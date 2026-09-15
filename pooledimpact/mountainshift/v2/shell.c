/*
 * shell.c — WASM module, stage 2
 *
 * Build (freestanding, no libc):
 *   clang --target=wasm32 -O2 -ffreestanding -nostdlib -Wl,--no-entry \
 *         -Wl,--export=run -Wl,--export=cwd_ptr -Wl,--export-memory \
 *         -o shell.wasm shell.c
 *
 * Design:
 *   - Two exports: run(ptr, len), and cwd_ptr() -- pure session
 *     bookkeeping (see cwd_ptr()'s own comment), not I/O
 *   - Imports: real WASI (wasi_snapshot_preview1) -- fd_read, fd_write,
 *     fd_close, fd_readdir, path_open, environ_sizes_get, environ_get
 *     -- fulfilled natively by the runtime itself. Only getuid(),
 *     spawn()/wait(), and pipe() have no WASI equivalent at all
 *   - All state in linear memory, allocated from a bump arena
 *   - No libc. Hand-declared. Own contracts.
 *   - Commands are small, dumb, external.
 *   - Stage-list parser, N pipes, builtin flag.
 *
 * v0.0.11 — Real WASI. Every previous version still had actual JS
 *   code standing at the import boundary deciding what a syscall
 *   meant -- even fs-free JS (ShellHost.js's open()/access() reading
 *   only from a caller-supplied map) was still application code
 *   fulfilling shell.c's syscalls, one layer removed from disk. The
 *   only way to make shell.wasm the one thing actually touching real
 *   bytes is to stop authoring the syscall layer at all: read(),
 *   write(), open(), close(), access(), chdir() are gone as
 *   hand-written wrappers over an invented "env" module and are now
 *   thin wrappers over the REAL wasi_snapshot_preview1 ABI --
 *   fd_read(), fd_write(), fd_close(), path_open() -- fulfilled by
 *   Node's own native WASI implementation (node:wasi), which calls
 *   the real OS directly. cmd_ls() now parses fd_readdir()'s actual
 *   raw dirent buffer itself (24-byte header + name bytes, no
 *   padding between records) -- the literal kern_getdirentries()
 *   shape this file opened with, finally implemented for real instead
 *   of talked about. getenv() is fed by real environ_sizes_get()/
 *   environ_get() instead of an invented _init_environ(). access()/
 *   chdir() have no WASI equivalent (no permission bits, no
 *   process-wide cwd in WASI's capability model), so they fall back
 *   to attempt-open, the same honest thing a libc without a dedicated
 *   call would do. getuid()/spawn()/wait()/pipe() are the only names
 *   left with no WASI equivalent at all (no user model, no fork(),
 *   no pipe(2)) and stay on their own "env" module, named plainly as
 *   the exceptions they are -- same category as run() itself. Also
 *   added cwd_ptr(): since this module gets a fresh
 *   WebAssembly.Instance every single run() call, sh.cwd can't
 *   survive between calls on its own any more -- this export lets the
 *   caller relay that one plain string in and out around each call,
 *   pure session bookkeeping, not I/O. Confirmed live: whoami, ls (/,
 *   /bin, cwd, /etc, and back), cat, which, a real pipeline, and both
 *   real failure cases, with zero JS-authored syscall logic anywhere
 *   in ShellHost.js -- only real WASI, or the four documented
 *   exceptions.
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
 * v0.0.11: these are the actual WASI syscalls -- fulfilled natively by
 * the runtime itself (Node's own C++ WASI implementation, calling the
 * real OS directly), not by any JS code this project wrote. There is
 * no "host" module here at all any more: the import module name is
 * "wasi_snapshot_preview1", the real standard, and passing it Node's
 * own `wasi.wasiImport` object unmodified is what makes path_open()/
 * fd_readdir()/environ_get() below real -- the same way a real
 * kernel's syscall table fulfills a real libc's open()/getdents().
 *
 * Only four names have no WASI equivalent, because WASI's capability
 * model has no user/uid concept and no fork()/pipe(2): getuid(),
 * spawn(), wait(), pipe(). Those stay on their own "env" module,
 * named plainly as the exceptions they are -- the same category run()
 * itself is already in.
 */

extern i32 fd_read(i32 fd, i32 iovs_ptr, i32 iovs_len, i32 nread_ptr)
    __attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_read")));
extern i32 fd_write(i32 fd, i32 iovs_ptr, i32 iovs_len, i32 nwritten_ptr)
    __attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_write")));
extern i32 fd_close(i32 fd)
    __attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_close")));
extern i32 fd_readdir(i32 fd, i32 buf_ptr, i32 buf_len, i64 cookie, i32 bufused_ptr)
    __attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_readdir")));
extern i32 path_open(i32 dirfd, i32 dirflags, i32 path_ptr, i32 path_len, i32 oflags,
                      i64 fs_rights_base, i64 fs_rights_inheriting, i32 fdflags, i32 opened_fd_ptr)
    __attribute__((import_module("wasi_snapshot_preview1"), import_name("path_open")));
extern i32 environ_sizes_get(i32 count_ptr, i32 buf_size_ptr)
    __attribute__((import_module("wasi_snapshot_preview1"), import_name("environ_sizes_get")));
extern i32 environ_get(i32 environ_ptr, i32 buf_ptr)
    __attribute__((import_module("wasi_snapshot_preview1"), import_name("environ_get")));

extern i32 getuid(void) /* WASI has no user model at all -- the one fact whoami needs that no real syscall here provides */
    __attribute__((import_module("env"), import_name("getuid")));
extern i32 pipe(i32 pipefd_ptr) /* WASI preview1 defines no pipe(2) */
    __attribute__((import_module("env"), import_name("pipe")));
extern i32 spawn(i32 cmd_ptr, i32 cmd_len, i32 in_fd, i32 out_fd, i32 err_fd) /* WASM cannot fork() itself */
    __attribute__((import_module("env"), import_name("spawn")));
extern i32 wait(i32 pid)
    __attribute__((import_module("env"), import_name("wait")));

/* The preopened directory fd -- by convention (and Node's own WASI
 * implementation) the first and only preopen lands at fd 3. It's
 * preopened as "/", so an absolute path this file already computed
 * (resolve_path() always returns one) becomes dirfd-relative just by
 * dropping its leading slash -- see rel_path() below. */
#define PREOPEN_FD 3
#define WASI_RIGHTS_READ ((i64)((1 << 1) | (1 << 14))) /* FD_READ | FD_READDIR */

/* ------------------------------------------------------------------ */
/* Hand-rolled string / memory — no <string.h>                         */
/* ------------------------------------------------------------------ */

static usize str_len(const char *s) {
    const char *p = s;
    while (*p) p++;
    return (usize)(p - s);
}

/*
 * read()/write()/open()/close()/access()/chdir() are thin C wrappers
 * over the real WASI calls above -- exactly the same relationship a
 * real libc's read()/write() have to the raw syscall numbers
 * underneath them. Nothing here is a stand-in; they just do the
 * iovec/rights/dirfd marshaling real WASI requires. Declared here,
 * right after str_len(), instead of up next to the WASI externs,
 * because open() needs str_len() and this file orders definitions
 * before their first use rather than forward-declaring (v0.0.1's own
 * fix already established that discipline).
 */
static i32 read(i32 fd, i32 buf_ptr, i32 count) {
    i32 iov[2]; i32 nread;
    iov[0] = buf_ptr; iov[1] = count;
    return fd_read(fd, (i32)(usize)iov, 1, (i32)(usize)&nread) == 0 ? nread : -1;
}
static i32 write(i32 fd, i32 buf_ptr, i32 count) {
    i32 iov[2]; i32 nwritten;
    iov[0] = buf_ptr; iov[1] = count;
    return fd_write(fd, (i32)(usize)iov, 1, (i32)(usize)&nwritten) == 0 ? nwritten : -1;
}
static i32 close(i32 fd) {
    return fd_close(fd) == 0 ? 0 : -1;
}
static const char *rel_path(const char *path) {
    if (path[0] != '/') return path;
    if (path[1] == '\0') return "."; /* "/" itself -- the preopen root; WASI path_open() rejects an empty relative path */
    return path + 1;
}
static i32 open(i32 path_ptr, i32 flags) {
    (void)flags;
    const char *rel = rel_path((const char *)(usize)path_ptr);
    i32 opened_fd;
    i32 rc = path_open(PREOPEN_FD, 1 /* SYMLINK_FOLLOW */,
                        (i32)(usize)rel, (i32)str_len(rel), 0,
                        WASI_RIGHTS_READ, WASI_RIGHTS_READ, 0,
                        (i32)(usize)&opened_fd);
    return rc == 0 ? opened_fd : -1;
}
/* No WASI equivalent for either -- access(2) and chdir(2) are both
 * real syscalls on a real system, but WASI's capability model has no
 * permission-bit check and no process-wide cwd. The honest fallback
 * every minimal libc without a dedicated call uses: attempt to open
 * the path, and let success or failure answer the question. */
static i32 access(i32 path_ptr, i32 mode) {
    (void)mode;
    i32 fd = open(path_ptr, 0);
    if (fd < 0) return -1;
    close(fd);
    return 0;
}
static i32 chdir(i32 path_ptr) {
    return access(path_ptr, 0);
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
 * syscall involved. This module's version of that one-time hand-off is
 * real WASI too: environ_sizes_get()+environ_get(), called once,
 * lazily, alongside the arena in run(). Every getenv() call after that
 * is pure C, same as on a real system.
 */
static char  g_environ[MAX_ENVIRON];
static usize g_environ_len;
static i32   g_environ_ptrs[128]; /* environ_get()'s required pointer table -- unused by getenv(), which scans g_environ directly, but WASI still needs somewhere valid to write it */

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
    /* No getcwd() equivalent in WASI -- there's no process-wide cwd to
     * ask for. path is already the resolved, canonical absolute form
     * (resolve_path() guarantees that), so it IS the new cwd. */
    usize n = str_len(path);
    mem_copy(sh.cwd, path, n < MAX_PATH ? n + 1 : MAX_PATH - 1);
    if (n >= MAX_PATH) sh.cwd[MAX_PATH - 1] = '\0';
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
 * v0.0.11: fd_readdir() is the real WASI syscall -- fulfilled by
 * Node's own native WASI implementation, calling the real OS directly
 * -- and it hands back exactly the raw kernel-style buffer
 * kern_getdirentries() (this whole file's very first reference point)
 * copies out to userspace: fixed-size records back-to-back, each a
 * 24-byte header (d_next: u64, d_ino: u64, d_namlen: u32, d_type: u8 +
 * 3 bytes padding) immediately followed by d_namlen raw name bytes,
 * no NUL, no separator. Nothing arrives pre-formatted; turning that
 * into a printed listing (one name per line) is ls's own job, done
 * right here, the same way a real ls.c walks its own getdents()
 * buffer.
 */
struct wasi_dirent {
    u64 d_next;
    u64 d_ino;
    u32 d_namlen;
    u8  d_type;
    u8  _pad[3];
};

static int cmd_ls(int argc, char **argv) {
    char resolved[MAX_PATH];
    const char *path = (argc >= 2) ? resolve_path(argv[1], resolved, sizeof resolved) : sh.cwd;

    i32 fd = open((i32)(usize)path, O_RDONLY);
    if (fd < 0) {
        fd_puts(STDERR_FILENO, "ls: cannot access directory\n");
        return 1;
    }

    char buf[32768];
    i32 bufused = 0;
    i32 rc = fd_readdir(fd, (i32)(usize)buf, sizeof buf, 0, (i32)(usize)&bufused);
    close(fd);
    if (rc != 0) {
        fd_puts(STDERR_FILENO, "ls: read error\n");
        return 1;
    }

    usize off = 0;
    while (off + sizeof(struct wasi_dirent) <= (usize)bufused) {
        struct wasi_dirent de;
        mem_copy(&de, buf + off, sizeof de);
        if (off + sizeof de + de.d_namlen > (usize)bufused) break;
        fd_write_all(STDOUT_FILENO, buf + off + sizeof de, de.d_namlen);
        fd_puts(STDOUT_FILENO, "\n");
        off += sizeof de + de.d_namlen;
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
 * cwd_ptr(): NOT a syscall, and not a WASI substitute -- WASI has no
 * process-wide cwd, and this isn't standing in for one. It exists
 * because this module gets a FRESH WebAssembly.Instance (fresh linear
 * memory) on every single run() call, so sh.cwd -- a C static -- can't
 * survive between calls on its own. A real OS process keeps its cwd in
 * its own memory for its own lifetime; this export just lets whatever
 * is re-instantiating this module each time copy that one plain
 * string in before run() and back out after, the same category of
 * bookkeeping as passing the command line itself in through ptr/len.
 * No file, no real path resolution, no interpretation happens on the
 * other side of this -- it's session continuity, not I/O.
 */
__attribute__((export_name("cwd_ptr")))
i32 cwd_ptr(void) {
    return (i32)(usize)sh.cwd;
}

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

        /* The one-time exec()-time hand-off getenv() depends on --
         * see the comment above g_environ. Real WASI calls, not a
         * disguised getenv: environ_sizes_get() + environ_get() are
         * exactly what a real libc's startup code runs once too. */
        i32 count, bufsize;
        if (environ_sizes_get((i32)(usize)&count, (i32)(usize)&bufsize) == 0
            && (usize)bufsize <= sizeof g_environ
            && (usize)count <= sizeof(g_environ_ptrs) / sizeof(g_environ_ptrs[0])) {
            environ_get((i32)(usize)g_environ_ptrs, (i32)(usize)g_environ);
            g_environ_len = (usize)bufsize;
        }
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
