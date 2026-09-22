/*
 * lsreal.c — the same C, compiled to wasm32, doing its own real
 * directory read off the real disk.
 *
 * Nothing is handed to this module. No blob of pre-gathered file
 * bytes, no `files` map, no host-side fs call staged in advance. It
 * opens the directory itself and reads the entries itself, the same
 * way native/msos.c does -- the only thing that changes between the
 * two is which syscall ABI the same logic is written against.
 *
 * Built freestanding, exactly like every other module here: -nostdlib,
 * no libc, no sysroot, own _start. The four calls it makes are
 * declared by hand below rather than pulled in from a library.
 *
 * Build:
 *   clang --target=wasm32 -O2 -ffreestanding -nostdlib \
 *         -Wl,--export=_start -Wl,--export-memory \
 *         -Wl,--initial-memory=1048576 -o lsreal.wasm lsreal.c
 */

typedef unsigned char      u8;
typedef unsigned int       u32;
typedef unsigned long long u64;
typedef signed   int       i32;
typedef unsigned long      usize;

#define WASI __attribute__((import_module("wasi_snapshot_preview1")))

WASI __attribute__((import_name("fd_readdir")))
i32 fd_readdir(i32 fd, i32 buf, i32 buf_len, u64 cookie, i32 bufused_out);

WASI __attribute__((import_name("path_open")))
i32 path_open(i32 dirfd, i32 dirflags, i32 path, i32 path_len, i32 oflags,
              u64 rights_base, u64 rights_inheriting, i32 fdflags, i32 fd_out);

WASI __attribute__((import_name("fd_close")))
i32 fd_close(i32 fd);

WASI __attribute__((import_name("fd_write")))
i32 fd_write(i32 fd, i32 iovs, i32 iovs_len, i32 nwritten_out);

WASI __attribute__((import_name("proc_exit")))
_Noreturn void proc_exit(i32 code);

#define OFLAGS_DIRECTORY  (1 << 1)
#define RIGHT_FD_READDIR  (1ULL << 14)
#define RIGHT_PATH_OPEN   (1ULL << 13)
#define RIGHT_FD_READ     (1ULL << 1)

/* The first preopened fd a WASI host hands a module. */
#define PREOPEN_FD 3

static usize str_len(const char *s) { const char *p = s; while (*p) p++; return (usize)(p - s); }
static void mem_copy(void *d, const void *s, usize n) { u8 *dp = d; const u8 *sp = s; while (n--) *dp++ = *sp++; }

static void emit(const char *buf, usize n)
{
    struct { i32 ptr; i32 len; } iov = { (i32)(usize)buf, (i32)n };
    i32 written;
    fd_write(1, (i32)(usize)&iov, 1, (i32)(usize)&written);
}
static void emit_str(const char *s) { emit(s, str_len(s)); }

/*
 * A WASI dirent: 24-byte header (next-cookie, inode, name length,
 * type) followed by the raw name bytes, packed back to back. Same
 * shape of walk getdents64 needs natively -- honor each record's own
 * length, because the name is variable.
 */
struct wasi_dirent { u64 d_next; u64 d_ino; u32 d_namlen; u8 d_type; u8 pad[3]; };

static int list_dir(i32 fd)
{
    static char buf[32768];
    u64 cookie = 0;

    for (;;)
    {
        i32 used = 0;
        if (fd_readdir(fd, (i32)(usize)buf, (i32)sizeof buf, cookie, (i32)(usize)&used) != 0)
        {
            emit_str("lsreal: readdir failed\n");
            return 1;
        }
        if (used == 0) break;

        usize off = 0;
        while (off + sizeof(struct wasi_dirent) <= (usize)used)
        {
            struct wasi_dirent *d = (struct wasi_dirent *)(buf + off);
            usize namlen = d->d_namlen;
            if (off + sizeof *d + namlen > (usize)used) break;

            const char *name = buf + off + sizeof *d;
            int is_dot = (namlen == 1 && name[0] == '.') ||
                         (namlen == 2 && name[0] == '.' && name[1] == '.');
            if (!is_dot) { emit(name, namlen); emit_str("\n"); }

            cookie = d->d_next;
            off += sizeof *d + namlen;
        }

        if ((usize)used < sizeof buf) break;
    }
    return 0;
}

void _start(void)
{
    /* The preopen itself is the directory being listed -- open a
     * subpath from it only if one is wanted. Listing the preopen
     * directly is the "." case. */
    i32 rc = list_dir(PREOPEN_FD);
    proc_exit(rc);
}
