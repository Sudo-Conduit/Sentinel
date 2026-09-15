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
 * v0.0.8 — cmd_whoami() no longer reads $USER/$LOGNAME. Real whoami
 *   asks the kernel for the real effective user; it never consults
 *   the environment (confirmed live: `USER=hacker whoami` on a real
 *   system still prints the real user). Reading an env var was a
 *   shell-convention shortcut that happened to produce a plausible-
 *   looking name, not the actual behavior it was standing in for --
 *   the kind of gap a test asserting only "whoami reads USER from the
 *   host" can pass while validating the wrong thing entirely. Added
 *   host_whoami()/sys_whoami() -- a real identity fact, immune to
 *   environment overrides -- and rewired cmd_whoami() to use it.
 * v0.0.7 — Added resolve_path(): path resolution (joining a relative
 *   argument against sh.cwd) is pure C string work and belongs in C,
 *   not the host. cmd_cat, cmd_ls, and builtin_cd all resolve their
 *   path argument before calling sys_open()/host_chdir() with it.
 *   Before this, a relative path (`cat notes.txt`) went to the host
 *   unresolved and only worked if the host's own notion of "current
 *   directory" happened to match sh.cwd -- an accident, not a
 *   contract. The host's job stays exactly "receive a string, return
 *   a string": nothing about cwd or path-joining is its concern.
 * v0.0.6 — Replaced host_readdir()/sys_readdir() entirely. An open
 *   directory doesn't need its own packed-array host contract -- it is
 *   just a stream of bytes, read via the SAME host_fd_read every other
 *   command already uses. New generic host_open()/host_close() resolve
 *   a path to a plain fd; cmd_ls is now sys_open() + drain_fd_to_stdout()
 *   + host_close(), the identical shape cmd_cat uses for its own file
 *   args (previously unsupported -- "cat: file args not supported in
 *   WASM seed" -- fixed for free by the same primitive). C land needs
 *   nothing from the host except the string.
 * v0.0.5 — cmd_ls no longer names host_readdir() directly. Added
 *   sys_readdir(), a syscall-shaped boundary cmd_ls calls instead --
 *   for now it just forwards to host_readdir(), but the point is the
 *   caller no longer knows that. Real Unix userspace never calls
 *   VOP_READDIR itself; it calls getdents(2), and the kernel decides
 *   how to fulfill it. When the real fd table/VFS dispatch lands, only
 *   sys_readdir()'s body changes -- cmd_ls never will.
 * v0.0.4 — host_readdir() changed from "give me entry N" (one host call
 *   per entry, each re-resolving the same path string from scratch, no
 *   persistent directory-stream state) to "fill this buffer with every
 *   entry, NUL-separated, in one call" -- the same "loop once, pack
 *   results into one buffer" shape a real getdirentries()-family
 *   syscall uses (see kern_getdirentries: one tbuf, one VOP_READDIR
 *   call, one copyout), minus the fd/vnode/VFS-dispatch layer real
 *   Unix has underneath it -- deliberately deferred, not forgotten:
 *   the next real step is a per-process fd table (a natural fit for
 *   Kernel.js's existing process table) and dispatching through
 *   FileFsX.js's Mount abstraction instead of a flat host-side path
 *   lookup, but this first cut gets the actual data flow (resolve
 *   once, enumerate once, emit via stdout) right before adding that.
 * v0.0.3 — Real multi-stage piping. run_pipeline() no longer bypasses
 *   host_spawn() -- every non-last stage gets a real pipe (new
 *   host_pipe() import), spawned with its stdout wired to the pipe's
 *   write end, and the next stage spawned with its stdin wired to that
 *   pipe's read end. Every spawned pid is waited on via host_wait().
 *   No command function changed: cmd_cat/cmd_grep/etc. already
 *   correctly expressed "read fd 0, write fd 1" -- the bug was entirely
 *   in the executor bypassing the spawn path the file's own comments
 *   already described as "the real path."
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

/*
 * open()/close() -- resolves a path into a plain fd, readable via the
 * SAME host_fd_read every command already uses. This is the one real
 * generic primitive a directory listing needs: from C's side, an open
 * directory is nothing but a stream of bytes (the same shape pre-
 * readdir(3) Unix used, before directories got their own read-entry
 * API) -- not a specialized packed-array contract invented to match
 * what one C function expects. Returns an fd (>= 0) or -1.
 */
__attribute__((import_module("host"), import_name("open")))
extern i32 host_open(i32 path_ptr, i32 path_len, i32 flags);

__attribute__((import_module("host"), import_name("close")))
extern i32 host_close(i32 fd);

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

/* Path lookup for `which` */
__attribute__((import_module("host"), import_name("access")))
extern i32 host_access(i32 path_ptr, i32 path_len, i32 mode);

/*
 * Real identity -- NOT the environment. Real whoami asks the kernel
 * for the effective user (geteuid() -> getpwuid()); it does not read
 * $USER, and `USER=hacker whoami` on a real system still prints the
 * real user. host_whoami() is that same fact, shaped the same way:
 * the host hands back whatever real identity it actually is, with no
 * environment variable able to override it.
 */
__attribute__((import_module("host"), import_name("whoami")))
extern i32 host_whoami(i32 buf_ptr, i32 buf_len);

/* Real pipe creation -- writes the new read/write fd numbers into
 * linear memory at the two given pointers. v0.0.3: this is the one
 * new host import multi-stage pipelines actually need. */
__attribute__((import_module("host"), import_name("pipe")))
extern i32 host_pipe(i32 read_fd_out_ptr, i32 write_fd_out_ptr);

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

#define O_RDONLY       0

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
/* Syscalls — the boundary a command is allowed to call                */
/* ------------------------------------------------------------------ */

/*
 * v0.0.7: path resolution belongs here, in C, not the host. Relative
 * paths get joined against sh.cwd -- pure string work, no host call --
 * so the host's job stays exactly "receive a string, return a string,"
 * nothing more. Before this, a relative argument (e.g. `cat notes.txt`)
 * went to host_open() unresolved and only worked by accident, if the
 * host's own idea of "current directory" happened to line up with
 * sh.cwd. Absolute paths pass through untouched.
 */
static const char *resolve_path(const char *path, char *out, usize out_cap) {
    if (path[0] == '/') return path;

    usize cwd_len  = str_len(sh.cwd);
    usize path_len = str_len(path);
    int   need_sep = (cwd_len == 0 || sh.cwd[cwd_len - 1] != '/');
    usize total    = cwd_len + (need_sep ? 1 : 0) + path_len;

    if (total >= out_cap) return path; /* too long to join -- let sys_open fail on it */

    mem_copy(out, sh.cwd, cwd_len);
    usize pos = cwd_len;
    if (need_sep) out[pos++] = '/';
    mem_copy(out + pos, path, path_len + 1); /* + NUL */
    return out;
}

/*
 * A command must never name a host_* import directly -- that's the
 * flattening a real kernel avoids: userspace calls a syscall (open(2)),
 * never a vnode operation itself. sys_open() is that syscall boundary:
 * a path string goes in, a byte-stream fd comes back. What that fd
 * actually streams -- a file's bytes, a directory's listing, anything
 * else -- is entirely the host's business. This function, and this
 * file, only ever deal in a string in, a string out.
 */
static i32 sys_open(const char *path, i32 flags) {
    return host_open((i32)(usize)path, (i32)str_len(path), flags);
}

/*
 * sys_whoami() -- the identity syscall. No path, no flags, nothing to
 * resolve: just "who is this, really." A command asks this, never
 * host_whoami() directly, for the same reason it never names any
 * other host_* import directly.
 */
static i32 sys_whoami(i32 buf_ptr, i32 buf_len) {
    return host_whoami(buf_ptr, buf_len);
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

/* Drains fd to STDOUT_FILENO until EOF. The one loop cat/ls both need --
 * from C's side, an open file and an open directory are the same thing:
 * a stream of bytes read via the ordinary host_fd_read every command
 * already uses. */
static int drain_fd_to_stdout(i32 fd) {
    char buf[4096];
    for (;;) {
        i32 n = host_fd_read(fd, (i32)(usize)buf, sizeof buf);
        if (n < 0) return 1;
        if (n == 0) break;
        if (fd_write_all(STDOUT_FILENO, buf, (usize)n) < 0) return 1;
    }
    return 0;
}

static int cmd_cat(int argc, char **argv) {
    if (argc < 2) {
        return drain_fd_to_stdout(STDIN_FILENO);
    }
    for (int i = 1; i < argc; i++) {
        char resolved[MAX_PATH];
        i32 fd = sys_open(resolve_path(argv[i], resolved, sizeof resolved), O_RDONLY);
        if (fd < 0) {
            fd_puts(STDERR_FILENO, "cat: cannot open ");
            fd_puts(STDERR_FILENO, argv[i]);
            fd_puts(STDERR_FILENO, "\n");
            return 1;
        }
        int rc = drain_fd_to_stdout(fd);
        host_close(fd);
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

/*
 * v0.0.6: an open directory IS a stream of bytes -- the string this
 * file's own header talks about -- read exactly like any other fd, via
 * drain_fd_to_stdout(), the same loop cat uses. No packed-array
 * contract invented to match one C function's expectations; no
 * directory-specific host primitive at all. sys_open() hands the host
 * a path string and gets back an fd streaming a string -- what's on
 * the other side of that string is not this file's concern.
 */
static int cmd_ls(int argc, char **argv) {
    char resolved[MAX_PATH];
    const char *path = (argc >= 2) ? resolve_path(argv[1], resolved, sizeof resolved) : sh.cwd;

    i32 fd = sys_open(path, O_RDONLY);
    if (fd < 0) {
        fd_puts(STDERR_FILENO, "ls: cannot access directory\n");
        return 1;
    }
    int rc = drain_fd_to_stdout(fd);
    host_close(fd);
    return rc;
}

/*
 * v0.0.8: whoami no longer reads $USER/$LOGNAME. Real whoami never
 * consults the environment -- it asks the kernel for the real
 * effective user (geteuid() -> getpwuid()), which is why
 * `USER=hacker whoami` on a real system still prints the real user,
 * not "hacker". Reading $USER was a shell-convention shortcut wearing
 * whoami's name, not what the command actually does. sys_whoami() is
 * the real fact instead, with no environment variable able to spoof
 * it.
 */
static int cmd_whoami(int argc, char **argv) {
    (void)argc; (void)argv;
    char buf[256];
    i32 n = sys_whoami((i32)(usize)buf, sizeof buf);
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

static int run_builtin(const struct command *c, int argc, char **argv) {
    return c->fn(argc, argv);
}

/* Rejoins a tokenized stage's argv back into a single space-separated
 * command string for host_spawn(), which takes a command line, not an
 * argv array. Loses original inter-token whitespace/quoting -- an
 * accepted simplification for this seed, since tokenize_stage() already
 * discarded that information in place. */
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

/*
 * v0.0.3: real multi-stage piping. Every stage still just says "read fd
 * 0, write fd 1" -- that was already correct and needed no change. What
 * was wrong was this function bypassing host_spawn() entirely and
 * calling each command in-process, so every stage's fd 0/1 resolved to
 * the SAME real stdin/stdout no matter its position. Now: a real pipe
 * (host_pipe()) is created between every adjacent pair of stages, each
 * stage is handed off to host_spawn() with the correct in_fd/out_fd
 * (STDIN_FILENO only for the first stage, STDOUT_FILENO only for the
 * last), and every spawned pid is waited on via host_wait().
 *
 * All stages are spawned first, then all are waited on, matching real
 * pipeline semantics (every stage notionally running concurrently) even
 * though today's host may in practice run each spawn synchronously to
 * completion -- host_wait() still gets called on every pid either way,
 * so a host that DOES spawn real concurrent processes needs no change
 * here to actually behave correctly.
 */
static int run_pipeline(struct pipeline *pl) {
    if (pl->nstages == 1) {
        const struct command *c = lookup(pl->stages[0].argv[0]);
        if (!c) {
            fd_puts(STDERR_FILENO, "shell: command not found: ");
            fd_puts(STDERR_FILENO, pl->stages[0].argv[0]);
            fd_puts(STDERR_FILENO, "\n");
            return 127;
        }
        if (c->is_builtin) {
            if (pl->background) {
                fd_puts(STDERR_FILENO,
                        "shell: builtins cannot run in background\n");
                return 1;
            }
            return run_builtin(c, pl->stages[0].argc, pl->stages[0].argv);
        }
        /* A lone external command runs directly, in-process, on the
         * real STDIN_FILENO/STDOUT_FILENO -- no spawn/pipe needed.
         * This bypass is load-bearing, not an optimization: host_spawn()
         * exists to isolate ONE STAGE OF A PIPELINE, and its host-side
         * implementation re-enters this same module's run() to actually
         * execute the command. Removing this bypass (v0.0.3's first
         * draft did) makes a lone command spawn itself, which re-parses
         * the same single-stage command line, which spawns itself again
         * -- infinite recursion, confirmed live as "Maximum call stack
         * size exceeded" before this fix, not a hypothetical concern. */
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
            fd_puts(STDERR_FILENO,
                    "shell: builtin in pipeline not supported\n");
            return 1;
        }
    }

    i32 pids[MAX_STAGES];
    int in_fd = STDIN_FILENO;

    for (int i = 0; i < pl->nstages; i++) {
        int out_fd;
        i32 next_in_fd = -1;

        if (i < pl->nstages - 1) {
            /* host_pipe() writes both fd numbers into linear memory at
             * these two arena-allocated slots. */
            i32 *slots = (i32 *)arena_alloc(sizeof(i32) * 2);
            if (!slots) { fd_puts(STDERR_FILENO, "shell: out of memory\n"); return 1; }
            if (host_pipe((i32)(usize)&slots[0], (i32)(usize)&slots[1]) != 0) {
                fd_puts(STDERR_FILENO, "shell: pipe() failed\n");
                return 1;
            }
            out_fd = slots[1];
            next_in_fd = slots[0];
        } else {
            out_fd = STDOUT_FILENO;
        }

        char cmdbuf[MAX_LINE];
        usize cmdlen = rejoin_argv(cmdbuf, sizeof cmdbuf,
                                   pl->stages[i].argv, pl->stages[i].argc);

        pids[i] = host_spawn((i32)(usize)cmdbuf, (i32)cmdlen,
                             in_fd, out_fd, STDERR_FILENO);

        in_fd = (int)next_in_fd;
    }

    int rc = 0;
    for (int i = 0; i < pl->nstages; i++) {
        int stage_rc = host_wait(pids[i]);
        if (i == pl->nstages - 1) rc = stage_rc;
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
