/*
 * curl.c — WASM module: a low-level curl. Same split real curl itself
 * uses: it doesn't reimplement TCP or TLS either -- it calls the OS's
 * socket()/connect()/send()/recv() (and hands crypto to a TLS library)
 * and does EVERYTHING else itself: building the raw HTTP/1.1 request
 * line and headers, and parsing the raw response (status line,
 * headers, Content-Length/chunked body) byte by byte. That's the line
 * this file draws too.
 *
 * Raw byte transport is the one thing that can't be pre-gathered the
 * way file bytes can (a live network round-trip can't be computed in
 * advance) -- so it's the one thing this file ever delegates, and it
 * delegates the SMALLEST possible primitive: "open this raw
 * connection, write these exact bytes, give me back everything until
 * it closes." Nothing HTTP-shaped ever crosses that boundary. Same
 * two-phase idiom as shell.c's EXEC marker:
 *
 *   Phase 1 (no /dev/socket_response file in the request): parse argv,
 *     parse the URL, build the raw HTTP/1.1 request bytes, respond
 *     with a SOCKET delegation instead of an answer.
 *   Phase 2 (/dev/socket_response present): the host already did the
 *     real connect+write+read and handed the raw response bytes back
 *     as a file, same mechanism whoami already uses for /etc/passwd.
 *     This file parses the status line, headers, and
 *     Content-Length/chunked body, and writes the real answer.
 *
 * curl.wasm is stateless like ls.wasm -- nothing needs to survive
 * between phase 1 and phase 2 except what's already in the re-sent
 * cmdline, so the host is free to use a fresh instance for each call.
 *
 * Build:
 *   clang --target=wasm32 -O2 -ffreestanding -nostdlib -Wl,--no-entry \
 *         -Wl,--export=run -Wl,--initial-memory=4194304 \
 *         -Wl,--export-memory -o curl.wasm curl.c
 *
 * Request blob:  cwd\0 uid\0 home\0 PATH\0 cmdline\0 stdinlen\0
 *                <stdinlen raw bytes> nfiles\0
 *                (path\0 length\0 <length raw bytes>){nfiles}
 *   cmdline: curl --request GET|POST --url URL [--header 'K: V']...
 *            [--data BODY] [-i|--include] [--cookie|-b 'name=value; ...']
 *   No automatic cookie jar (same as real curl without -c/-b <file>):
 *   whoever wants a Set-Cookie from one response to reach the next
 *   request passes it back in explicitly via --cookie, same as
 *   sequencing curl calls in a real shell script would.
 *   /dev/socket_response (phase 2 only): the raw bytes read off the
 *   real socket, verbatim.
 *
 * Response blob (phase 1) -- a delegation, not an answer, same shape
 * as shell.c's own EXEC marker (no new_cwd/rc prefix):
 *   SOCKET\0host\0port\0tls\0requestlen\0<requestlen raw bytes>
 * Response blob (phase 2): new_cwd\0 rc\0 <stdout: the real answer>
 */

typedef unsigned char      u8;
typedef signed   int       i32;
typedef unsigned long      usize;

#define NULL ((void *)0)
#define STDOUT_FILENO 1
#define MAX_ARGS    32
#define MAX_HEADERS 16
#define MAX_VFILES  8

static usize str_len(const char *s) { const char *p = s; while (*p) p++; return (usize)(p - s); }
static int str_cmp(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return (u8)*a - (u8)*b; }
static int str_ncmp(const char *a, const char *b, usize n) { while (n && *a && *a == *b) { a++; b++; n--; } return n ? (u8)*a - (u8)*b : 0; }
static char *str_chr(const char *s, int c) { while (*s) { if (*s == (char)c) return (char *)s; s++; } return NULL; }
static char *str_str(const char *hay, const char *needle) {
    if (!*needle) return (char *)hay;
    for (; *hay; hay++) {
        const char *h = hay, *n = needle;
        while (*h && *n && *h == *n) { h++; n++; }
        if (!*n) return (char *)hay;
    }
    return NULL;
}
static void mem_copy(void *d, const void *s, usize n) { u8 *dp = d; const u8 *sp = s; while (n--) *dp++ = *sp++; }
static int parse_int(const char *s) { int v = 0; while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); s++; } return v; }
static int parse_hex(const char *s, const char **end) {
    int v = 0;
    while (1) {
        char c = *s;
        int d;
        if (c >= '0' && c <= '9') d = c - '0';
        else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
        else break;
        v = v * 16 + d;
        s++;
    }
    if (end) *end = s;
    return v;
}
static usize write_uint(char *out, usize v) {
    char tmp[24]; int n = 0;
    if (v == 0) tmp[n++] = '0';
    while (v > 0) { tmp[n++] = (char)('0' + (v % 10)); v /= 10; }
    for (int i = 0; i < n; i++) out[i] = tmp[n - 1 - i];
    out[n] = '\0';
    return (usize)n;
}

static void write_all(char *out, usize *out_len, usize cap, const char *buf, usize n) {
    usize room = cap - *out_len;
    if (n > room) n = room;
    mem_copy(out + *out_len, buf, n);
    *out_len += n;
}
static void write_str(char *out, usize *out_len, usize cap, const char *s) {
    write_all(out, out_len, cap, s, str_len(s));
}

struct vfile { const char *path; const char *data; usize len; };
static struct vfile g_vfiles[MAX_VFILES];
static int g_nvfiles;
static const struct vfile *vfs_find(const char *path) {
    for (int i = 0; i < g_nvfiles; i++)
        if (str_cmp(g_vfiles[i].path, path) == 0) return &g_vfiles[i];
    return NULL;
}

static const char *take_field(const char **cursor, const char *end) {
    const char *start = *cursor, *p = start;
    while (p < end && *p != '\0') p++;
    if (p >= end) return NULL;
    *cursor = p + 1;
    return start;
}

/* Same quoting a real shell gives a real curl -- 'Authorization: Basic
 * abc' has to survive as ONE argv entry. shell.c's own tokenizer never
 * needed this (none of its builtins take a value with a space in it),
 * so this is curl.c's own, applied only to curl.c's own cmdline. */
static int tokenize_curl(char *s, char **argv) {
    int argc = 0;
    char *p = s;
    while (*p && argc < MAX_ARGS - 1) {
        while (*p == ' ' || *p == '\t') p++;
        if (!*p) break;
        if (*p == '\'') {
            p++;
            argv[argc++] = p;
            char *q = str_chr(p, '\'');
            if (q) { *q = '\0'; p = q + 1; } else { p += str_len(p); }
        } else {
            argv[argc++] = p;
            while (*p && *p != ' ' && *p != '\t') p++;
            if (*p) *p++ = '\0';
        }
    }
    argv[argc] = NULL;
    return argc;
}

struct url_parts { char scheme[8]; char host[256]; int port; char path[2048]; };

static void parse_url(const char *url, struct url_parts *u) {
    u->scheme[0] = '\0'; u->host[0] = '\0'; u->port = 0;
    u->path[0] = '/'; u->path[1] = '\0';

    const char *p = url;
    const char *scheme_end = str_str(p, "://");
    if (scheme_end) {
        usize slen = (usize)(scheme_end - p);
        if (slen >= sizeof u->scheme) slen = sizeof u->scheme - 1;
        mem_copy(u->scheme, p, slen); u->scheme[slen] = '\0';
        p = scheme_end + 3;
    } else {
        mem_copy(u->scheme, "http", 5);
    }

    const char *path_start = str_chr(p, '/');
    const char *hostport_end = path_start ? path_start : p + str_len(p);
    const char *colon = NULL;
    for (const char *c = p; c < hostport_end; c++) if (*c == ':') { colon = c; break; }

    usize host_len = (usize)((colon ? colon : hostport_end) - p);
    if (host_len >= sizeof u->host) host_len = sizeof u->host - 1;
    mem_copy(u->host, p, host_len); u->host[host_len] = '\0';

    if (colon) {
        char portbuf[8];
        usize plen = (usize)(hostport_end - (colon + 1));
        if (plen >= sizeof portbuf) plen = sizeof portbuf - 1;
        mem_copy(portbuf, colon + 1, plen); portbuf[plen] = '\0';
        u->port = parse_int(portbuf);
    } else {
        u->port = (str_cmp(u->scheme, "https") == 0) ? 443 : 80;
    }

    if (path_start) {
        usize plen = str_len(path_start);
        if (plen >= sizeof u->path) plen = sizeof u->path - 1;
        mem_copy(u->path, path_start, plen); u->path[plen] = '\0';
    }
}

/* Phase 1: parse argv + URL, build the raw HTTP/1.1 request, respond
 * with a SOCKET delegation naming only host/port/tls and the exact
 * bytes to send -- nothing here is a call the host interprets. */
static i32 respond_socket_request(char *cmd_field, char *out) {
    static char argbuf[8192];
    usize cmdlen = str_len(cmd_field);
    if (cmdlen >= sizeof argbuf) cmdlen = sizeof argbuf - 1;
    mem_copy(argbuf, cmd_field, cmdlen);
    argbuf[cmdlen] = '\0';

    char *argv[MAX_ARGS];
    int argc = tokenize_curl(argbuf, argv);

    const char *method = "GET";
    const char *url = NULL;
    const char *headers[MAX_HEADERS];
    int nheaders = 0;
    const char *body = NULL;
    const char *cookie = NULL;

    for (int i = 1; i < argc; i++) {
        if (str_cmp(argv[i], "--request") == 0 && i + 1 < argc) method = argv[++i];
        else if (str_cmp(argv[i], "--url") == 0 && i + 1 < argc) url = argv[++i];
        else if (str_cmp(argv[i], "--header") == 0 && i + 1 < argc && nheaders < MAX_HEADERS) headers[nheaders++] = argv[++i];
        else if (str_cmp(argv[i], "--data") == 0 && i + 1 < argc) body = argv[++i];
        else if ((str_cmp(argv[i], "--cookie") == 0 || str_cmp(argv[i], "-b") == 0) && i + 1 < argc) cookie = argv[++i];
    }
    if (!url) return 0;

    struct url_parts u;
    parse_url(url, &u);
    int tls = (str_cmp(u.scheme, "https") == 0);

    static char req[16384];
    usize req_len = 0;
    write_str(req, &req_len, sizeof req, method);
    write_str(req, &req_len, sizeof req, " ");
    write_str(req, &req_len, sizeof req, u.path);
    write_str(req, &req_len, sizeof req, " HTTP/1.1\r\nHost: ");
    write_str(req, &req_len, sizeof req, u.host);
    write_str(req, &req_len, sizeof req, "\r\n");
    for (int i = 0; i < nheaders; i++) {
        write_str(req, &req_len, sizeof req, headers[i]);
        write_str(req, &req_len, sizeof req, "\r\n");
    }
    if (cookie) {
        write_str(req, &req_len, sizeof req, "Cookie: ");
        write_str(req, &req_len, sizeof req, cookie);
        write_str(req, &req_len, sizeof req, "\r\n");
    }
    usize body_len = body ? str_len(body) : 0;
    if (body) {
        char numbuf[24];
        write_str(req, &req_len, sizeof req, "Content-Length: ");
        write_all(req, &req_len, sizeof req, numbuf, write_uint(numbuf, body_len));
        write_str(req, &req_len, sizeof req, "\r\n");
    }
    write_str(req, &req_len, sizeof req, "Connection: close\r\n\r\n");
    if (body) write_all(req, &req_len, sizeof req, body, body_len);

    usize out_len = 0;
    static const char marker[] = "SOCKET";
    mem_copy(out, marker, sizeof marker);
    out_len = sizeof marker;
    write_str(out, &out_len, 1024 * 1024, u.host);
    out[out_len++] = '\0';
    char numbuf[24];
    write_all(out, &out_len, 1024 * 1024, numbuf, write_uint(numbuf, (usize)u.port));
    out[out_len++] = '\0';
    out[out_len++] = tls ? '1' : '0';
    out[out_len++] = '\0';
    write_all(out, &out_len, 1024 * 1024, numbuf, write_uint(numbuf, req_len));
    out[out_len++] = '\0';
    write_all(out, &out_len, 1024 * 1024, req, req_len);
    return (i32)out_len;
}

/* Phase 2: the host already did the real connect+write+read. Parse
 * the raw response bytes (status line, headers, Content-Length or
 * chunked body) and write the real answer -- exactly what real curl's
 * own response parser does, none of it delegated. */
static void render_response(const char *raw, usize raw_len, int include_headers, char *stdout_buf, usize *stdout_len, usize cap) {
    const char *headers_end = NULL;
    for (usize i = 0; i + 3 < raw_len; i++) {
        if (raw[i] == '\r' && raw[i+1] == '\n' && raw[i+2] == '\r' && raw[i+3] == '\n') { headers_end = raw + i; break; }
    }
    if (!headers_end) { write_all(stdout_buf, stdout_len, cap, raw, raw_len); return; }

    usize header_block_len = (usize)(headers_end - raw);
    const char *body = headers_end + 4;
    usize body_len = raw_len - header_block_len - 4;

    if (include_headers) {
        write_all(stdout_buf, stdout_len, cap, raw, header_block_len);
        write_str(stdout_buf, stdout_len, cap, "\r\n\r\n");
    }

    int chunked = 0;
    {
        static char hdrs[8192];
        usize n = header_block_len < sizeof hdrs - 1 ? header_block_len : sizeof hdrs - 1;
        mem_copy(hdrs, raw, n); hdrs[n] = '\0';
        for (char *line = hdrs; line && *line; ) {
            char *nl = str_chr(line, '\n');
            if (nl) *nl = '\0';
            if (str_ncmp(line, "Transfer-Encoding:", 18) == 0 && str_str(line, "chunked")) chunked = 1;
            line = nl ? nl + 1 : NULL;
        }
    }

    if (!chunked) {
        write_all(stdout_buf, stdout_len, cap, body, body_len);
        return;
    }

    const char *p = body, *end = body + body_len;
    while (p < end) {
        const char *hexend;
        int size = parse_hex(p, &hexend);
        if (hexend == p || size < 0) break;
        p = hexend;
        if (p + 1 < end && p[0] == '\r' && p[1] == '\n') p += 2;
        if (size == 0) break;
        usize n = (usize)size;
        if (p + n > end) n = (usize)(end - p);
        write_all(stdout_buf, stdout_len, cap, p, n);
        p += n;
        if (p + 1 < end && p[0] == '\r' && p[1] == '\n') p += 2;
    }
}

__attribute__((export_name("run")))
i32 run(i32 ptr, i32 len) {
    g_nvfiles = 0;

    const char *cursor = (const char *)(usize)ptr;
    const char *end = cursor + (usize)len;

    const char *cwd_field = take_field(&cursor, end);
    const char *uid_field = take_field(&cursor, end); (void)uid_field;
    const char *home_field = take_field(&cursor, end); (void)home_field;
    const char *path_field = take_field(&cursor, end); (void)path_field;
    const char *cmd_field = take_field(&cursor, end);
    const char *stdinlen_field = take_field(&cursor, end);
    if (!cwd_field || !cmd_field || !stdinlen_field) return 0;

    usize stdin_len = (usize)parse_int(stdinlen_field);
    if (cursor + stdin_len > end) return 0;
    cursor += stdin_len; /* curl doesn't read stdin -- just skip past it */

    const char *nfiles_field = take_field(&cursor, end);
    if (!nfiles_field) return 0;

    int nfiles = parse_int(nfiles_field);
    for (int i = 0; i < nfiles && i < MAX_VFILES; i++) {
        const char *path_f = take_field(&cursor, end);
        const char *len_f  = take_field(&cursor, end);
        if (!path_f || !len_f) break;
        usize flen = (usize)parse_int(len_f);
        if (cursor + flen > end) break;
        g_vfiles[g_nvfiles].path = path_f;
        g_vfiles[g_nvfiles].data = cursor;
        g_vfiles[g_nvfiles].len = flen;
        g_nvfiles++;
        cursor += flen;
    }

    usize total_bytes = (usize)__builtin_wasm_memory_size(0) * 65536;
    usize output_cap = 1024 * 1024;
    char *out = (char *)(total_bytes - 2 * output_cap);

    const struct vfile *sock_response = vfs_find("/dev/socket_response");

    static char cmdcopy[8192];
    usize cmdlen = str_len(cmd_field);
    if (cmdlen >= sizeof cmdcopy) cmdlen = sizeof cmdcopy - 1;
    mem_copy(cmdcopy, cmd_field, cmdlen); cmdcopy[cmdlen] = '\0';

    if (!sock_response) {
        i32 socklen = respond_socket_request(cmdcopy, out);
        if (socklen > 0) return socklen;
        /* malformed request (no --url): fall through to a normal error answer */
    }

    static char stdout_buf[1024 * 1024 - 4096];
    usize stdout_len = 0;
    int rc = 0;

    if (sock_response) {
        int include_headers = (str_str(cmdcopy, " -i") != NULL) || (str_str(cmdcopy, "--include") != NULL);
        render_response(sock_response->data, sock_response->len, include_headers, stdout_buf, &stdout_len, sizeof stdout_buf);
    } else {
        write_str(stdout_buf, &stdout_len, sizeof stdout_buf, "curl: usage: curl --request METHOD --url URL [--header 'K: V'] [--data BODY]\n");
        rc = 2;
    }

    usize cwd_len = str_len(cwd_field);
    mem_copy(out, cwd_field, cwd_len + 1);
    usize out_len = cwd_len + 1;

    char rcbuf[24];
    usize rclen = write_uint(rcbuf, (usize)rc);
    mem_copy(out + out_len, rcbuf, rclen + 1);
    out_len += rclen + 1;

    usize room = output_cap - out_len;
    if (stdout_len > room) stdout_len = room;
    mem_copy(out + out_len, stdout_buf, stdout_len);
    out_len += stdout_len;

    return (i32)out_len;
}
