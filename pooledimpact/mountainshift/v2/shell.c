/*
 * shell.c — WASM module, stage 3: zero imports
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
 *   - Response blob: new_cwd\0 rc\0 <remaining bytes are stdout>.
 *   - Multi-stage pipelines no longer spawn anything -- there's
 *     nothing to spawn without a host. Each stage is a plain function
 *     call within this same run(), stdout redirected to a small
 *     in-memory buffer that becomes the next stage's stdin. Real
 *     concurrency was never actually happening under the old
 *     spawn()/wait() design either (this environment always ran each
 *     stage to completion before the next); this makes that honest.
 *   - All state in linear memory, allocated from a bump arena.
 *   - No libc. Hand-declared. Own contracts.
 *
 * v0.1 (stage 3) — Every import is gone, including the real WASI ones.
 *   WASI's path_open() turned out to still be "something else doing
 *   the command's job," just relocated: it enforces WASI's OWN rights-
 *   bitmask/capability policy (the FD_READ|FD_READDIR mask, preopen-
 *   relative resolution, WASI-specific errno mapping) before the real
 *   OS call underneath it ever runs -- Node's WASI implementation
 *   deciding things, not a dumb relay of a raw syscall. The only way
 *   to make shell.wasm the one and only thing touching real bytes was
 *   to stop crossing the import boundary at all, in either direction,
 *   for anything. WebAssembly.Module.imports(this module) is now [].
 *   The host's only two operations are the ones this project's own
 *   memorymap.c already established as the pattern: write into a
 *   fixed offset in the module's own linear memory, call one exported
 *   entry point, read a fixed offset back out. Real content (file
 *   bytes, a directory's raw listing, /etc/passwd, the real uid) is
 *   gathered entirely outside any WASM interaction and bundled into
 *   the SAME request blob the command line already travels in --
 *   nothing shell.c ever needed was "a call," only ever "a string."
 *   Multi-stage pipelines stopped spawning anything, because there's
 *   no host left to spawn via: each stage is a plain function call
 *   within the same run(), stdout redirected to an in-memory buffer
 *   that becomes the next stage's stdin. A real caught bug along the
 *   way: the new vfd table's open() returned raw array indices
 *   starting at 0, colliding with STDIN_FILENO (also 0) -- the first
 *   file opened in any command was silently read back as stdin
 *   instead, producing empty output with a misleadingly successful
 *   rc=0 for every real ls/cat until fd numbering was moved to start
 *   at 3, same as a real fd table reserves 0/1/2 for stdio.
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

static int cmd_ls(int argc, char **argv) {
    char resolved[MAX_PATH];
    const char *path = (argc >= 2) ? resolve_path(argv[1], resolved, sizeof resolved) : sh.cwd;

    i32 fd = open(path, O_RDONLY);
    if (fd < 0) {
        fd_puts(STDERR_FILENO, "ls: cannot access directory\n");
        return 1;
    }
    /* The vfile behind this fd is a NUL-separated raw listing --
     * whoever built the request blob is responsible for that shape,
     * same contract as before. cmd_ls turns it into a printed listing
     * (one name per line) itself, exactly like a real ls.c does after
     * getdents(). */
    char buf[16384];
    usize total = 0;
    for (;;) {
        i32 n = read(fd, buf + total, (i32)(sizeof(buf) - total));
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
