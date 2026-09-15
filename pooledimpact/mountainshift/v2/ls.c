/*
 * ls.c — WASM module, does one thing: list a directory
 *
 * Same zero-import substrate as shell.c: ONE export, run(ptr, len),
 * no imports at all. Same request/response blob shape shell.c uses,
 * so an orchestrator (shell.wasm, or the host directly) can call any
 * command.wasm module the identical way -- ls.wasm just ignores the
 * fields it has no use for (uid, home, PATH). It has no command
 * table, no pipeline parser, no cd/whoami/grep/which/cat -- one job.
 *
 * Build:
 *   clang --target=wasm32 -O2 -ffreestanding -nostdlib -Wl,--no-entry \
 *         -Wl,--export=run -Wl,--initial-memory=1048576 \
 *         -Wl,--export-memory -o ls.wasm ls.c
 *
 * Request blob:  cwd\0 uid\0 home\0 PATH\0 cmdline\0 nfiles\0
 *                (path\0 length\0 <length raw bytes>){nfiles}
 * Response blob: new_cwd\0 rc\0 <remaining bytes are stdout>
 */

typedef unsigned char      u8;
typedef unsigned long long u64;
typedef signed   int       i32;
typedef unsigned long      usize;

#define NULL ((void *)0)
#define STDOUT_FILENO 1
#define STDERR_FILENO 2
#define O_RDONLY 0
#define MAX_PATH   4096
#define MAX_VFILES 64
#define MAX_VFDS   16
#define VFD_BASE   3

static usize str_len(const char *s) { const char *p = s; while (*p) p++; return (usize)(p - s); }
static int str_cmp(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return (u8)*a - (u8)*b; }
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

struct vfile { const char *path; const char *data; usize len; };
static struct vfile g_vfiles[MAX_VFILES];
static int g_nvfiles;
static const struct vfile *vfs_find(const char *path) {
    for (int i = 0; i < g_nvfiles; i++)
        if (str_cmp(g_vfiles[i].path, path) == 0) return &g_vfiles[i];
    return NULL;
}

struct vfd { const char *data; usize len; usize pos; int used; };
static struct vfd g_vfds[MAX_VFDS];

static i32 open(const char *path) {
    const struct vfile *f = vfs_find(path);
    if (!f) return -1;
    for (i32 i = 0; i < MAX_VFDS; i++) {
        if (!g_vfds[i].used) {
            g_vfds[i].data = f->data; g_vfds[i].len = f->len; g_vfds[i].pos = 0; g_vfds[i].used = 1;
            return i + VFD_BASE;
        }
    }
    return -1;
}
static void close_fd(i32 fd) { i32 i = fd - VFD_BASE; if (i >= 0 && i < MAX_VFDS) g_vfds[i].used = 0; }
static i32 read_fd(i32 fd, char *buf, i32 count) {
    i32 i = fd - VFD_BASE;
    if (i < 0 || i >= MAX_VFDS || !g_vfds[i].used) return -1;
    struct vfd *v = &g_vfds[i];
    usize remaining = v->len - v->pos;
    usize n = (usize)count < remaining ? (usize)count : remaining;
    mem_copy(buf, v->data + v->pos, n);
    v->pos += n;
    return (i32)n;
}

static const char *resolve_path(const char *path, const char *cwd, char *out, usize out_cap) {
    if (path[0] == '/') return path;
    usize cwd_len = str_len(cwd), path_len = str_len(path);
    int need_sep = (cwd_len == 0 || cwd[cwd_len - 1] != '/');
    usize total = cwd_len + (need_sep ? 1 : 0) + path_len;
    if (total >= out_cap) return path;
    mem_copy(out, cwd, cwd_len);
    usize pos = cwd_len;
    if (need_sep) out[pos++] = '/';
    mem_copy(out + pos, path, path_len + 1);
    return out;
}

/* Raw fd_readdir()-shaped dirent, matching what a real directory read
 * gives real userspace: fixed header + raw name bytes, no formatting.
 * ls.wasm's vfs table hands back this exact same raw shape for a
 * directory path (whoever built the request blob is responsible for
 * that, same contract shell.c's ls always had) -- turning it into a
 * printed listing is this file's one job. */
static void write_all(char *out, usize *out_len, usize cap, const char *buf, usize n) {
    usize room = cap - *out_len;
    if (n > room) n = room;
    mem_copy(out + *out_len, buf, n);
    *out_len += n;
}

static const char *take_field(const char **cursor, const char *end) {
    const char *start = *cursor, *p = start;
    while (p < end && *p != '\0') p++;
    if (p >= end) return NULL;
    *cursor = p + 1;
    return start;
}

__attribute__((export_name("run")))
i32 run(i32 ptr, i32 len) {
    g_nvfiles = 0;
    for (int i = 0; i < MAX_VFDS; i++) g_vfds[i].used = 0;

    const char *cursor = (const char *)(usize)ptr;
    const char *end = cursor + (usize)len;

    const char *cwd_field = take_field(&cursor, end);
    const char *uid_field = take_field(&cursor, end); (void)uid_field;
    const char *home_field = take_field(&cursor, end); (void)home_field;
    const char *path_field = take_field(&cursor, end); (void)path_field;
    const char *cmd_field = take_field(&cursor, end);
    const char *nfiles_field = take_field(&cursor, end);
    if (!cwd_field || !cmd_field || !nfiles_field) return 0;

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

    /* cmdline: "ls" or "ls PATH" -- tokenize in place, at most one arg. */
    char *cmd = (char *)cmd_field;
    char *sp = cmd;
    while (*sp && *sp != ' ') sp++;
    const char *arg = NULL;
    if (*sp) { *sp = '\0'; arg = sp + 1; while (*arg == ' ') arg++; if (!*arg) arg = NULL; }

    static char resolved[MAX_PATH];
    const char *path = arg ? resolve_path(arg, cwd_field, resolved, sizeof resolved) : cwd_field;

    static char stdout_buf[65536];
    usize stdout_len = 0;
    int rc = 0;

    i32 fd = open(path);
    if (fd < 0) {
        static const char msg[] = "ls: cannot access directory\n";
        write_all(stdout_buf, &stdout_len, sizeof stdout_buf, msg, sizeof msg - 1);
        rc = 1;
    } else {
        static char buf[32768];
        usize total = 0;
        for (;;) {
            i32 n = read_fd(fd, buf + total, (i32)(sizeof(buf) - total));
            if (n <= 0) break;
            total += (usize)n;
            if (total >= sizeof buf) break;
        }
        close_fd(fd);

        usize start = 0;
        for (usize i = 0; i < total; i++) {
            if (buf[i] == '\0') {
                if (i > start) {
                    write_all(stdout_buf, &stdout_len, sizeof stdout_buf, buf + start, i - start);
                    write_all(stdout_buf, &stdout_len, sizeof stdout_buf, "\n", 1);
                }
                start = i + 1;
            }
        }
        if (total > start) {
            write_all(stdout_buf, &stdout_len, sizeof stdout_buf, buf + start, total - start);
            write_all(stdout_buf, &stdout_len, sizeof stdout_buf, "\n", 1);
        }
    }

    /* Response: same fixed 1MB region shell.c uses, [total-2MB, total-1MB). */
    usize total_bytes = (usize)__builtin_wasm_memory_size(0) * 65536;
    usize output_cap = 1024 * 1024;
    char *out = (char *)(total_bytes - 2 * output_cap);
    usize out_len = 0;

    usize cwd_len = str_len(cwd_field);
    mem_copy(out, cwd_field, cwd_len + 1);
    out_len = cwd_len + 1;

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
