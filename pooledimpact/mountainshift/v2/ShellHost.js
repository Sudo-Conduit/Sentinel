/**
 * @file ShellHost.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The entire plumbing shell.wasm needs (WASM instantiation,
 *   real per-stage spawning via a fresh instance per pipeline stage,
 *   real pipe()-backed pipes, a generic open-file table), collapsed
 *   behind one call: `shell.run(cmdline)` returns the command's real
 *   stdout as a plain string. Everything else stays hidden -- the same
 *   reasoning `MountainShift()` exposes only `run()`: a caller
 *   shouldn't need to know there's a whole instantiate/wire/spawn
 *   dance behind one line.
 *
 *   Every import here is the real POSIX function shell.c names it
 *   after (read, write, open, close, access, chdir, getcwd, getuid,
 *   pipe) -- shell.c calls these directly, the same way a native
 *   cat.c/ls.c/whoami.c would, with real signatures: a path argument
 *   is a plain NUL-terminated C string, not a (ptr, len) pair, because
 *   this side can find the NUL itself in the module's own linear
 *   memory, exactly like a real implementation of these calls would.
 *   getenv() isn't imported at all -- real getenv() is a pure-C scan
 *   over `environ`, populated once at exec() time, so this file's only
 *   job for it is _init_environ(), a one-time mirror of `env` into
 *   shell.wasm's linear memory (see shell.c's own comment on
 *   _init_environ for why that one call is a bootstrap exception, not
 *   a disguised getenv).
 *
 *   No formatting or lookup happens here that shell.c's own commands
 *   are supposed to do themselves: open() on a directory hands back
 *   raw NUL-separated names (cmd_ls turns that into a printed listing
 *   in C, not this file with a string .join()), and getuid() hands
 *   back a bare integer (cmd_whoami reads and parses /etc/passwd
 *   itself, in C, through the same open()/read() as any other file --
 *   this file never resolves an identity string).
 *
 *   The module itself is fetched, not read off disk -- `fetch(url)` is
 *   the one loading primitive that exists identically in a browser and
 *   in Node, so shell.wasm's bytes come from wherever it's actually
 *   served, the same way they would once this runs inside
 *   MountainShift OS itself. `fs` still appears below, but only inside
 *   open()/access() -- shell.c's OWN filesystem commands resolving a
 *   real path on this machine, a completely different concern from how
 *   the module's own bytes got loaded.
 *
 *     const { createShell } = require('./ShellHost.js');
 *     const shell = await createShell({ wasmUrl: 'http://localhost:PORT/shell.wasm' });
 *     var a = shell.run('ls /tmp');
 *     console.log(a);
 *
 * @tests test/Shell.wasm.test.js
 */
'use strict';
const fs = require('fs');

const DEFAULT_WASM_URL = 'file://' + __dirname + '/shell.wasm';

/**
 * @param {Object} [options]
 * @param {string} [options.wasmUrl] - fetched via fetch(); defaults to
 *   a file:// URL for shell.wasm next to this file, but Node's fetch()
 *   only actually serves http(s):// -- pass a real URL (e.g. a small
 *   local static server) to load it for real rather than falling back.
 * @param {Object<string,string>} [options.env] - env vars getenv() sees,
 *   mirrored into linear memory once via _init_environ()
 * @param {Object<string,string>} [options.files] - path -> plain string
 *   content. An "open directory" and an "open file" are the same thing
 *   here: whatever bytes read() returns. No packed structure, no
 *   contract invented to match one C function's expectations.
 * @param {string} [options.cwd] - initial working directory
 * @returns {Promise<{run: (cmdline: string, stdin?: string) => string}>}
 */
async function createShell(options)
{
    options = options || {};
    const wasmBytes = await fetch(options.wasmUrl || DEFAULT_WASM_URL).then((r) => r.arrayBuffer());
    const wasmModule = await WebAssembly.compile(wasmBytes);

    const env = options.env || { HOME: '/home/user', PATH: '/usr/bin:/bin' };
    // Real by default, resolved via Node's fs -- but this is an internal
    // detail of open()'s own implementation below, never part of C's
    // contract or shell.run()'s own signature. C only ever sees "a
    // string" through the ordinary read() path; it has no idea Node or
    // a real disk exists on the other side of that string. options.files
    // (path -> plain string content) overrides this with fixed,
    // deterministic content instead -- the one legitimate use is test
    // assertions that must not depend on whatever happens to be on disk.
    const fixedFiles = options.files || null;
    let cwd = options.cwd || process.cwd();

    function resolvePathContent(p)
    {
        if (fixedFiles) { return fixedFiles[p] !== undefined ? fixedFiles[p] : null; }
        let stat;
        try { stat = fs.statSync(p); } catch (e) { return null; }
        // Raw names, NUL-joined -- no formatting a human would want
        // (that's cmd_ls's job in C, not this file's). Enumerating what
        // exists is the one thing only the real filesystem can answer;
        // fs.readdirSync() is that raw fact, nothing more.
        return stat.isDirectory() ? fs.readdirSync(p).join('\0') + '\0' : fs.readFileSync(p, 'utf8');
    }

    function pathExists(p)
    {
        if (fixedFiles) { return fixedFiles[p] !== undefined; }
        return fs.existsSync(p);
    }

    const pipes = new Map();      // fd -> { chunks: Buffer, readPos: number }
    const openFiles = new Map();  // fd -> { data: Buffer, pos: number }
    let nextFd = 3;
    let nextPid = 1;
    const pidResults = new Map();

    // 'ROOT' means "the real top-level stdin/stdout for the run() call
    // currently in flight" -- shared across the top-level instance and
    // any stage spawned during it that resolves to 'ROOT', never a
    // per-instance array (only one run() is ever in flight at a time).
    let currentRootStdoutChunks = null;
    let currentRootStdinBuf = null;
    let currentRootStdinPos = 0;

    function makeInstanceImports(resolvedInFd, resolvedOutFd)
    {
        let memory;

        function readMemStr(ptr, len)
        {
            return Buffer.from(memory.buffer, ptr, len).toString('utf8');
        }
        // Real open()/access()/chdir() take a plain C string -- the
        // callee finds the NUL itself, it isn't handed a length.
        function readCStr(ptr)
        {
            const bytes = new Uint8Array(memory.buffer, ptr);
            let end = 0;
            while (bytes[end] !== 0) end++;
            return Buffer.from(memory.buffer, ptr, end).toString('utf8');
        }
        function writeI32(ptr, value)
        {
            new DataView(memory.buffer).setInt32(ptr, value, true);
        }
        // Real getcwd()/getlogin_r() NUL-terminate on success and fail
        // (rather than silently truncate) if the string doesn't fit --
        // returns the byte length written, or -1 if it doesn't fit.
        function writeCStr(ptr, cap, str)
        {
            const buf = Buffer.from(str, 'utf8');
            if (buf.length + 1 > cap) return -1;
            new Uint8Array(memory.buffer, ptr, buf.length + 1).set(Buffer.concat([buf, Buffer.from([0])]));
            return buf.length;
        }

        function doRead(fd, bufPtr, bufLen)
        {
            const openFile = openFiles.get(fd);
            if (openFile)
            {
                const remaining = openFile.data.length - openFile.pos;
                if (remaining <= 0) return 0;
                const n = Math.min(remaining, bufLen);
                new Uint8Array(memory.buffer, bufPtr, n).set(openFile.data.subarray(openFile.pos, openFile.pos + n));
                openFile.pos += n;
                return n;
            }
            if (fd !== 0) return -1;
            if (resolvedInFd === 'ROOT')
            {
                const remaining = currentRootStdinBuf.length - currentRootStdinPos;
                if (remaining <= 0) return 0;
                const n = Math.min(remaining, bufLen);
                new Uint8Array(memory.buffer, bufPtr, n).set(currentRootStdinBuf.subarray(currentRootStdinPos, currentRootStdinPos + n));
                currentRootStdinPos += n;
                return n;
            }
            const p = pipes.get(resolvedInFd);
            const remaining = p.chunks.length - p.readPos;
            if (remaining <= 0) return 0;
            const n = Math.min(remaining, bufLen);
            new Uint8Array(memory.buffer, bufPtr, n).set(p.chunks.subarray(p.readPos, p.readPos + n));
            p.readPos += n;
            return n;
        }

        function doWrite(fd, bufPtr, bufLen)
        {
            const str = readMemStr(bufPtr, bufLen);
            if (fd === 2) { currentRootStdoutChunks.push(str); return bufLen; }
            if (fd !== 1) return -1;
            if (resolvedOutFd === 'ROOT')
            {
                currentRootStdoutChunks.push(str);
                return bufLen;
            }
            const p = pipes.get(resolvedOutFd);
            p.chunks = Buffer.concat([p.chunks, Buffer.from(str, 'utf8')]);
            return bufLen;
        }

        const imports = { env: {
            read: doRead,
            write: doWrite,
            spawn: (cmdPtr, cmdLen, inFd, outFd) => spawn(readMemStr(cmdPtr, cmdLen), inFd, outFd),
            wait: (pid) => (pidResults.has(pid) ? pidResults.get(pid) : -1),
            // The one bootstrap exception, mirroring what a real
            // exec() does once before main() ever runs: after this,
            // shell.c's own getenv() is pure C, no import per lookup.
            _init_environ: (bufPtr, cap) =>
            {
                let total = 0;
                const view = new Uint8Array(memory.buffer, bufPtr, cap);
                for (const name of Object.keys(env))
                {
                    const entry = Buffer.from(name + '=' + env[name] + '\0', 'utf8');
                    if (total + entry.length > cap) break;
                    view.set(entry, total);
                    total += entry.length;
                }
                return total;
            },
            // A bare integer, nothing resolved -- process.getuid() is
            // Node's own real getuid(2) wrapper. cmd_whoami looks the
            // name up itself, in C, by reading /etc/passwd.
            getuid: () => process.getuid(),
            chdir: (pathPtr) =>
            {
                const p = readCStr(pathPtr);
                if (!pathExists(p)) return -1;
                cwd = p;
                return 0;
            },
            getcwd: (bufPtr, bufLen) => (writeCStr(bufPtr, bufLen, cwd) < 0 ? 0 : bufPtr),
            open: (pathPtr, flags) =>
            {
                const content = resolvePathContent(readCStr(pathPtr));
                if (content === null) return -1;
                const fd = nextFd++;
                openFiles.set(fd, { data: Buffer.from(content, 'utf8'), pos: 0 });
                return fd;
            },
            close: (fd) => { openFiles.delete(fd); return 0; },
            // Real access(path, mode) -- amode 1 is X_OK, 0 is F_OK,
            // matching <unistd.h> exactly. Checks the real filesystem;
            // no hardcoded candidate list.
            access: (pathPtr, mode) =>
            {
                const p = readCStr(pathPtr);
                try { fs.accessSync(p, mode === 1 ? fs.constants.X_OK : fs.constants.F_OK); return 0; }
                catch (e) { return -1; }
            },
            // Real pipe(int[2]): one array pointer, [0] read end, [1]
            // write end -- not two separate out-pointers.
            pipe: (pipefdPtr) =>
            {
                const readFd = nextFd++;
                const writeFd = nextFd++;
                const buf = { chunks: Buffer.alloc(0), readPos: 0 };
                pipes.set(readFd, buf);
                pipes.set(writeFd, buf);
                writeI32(pipefdPtr, readFd);
                writeI32(pipefdPtr + 4, writeFd);
                return 0;
            }
        } };

        return { imports, setMemory: (m) => { memory = m; } };
    }

    function runInstance(resolvedIn, resolvedOut, cmdline)
    {
        const host = makeInstanceImports(resolvedIn, resolvedOut);
        const instance = new WebAssembly.Instance(wasmModule, host.imports);
        host.setMemory(instance.exports.memory);
        const cmdBytes = Buffer.from(cmdline, 'utf8');
        const scratchPtr = instance.exports.memory.buffer.byteLength - 4096;
        new Uint8Array(instance.exports.memory.buffer, scratchPtr, cmdBytes.length).set(cmdBytes);
        return instance.exports.run(scratchPtr, cmdBytes.length);
    }

    function spawn(cmdline, inFd, outFd)
    {
        const resolvedIn = inFd === 0 ? 'ROOT' : inFd;
        const resolvedOut = outFd === 1 ? 'ROOT' : outFd;
        const rc = runInstance(resolvedIn, resolvedOut, cmdline);
        const pid = nextPid++;
        pidResults.set(pid, rc);
        return pid;
    }

    return {
        /**
         * Runs one command line and returns its real stdout as a plain
         * string. rc is available via runDetailed() when needed; this
         * one matches the ergonomics of Node's own execSync().
         * @param {string} cmdline
         * @param {string} [stdin]
         * @returns {string}
         */
        run(cmdline, stdin)
        {
            return this.runDetailed(cmdline, stdin).stdout;
        },
        /** @returns {{rc: number, stdout: string}} */
        runDetailed(cmdline, stdin)
        {
            currentRootStdoutChunks = [];
            currentRootStdinBuf = Buffer.from(stdin || '', 'utf8');
            currentRootStdinPos = 0;
            const rc = runInstance('ROOT', 'ROOT', cmdline);
            return { rc, stdout: currentRootStdoutChunks.join('') };
        }
    };
}

module.exports = { createShell };
