/*
 * shell.c — WASM module, stage 2
 *
 * Build (freestanding, no libc):
 *   clang --target=wasm32 -O2 -nostdlib -Wl,--no-entry \
 *         -Wl,--export=run -Wl,--export-memory -o shell.wasm shell.c
 *
 * Design:
 *   - One export: run(ptr, len)
 *   - Imports: fd_read, fd_write, host_* for the rest
 *   - All state in linear memory, allocated from a bump arena
 *   - No libc. Hand-declared. Own contracts.
 *   - Commands are small, dumb, external.
 *   - Stage-list parser, N pipes, builtin flag.
 *
 * v0.0.2 — Collapsed to a single export. alloc_init() is no longer
 *   exported for the host to remember to call separately — run() lazily
 *   initializes the arena on first call instead (checks arena_base ==
 *   NULL). Same reasoning as MountainShift()'s own opaque run()-only
 *   surface: the host shouldn't need to know there's a second setup
 *   step to get right. Also fixed a bug the same lazy-init path exposed
 *   live, not by reading the source: sh.cwd is a zero-initialized
 *   static, so `ls` (and anything else defaulting to sh.cwd) silently
 *   operated on an empty path until the first successful `cd` -- fixed
 *   by seeding sh.cwd via host_getcwd() on first run() call, same as
 *   the arena.
 * v0.0.1 — Initial seed. Had a real compile-blocking bug: str_copy_lit()
 *   was called from cmd_which() before it was declared or defined
 *   anywhere earlier in the file, and clang's default
 *   -Werror=implicit-function-declaration rejects that outright. Fixed
 *   by moving str_copy_lit() up next to the other string helpers,
 *   before its first use.
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

/* Provided by the linker when --export-memory is used. */
extern u8 __heap_base;

/* ------------------------------------------------------------------ */
/* Host imports — the only things the module can call                  */
/* ------------------------------------------------------------------ */

/*
 * Everything the module needs from the outside goes through here.
 * No syscalls, no libc, no ambient authority. Just these.
 */

/* I/O */
__attribute__((import_module("host"), import_name("fd_read")))
extern i32 host_fd_read(i32 fd, i32 buf_ptr, i32 buf_len);

__attribute__((import_module("host"), import_name("fd_write")))
extern i32 host_fd_write(i32 fd, i32 buf_ptr, i32 buf_len);

/* Process / job interface */
__attribute__((import_module("host"), import_name("spawn")))
extern i32 host_spawn(i32 cmd_ptr, i32 cmd_len,
                      i32 in_fd, i32 out_fd, i32 err_fd);

__attribute__((import_module("host"), import_name("wait")))
extern i32 host_wait(i32 pid);

/* Environment */
__attribute__((import_module("host"), import_name("getenv")))
extern i32 host_getenv(i32 name_ptr, i32 name_len,
                       i32 buf_ptr, i32 buf_len);

__attribute__((import_module("host"), import_name("chdir")))
extern i32 host_chdir(i32 path_ptr, i32 path_len);

__attribute__((import_module("host"), import_name("getcwd")))
extern i32 host_getcwd(i32 buf_ptr, i32 buf_len);

/* Directory listing — one entry per call, returns 0 at end */
__attribute__((import_module("host"), import_name("readdir")))
extern i32 host_readdir(i32 path_ptr, i32 path_len, i32 index,
                        i32 name_ptr, i32 name_len);

/* Path lookup for `which` */
__attribute__((import_module("host"), import_name("access")))
extern i32 host_access(i32 path_ptr, i32 path_len, i32 mode);

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

/* Moved up next to the other string helpers, above every call site --
 * v0.0.1 had this declared after cmd_which() used it, with no forward
 * declaration, which clang rejects as an implicit-function-declaration
 * error rather than silently defaulting an int return the way older C
 * compilers might. */
static void str_copy_lit(char *dst, const char *lit) {
    while ((*dst++ = *lit++)) ;
}

static void mem_copy(void *d, const void *s, usize n) {
    u8 *dp = d; const u8 *sp = s;
    while (n--) *dp++ = *sp++;
}

static void mem_set(void *d, int c, usize n) {
    u8 *dp = d;
    while (n--) *dp++ = (u8)c;
}

static int parse_int(const char *s) {
    int v = 0, neg = 0;
    if (*s == '-') { neg = 1; s++; }
    while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); s++; }
    return neg ? -v : v;
}

/* ------------------------------------------------------------------ */
/* Bump arena — mmap-equivalent for WASM                               */
/* ------------------------------------------------------------------ */

/*
 * In WASM, linear memory grows via memory.grow. We use a bump allocator
 * over the region above __heap_base. No free — reset between commands.
 */

static u8  *arena_base = NULL;
static u8  *arena_ptr  = NULL;
static usize arena_cap = 0;

/* Lazily initialized from run() on first call -- no longer a separate
 * export the host has to remember to invoke first (v0.0.2). */
static void alloc_init(void) {
    arena_base = &__heap_base;
    /* Round up to 8-byte alignment */
    usize a = (usize)arena_base;
    a = (a + 7) & ~(usize)7;
    arena_base = (u8 *)a;
    arena_ptr  = arena_base;
    /* Leave a fixed cap — the host can grow memory if needed */
    arena_cap  = 64 * 1024;
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

#define MAX_STAGES 16
#define MAX_ARGS   64
#define MAX_LINE   8192
#define MAX_PATH   4096

/* ------------------------------------------------------------------ */
/* Shell context                                                       */
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

struct shell {
    int  last_status;
    char cwd[MAX_PATH];
};

static struct shell sh;

/* ------------------------------------------------------------------ */
/* I/O helpers                                                         */
/* ------------------------------------------------------------------ */

static i32 fd_write_all(i32 fd, const char *buf, usize len) {
    usize off = 0;
    while (off < len) {
        i32 n = host_fd_write(fd, (i32)(usize)(buf + off), (i32)(len - off));
        if (n <= 0) return -1;
        off += (usize)n;
    }
    return 0;
}

static i32 fd_puts(i32 fd, const char *s) {
    return fd_write_all(fd, s, str_len(s));
}

/* Read one byte. Returns 1 on success, 0 on EOF, -1 on error. */
static int fd_read_byte(i32 fd, char *out) {
    i32 n = host_fd_read(fd, (i32)(usize)out, 1);
    return (n == 1) ? 1 : (n == 0 ? 0 : -1);
}

/* ------------------------------------------------------------------ */
/* Builtins — run in the module, never in a child                      */
/* ------------------------------------------------------------------ */

static int builtin_cd(int argc, char **argv) {
    const char *path;
    if (argc >= 2) {
        path = argv[1];
    } else {
        char home[MAX_PATH];
        i32 n = host_getenv((i32)(usize)"HOME", 4,
                            (i32)(usize)home, MAX_PATH);
        if (n <= 0) path = "/";
        else { home[n < MAX_PATH ? n : MAX_PATH - 1] = '\0'; path = home; }
    }
    if (host_chdir((i32)(usize)path, (i32)str_len(path)) != 0) {
        fd_puts(STDERR_FILENO, "cd: no such directory\n");
        return 1;
    }
    host_getcwd((i32)(usize)sh.cwd, MAX_PATH);
    return 0;
}

static int builtin_exit(int argc, char **argv) {
    int code = (argc >= 2) ? parse_int(argv[1]) : 0;
    /* In WASM there's no exit — the host decides. We return a sentinel. */
    return code & 0xff;
}

/* ------------------------------------------------------------------ */
/* External commands — read fd 0, write fd 1, errors to fd 2           */
/* ------------------------------------------------------------------ */

static int cmd_cat(int argc, char **argv) {
    char buf[4096];
    if (argc >= 2) {
        for (int i = 1; i < argc; i++) {
            (void)i;
            fd_puts(STDERR_FILENO, "cat: file args not supported in WASM seed\n");
            return 1;
        }
    }
    for (;;) {
        i32 n = host_fd_read(STDIN_FILENO, (i32)(usize)buf, sizeof buf);
        if (n < 0) return 1;
        if (n == 0) break;
        if (fd_write_all(STDOUT_FILENO, buf, (usize)n) < 0) return 1;
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

static int cmd_ls(int argc, char **argv) {
    const char *path = (argc >= 2) ? argv[1] : sh.cwd;
    char name[256];
    for (int i = 0; ; i++) {
        i32 n = host_readdir((i32)(usize)path, (i32)str_len(path), i,
                             (i32)(usize)name, sizeof name);
        if (n <= 0) break;
        name[n < 256 ? n : 255] = '\0';
        fd_puts(STDOUT_FILENO, name);
        fd_puts(STDOUT_FILENO, "\n");
    }
    return 0;
}

static int cmd_whoami(int argc, char **argv) {
    (void)argc; (void)argv;
    char buf[256];
    i32 n = host_getenv((i32)(usize)"USER", 4, (i32)(usize)buf, sizeof buf);
    if (n <= 0) n = host_getenv((i32)(usize)"LOGNAME", 7,
                                (i32)(usize)buf, sizeof buf);
    if (n <= 0) { fd_puts(STDOUT_FILENO, "unknown\n"); return 0; }
    buf[n < 256 ? n : 255] = '\0';
    fd_puts(STDOUT_FILENO, buf);
    fd_puts(STDOUT_FILENO, "\n");
    return 0;
}

static int cmd_which(int argc, char **argv) {
    if (argc < 2) return 2;
    char path[MAX_PATH];
    i32 n = host_getenv((i32)(usize)"PATH", 4, (i32)(usize)path, sizeof path);
    if (n <= 0) { str_copy_lit(path, "/usr/bin:/bin"); n = (i32)str_len(path); }
    path[n < MAX_PATH ? n : MAX_PATH - 1] = '\0';

    char buf[MAX_PATH];
    const char *p = path;
    while (*p) {
        const char *colon = str_chr(p, ':');
        usize len = colon ? (usize)(colon - p) : str_len(p);
        if (len + 1 + str_len(argv[1]) + 1 < sizeof buf) {
            mem_copy(buf, p, len);
            buf[len] = '/';
            mem_copy(buf + len + 1, argv[1], str_len(argv[1]) + 1);
            if (host_access((i32)(usize)buf, (i32)str_len(buf), 1) == 0) {
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
    { "ls",     cmd_ls,       0 },
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

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

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

/*
 * KNOWN LIMITATION, not yet fixed: multi-stage pipelines do not actually
 * pipe data between stages. Every stage below reads STDIN_FILENO and
 * writes STDOUT_FILENO directly regardless of its position, so a real
 * `cat file | grep pattern` would have both stages independently
 * competing for the same real stdin/stdout rather than one feeding the
 * other. Fixing this needs either host-mediated pipes (host_spawn's
 * in_fd/out_fd) or an in-process buffer actually threaded stage to
 * stage -- neither is wired up yet. Single-stage commands are correct.
 */

static int run_external(const struct command *c, int argc, char **argv,
                        int in_fd, int out_fd) {
    (void)in_fd; (void)out_fd;
    return c->fn(argc, argv);
}

static int run_builtin(const struct command *c, int argc, char **argv) {
    return c->fn(argc, argv);
}

static int run_pipeline(struct pipeline *pl) {
    if (pl->nstages == 1) {
        const struct command *c = lookup(pl->stages[0].argv[0]);
        if (c && c->is_builtin) {
            if (pl->background) {
                fd_puts(STDERR_FILENO,
                        "shell: builtins cannot run in background\n");
                return 1;
            }
            return run_builtin(c, pl->stages[0].argc, pl->stages[0].argv);
        }
    }

    int rc = 0;
    for (int i = 0; i < pl->nstages; i++) {
        struct stage *st = &pl->stages[i];
        const struct command *c = lookup(st->argv[0]);
        if (!c) {
            fd_puts(STDERR_FILENO, "shell: command not found: ");
            fd_puts(STDERR_FILENO, st->argv[0]);
            fd_puts(STDERR_FILENO, "\n");
            return 127;
        }
        if (c->is_builtin) {
            fd_puts(STDERR_FILENO,
                    "shell: builtin in pipeline not supported\n");
            return 1;
        }
        rc = run_external(c, st->argc, st->argv, STDIN_FILENO, STDOUT_FILENO);
    }

    return rc;
}

/* ------------------------------------------------------------------ */
/* run() — the single export                                           */
/* ------------------------------------------------------------------ */

/*
 * run(ptr, len): the WASM module's only entry point.
 *
 * The host writes the command line into linear memory at ptr, sets len,
 * and calls this. The module parses, dispatches, and returns the exit
 * status. All I/O goes through host imports. Lazily initializes the
 * bump arena on first call -- no separate export the host has to
 * remember to invoke first.
 */
__attribute__((export_name("run")))
int run(i32 ptr, i32 len) {
    if (arena_base == NULL) {
        alloc_init();
        /* sh.cwd is a zero-initialized static -- without this, ls and
         * anything else defaulting to sh.cwd silently operates on an
         * empty path until the first successful cd. Caught live by
         * actually running the module, not by reading the source. */
        host_getcwd((i32)(usize)sh.cwd, MAX_PATH);
    }

    if (len <= 0 || len >= MAX_LINE) return 2;

    char *line = (char *)arena_alloc((usize)len + 1);
    if (!line) return 2;
    mem_copy(line, (const void *)(usize)ptr, (usize)len);
    line[len] = '\0';

    struct pipeline pl;
    if (!parse(line, &pl)) {
        arena_reset();
        return sh.last_status;
    }

    int rc = run_pipeline(&pl);
    sh.last_status = rc;
    arena_reset();
    return rc;
}
