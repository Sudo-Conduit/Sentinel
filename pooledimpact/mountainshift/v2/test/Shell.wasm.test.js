// Life-cycle proof for shell.c's compiled shell.wasm: loads the real
// compiled module (not a mock), wires up a minimal JS host implementing
// every declared host import -- including real spawn/pipe/wait since
// v0.0.3 -- and drives real commands, including a real multi-stage
// pipeline, through the single run(ptr, len) export.
//
// host_spawn() here instantiates a FRESH WebAssembly.Instance of the
// SAME compiled module per stage, rather than reentering the calling
// instance's own run(). That is deliberate, not incidental: shell.c's
// bump arena is a single unconditional-reset allocator with no
// reentrancy guard, so calling run() again on the SAME instance mid-
// pipeline would have the nested call's own arena_reset() silently
// stomp the outer call's still-live allocations (e.g. the pipe fd
// slots just written by host_pipe()). A fresh instance per spawned
// stage gives each stage its own independent linear memory/arena,
// exactly the isolation a real fork() gives a child process, and
// sidesteps that hazard entirely rather than working around it.
//
// Run with: node test/Shell.wasm.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { check, report } = require('./helpers.js');

const V2 = path.join(__dirname, '..');

function makeOS(wasmModule) {
    const env = { USER: 'meshos', HOME: '/home/user', PATH: '/usr/bin:/bin' };
    // v0.0.6: files are plain STRING content, not a directory-specific
    // structure invented to match a C-side parser. An open directory and
    // an open regular file are the same thing from here on -- bytes a
    // real fd_read call returns, nothing packed or pre-structured for
    // one particular caller's convenience.
    const files = {
        '/': 'bin\netc\nhome\nusr\nvar\n',
        '/home/user': 'README.md\nprojects\nnotes.txt\nmain.c\nshell.c\n',
        '/home/user/README.md': 'This is a real file, read through the same open()+fd_read() path as any directory listing.\n'
    };
    let cwd = '/home/user';

    // Shared across every spawned instance -- pipes AND open files both
    // connect stages/reads that live in genuinely separate WebAssembly
    // instances, addressed by the same global fd counter.
    const pipes = new Map(); // fd -> { chunks: Buffer[], readPos: number, otherEnd: fd }
    const openFiles = new Map(); // fd -> { data: Buffer, pos: number }
    let nextFd = 3;
    let nextPid = 1;
    const pidResults = new Map(); // pid -> exit code

    // 'ROOT' means "the real top-level stdin/stdout for THIS invocation
    // of runTopLevel()" -- shared across the top-level instance and any
    // stage spawned during it that resolves to 'ROOT' (the pipeline's
    // first stdin, or its last stdout), never a per-instance array.
    // Only one top-level run() is ever in flight at a time (synchronous,
    // single-threaded), so one shared mutable slot is safe.
    let currentRootStdoutChunks = null;
    let currentRootStdinBuf = null;
    let currentRootStdinPos = 0;

    function makeInstanceImports(resolvedInFd, resolvedOutFd) {
        let memory;

        function readMemStr(ptr, len) {
            return Buffer.from(memory.buffer, ptr, len).toString('utf8');
        }
        function writeStr(ptr, maxLen, str) {
            const buf = Buffer.from(str, 'utf8');
            const n = Math.min(buf.length, maxLen);
            new Uint8Array(memory.buffer, ptr, n).set(buf.subarray(0, n));
            return n;
        }
        function writeI32(ptr, value) {
            new DataView(memory.buffer).setInt32(ptr, value, true);
        }

        function doRead(fd, bufPtr, bufLen) {
            // An fd from open() is addressed directly by its real number
            // (unlike stdin/pipes, which the C side always reaches via
            // the literal STDIN_FILENO=0 and this instance's own
            // resolvedInFd indirection below).
            const openFile = openFiles.get(fd);
            if (openFile) {
                const remaining = openFile.data.length - openFile.pos;
                if (remaining <= 0) return 0;
                const n = Math.min(remaining, bufLen);
                new Uint8Array(memory.buffer, bufPtr, n).set(openFile.data.subarray(openFile.pos, openFile.pos + n));
                openFile.pos += n;
                return n;
            }
            if (fd !== 0) return -1;
            if (resolvedInFd === 'ROOT') {
                const remaining = currentRootStdinBuf.length - currentRootStdinPos;
                if (remaining <= 0) return 0;
                const n = Math.min(remaining, bufLen);
                new Uint8Array(memory.buffer, bufPtr, n).set(currentRootStdinBuf.subarray(currentRootStdinPos, currentRootStdinPos + n));
                currentRootStdinPos += n;
                return n;
            }
            // resolvedInFd is a real pipe read-fd.
            const p = pipes.get(resolvedInFd);
            const remaining = p.chunks.length - p.readPos;
            if (remaining <= 0) return 0;
            const n = Math.min(remaining, bufLen);
            new Uint8Array(memory.buffer, bufPtr, n).set(p.chunks.subarray(p.readPos, p.readPos + n));
            p.readPos += n;
            return n;
        }

        function doWrite(fd, bufPtr, bufLen) {
            const str = readMemStr(bufPtr, bufLen);
            if (fd === 2) { currentRootStdoutChunks.push(str); return bufLen; } // stderr always captured to the real, shared output
            if (fd !== 1) return -1;
            if (resolvedOutFd === 'ROOT') {
                currentRootStdoutChunks.push(str);
                return bufLen;
            }
            const p = pipes.get(resolvedOutFd);
            p.chunks = Buffer.concat([p.chunks, Buffer.from(str, 'utf8')]);
            return bufLen;
        }

        const imports = {
            host: {
                fd_read: doRead,
                fd_write: doWrite,
                spawn: (cmdPtr, cmdLen, inFd, outFd, errFd) => {
                    const cmdline = readMemStr(cmdPtr, cmdLen);
                    return spawn(cmdline, inFd, outFd, errFd);
                },
                wait: (pid) => {
                    return pidResults.has(pid) ? pidResults.get(pid) : -1;
                },
                getenv: (namePtr, nameLen, bufPtr, bufLen) => {
                    const val = env[readMemStr(namePtr, nameLen)];
                    return val === undefined ? -1 : writeStr(bufPtr, bufLen, val);
                },
                // Deliberately NOT env.USER -- proves whoami is wired to a
                // real identity fact, not the environment. Real whoami
                // ignores $USER entirely (confirmed live: `USER=hacker
                // whoami` on a real system still prints the real user).
                whoami: (bufPtr, bufLen) => writeStr(bufPtr, bufLen, 'real-identity'),
                chdir: (pathPtr, pathLen) => {
                    const p = readMemStr(pathPtr, pathLen);
                    if (files[p] === undefined) return -1;
                    cwd = p;
                    return 0;
                },
                getcwd: (bufPtr, bufLen) => writeStr(bufPtr, bufLen, cwd),
                // v0.0.6: resolves a path to a plain fd. What that fd's
                // bytes actually mean (a directory listing, a real
                // file's content) is entirely a host-side decision --
                // the returned fd is read through the same generic
                // fd_read every other command already uses, no special
                // contract for cmd_ls to know about.
                open: (pathPtr, pathLen, flags) => {
                    const p = readMemStr(pathPtr, pathLen);
                    const content = files[p];
                    if (content === undefined) return -1;
                    const fd = nextFd++;
                    openFiles.set(fd, { data: Buffer.from(content, 'utf8'), pos: 0 });
                    return fd;
                },
                close: (fd) => {
                    openFiles.delete(fd);
                    return 0;
                },
                access: (pathPtr, pathLen) => {
                    const p = readMemStr(pathPtr, pathLen);
                    return (p === '/usr/bin/ls' || p === '/bin/ls' || p === '/usr/bin/grep' || p === '/bin/grep') ? 0 : -1;
                },
                pipe: (readFdOutPtr, writeFdOutPtr) => {
                    const readFd = nextFd++;
                    const writeFd = nextFd++;
                    const buf = { chunks: Buffer.alloc(0), readPos: 0 };
                    pipes.set(readFd, buf);
                    pipes.set(writeFd, buf);
                    writeI32(readFdOutPtr, readFd);
                    writeI32(writeFdOutPtr, writeFd);
                    return 0;
                }
            }
        };

        return {
            imports,
            setMemory: (m) => { memory = m; }
        };
    }

    function runInstance(resolvedIn, resolvedOut, cmdline) {
        const host = makeInstanceImports(resolvedIn, resolvedOut);
        const instance = new WebAssembly.Instance(wasmModule, host.imports);
        host.setMemory(instance.exports.memory);
        const cmdBytes = Buffer.from(cmdline, 'utf8');
        const scratchPtr = instance.exports.memory.buffer.byteLength - 4096;
        new Uint8Array(instance.exports.memory.buffer, scratchPtr, cmdBytes.length).set(cmdBytes);
        return instance.exports.run(scratchPtr, cmdBytes.length);
    }

    function spawn(cmdline, inFd, outFd, errFd) {
        const resolvedIn = inFd === 0 ? 'ROOT' : inFd;
        const resolvedOut = outFd === 1 ? 'ROOT' : outFd;
        // 'ROOT' here correctly refers back to whichever runTopLevel()
        // call is currently in flight -- currentRootStdoutChunks/
        // currentRootStdinBuf are shared, not per-instance, so a spawned
        // last stage writing to 'ROOT' lands in the SAME buffer the
        // top-level caller reads back, rather than a throwaway array
        // local to the spawned instance (the bug this replaced).
        const rc = runInstance(resolvedIn, resolvedOut, cmdline);
        const pid = nextPid++;
        pidResults.set(pid, rc);
        return pid;
    }

    return {
        runTopLevel(cmdline, stdinStr) {
            currentRootStdoutChunks = [];
            currentRootStdinBuf = Buffer.from(stdinStr || '', 'utf8');
            currentRootStdinPos = 0;
            const rc = runInstance('ROOT', 'ROOT', cmdline);
            return { rc, stdout: currentRootStdoutChunks.join('') };
        }
    };
}

async function run() {
    check('shell.wasm exists (build it with the command in shell.c\'s own header)', () => {
        if (!fs.existsSync(path.join(V2, 'shell.wasm'))) throw new Error('shell.wasm not found');
    });

    const wasmBytes = fs.readFileSync(path.join(V2, 'shell.wasm'));
    const wasmModule = await WebAssembly.compile(wasmBytes);

    check('the compiled module exports exactly memory + run', () => {
        const exportsList = WebAssembly.Module.exports(wasmModule).map((e) => e.name).sort();
        if (JSON.stringify(exportsList) !== JSON.stringify(['memory', 'run'])) {
            throw new Error('expected exactly ["memory","run"], got ' + JSON.stringify(exportsList));
        }
    });

    check('the compiled module imports exactly the declared host surface, nothing ambient', () => {
        const importsList = WebAssembly.Module.imports(wasmModule)
            .filter((i) => i.module === 'host')
            .map((i) => i.name)
            .sort();
        const expected = ['access', 'chdir', 'close', 'fd_read', 'fd_write', 'getcwd', 'getenv', 'open', 'pipe', 'spawn', 'wait', 'whoami'].sort();
        if (JSON.stringify(importsList) !== JSON.stringify(expected)) {
            throw new Error('expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(importsList));
        }
    });

    let os = makeOS(wasmModule);

    check('whoami reports the real identity, NOT $USER -- real whoami ignores the environment entirely (confirmed live: `USER=hacker whoami` on a real system still prints the real user), so the mock deliberately answers whoami() with a value that differs from env.USER to prove the two are decoupled', () => {
        const r = os.runTopLevel('whoami', '');
        if (r.rc !== 0 || r.stdout !== 'real-identity\n') throw new Error('unexpected result: ' + JSON.stringify(r));
        if (r.stdout.includes('meshos')) throw new Error('whoami leaked $USER (\'meshos\') instead of using the real identity fact');
    });

    check('ls with no argument lists the current directory (sh.cwd seeded from host_getcwd() on first run())', () => {
        const r = os.runTopLevel('ls', '');
        if (r.rc !== 0) throw new Error('unexpected rc: ' + r.rc);
        if (!r.stdout.includes('README.md')) throw new Error('ls did not list the real cwd: ' + JSON.stringify(r.stdout));
    });


    check('cat with an absolute file argument works -- previously documented as unsupported ("cat: file args not supported in WASM seed"), closed for free by the same open()+fd_read() primitive ls now uses.', () => {
        const r = os.runTopLevel('cat /home/user/README.md', '');
        if (r.rc !== 0) throw new Error('unexpected rc: ' + r.rc);
        if (!r.stdout.includes('This is a real file')) throw new Error('cat did not read the real file content: ' + JSON.stringify(r.stdout));
    });

    check('cat with a RELATIVE file argument now resolves against cwd in C (resolve_path()), not by accident of whatever the host happens to treat as current -- the host still only ever sees the one fully-resolved string sys_open() hands it', () => {
        const r = os.runTopLevel('cat README.md', '');
        if (r.rc !== 0) throw new Error('unexpected rc: ' + r.rc);
        if (!r.stdout.includes('This is a real file')) throw new Error('cat did not resolve the relative path against cwd: ' + JSON.stringify(r.stdout));
    });

    check('cat with a nonexistent file argument fails cleanly instead of silently succeeding', () => {
        const r = os.runTopLevel('cat nonexistent.txt', '');
        if (r.rc !== 1) throw new Error('expected rc 1, got ' + r.rc);
    });

    check('a single-stage grep still works exactly as before (no regression from the pipeline rewrite)', () => {
        const r = os.runTopLevel('grep hello', 'goodbye world\nhello there\nhello again\n');
        if (r.rc !== 0 || r.stdout !== 'hello there\nhello again\n') throw new Error('unexpected result: ' + JSON.stringify(r));
    });

    check('cd to a missing directory still fails with rc 1 (no regression)', () => {
        const r = os.runTopLevel('cd /nope', '');
        if (r.rc !== 1 || r.stdout !== 'cd: no such directory\n') throw new Error('unexpected result: ' + JSON.stringify(r));
    });

    check('an unknown command still reports rc 127 (no regression)', () => {
        const r = os.runTopLevel('bogus', '');
        if (r.rc !== 127) throw new Error('expected rc 127, got ' + r.rc);
    });

    // ─── THE REAL PAYOFF: a genuine two-stage pipeline ────────────────
    check('ls | grep .c actually pipes ls\'s real output into grep -- not both stages independently reading the real stdin', () => {
        const r = os.runTopLevel('ls | grep .c', '');
        if (r.rc !== 0) throw new Error('unexpected rc: ' + r.rc);
        const lines = r.stdout.split('\n').filter(Boolean);
        // ls's directory has: README.md, projects, notes.txt, main.c, shell.c
        // Only the two .c files should survive the real pipe into grep.
        if (lines.length !== 2 || !lines.includes('main.c') || !lines.includes('shell.c')) {
            throw new Error('expected exactly ["main.c","shell.c"] to survive the pipe, got: ' + JSON.stringify(lines));
        }
        if (r.stdout.includes('README.md') || r.stdout.includes('notes.txt')) {
            throw new Error('non-matching entries leaked through the pipe: ' + JSON.stringify(r.stdout));
        }
    });

    check('a three-stage pipeline (ls | grep .c | grep shell) chains through two real pipes', () => {
        const r = os.runTopLevel('ls | grep .c | grep shell', '');
        if (r.rc !== 0) throw new Error('unexpected rc: ' + r.rc);
        if (r.stdout !== 'shell.c\n') throw new Error('expected only shell.c to survive both pipes, got: ' + JSON.stringify(r.stdout));
    });

    check('cat | grep pipes real stdin through cat into grep, rather than grep seeing the raw stdin independently', () => {
        const r = os.runTopLevel('cat | grep hello', 'goodbye world\nhello there\n');
        if (r.rc !== 0) throw new Error('unexpected rc: ' + r.rc);
        // With a real pipe, only grep's matched output reaches the top-level
        // stdout -- cat's own stdout went into the pipe, not to the real
        // stdout at all, so "goodbye world" must NOT appear.
        if (r.stdout !== 'hello there\n') throw new Error('expected only grep\'s filtered output, got: ' + JSON.stringify(r.stdout));
    });

    check('a pipeline where an early stage is unknown still fails with 127 before spawning anything', () => {
        const r = os.runTopLevel('bogus | grep x', '');
        if (r.rc !== 127) throw new Error('expected rc 127, got ' + r.rc);
    });

    report();
}

run().catch((err) => {
    console.error('Shell.wasm.test.js failed:', err);
    process.exitCode = 1;
});
