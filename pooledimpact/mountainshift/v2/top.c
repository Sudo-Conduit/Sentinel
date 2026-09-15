/*
 * top.c — WASM module, does one thing: render a snapshot of the job
 * table JS is tracking.
 *
 * Same zero-import substrate as ls.c/shell.c -- ONE export, run(ptr,
 * len), no imports. But unlike ls.c (a fresh instance per call,
 * stateless), top is the test case for a command that has to survive
 * ACROSS calls: JS keeps ONE instance of this module alive for the
 * lifetime of the job, calling run() repeatedly (a "tick"), and this
 * file's own linear memory is where the running tick count lives --
 * there is no other place it could live, since nothing crosses this
 * module's boundary except one request blob in, one response blob out
 * per call. run() resets the usual per-call scratch state (vfs table,
 * fd table, environ) exactly like every other module, but deliberately
 * leaves g_ticks alone -- that's the one piece of state this file
 * intends to survive from one call to the next.
 *
 * top never decides it's "finished" on its own -- same as real top, it
 * runs until something else stops asking it to tick. Whether that's a
 * fixed tick count, a user hitting kill, or a background job control
 * layer, is entirely JS's call; this file only ever renders whatever
 * job-table snapshot it's handed for whichever phase it's asked to
 * render.
 *
 * Real content (the actual job table: which pids exist, their state,
 * their command line) never arrives via a call this file makes -- it
 * can't, there's no import to make it through. JS gathers that from
 * its OWN job table (the one thing only JS can know, since JS is the
 * one thing that ever decided to run a command anywhere) and hands it
 * in via the standard vfile mechanism, as if it were a real file at
 * /proc/jobs -- same idiom whoami already uses for /etc/passwd.
 *
 * Build:
 *   clang --target=wasm32 -O2 -ffreestanding -nostdlib -Wl,--no-entry \
 *         -Wl,--export=run -Wl,--initial-memory=4194304 \
 *         -Wl,--export-memory -o top.wasm top.c
 *
 * Request blob:  cwd\0 uid\0 home\0 PATH\0 cmdline\0 stdinlen\0
 *                <stdinlen raw bytes> nfiles\0
 *                (path\0 length\0 <length raw bytes>){nfiles}
 *   cmdline is one of:
 *     "top"         -- start: reset the tick counter to 0
 *     "top --tick"  -- advance one tick, render the current snapshot
 *     "top --stop"  -- render one final snapshot, do not advance
 *   /proc/jobs (if present among the request's files) holds the real
 *   snapshot content: one line per job, tab-separated
 *   "pid\tstate\tcmdline\n".
 *
 * Response blob: new_cwd\0 rc\0 <remaining bytes are stdout>
 */

typedef unsigned char      u8;
typedef unsigned long long u64;
typedef signed   int       i32;
typedef unsigned long      usize;

#define NULL ((void *)0)
#define STDOUT_FILENO 1
#define O_RDONLY 0
#define MAX_VFILES 8
#define MAX_VFDS   4
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

static void write_all(char *out, usize *out_len, usize cap, const char *buf, usize n) {
    usize room = cap - *out_len;
    if (n > room) n = room;
    mem_copy(out + *out_len, buf, n);
    *out_len += n;
}
static void write_str(char *out, usize *out_len, usize cap, const char *s) {
    write_all(out, out_len, cap, s, str_len(s));
}

static const char *take_field(const char **cursor, const char *end) {
    const char *start = *cursor, *p = start;
    while (p < end && *p != '\0') p++;
    if (p >= end) return NULL;
    *cursor = p + 1;
    return start;
}

/* The one piece of state this file exists to prove can survive across
 * calls: run() never resets this. It only survives because JS keeps
 * the SAME WebAssembly.Instance alive for a job's whole lifetime --
 * a fresh instance (fresh linear memory) would zero it right back to
 * 0, same as sh.cwd would reset in shell.c if every call got a new
 * instance instead of a threaded request field. */
static usize g_ticks;

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
    const char *stdinlen_field = take_field(&cursor, end);
    if (!cwd_field || !cmd_field || !stdinlen_field) return 0;

    usize stdin_len = (usize)parse_int(stdinlen_field);
    if (cursor + stdin_len > end) return 0;
    cursor += stdin_len; /* top doesn't read stdin -- just skip past it */

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

    /* cmdline is "top", "top --tick", or "top --stop" -- the only
     * argument this file ever looks at. */
    int is_tick = (str_cmp(cmd_field, "top --tick") == 0);
    int is_stop = (str_cmp(cmd_field, "top --stop") == 0);
    if (!is_tick && !is_stop) g_ticks = 0; /* "top" (start) */
    else if (is_tick) g_ticks++;

    static char stdout_buf[65536];
    usize stdout_len = 0;

    write_str(stdout_buf, &stdout_len, sizeof stdout_buf, "top - tick ");
    char numbuf[24];
    write_all(stdout_buf, &stdout_len, sizeof stdout_buf, numbuf, write_uint(numbuf, g_ticks));
    write_str(stdout_buf, &stdout_len, sizeof stdout_buf, is_stop ? " (stopped)\n" : "\n");
    write_str(stdout_buf, &stdout_len, sizeof stdout_buf, "PID\tSTATE\tCMD\n");

    i32 fd = open("/proc/jobs");
    if (fd < 0) {
        write_str(stdout_buf, &stdout_len, sizeof stdout_buf, "(no jobs)\n");
    } else {
        static char buf[16384];
        usize total = 0;
        for (;;) {
            i32 n = read_fd(fd, buf + total, (i32)(sizeof(buf) - total));
            if (n <= 0) break;
            total += (usize)n;
            if (total >= sizeof buf) break;
        }
        close_fd(fd);
        write_all(stdout_buf, &stdout_len, sizeof stdout_buf, buf, total);
    }

    usize total_bytes = (usize)__builtin_wasm_memory_size(0) * 65536;
    usize output_cap = 1024 * 1024;
    char *out = (char *)(total_bytes - 2 * output_cap);
    usize out_len = 0;

    usize cwd_len = str_len(cwd_field);
    mem_copy(out, cwd_field, cwd_len + 1);
    out_len = cwd_len + 1;

    char rcbuf[24];
    usize rclen = write_uint(rcbuf, 0);
    mem_copy(out + out_len, rcbuf, rclen + 1);
    out_len += rclen + 1;

    usize room = output_cap - out_len;
    if (stdout_len > room) stdout_len = room;
    mem_copy(out + out_len, stdout_buf, stdout_len);
    out_len += stdout_len;

    return (i32)out_len;
}
