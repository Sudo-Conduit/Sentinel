/**
 * @file ShellHost.js
 * @author Will Fobbs
 * @version 2.0.0
 * @description Instantiates shell.wasm against REAL WASI --
 * `wasi_snapshot_preview1`, fulfilled by Node's own native WASI
 * implementation (`node:wasi`), which calls the real OS directly.
 * This file never touches a real file, a real directory, or the real
 * environment itself -- shell.c's own path_open()/fd_readdir()/
 * environ_get() calls go straight to Node's WASI, not to any JS glue
 * written here. The only two things this file still does at the
 * import boundary are things WASI's capability model has no way to
 * express at all, not things it does instead of shell.c:
 *
 *   1. stdio (fd 0/1/2) -- WASI wires these to the REAL process's real
 *      stdin/stdout/stderr, which is correct for a real program but
 *      wrong for `shell.run()`'s job of returning a command's output
 *      as a string, and wrong for a pipeline stage, whose fd 0/1 must
 *      be an in-memory pipe, not the real terminal. So fd 0/1/2 (and
 *      only those three) are intercepted and redirected to an
 *      in-memory buffer instead of being handed to real WASI.
 *   2. process control (spawn/wait/pipe/getuid) -- a WASM module can't
 *      fork() itself, WASI preview1 defines no pipe(2), and WASI has
 *      no user/uid concept at all. These stay on their own "env"
 *      module, matching shell.c's own naming, and every pipe fd they
 *      hand out lives in a numeric range far above anything WASI's
 *      own fd table would ever use, so the two never collide.
 *
 * Every other fd -- anything path_open() returned -- is real, and
 * fd_read()/fd_write()/fd_close() on it go straight to
 * `wasi.wasiImport`, completely unmodified.
 *
 *     const { createShell } = require('./ShellHost.js');
 *     const shell = await createShell({ wasmUrl: 'http://localhost:PORT/shell.wasm' });
 *     var a = shell.run('ls /tmp');
 *     console.log(a);
 *
 * @tests test/Shell.wasm.test.js
 */
'use strict';
const { WASI } = require('node:wasi');

const DEFAULT_WASM_URL = 'file://' + __dirname + '/shell.wasm';
const PIPE_FD_BASE = 1000000; // far above anything WASI's own fd table uses

/**
 * @param {Object} [options]
 * @param {string} [options.wasmUrl] - fetched via fetch(); defaults to
 *   a file:// URL for shell.wasm next to this file, but Node's fetch()
 *   only actually serves http(s):// -- pass a real URL to load it for
 *   real rather than falling back.
 * @param {Object<string,string>} [options.env] - the real environment
 *   WASI's own environ_sizes_get()/environ_get() will report; shell.c
 *   reads it with its own pure-C getenv(), never through this file.
 * @param {string} [options.stdin] - unused directly; use run()'s own
 *   stdin argument instead.
 * @returns {Promise<{run: (cmdline: string, stdin?: string) => string}>}
 */
async function createShell(options)
{
    options = options || {};
    const wasmBytes = await fetch(options.wasmUrl || DEFAULT_WASM_URL).then((r) => r.arrayBuffer());
    const wasmModule = await WebAssembly.compile(wasmBytes);

    const env = options.env || { HOME: '/home/user', PATH: '/usr/bin:/bin' };
    // Session-persistent, plain string bookkeeping -- NOT real I/O.
    // Every shell.run() call gets a fresh WebAssembly.Instance (fresh
    // linear memory), so sh.cwd can't survive on the C side between
    // calls on its own; this is relayed in/out via the module's own
    // cwd_ptr() export, the same category as passing the command line
    // itself in through ptr/len.
    let cwd = options.cwd || '/';

    const pipes = new Map(); // fd -> { chunks: Buffer, readPos: number }
    let nextPipeFd = PIPE_FD_BASE;
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
        // A fresh WASI instance per pipeline stage, exactly like a
        // fresh WebAssembly.Instance per stage -- each is its own
        // isolated real syscall surface, preopened at "/".
        const wasi = new WASI({ version: 'preview1', args: [], env, preopens: { '/': '/' } });
        let memory;

        function readMemStr(ptr, len)
        {
            return Buffer.from(memory.buffer, ptr, len).toString('utf8');
        }
        function readIovec(iovsPtr)
        {
            const dv = new DataView(memory.buffer);
            return { ptr: dv.getInt32(iovsPtr, true), len: dv.getInt32(iovsPtr + 4, true) };
        }
        function writeI32(ptr, value)
        {
            new DataView(memory.buffer).setInt32(ptr, value, true);
        }

        // fd_read/fd_write take a real WASI iovec (ptr, len) -- shell.c's
        // own read()/write() wrappers only ever build a single one, so
        // that's the only shape handled here.
        function customFdRead(fd, iovsPtr, iovsLen, nreadPtr)
        {
            const { ptr, len } = readIovec(iovsPtr);
            let src, pos;
            if (fd === 0 && resolvedInFd === 'ROOT') { src = currentRootStdinBuf; pos = currentRootStdinPos; }
            else if (fd === 0) { const p = pipes.get(resolvedInFd); src = p.chunks; pos = p.readPos; }
            else if (fd >= PIPE_FD_BASE) { const p = pipes.get(fd); src = p.chunks; pos = p.readPos; }
            else return wasi.wasiImport.fd_read(fd, iovsPtr, iovsLen, nreadPtr);

            const n = Math.max(0, Math.min(src.length - pos, len));
            new Uint8Array(memory.buffer, ptr, n).set(src.subarray(pos, pos + n));
            if (fd === 0 && resolvedInFd === 'ROOT') currentRootStdinPos += n;
            else if (fd === 0) pipes.get(resolvedInFd).readPos += n;
            else pipes.get(fd).readPos += n;
            writeI32(nreadPtr, n);
            return 0;
        }

        function customFdWrite(fd, iovsPtr, iovsLen, nwrittenPtr)
        {
            const { ptr, len } = readIovec(iovsPtr);
            if (fd === 1 || fd === 2 || fd >= PIPE_FD_BASE)
            {
                const str = readMemStr(ptr, len);
                if (fd === 2) currentRootStdoutChunks.push(str);
                else if (fd === 1 && resolvedOutFd === 'ROOT') currentRootStdoutChunks.push(str);
                else if (fd === 1) { const p = pipes.get(resolvedOutFd); p.chunks = Buffer.concat([p.chunks, Buffer.from(str, 'utf8')]); }
                else { const p = pipes.get(fd); p.chunks = Buffer.concat([p.chunks, Buffer.from(str, 'utf8')]); }
                writeI32(nwrittenPtr, len);
                return 0;
            }
            return wasi.wasiImport.fd_write(fd, iovsPtr, iovsLen, nwrittenPtr);
        }

        // Everything else -- path_open, fd_close, fd_readdir,
        // environ_sizes_get, environ_get, and anything else WASI
        // defines -- is wasi.wasiImport, completely unmodified.
        const wasiImport = Object.assign({}, wasi.wasiImport, {
            fd_read: customFdRead,
            fd_write: customFdWrite,
        });

        const imports = {
            wasi_snapshot_preview1: wasiImport,
            env: {
                // WASI has no user/uid concept at all -- the one fact
                // whoami needs that no real syscall here provides.
                getuid: () => process.getuid(),
                spawn: (cmdPtr, cmdLen, inFd, outFd) => spawn(readMemStr(cmdPtr, cmdLen), inFd, outFd),
                wait: (pid) => (pidResults.has(pid) ? pidResults.get(pid) : -1),
                // WASI preview1 defines no pipe(2). Real pipe(int[2])
                // shape: one array pointer, [0] read end, [1] write end.
                pipe: (pipefdPtr) =>
                {
                    const readFd = nextPipeFd++;
                    const writeFd = nextPipeFd++;
                    const buf = { chunks: Buffer.alloc(0), readPos: 0 };
                    pipes.set(readFd, buf);
                    pipes.set(writeFd, buf);
                    writeI32(pipefdPtr, readFd);
                    writeI32(pipefdPtr + 4, writeFd);
                    return 0;
                },
            },
        };

        return { imports, wasi, setMemory: (m) => { memory = m; } };
    }

    const MAX_PATH = 4096; // matches shell.c's own MAX_PATH -- sh.cwd's real capacity

    function runInstance(resolvedIn, resolvedOut, cmdline)
    {
        const host = makeInstanceImports(resolvedIn, resolvedOut);
        const instance = new WebAssembly.Instance(wasmModule, host.imports);
        host.setMemory(instance.exports.memory);
        host.wasi.initialize(instance);

        const cwdPtr = instance.exports.cwd_ptr();
        const cwdBytes = Buffer.from(cwd, 'utf8');
        new Uint8Array(instance.exports.memory.buffer, cwdPtr, cwdBytes.length + 1).set(Buffer.concat([cwdBytes, Buffer.from([0])]));

        const cmdBytes = Buffer.from(cmdline, 'utf8');
        const scratchPtr = instance.exports.memory.buffer.byteLength - 4096;
        new Uint8Array(instance.exports.memory.buffer, scratchPtr, cmdBytes.length).set(cmdBytes);
        const rc = instance.exports.run(scratchPtr, cmdBytes.length);

        // Read back whatever sh.cwd is now (unchanged unless this call
        // was a `cd`) so the NEXT fresh instance starts where this one
        // left off.
        const cwdOut = new Uint8Array(instance.exports.memory.buffer, cwdPtr, MAX_PATH);
        let end = 0;
        while (end < MAX_PATH && cwdOut[end] !== 0) end++;
        cwd = Buffer.from(cwdOut.subarray(0, end)).toString('utf8');

        return rc;
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
