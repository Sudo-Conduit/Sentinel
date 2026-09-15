/*
 * shell.c — WASM module, stage 2
 *
 * Build (freestanding, no libc):
 *   clang --target=wasm32 -O2 -nostdlib -Wl,--no-entry \
 *         -Wl,--export=run -Wl,--export-memory -o shell.wasm shell.c
 *
 * Design:
 *   - One export: run(ptr, len)
 *   - Imports: real POSIX names and shapes (read, write, open, close,
 *     access, chdir, getcwd, getuid, pipe) -- only spawn()/wait()
 *     and _init_environ() have no native single-process equivalent
 *   - All state in linear memory, allocated from a bump arena
 *   - No libc. Hand-declared. Own contracts.
 *   - Commands are small, dumb, external.
 *   - Stage-list parser, N pipes, builtin flag.
 *
 * v0.0.10 — Renaming host_open()/host_whoami() to open()/getlogin_r()
 *   in v0.0.9 wasn't enough: the host side of ls and whoami was still
 *   doing the actual work of ls and whoami. ShellHost.js's open() was
 *   handing back an ALREADY newline-joined directory listing
 *   (fs.readdirSync(p).join('\n')) -- Node had already enumerated AND
 *   formatted it before cmd_ls ever saw a byte; drain_fd_to_stdout()
 *   just copied that finished string through untouched. Its
 *   getlogin_r() handed back os.userInfo().username -- Node's own
 *   built-in whoami, already resolved to a name; cmd_whoami just
 *   printed it. A PASS on either command proved only that Node's
 *   fs/os modules produce the expected string, never that shell.c
 *   does. Fixed by moving the actual command logic into C: open() on
 *   a directory now streams raw, NUL-separated names -- unformatted,
 *   the same shape a real getdents() gives a real ls.c -- and cmd_ls
 *   itself turns that into a printed listing. getuid() replaces
 *   getlogin_r() entirely: it hands back a bare integer with nothing
 *   left to interpret, and cmd_whoami looks its own name up by
 *   reading and parsing /etc/passwd (passwd(5): name:x:uid:...),
 *   through the exact same open()+read() every other command already
 *   uses -- exactly what a minimal getpwuid() does internally, just
 *   written out in this file instead of hidden inside a library call.
 * v0.0.9 — Every host_ and sys_ name is gone. Deleting sys_open(),
 *   fd_read_byte(), fd_puts(), fd_write_all(), and sys_whoami() to
 *   check whether the code still worked (it didn't -- 20 implicit-
 *   function-declaration errors, one at every real call site) proved
 *   they weren't decorative: they WERE the only path any command had
 *   to the outside world. The actual fix wasn't removing that path,
 *   it was naming it honestly. Every import is now the real POSIX
 *   function it stands for -- read, write, open, close, access,
 *   chdir, getcwd, getuid, pipe(int[2]) -- with real signatures
 *   (a path is a plain NUL-terminated C string, no invented _len
 *   parameter, because the callee can find the NUL itself in the same
 *   linear memory this module owns). cmd_cat/cmd_ls/cmd_whoami/
 *   cmd_which/builtin_cd call these names directly, the same way a
 *   native cat.c/ls.c/whoami.c would -- no sys_open()/sys_whoami()
 *   wrapper in between, because wrapping a real call in a same-shaped
 *   function that only forwards to it isn't a syscall boundary, it's
 *   just a longer name for the same call. getenv() stopped being a
 *   per-call import entirely: real getenv() is not a syscall, it's
 *   glibc scanning the `environ` array the kernel populates once at
 *   exec() time, so this module now mirrors that once, in
 *   _init_environ() (a bootstrap exception in the same category as
 *   run() itself, not a disguised getenv), and getenv() below it is
 *   pure C, zero per-lookup import calls, same as on a real system.
 *   The only names left that a native single-process build couldn't
 *   give this file for free via <unistd.h>/<fcntl.h> are spawn()/
 *   wait() (a WASM module can't fork() itself) and _init_environ().
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
/* Imports — real POSIX names and shapes, nothing invented              */
/* ------------------------------------------------------------------ */

/*
 * v0.0.9: every one of these is the actual libc/syscall it's named
 * after, not a stand-in ("host_open", "sys_open") for one. A path
 * argument is a plain NUL-terminated C string, exactly like the real
 * function takes -- no extra _len parameter, because the callee can
 * read the same linear memory this module owns and find the NUL
 * itself, the same way real open()/access()/chdir() do. Only two
 * things here couldn't exist on a real system and are named plainly
 * as what they are: spawn()/wait() (WASM can't fork() itself, so
 * something has to stand in for process creation) and _init_environ()
 * (see below). Every other declaration is what a native build's
 * <unistd.h>/<fcntl.h> would already give this file for free -- swap
 * these externs for those two includes and cat/grep/ls/whoami/which/cd
 * don't change a line.
 */

extern i32 read(i32 fd, i32 buf_ptr, i32 count)
    __attribute__((import_module("env"), import_name("read")));
extern i32 write(i32 fd, i32 buf_ptr, i32 count)
    __attribute__((import_module("env"), import_name("write")));
extern i32 open(i32 path_ptr, i32 flags)
    __attribute__((import_module("env"), import_name("open")));
extern i32 close(i32 fd)
    __attribute__((import_module("env"), import_name("close")));
extern i32 access(i32 path_ptr, i32 amode)
    __attribute__((import_module("env"), import_name("access")));
extern i32 chdir(i32 path_ptr)
    __attribute__((import_module("env"), import_name("chdir")));
extern i32 getcwd(i32 buf_ptr, i32 size)  /* returns buf_ptr, or 0 on failure -- same convention as real getcwd() returning buf or NULL */
    __attribute__((import_module("env"), import_name("getcwd")));
extern i32 getuid(void) /* real POSIX: the raw fact whoami's own real implementation starts from */
    __attribute__((import_module("env"), import_name("getuid")));
extern i32 pipe(i32 pipefd_ptr) /* pipefd_ptr -> int[2], exactly like real pipe(2) */
    __attribute__((import_module("env"), import_name("pipe")));

/* Process control -- the one pair with no real single-process C
 * equivalent, because a WASM module cannot fork() itself. Named
 * plainly as the exception it is, the same way run() itself is. */
extern i32 spawn(i32 cmd_ptr, i32 cmd_len, i32 in_fd, i32 out_fd, i32 err_fd)
    __attribute__((import_module("env"), import_name("spawn")));
extern i32 wait(i32 pid)
    __attribute__((import_module("env"), import_name("wait")));

/*
 * getenv() is NOT a syscall on a real system -- glibc's own
 * implementation is a linear scan over the `environ` array, which the
 * kernel populates once, at exec() time, before main() ever runs.
 * There is no per-lookup round-trip to anything in real getenv(); see
 * the pure-C implementation below. _init_environ() is this module's
 * one-time stand-in for that exec()-time hand-off -- an exception in
 * the same category as run() itself, not a "getenv" that happens to
 * round-trip every call.
 */
extern i32 _init_environ(i32 buf_ptr, i32 cap)
    __attribute__((import_module("env"), import_name("_init_environ")));

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

/* Real values (<unistd.h>: F_OK=0, X_OK=1) -- access() itself already
 * has the real signature, so these need to already be the real ones. */
#define F_OK 0
#define X_OK 1

#define MAX_STAGES 16
#define MAX_ARGS   64
#define MAX_LINE   8192
#define MAX_PATH   4096
#define MAX_ENVIRON 4096

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
/* environ / getenv() — pure C, exactly like real libc                 */
/* ------------------------------------------------------------------ */

/*
 * A real process's `environ` is populated once, at exec() time, by the
 * kernel handing envp to the new process -- getenv() itself is then
 * just glibc walking that array in the process's own memory, no
 * syscall involved. _init_environ() is this module's one-time stand-in
 * for that exec()-time hand-off (called once, lazily, alongside the
 * arena in run()); every getenv() call after that is pure C, same as
 * on a real system.
 */
static char  g_environ[MAX_ENVIRON];
static usize g_environ_len;

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
        i32 n = write(fd, (i32)(usize)(buf + off), (i32)(len - off));
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
    i32 n = read(fd, (i32)(usize)out, 1);
    return (n == 1) ? 1 : (n == 0 ? 0 : -1);
}

/* ------------------------------------------------------------------ */
/* Path resolution — pure C, the one thing no import does for you      */
/* ------------------------------------------------------------------ */

/*
 * Relative paths get joined against sh.cwd before reaching open() --
 * pure string work. Real open() has no idea what "current directory"
 * means either; the kernel resolves relative paths starting from the
 * calling process's own cwd entry, which is exactly what this does in
 * user space here, before the real open() call. Absolute paths pass
 * through untouched.
 */
static const char *resolve_path(const char *path, char *out, usize out_cap) {
    if (path[0] == '/') return path;

    usize cwd_len  = str_len(sh.cwd);
    usize path_len = str_len(path);
    int   need_sep = (cwd_len == 0 || sh.cwd[cwd_len - 1] != '/');
    usize total    = cwd_len + (need_sep ? 1 : 0) + path_len;

    if (total >= out_cap) return path; /* too long to join -- let open() fail on it */

    mem_copy(out, sh.cwd, cwd_len);
    usize pos = cwd_len;
    if (need_sep) out[pos++] = '/';
    mem_copy(out + pos, path, path_len + 1); /* + NUL */
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
    if (chdir((i32)(usize)path) != 0) {
        fd_puts(STDERR_FILENO, "cd: no such directory\n");
        return 1;
    }
    getcwd((i32)(usize)sh.cwd, MAX_PATH);
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

/* Drains fd to STDOUT_FILENO until EOF -- the one loop cat/ls both
 * need. From C's side, an open file and an open directory are the same
 * thing: a stream of bytes read via the ordinary read() every command
 * already uses. */
static int drain_fd_to_stdout(i32 fd) {
    char buf[4096];
    for (;;) {
        i32 n = read(fd, (i32)(usize)buf, sizeof buf);
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
        const char *path = resolve_path(argv[i], resolved, sizeof resolved);
        i32 fd = open((i32)(usize)path, O_RDONLY);
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

/*
 * v0.0.10: open() on a directory streams raw entries, NUL-separated --
 * the same shape a real getdents() gives a real ls.c: unformatted
 * names, no separator a human would ever want to see. Turning that
 * into a printed listing (one name per line) is ls's own job, same as
 * on a real system; it used to be done for this file, by whatever
 * produced the newline-joined string drain_fd_to_stdout() just copied
 * through untouched. cat still uses drain_fd_to_stdout() for regular
 * files -- their content isn't structured, so nothing should
 * reinterpret it. A directory listing is structured, so this file
 * does the interpreting.
 */
static int cmd_ls(int argc, char **argv) {
    char resolved[MAX_PATH];
    const char *path = (argc >= 2) ? resolve_path(argv[1], resolved, sizeof resolved) : sh.cwd;

    i32 fd = open((i32)(usize)path, O_RDONLY);
    if (fd < 0) {
        fd_puts(STDERR_FILENO, "ls: cannot access directory\n");
        return 1;
    }

    char buf[16384];
    usize total = 0;
    for (;;) {
        i32 n = read(fd, (i32)(usize)(buf + total), (i32)(sizeof(buf) - total));
        if (n < 0) { close(fd); fd_puts(STDERR_FILENO, "ls: read error\n"); return 1; }
        if (n == 0) break;
        total += (usize)n;
        if (total >= sizeof buf) break;
    }
    close(fd);

    usize start = 0;
    for (usize i = 0; i < total; i++) {
        if (buf[i] == '\0') {
            if (i > start) {
                fd_write_all(STDOUT_FILENO, buf + start, i - start);
                fd_puts(STDOUT_FILENO, "\n");
            }
            start = i + 1;
        }
    }
    if (total > start) {
        fd_write_all(STDOUT_FILENO, buf + start, total - start);
        fd_puts(STDOUT_FILENO, "\n");
    }
    return 0;
}

/*
 * v0.0.10: whoami no longer asks for a pre-resolved name string --
 * that was still just a relayed answer, this time from getlogin_r()
 * instead of $USER. getuid() gives a raw integer with nothing left to
 * interpret; the actual identity lookup -- reading /etc/passwd and
 * matching the uid field, exactly what a minimal getpwuid() does --
 * happens here, in C, through the SAME open()+read() every other
 * command already uses. No environment variable and no pre-formatted
 * string crosses the import boundary; only a number and raw file
 * bytes do.
 */
static int cmd_whoami(int argc, char **argv) {
    (void)argc; (void)argv;
    i32 uid = getuid();

    i32 fd = open((i32)(usize)"/etc/passwd", O_RDONLY);
    if (fd < 0) { fd_puts(STDOUT_FILENO, "unknown\n"); return 0; }
    char buf[8192];
    usize total = 0;
    for (;;) {
        i32 n = read(fd, (i32)(usize)(buf + total), (i32)(sizeof(buf) - total));
        if (n <= 0) break;
        total += (usize)n;
        if (total >= sizeof buf) break;
    }
    close(fd);
    if (total >= sizeof buf) total = sizeof buf - 1;
    buf[total] = '\0';

    /* passwd(5): name:passwd:uid:gid:gecos:home:shell, one entry per
     * line. */
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
                if (parse_int(uidfield) == uid) {
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
            if (access((i32)(usize)buf, X_OK) == 0) {
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
 * command string for spawn(), which takes a command line, not an
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
 * was wrong was this function bypassing spawn() entirely and calling
 * each command in-process, so every stage's fd 0/1 resolved to the
 * SAME real stdin/stdout no matter its position. Now: a real pipe
 * (pipe()) is created between every adjacent pair of stages, each
 * stage is handed off to spawn() with the correct in_fd/out_fd
 * (STDIN_FILENO only for the first stage, STDOUT_FILENO only for the
 * last), and every spawned pid is waited on via wait().
 *
 * All stages are spawned first, then all are waited on, matching real
 * pipeline semantics (every stage notionally running concurrently) even
 * though today's implementation may in practice run each spawn
 * synchronously to completion -- wait() still gets called on every pid
 * either way, so an implementation that DOES spawn real concurrent
 * processes needs no change here to actually behave correctly.
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
         * This bypass is load-bearing, not an optimization: spawn()
         * exists to isolate ONE STAGE OF A PIPELINE, and its own
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
            /* pipe(int[2]) -- real signature: one array, [0] read end,
             * [1] write end. */
            i32 *pipefd = (i32 *)arena_alloc(sizeof(i32) * 2);
            if (!pipefd) { fd_puts(STDERR_FILENO, "shell: out of memory\n"); return 1; }
            if (pipe((i32)(usize)pipefd) != 0) {
                fd_puts(STDERR_FILENO, "shell: pipe() failed\n");
                return 1;
            }
            out_fd = pipefd[1];
            next_in_fd = pipefd[0];
        } else {
            out_fd = STDOUT_FILENO;
        }

        char cmdbuf[MAX_LINE];
        usize cmdlen = rejoin_argv(cmdbuf, sizeof cmdbuf,
                                   pl->stages[i].argv, pl->stages[i].argc);

        pids[i] = spawn((i32)(usize)cmdbuf, (i32)cmdlen,
                        in_fd, out_fd, STDERR_FILENO);

        in_fd = (int)next_in_fd;
    }

    int rc = 0;
    for (int i = 0; i < pl->nstages; i++) {
        int stage_rc = wait(pids[i]);
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
        getcwd((i32)(usize)sh.cwd, MAX_PATH);
        /* The one-time exec()-time hand-off getenv() depends on -- see
         * the comment above g_environ. */
        g_environ_len = (usize)_init_environ((i32)(usize)g_environ, sizeof g_environ);
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
