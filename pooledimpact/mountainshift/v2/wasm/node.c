/*
 * node.c — WASM module: run a real `node` process, on a whitelist,
 * as a genuinely long-running external program.
 *
 * Same split as curl.c: the one thing that can't be pre-gathered or
 * computed in this module (a live process's real execution) is the
 * only thing ever delegated, and the smallest possible primitive is
 * delegated -- "start this exact program with these exact args, feed
 * it this exact stdin, give me back its real stdout/stderr/exit code
 * once it's done." Nothing about WHAT node.js does is interpreted
 * here; this file only ever decides that the program to run is
 * literally "node" (hardcoded, never taken from argv) and builds the
 * argv to hand it -- the same shape curl.c always builds an HTTP
 * request but never lets argv name an arbitrary raw byte target
 * beyond what --url resolves to.
 *
 * The whitelist itself lives on the host side (ShellHost.js), as
 * defense in depth: even though this file can only ever ASK to run
 * "node", the host is still the one that decides whether to honor
 * that ask, exactly like curl.wasm's SOCKET request doesn't mean the
 * host blindly connects to any host without the possibility of a
 * host-side policy layer.
 *
 * Two-phase idiom, identical to curl.c's SOCKET marker:
 *   Phase 1 (no /dev/exec_response file in the request): parse argv,
 *     respond with a SPAWN delegation instead of an answer.
 *   Phase 2 (/dev/exec_response present): the host already ran the
 *     real process and handed back its exit code + real stdout/stderr
 *     as a file. Parse it and write the real answer.
 *
 * Build:
 *   clang --target=wasm32 -O2 -ffreestanding -nostdlib -Wl,--no-entry \
 *         -Wl,--export=run -Wl,--initial-memory=4194304 \
 *         -Wl,--export-memory -o node.wasm node.c
 *
 * Request blob:  cwd\0 uid\0 home\0 PATH\0 cmdline\0 stdinlen\0
 *                <stdinlen raw bytes> nfiles\0
 *                (path\0 length\0 <length raw bytes>){nfiles}
 *   cmdline: node [any real node argv, quote-aware -- e.g.
 *            node --eval 'console.log(1+1)']
 *   /dev/exec_response (phase 2 only): exit_code\0 stdout_len\0
 *     <stdout_len raw bytes> stderr_len\0 <stderr_len raw bytes>
 *
 * Response blob (phase 1) -- a delegation, not an answer:
 *   SPAWN\0node\0argc\0(arg\0){argc}stdinlen\0<stdinlen raw bytes>
 * Response blob (phase 2): new_cwd\0 rc\0 <stdout: real stdout+stderr>
 */

typedef unsigned char      u8;
typedef signed   int       i32;
typedef unsigned long      usize;

#define NULL ((void *)0)
#define MAX_ARGS   32
#define MAX_VFILES 8

static usize str_len(const char *s) { const char *p = s; while (*p) p++; return (usize)(p - s); }
static int str_cmp(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return (u8)*a - (u8)*b; }
static char *str_chr(const char *s, int c) { while (*s) { if (*s == (char)c) return (char *)s; s++; } return NULL; }
static void mem_copy(void *d, const void *s, usize n) { u8 *dp = d; const u8 *sp = s; while (n--) *dp++ = *sp++; }
static int parse_int(const char *s) { int v = 0; while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); s++; } return v; }
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

/* Same single-quote-aware tokenizer curl.c has -- an argument like
 * --eval 'console.log(1+1)' has to survive as one argv entry, and
 * this file's own cmdline still carries whatever quote characters
 * were in it (JS's pipeline splitter only breaks on `|`). */
static int tokenize_quoted(char *s, char **argv) {
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
    const char *stdin_data = cursor;
    cursor += stdin_len;

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

    const struct vfile *exec_response = vfs_find("/dev/exec_response");

    if (!exec_response) {
        static char cmdcopy[8192];
        usize cmdlen = str_len(cmd_field);
        if (cmdlen >= sizeof cmdcopy) cmdlen = sizeof cmdcopy - 1;
        mem_copy(cmdcopy, cmd_field, cmdlen); cmdcopy[cmdlen] = '\0';

        char *argv[MAX_ARGS];
        int argc = tokenize_quoted(cmdcopy, argv);
        /* argv[0] is "node" itself -- never forwarded as an arg to the
         * real node binary, same as a shell never passes argv[0] of
         * the command line back to itself as an argument. */

        usize out_len = 0;
        static const char marker[] = "SPAWN";
        mem_copy(out, marker, sizeof marker);
        out_len = sizeof marker;
        write_str(out, &out_len, output_cap, "node");
        out[out_len++] = '\0';

        char numbuf[24];
        int real_argc = argc > 0 ? argc - 1 : 0;
        write_all(out, &out_len, output_cap, numbuf, write_uint(numbuf, (usize)real_argc));
        out[out_len++] = '\0';
        for (int i = 1; i < argc; i++) {
            write_str(out, &out_len, output_cap, argv[i]);
            out[out_len++] = '\0';
        }
        write_all(out, &out_len, output_cap, numbuf, write_uint(numbuf, stdin_len));
        out[out_len++] = '\0';
        write_all(out, &out_len, output_cap, stdin_data, stdin_len);
        return (i32)out_len;
    }

    /* Phase 2: the host already ran the real node process. Parse its
     * exit code and real stdout/stderr out of the file it handed
     * back -- same idiom whoami uses reading /etc/passwd. */
    const char *rcur = exec_response->data;
    const char *rend = exec_response->data + exec_response->len;

    const char *exit_field = take_field(&rcur, rend);
    const char *outlen_field = take_field(&rcur, rend);
    int rc = 0;
    static char stdout_buf[1024 * 1024 - 4096];
    usize stdout_len = 0;

    if (exit_field && outlen_field) {
        rc = parse_int(exit_field);
        usize out_data_len = (usize)parse_int(outlen_field);
        if (rcur + out_data_len <= rend) {
            write_all(stdout_buf, &stdout_len, sizeof stdout_buf, rcur, out_data_len);
            rcur += out_data_len;
        }
        const char *errlen_field = take_field(&rcur, rend);
        if (errlen_field) {
            usize err_data_len = (usize)parse_int(errlen_field);
            if (rcur + err_data_len <= rend) write_all(stdout_buf, &stdout_len, sizeof stdout_buf, rcur, err_data_len);
        }
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
