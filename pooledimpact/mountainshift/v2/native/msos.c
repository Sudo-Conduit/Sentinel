/*
 * msos.c — the real work, off mainline.
 *
 * No libc. No stdio.h. No JS. No WASM. No imports, no runtime, no
 * linked library of any kind -- built with -nostdlib and its own
 * _start, talking to the kernel through the raw `syscall`
 * instruction directly. Nothing above it constrains what it can do,
 * because nothing above it is in the chain at all.
 *
 * The contract is a string in, a string out:
 *   stdin  <- one command line, e.g. "ls /" or "cat /etc/hostname"
 *   stdout -> the real answer
 *
 * Whoever knocks (JS, a shell, a pipe, anything) passes a string and
 * gets a string back. It does not know or care what ran behind the
 * door.
 *
 * `ls` here is a real getdents64(2) against a real directory fd: the
 * kernel resolves the fd to its real vnode/inode, dispatches through
 * the VFS layer to whatever concrete filesystem actually backs that
 * path, and copies real directory entries back out. Same for `cat` --
 * a real open(2)/read(2) against real bytes on real disk.
 *
 * Build:
 *   clang -O2 -nostdlib -ffreestanding -static -no-pie -o msos msos.c
 */

typedef unsigned char      u8;
typedef unsigned short     u16;
typedef unsigned long      u64;
typedef long               i64;

#define SYS_read        0
#define SYS_write       1
#define SYS_open        2
#define SYS_close       3
#define SYS_exit        60
#define SYS_getdents64  217

#define O_RDONLY     0
#define O_DIRECTORY  0200000

#define STDIN_FD   0
#define STDOUT_FD  1

/* The whole dependency surface of this program: one instruction. */
static i64 sys(i64 n, i64 a, i64 b, i64 c)
{
    i64 ret;
    __asm__ volatile ("syscall"
                      : "=a"(ret)
                      : "a"(n), "D"(a), "S"(b), "d"(c)
                      : "rcx", "r11", "memory");
    return ret;
}

static u64 str_len(const char *s) { const char *p = s; while (*p) p++; return (u64)(p - s); }
static int str_eq(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }

static void emit(const char *buf, u64 n) { sys(SYS_write, STDOUT_FD, (i64)buf, (i64)n); }
static void emit_str(const char *s) { emit(s, str_len(s)); }

/*
 * Real directory read. getdents64 returns a packed buffer of variable
 * length records straight out of the kernel's VFS layer; walking it
 * means honoring each record's own d_reclen, since the name is a
 * flexible array member and records are not fixed size.
 */
static int do_ls(const char *path)
{
    i64 fd = sys(SYS_open, (i64)path, O_RDONLY | O_DIRECTORY, 0);
    if (fd < 0) { emit_str("ls: cannot access "); emit_str(path); emit_str("\n"); return 1; }

    static char buf[65536];
    for (;;)
    {
        i64 n = sys(SYS_getdents64, fd, (i64)buf, (i64)sizeof buf);
        if (n < 0) { sys(SYS_close, fd, 0, 0); emit_str("ls: read error\n"); return 1; }
        if (n == 0) break;

        for (i64 off = 0; off < n; )
        {
            u16 reclen = *(u16 *)(buf + off + 16);
            const char *name = buf + off + 19;
            if (!str_eq(name, ".") && !str_eq(name, ".."))
            {
                emit_str(name);
                emit_str("\n");
            }
            if (reclen == 0) break;
            off += reclen;
        }
    }

    sys(SYS_close, fd, 0, 0);
    return 0;
}

/* Real file read -- real bytes, off real disk, straight to stdout. */
static int do_cat(const char *path)
{
    i64 fd = sys(SYS_open, (i64)path, O_RDONLY, 0);
    if (fd < 0) { emit_str("cat: cannot open "); emit_str(path); emit_str("\n"); return 1; }

    static char buf[65536];
    for (;;)
    {
        i64 n = sys(SYS_read, fd, (i64)buf, (i64)sizeof buf);
        if (n <= 0) break;
        emit(buf, (u64)n);
    }

    sys(SYS_close, fd, 0, 0);
    return 0;
}

void _start(void)
{
    static char line[4096];
    i64 n = sys(SYS_read, STDIN_FD, (i64)line, (i64)sizeof line - 1);
    if (n < 0) n = 0;
    line[n] = '\0';

    /* Trim the trailing newline a caller's string almost always has. */
    while (n > 0 && (line[n - 1] == '\n' || line[n - 1] == '\r')) line[--n] = '\0';

    char *cmd = line;
    char *arg = line;
    while (*arg && *arg != ' ') arg++;
    if (*arg) { *arg++ = '\0'; while (*arg == ' ') arg++; }

    int rc;
    if (str_eq(cmd, "ls"))       rc = do_ls(*arg ? arg : "/");
    else if (str_eq(cmd, "cat")) rc = do_cat(arg);
    else { emit_str("msos: command not found: "); emit_str(cmd); emit_str("\n"); rc = 127; }

    sys(SYS_exit, rc, 0, 0);
    __builtin_unreachable();
}
