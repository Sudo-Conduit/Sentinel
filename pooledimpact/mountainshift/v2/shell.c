/*
 * shell.c — WASM module
 *
 * Build (freestanding, no libc):
 *   clang --target=wasm32 -O2 -ffreestanding -nostdlib -Wl,--no-entry \
 *         -Wl,--export=run -Wl,--initial-memory=4194304 \
 *         -Wl,--export-memory -o shell.wasm shell.c
 *
 * Design:
 *   - ONE export: run(ptr, len) -> i32 (the response blob's length).
 *     Nothing else. WebAssembly.Module.imports(this module) is empty
 *     -- there is no "host" surface at all, not even a name for one.
 *   - The host's only two operations, ever: write a request blob into
 *     this module's OWN linear memory at a fixed offset, call run(),
 *     then read a response blob back out of another fixed offset. No
 *     function of any kind crosses the boundary in either direction --
 *     same shape as this project's own memorymap.c (a shared flat
 *     buffer at fixed byte offsets, gated by a couple of exported
 *     entry points), just with one entry point instead of several.
 *   - Real content (file bytes, a directory's raw listing, /etc/passwd,
 *     the real uid) never arrives via a call shell.c makes mid-
 *     execution -- there IS no mid-execution call to make. Whoever
 *     prepares the request blob (fetching real bytes however it
 *     likes, entirely outside any WASM interaction) bundles everything
 *     a command might touch into the SAME string this module already
 *     only ever needed: a request in, a response out.
 *   - Request blob: cwd\0 uid\0 home\0 PATH\0 cmdline\0 nfiles\0
 *     (path\0 length\0 <length raw bytes>){nfiles} -- length-prefixed
 *     file content, not NUL-terminated, because file bytes can
 *     legitimately contain a NUL (this project's own MemoryMapArena.js
 *     already documents exactly why an in-band terminator is the wrong
 *     call for raw byte payloads).
 *   - Response blob is either new_cwd\0 rc\0 <stdout>, OR, when the
 *     parsed command names a module this file has no implementation
 *     of (ls first), EXEC\0 cmdline\0 -- a delegation, not an answer.
 *     Whoever is driving this module runs the named command.wasm
 *     itself (same request/response shape) and treats ITS response as
 *     the real answer. This file only ever decides WHICH module to
 *     ask for; it never sees what that module actually does.
 *   - Multi-stage pipelines don't spawn anything -- there's no host to
 *     spawn via. Each stage is a plain function call within this same
 *     run(), stdout redirected to a small in-memory buffer that
 *     becomes the next stage's stdin.
 *   - All state in linear memory, allocated from a bump arena.
 *   - No libc. Hand-declared. Own contracts.
 *
 * v1.0 — First stable cut of the zero-import design. Commands (cat,
 *   grep, ls, whoami, which, cd) run entirely in C against a virtual
 *   file table populated once per run() from the request blob; no
 *   function this file declares is ever fulfilled by anything outside
 *   the module. Confirmed live: whoami, real directory listings (via
 *   a real filesystem snapshot bundled into the request), cd, two
 *   real pipelines, and both real failure cases (missing file, unknown
 *   command).
 */

/* ------------------------------------------------------------------ */
/* Types — hand-declared, no <stdint.h>                                */
/* ------------------------------------------------------------------ */

typedef unsigned char      u8;
typedef unsigned short     u16;
typedef unsigned int       u32;
typedef unsigned long long u64;
typedef signed   int       i32;
typedef signed   long long i64;
typedef unsigned long      usize;
typedef long               isize;

#define NULL ((void *)0)
#define TRUE  1
#define FALSE 0

/* ------------------------------------------------------------------ */
/* WASM memory intrinsics                                              */
/* ------------------------------------------------------------------ */

extern u8 __heap_base;

/* ------------------------------------------------------------------ */
/* Hand-rolled string / memory — no <string.h>                         */
/* ------------------------------------------------------------------ */

static usize str_len(const char *s) {
    const char *p = s;
    while (*p) p++;
    return (usize)(p - s);
}

static int str_cmp(const char *a, const char *b) {
    while (*a && *a == *b) { a++; b++; }
    return (u8)*a - (u8)*b;
}

static char *str_chr(const char *s, int c) {
    while (*s) { if (*s == (char)c) return (char *)s; s++; }
    return NULL;
}

static char *str_str(const char *hay, const char *needle) {
    if (!*needle) return (char *)hay;
    for (; *hay; hay++) {
        const char *h = hay, *n = needle;
        while (*h && *n && *h == *n) { h++; n++; }
        if (!*n) return (char *)hay;
    }
    return NULL;
}

static void mem_copy(void *d, const void *s, usize n) {
    u8 *dp = d; const u8 *sp = s;
    while (n--) *dp++ = *sp++;
}

static void mem_set(void *d, int c, usize n) {
    u8 *dp = d;
    while (n--) *dp++ = (u8)c;
}

static int mem_cmp(const void *a, const void *b, usize n) {
    const u8 *pa = a, *pb = b;
    while (n--) { if (*pa != *pb) return (int)*pa - (int)*pb; pa++; pb++; }
    return 0;
}

static int parse_int(const char *s) {
    int v = 0, neg = 0;
    if (*s == '-') { neg = 1; s++; }
    while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); s++; }
    return neg ? -v : v;
}

/* Writes the decimal digits of v (>= 0) to out, NUL-terminated.
 * Returns the number of digit characters written (not counting the
 * NUL). No fprintf/itoa -- hand-rolled, same discipline as the rest
 * of this file. */
static usize write_uint(char *out, usize v) {
    char tmp[24];
    int n = 0;
    if (v == 0) tmp[n++] = '0';
    while (v > 0) { tmp[n++] = (char)('0' + (v % 10)); v /= 10; }
    for (int i = 0; i < n; i++) out[i] = tmp[n - 1 - i];
    out[n] = '\0';
    return (usize)n;
}

/* ------------------------------------------------------------------ */
/* Bump arena — mmap-equivalent for WASM                               */
/* ------------------------------------------------------------------ */

static u8  *arena_base = NULL;
static u8  *arena_ptr  = NULL;
static usize arena_cap = 0;

static void alloc_init(void) {
    arena_base = &__heap_base;
    usize a = (usize)arena_base;
    a = (a + 7) & ~(usize)7;
    arena_base = (u8 *)a;
    arena_ptr  = arena_base;
    /* Must comfortably fit the 1MB stdout_buf run() allocates from it
     * (plus the cmdline copy and any pipeline stage buffers), while
     * staying clear of the 2MB response/request region reserved at
     * the top of the module's 4MB total memory. */
    arena_cap  = 1536 * 1024;
}

static void *arena_alloc(usize n) {
    usize a = (usize)arena_ptr;
    a = (a + 7) & ~(usize)7;
    if (a + n > (usize)arena_base + arena_cap) return NULL;
    arena_ptr = (u8 *)(a + n);
    return (void *)a;
}

static void arena_reset(void) {
    arena_ptr = arena_base;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

#define STDIN_FILENO   0
#define STDOUT_FILENO  1
#define STDERR_FILENO  2

#define O_RDONLY       0
#define F_OK 0
#define X_OK 1

#define MAX_STAGES 16
#define MAX_ARGS   64
#define MAX_LINE   8192
#define MAX_PATH   4096
#define MAX_ENVIRON 4096
#define MAX_VFILES  64   /* how many real (path, content) pairs a single request can carry */
#define MAX_VFDS    16   /* how many of those a single command run can have open at once */

/* ------------------------------------------------------------------ */
/* Virtual filesystem — populated ONCE per run() from the request      */
/* blob, never touched again after that                                */
/* ------------------------------------------------------------------ */

struct vfile { const char *path; const char *data; usize len; };
static struct vfile g_vfiles[MAX_VFILES];
static int g_nvfiles;

static const struct vfile *vfs_find(const char *path) {
    for (int i = 0; i < g_nvfiles; i++) {
        if (str_cmp(g_vfiles[i].path, path) == 0) return &g_vfiles[i];
    }
    return NULL;
}

struct vfd { const char *data; usize len; usize pos; int used; };
static struct vfd g_vfds[MAX_VFDS];

/*
 * open()/close()/read()/write()/access()/chdir() below have the real
 * POSIX shapes, but they are ordinary static C functions now, not
 * imports -- there is no host on the other side of them any more.
 * "Opening a file" means finding it in the vfs table the request blob
 * already populated; "reading" it means copying out of memory this
 * module already owns. Nothing here reaches outside the module.
 */
/* vfd slots start at 3 -- 0/1/2 are reserved for stdin/stdout/stderr,
 * exactly like a real fd table. Returning a raw array index starting
 * at 0 here would collide fd 0 (the first opened file) with
 * STDIN_FILENO, and read() would silently serve stdin instead of the
 * file just opened. */
#define VFD_BASE 3
static i32 open(const char *path, i32 flags) {
    (void)flags;
    const struct vfile *f = vfs_find(path);
    if (!f) return -1;
    for (i32 i = 0; i < MAX_VFDS; i++) {
        if (!g_vfds[i].used) {
            g_vfds[i].data = f->data;
            g_vfds[i].len = f->len;
            g_vfds[i].pos = 0;
            g_vfds[i].used = 1;
            return i + VFD_BASE;
        }
    }
    return -1;
}
static i32 close(i32 fd) {
    i32 i = fd - VFD_BASE;
    if (i < 0 || i >= MAX_VFDS) return -1;
    g_vfds[i].used = 0;
    return 0;
}
static i32 access(const char *path, i32 mode) {
    (void)mode;
    return vfs_find(path) ? 0 : -1;
}
static i32 chdir(const char *path) {
    return access(path, F_OK);
}

/* ------------------------------------------------------------------ */
/* stdin/stdout redirection — pure in-memory, swapped per pipeline     */
/* stage by run_pipeline() below, never by anything outside this file  */
/* ------------------------------------------------------------------ */

struct iobuf { const char *data; usize len; usize pos; };
static struct iobuf *g_stdin_src;   /* NULL = no stdin for this stage */
static char  *g_stdout_dst;
static usize *g_stdout_len;
static usize  g_stdout_cap;

static i32 read(i32 fd, char *buf, i32 count) {
    if (fd == STDIN_FILENO) {
        if (!g_stdin_src) return 0;
        usize remaining = g_stdin_src->len - g_stdin_src->pos;
        usize n = (usize)count < remaining ? (usize)count : remaining;
        mem_copy(buf, g_stdin_src->data + g_stdin_src->pos, n);
        g_stdin_src->pos += n;
        return (i32)n;
    }
    i32 vi = fd - VFD_BASE;
    if (vi < 0 || vi >= MAX_VFDS || !g_vfds[vi].used) return -1;
    struct vfd *v = &g_vfds[vi];
    usize remaining = v->len - v->pos;
    usize n = (usize)count < remaining ? (usize)count : remaining;
    mem_copy(buf, v->data + v->pos, n);
    v->pos += n;
    return (i32)n;
}

static i32 write(i32 fd, const char *buf, i32 count) {
    if (fd != STDOUT_FILENO && fd != STDERR_FILENO) return -1;
    usize n = (usize)count;
    usize room = g_stdout_cap - *g_stdout_len;
    if (n > room) n = room;
    mem_copy(g_stdout_dst + *g_stdout_len, buf, n);
    *g_stdout_len += n;
    return (i32)n;
}

/* ------------------------------------------------------------------ */
/* environ / getenv() — pure C                                         */
/* ------------------------------------------------------------------ */

static char  g_environ[MAX_ENVIRON];
static usize g_environ_len;

static void environ_add(const char *name, const char *value) {
    if (!value) return;
    usize nlen = str_len(name), vlen = str_len(value);
    if (g_environ_len + nlen + 1 + vlen + 1 > sizeof g_environ) return;
    mem_copy(g_environ + g_environ_len, name, nlen); g_environ_len += nlen;
    g_environ[g_environ_len++] = '=';
    mem_copy(g_environ + g_environ_len, value, vlen); g_environ_len += vlen;
    g_environ[g_environ_len++] = '\0';
}

static char *getenv(const char *name) {
    usize nlen = str_len(name);
    const char *p = g_environ, *end = g_environ + g_environ_len;
    while (p < end) {
        usize elen = str_len(p);
        if (elen > nlen && p[nlen] == '=' && mem_cmp(p, name, nlen) == 0)
            return (char *)(p + nlen + 1);
        p += elen + 1;
    }
    return NULL;
}

/* ------------------------------------------------------------------ */
/* I/O helpers                                                         */
/* ------------------------------------------------------------------ */

static i32 fd_write_all(i32 fd, const char *buf, usize len) {
    usize off = 0;
    while (off < len) {
        i32 n = write(fd, buf + off, (i32)(len - off));
        if (n <= 0) return -1;
        off += (usize)n;
    }
    return 0;
}

static i32 fd_puts(i32 fd, const char *s) {
    return fd_write_all(fd, s, str_len(s));
}

static int fd_read_byte(i32 fd, char *out) {
    i32 n = read(fd, out, 1);
    return (n == 1) ? 1 : (n == 0 ? 0 : -1);
}

/* ------------------------------------------------------------------ */
/* Path resolution — pure C                                            */
/* ------------------------------------------------------------------ */

struct shell {
    int  last_status;
    char cwd[MAX_PATH];
};
static struct shell sh;

static const char *resolve_path(const char *path, char *out, usize out_cap) {
    if (path[0] == '/') return path;
    usize cwd_len  = str_len(sh.cwd);
    usize path_len = str_len(path);
    int   need_sep = (cwd_len == 0 || sh.cwd[cwd_len - 1] != '/');
    usize total    = cwd_len + (need_sep ? 1 : 0) + path_len;
    if (total >= out_cap) return path;
    mem_copy(out, sh.cwd, cwd_len);
    usize pos = cwd_len;
    if (need_sep) out[pos++] = '/';
    mem_copy(out + pos, path, path_len + 1);
    return out;
}

/* ------------------------------------------------------------------ */
/* Builtins — run in the module, never in a child                      */
/* ------------------------------------------------------------------ */

static int builtin_cd(int argc, char **argv) {
    char resolved[MAX_PATH];
    const char *path;
    if (argc >= 2) {
        path = resolve_path(argv[1], resolved, sizeof resolved);
    } else {
        const char *home = getenv("HOME");
        path = home ? home : "/";
    }
    if (chdir(path) != 0) {
        fd_puts(STDERR_FILENO, "cd: no such directory\n");
        return 1;
    }
    usize n = str_len(path);
    mem_copy(sh.cwd, path, n < MAX_PATH ? n + 1 : MAX_PATH - 1);
    if (n >= MAX_PATH) sh.cwd[MAX_PATH - 1] = '\0';
    return 0;
}

static int builtin_exit(int argc, char **argv) {
    int code = (argc >= 2) ? parse_int(argv[1]) : 0;
    return code & 0xff;
}

/* ------------------------------------------------------------------ */
/* External commands — read fd 0, write fd 1, errors to fd 2           */
/* ------------------------------------------------------------------ */

static int drain_fd_to_stdout(i32 fd) {
    char buf[4096];
    for (;;) {
        i32 n = read(fd, buf, sizeof buf);
        if (n < 0) return 1;
        if (n == 0) break;
        if (fd_write_all(STDOUT_FILENO, buf, (usize)n) < 0) return 1;
    }
    return 0;
}

static int cmd_cat(int argc, char **argv) {
    if (argc < 2) return drain_fd_to_stdout(STDIN_FILENO);
    for (int i = 1; i < argc; i++) {
        char resolved[MAX_PATH];
        const char *path = resolve_path(argv[i], resolved, sizeof resolved);
        i32 fd = open(path, O_RDONLY);
        if (fd < 0) {
            fd_puts(STDERR_FILENO, "cat: cannot open ");
            fd_puts(STDERR_FILENO, argv[i]);
            fd_puts(STDERR_FILENO, "\n");
            return 1;
        }
        int rc = drain_fd_to_stdout(fd);
        close(fd);
        if (rc != 0) return rc;
    }
    return 0;
}

static int cmd_grep(int argc, char **argv) {
    if (argc < 2) {
        fd_puts(STDERR_FILENO, "grep: usage: grep PATTERN\n");
        return 2;
    }
    const char *pat = argv[1];
    char   line[4096];
    usize  len = 0;
    char   c;
    int    r;
    while ((r = fd_read_byte(STDIN_FILENO, &c)) == 1) {
        if (len < sizeof line - 1) line[len++] = c;
        if (c == '\n') {
            line[len] = '\0';
            if (str_str(line, pat)) fd_write_all(STDOUT_FILENO, line, len);
            len = 0;
        }
    }
    if (len > 0) {
        line[len] = '\0';
        if (str_str(line, pat)) fd_write_all(STDOUT_FILENO, line, len);
    }
    return 0;
}

/* ls used to live here. It's ls.wasm now -- see external_commands[]
 * below and the EXEC delegation this file's response protocol gained
 * to hand it off. */

static i32 g_uid = -1;

/*
 * whoami's real work: read and parse /etc/passwd for the entry whose
 * uid field matches g_uid (passwd(5): name:x:uid:gid:gecos:home:shell)
 * -- exactly what a minimal getpwuid() does internally. g_uid itself
 * is a bare fact from the request blob, not a resolved name; nothing
 * about identity is decided anywhere except here.
 */
static int cmd_whoami(int argc, char **argv) {
    (void)argc; (void)argv;
    i32 fd = open("/etc/passwd", O_RDONLY);
    if (fd < 0) { fd_puts(STDOUT_FILENO, "unknown\n"); return 0; }
    char buf[8192];
    usize total = 0;
    for (;;) {
        i32 n = read(fd, buf + total, (i32)(sizeof(buf) - total));
        if (n <= 0) break;
        total += (usize)n;
        if (total >= sizeof buf) break;
    }
    close(fd);
    if (total >= sizeof buf) total = sizeof buf - 1;
    buf[total] = '\0';

    char *line = buf;
    while (line && *line) {
        char *nl = str_chr(line, '\n');
        if (nl) *nl = '\0';
        char *name = line;
        char *c1 = str_chr(name, ':');
        if (c1) {
            *c1 = '\0';
            char *c2 = str_chr(c1 + 1, ':');
            if (c2) {
                char *uidfield = c2 + 1;
                char *c3 = str_chr(uidfield, ':');
                if (c3) *c3 = '\0';
                if (parse_int(uidfield) == g_uid) {
                    fd_puts(STDOUT_FILENO, name);
                    fd_puts(STDOUT_FILENO, "\n");
                    return 0;
                }
            }
        }
        line = nl ? nl + 1 : NULL;
    }
    fd_puts(STDOUT_FILENO, "unknown\n");
    return 0;
}

static int cmd_which(int argc, char **argv) {
    if (argc < 2) return 2;
    const char *path = getenv("PATH");
    if (!path) path = "/usr/bin:/bin";

    char buf[MAX_PATH];
    const char *p = path;
    while (*p) {
        const char *colon = str_chr(p, ':');
        usize len = colon ? (usize)(colon - p) : str_len(p);
        if (len + 1 + str_len(argv[1]) + 1 < sizeof buf) {
            mem_copy(buf, p, len);
            buf[len] = '/';
            mem_copy(buf + len + 1, argv[1], str_len(argv[1]) + 1);
            if (access(buf, X_OK) == 0) {
                fd_puts(STDOUT_FILENO, buf);
                fd_puts(STDOUT_FILENO, "\n");
                return 0;
            }
        }
        if (!colon) break;
        p = colon + 1;
    }
    return 1;
}

/* ------------------------------------------------------------------ */
/* Command table                                                       */
/* ------------------------------------------------------------------ */

typedef int (*cmd_fn)(int argc, char **argv);

struct command {
    const char *name;
    cmd_fn      fn;
    int         is_builtin;
};

static const struct command commands[] = {
    { "cat",    cmd_cat,      0 },
    { "grep",   cmd_grep,     0 },
    { "whoami", cmd_whoami,   0 },
    { "which",  cmd_which,    0 },
    { "cd",     builtin_cd,   1 },
    { "exit",   builtin_exit, 1 },
    { NULL,     NULL,         0 },
};

static const struct command *lookup(const char *name) {
    for (const struct command *c = commands; c->name; c++) {
        if (str_cmp(c->name, name) == 0) return c;
    }
    return NULL;
}

/*
 * Commands this file has no implementation of at all any more -- they
 * live in their own single-purpose command.wasm modules (ls.wasm
 * first). lookup() failing doesn't mean "not found" for these; it
 * means "someone else's job." The orchestrator's response says so
 * (see run()'s EXEC delegation), and whoever's driving this module
 * (a JS wrapper, or eventually another WASM module) is responsible
 * for actually running the named module and treating its result as
 * the answer -- this file never sees what that module did.
 */
static const char *external_commands[] = { "ls", NULL };

static int is_external_command(const char *name) {
    for (int i = 0; external_commands[i]; i++)
        if (str_cmp(external_commands[i], name) == 0) return 1;
    return 0;
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

struct stage {
    char *argv[MAX_ARGS];
    int   argc;
};

struct pipeline {
    struct stage stages[MAX_STAGES];
    int          nstages;
    int          background;
};

static int tokenize_stage(char *s, char **argv) {
    int argc = 0;
    char *p = s;
    while (*p && argc < MAX_ARGS - 1) {
        while (*p == ' ' || *p == '\t') p++;
        if (!*p) break;
        argv[argc++] = p;
        while (*p && *p != ' ' && *p != '\t') p++;
        if (*p) *p++ = '\0';
    }
    argv[argc] = NULL;
    return argc;
}

static int parse(char *line, struct pipeline *pl) {
    mem_set(pl, 0, sizeof *pl);

    usize n = str_len(line);
    while (n > 0 && (line[n-1] == '\n' || line[n-1] == ' ' ||
                     line[n-1] == '\t' || line[n-1] == '\r'))
        line[--n] = '\0';
    if (n == 0) return 0;

    if (line[n-1] == '&') {
        pl->background = 1;
        line[--n] = '\0';
        while (n > 0 && (line[n-1] == ' ' || line[n-1] == '\t'))
            line[--n] = '\0';
        if (n == 0) return 0;
    }

    char *p = line;
    while (p && *p && pl->nstages < MAX_STAGES) {
        char *bar = str_chr(p, '|');
        if (bar) *bar = '\0';
        int argc = tokenize_stage(p, pl->stages[pl->nstages].argv);
        pl->stages[pl->nstages].argc = argc;
        if (argc > 0) pl->nstages++;
        p = bar ? bar + 1 : NULL;
    }
    return pl->nstages > 0;
}

/* ------------------------------------------------------------------ */
/* Executor                                                            */
/* ------------------------------------------------------------------ */

static int run_builtin(const struct command *c, int argc, char **argv) {
    return c->fn(argc, argv);
}

/*
 * v3: no spawn(), no pipe(), no wait() -- there's no host to ask for
 * any of them any more. Every stage of a pipeline is a plain function
 * call within this same run(), one after another (this environment
 * never actually ran them concurrently under the old spawn()/wait()
 * design either -- every "spawn" resolved to a synchronous call before
 * the next line ran). A non-last stage's stdout is redirected to a
 * small arena buffer, which becomes the next stage's stdin -- pure
 * in-memory handoff, the exact same "stage N's real stdout becomes
 * stage N+1's real stdin" behavior as before, just without a host
 * coordinating fds to make it happen.
 */
/*
 * When run() finds this set after run_pipeline() returns, the normal
 * new_cwd/rc/stdout response is replaced entirely by an EXEC
 * delegation (see run()'s own comment on the response protocol).
 * g_exec_cmdline is rejoined from argv here because tokenize_stage()
 * already NUL-split the original command line in place -- the pieces
 * need to travel back out as one string again.
 */
static int g_exec_pending;
static char g_exec_cmdline[MAX_LINE];

static usize rejoin_argv(char *buf, usize buf_cap, char **argv, int argc) {
    usize len = 0;
    for (int i = 0; i < argc; i++) {
        if (i > 0) {
            if (len + 1 >= buf_cap) break;
            buf[len++] = ' ';
        }
        usize alen = str_len(argv[i]);
        if (len + alen >= buf_cap) alen = buf_cap - len - 1;
        mem_copy(buf + len, argv[i], alen);
        len += alen;
    }
    buf[len] = '\0';
    return len;
}

static int run_pipeline(struct pipeline *pl) {
    if (pl->nstages == 1) {
        const struct command *c = lookup(pl->stages[0].argv[0]);
        if (!c) {
            if (is_external_command(pl->stages[0].argv[0])) {
                rejoin_argv(g_exec_cmdline, sizeof g_exec_cmdline, pl->stages[0].argv, pl->stages[0].argc);
                g_exec_pending = 1;
                return 0;
            }
            fd_puts(STDERR_FILENO, "shell: command not found: ");
            fd_puts(STDERR_FILENO, pl->stages[0].argv[0]);
            fd_puts(STDERR_FILENO, "\n");
            return 127;
        }
        if (c->is_builtin) {
            if (pl->background) {
                fd_puts(STDERR_FILENO, "shell: builtins cannot run in background\n");
                return 1;
            }
            return run_builtin(c, pl->stages[0].argc, pl->stages[0].argv);
        }
        return c->fn(pl->stages[0].argc, pl->stages[0].argv);
    }

    for (int i = 0; i < pl->nstages; i++) {
        const struct command *c = lookup(pl->stages[i].argv[0]);
        if (!c) {
            fd_puts(STDERR_FILENO, "shell: command not found: ");
            fd_puts(STDERR_FILENO, pl->stages[i].argv[0]);
            fd_puts(STDERR_FILENO, "\n");
            return 127;
        }
        if (c->is_builtin) {
            fd_puts(STDERR_FILENO, "shell: builtin in pipeline not supported\n");
            return 1;
        }
    }

    struct iobuf *stage_in = NULL; /* stage 0 reads the real stdin */
    int rc = 0;

    for (int i = 0; i < pl->nstages; i++) {
        const struct command *c = lookup(pl->stages[i].argv[0]);

        struct iobuf *saved_in = g_stdin_src;
        char *saved_out_dst = g_stdout_dst;
        usize *saved_out_len = g_stdout_len;
        usize saved_out_cap = g_stdout_cap;

        g_stdin_src = stage_in;

        int is_last = (i == pl->nstages - 1);
        char *stage_buf = NULL;
        usize stage_cap = 0;
        usize stage_len = 0;

        if (!is_last) {
            stage_cap = 65536;
            stage_buf = (char *)arena_alloc(stage_cap);
            if (!stage_buf) { fd_puts(STDERR_FILENO, "shell: out of memory\n"); rc = 1; break; }
            g_stdout_dst = stage_buf;
            g_stdout_len = &stage_len;
            g_stdout_cap = stage_cap;
        }
        /* else: leave g_stdout_dst/_len/_cap as whatever the caller
         * (run(), or an outer pipeline) already set them to -- the
         * last stage writes to the real destination. */

        rc = c->fn(pl->stages[i].argc, pl->stages[i].argv);

        g_stdin_src = saved_in;
        if (!is_last) {
            g_stdout_dst = saved_out_dst;
            g_stdout_len = saved_out_len;
            g_stdout_cap = saved_out_cap;

            struct iobuf *next_in = (struct iobuf *)arena_alloc(sizeof *next_in);
            if (!next_in) { fd_puts(STDERR_FILENO, "shell: out of memory\n"); rc = 1; break; }
            next_in->data = stage_buf;
            next_in->len = stage_len;
            next_in->pos = 0;
            stage_in = next_in;
        }
    }

    return rc;
}

/* ------------------------------------------------------------------ */
/* Request/response blob parsing                                       */
/* ------------------------------------------------------------------ */

/* Reads one NUL-terminated field starting at *cursor (which must be <
 * end); advances *cursor past the NUL. Returns NULL if the field runs
 * past end without a NUL (malformed request). */
static const char *take_field(const char **cursor, const char *end) {
    const char *start = *cursor;
    const char *p = start;
    while (p < end && *p != '\0') p++;
    if (p >= end) return NULL;
    *cursor = p + 1;
    return start;
}

/* ------------------------------------------------------------------ */
/* run() — the single export                                           */
/* ------------------------------------------------------------------ */

/*
 * run(ptr, len): the ONLY thing anything outside this module ever
 * calls. ptr/len describe the request blob (see the file header for
 * its shape) already sitting in this module's own linear memory --
 * the host wrote it there before calling this, exactly like this
 * project's own memorymap.c expects a caller to populate its shared
 * buffer before calling one of its exported entry points. The
 * response blob is written to a fixed offset (see OUTPUT_OFFSET
 * below); this function's return value is that response's length.
 */
__attribute__((export_name("run")))
i32 run(i32 ptr, i32 len) {
    alloc_init();
    g_nvfiles = 0;
    g_environ_len = 0;
    g_exec_pending = 0;
    mem_set(g_vfds, 0, sizeof g_vfds);

    const char *cursor = (const char *)(usize)ptr;
    const char *end = cursor + (usize)len;

    const char *cwd_field  = take_field(&cursor, end);
    const char *uid_field  = take_field(&cursor, end);
    const char *home_field = take_field(&cursor, end);
    const char *path_field = take_field(&cursor, end);
    const char *cmd_field  = take_field(&cursor, end);
    const char *nfiles_field = take_field(&cursor, end);

    if (!cwd_field || !uid_field || !home_field || !path_field || !cmd_field || !nfiles_field)
        return 0; /* malformed request -- nothing sensible to do */

    usize n = str_len(cwd_field);
    mem_copy(sh.cwd, cwd_field, n < MAX_PATH ? n + 1 : MAX_PATH - 1);
    if (n >= MAX_PATH) sh.cwd[MAX_PATH - 1] = '\0';

    g_uid = parse_int(uid_field);
    if (*home_field) environ_add("HOME", home_field);
    if (*path_field) environ_add("PATH", path_field);

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

    /* Command line gets its own arena copy since parse() tokenizes
     * (writes NULs) into it, and cmd_field points into the read-only
     * request blob. */
    usize cmdlen = str_len(cmd_field);
    char *line = (char *)arena_alloc(cmdlen + 1);
    if (!line) return 0;
    mem_copy(line, cmd_field, cmdlen + 1);

    /* Response area: a fixed 1MB region at [total-2MB, total-1MB) in
     * this module's own linear memory -- computed from the module's
     * actual memory size, not a hardcoded constant, so it agrees with
     * whatever the caller computes the same way. The request blob the
     * host wrote to call this run() lives in the 1MB region above it,
     * [total-1MB, total). */
    usize total_bytes = (usize)__builtin_wasm_memory_size(0) * 65536;
    usize output_cap = 1024 * 1024;
    char *out = (char *)(total_bytes - 2 * output_cap);
    usize out_len = 0;

    /* stdout is built into its own arena buffer first (rc and a
     * possibly-changed cwd aren't known until the command has run),
     * then assembled into the response region afterward. */
    char *stdout_buf = (char *)arena_alloc(output_cap);
    if (!stdout_buf) return 0;
    usize stdout_len = 0;

    g_stdin_src = NULL;
    g_stdout_dst = stdout_buf;
    g_stdout_len = &stdout_len;
    g_stdout_cap = output_cap;

    struct pipeline pl;
    int rc;
    if (!parse(line, &pl)) {
        rc = sh.last_status;
    } else {
        rc = run_pipeline(&pl);
        sh.last_status = rc;
    }

    /*
     * EXEC delegation: the parsed command names a module this file
     * doesn't implement (see external_commands[]/is_external_command()
     * above). The entire response becomes "EXEC\0<cmdline>\0" instead
     * of the usual new_cwd/rc/stdout shape -- whoever is driving this
     * module is responsible for running the named command.wasm itself
     * and treating ITS response as the answer. This file never sees
     * what that module does; it only ever decided WHICH one to ask
     * for, which is the one thing only the parser can know.
     */
    if (g_exec_pending) {
        static const char marker[] = "EXEC";
        mem_copy(out, marker, sizeof marker); /* includes the NUL */
        usize elen = sizeof marker;
        usize cmdlen2 = str_len(g_exec_cmdline);
        mem_copy(out + elen, g_exec_cmdline, cmdlen2 + 1);
        elen += cmdlen2 + 1;
        return (i32)elen;
    }

    usize cwd_len = str_len(sh.cwd);
    mem_copy(out, sh.cwd, cwd_len + 1);
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
