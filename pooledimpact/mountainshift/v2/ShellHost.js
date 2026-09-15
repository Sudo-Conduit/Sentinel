/**
 * @file ShellHost.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The entire host-side plumbing shell.wasm needs (WASM
 *   instantiation, real per-stage spawning via a fresh instance per
 *   pipeline stage, real host_pipe()-backed pipes, a generic open-file
 *   table), collapsed behind one call: `shell.run(cmdline)` returns the
 *   command's real stdout as a plain string. Everything else stays
 *   hidden -- the same reasoning `MountainShift()` exposes only
 *   `run()`: a caller shouldn't need to know there's a whole
 *   instantiate/wire/spawn dance behind one line.
 *
 *   Synchronous end to end -- `new WebAssembly.Module(bytes)` compiles
 *   synchronously in Node (unlike the browser-recommended async
 *   `WebAssembly.compile()`), so `createShell()` and `run()` both
 *   return directly, no `await` anywhere:
 *
 *     const { createShell } = require('./ShellHost.js');
 *     const shell = createShell();
 *     var a = shell.run('ls /tmp');
 *     console.log(a);
 *
 * @tests test/Shell.wasm.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_WASM_PATH = path.join(__dirname, 'shell.wasm');

/**
 * @param {Object} [options]
 * @param {string} [options.wasmPath] - defaults to ./shell.wasm
 * @param {Object<string,string>} [options.env] - env vars getenv() sees
 * @param {Object<string,string>} [options.files] - path -> plain string
 *   content. An "open directory" and an "open file" are the same thing
 *   here: whatever bytes fd_read() returns. No packed structure, no
 *   contract invented to match one C function's expectations.
 * @param {string} [options.cwd] - initial working directory
 * @returns {{run: (cmdline: string, stdin?: string) => string}}
 */
function createShell(options)
{
    options = options || {};
    const wasmBytes = fs.readFileSync(options.wasmPath || DEFAULT_WASM_PATH);
    const wasmModule = new WebAssembly.Module(wasmBytes);

    const env = options.env || { USER: 'meshos', HOME: '/home/user', PATH: '/usr/bin:/bin' };
    // Real by default, resolved via Node's fs -- but this is an internal
    // detail of open()'s own implementation below, never part of C's
    // contract or shell.run()'s own signature. C only ever sees "a
    // string" through the ordinary fd_read path; it has no idea Node or
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
        return stat.isDirectory() ? fs.readdirSync(p).join('\n') + '\n' : fs.readFileSync(p, 'utf8');
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
        function writeStr(ptr, maxLen, str)
        {
            const buf = Buffer.from(str, 'utf8');
            const n = Math.min(buf.length, maxLen);
            new Uint8Array(memory.buffer, ptr, n).set(buf.subarray(0, n));
            return n;
        }
        function writeI32(ptr, value)
        {
            new DataView(memory.buffer).setInt32(ptr, value, true);
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

        const imports = { host: {
            fd_read: doRead,
            fd_write: doWrite,
            spawn: (cmdPtr, cmdLen, inFd, outFd) => spawn(readMemStr(cmdPtr, cmdLen), inFd, outFd),
            wait: (pid) => (pidResults.has(pid) ? pidResults.get(pid) : -1),
            getenv: (namePtr, nameLen, bufPtr, bufLen) =>
            {
                const val = env[readMemStr(namePtr, nameLen)];
                return val === undefined ? -1 : writeStr(bufPtr, bufLen, val);
            },
            // Real identity, not the environment -- os.userInfo().username
            // is backed by the real uid the way getpwuid(geteuid()) is, so
            // no amount of tampering with the env object above can spoof
            // what whoami reports, matching real whoami's own behavior.
            whoami: (bufPtr, bufLen) => writeStr(bufPtr, bufLen, os.userInfo().username),
            chdir: (pathPtr, pathLen) =>
            {
                const p = readMemStr(pathPtr, pathLen);
                if (!pathExists(p)) return -1;
                cwd = p;
                return 0;
            },
            getcwd: (bufPtr, bufLen) => writeStr(bufPtr, bufLen, cwd),
            open: (pathPtr, pathLen) =>
            {
                const content = resolvePathContent(readMemStr(pathPtr, pathLen));
                if (content === null) return -1;
                const fd = nextFd++;
                openFiles.set(fd, { data: Buffer.from(content, 'utf8'), pos: 0 });
                return fd;
            },
            close: (fd) => { openFiles.delete(fd); return 0; },
            access: (pathPtr, pathLen) =>
            {
                const p = readMemStr(pathPtr, pathLen);
                const base = '/usr/bin:/bin'.split(':').some((dir) => p === dir + '/' + p.split('/').pop());
                return base ? 0 : -1;
            },
            pipe: (readFdOutPtr, writeFdOutPtr) =>
            {
                const readFd = nextFd++;
                const writeFd = nextFd++;
                const buf = { chunks: Buffer.alloc(0), readPos: 0 };
                pipes.set(readFd, buf);
                pipes.set(writeFd, buf);
                writeI32(readFdOutPtr, readFd);
                writeI32(writeFdOutPtr, writeFd);
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
