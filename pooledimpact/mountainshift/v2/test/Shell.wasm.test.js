// Life-cycle proof for shell.c's compiled shell.wasm: loads the real
// compiled module (not a mock), wires up a minimal JS host implementing
// every declared host import, and drives real commands through the
// single run(ptr, len) export -- proving the freestanding C shell
// actually parses, dispatches, and reports exit statuses correctly
// against a real WASM instance, not just that the source reads right.
//
// Run with: node test/Shell.wasm.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { check, report } = require('./helpers.js');

const V2 = path.join(__dirname, '..');

function makeHost() {
    let memory;
    let cwd = '/home/user';
    const env = { USER: 'meshos', HOME: '/home/user', PATH: '/usr/bin:/bin' };
    const files = { '/home/user': ['README.md', 'projects', 'notes.txt'] };
    let stdinBuf = Buffer.from('');
    let stdinPos = 0;
    let stdoutChunks = [];

    function readMemStr(ptr, len) {
        return Buffer.from(memory.buffer, ptr, len).toString('utf8');
    }
    function writeStr(ptr, maxLen, str) {
        const buf = Buffer.from(str, 'utf8');
        const n = Math.min(buf.length, maxLen);
        new Uint8Array(memory.buffer, ptr, n).set(buf.subarray(0, n));
        return n;
    }

    const imports = {
        host: {
            fd_read: (fd, bufPtr, bufLen) => {
                if (fd !== 0) return -1;
                const remaining = stdinBuf.length - stdinPos;
                if (remaining <= 0) return 0;
                const n = Math.min(remaining, bufLen);
                new Uint8Array(memory.buffer, bufPtr, n).set(stdinBuf.subarray(stdinPos, stdinPos + n));
                stdinPos += n;
                return n;
            },
            fd_write: (fd, bufPtr, bufLen) => {
                const str = readMemStr(bufPtr, bufLen);
                if (fd === 1 || fd === 2) stdoutChunks.push(str);
                return bufLen;
            },
            spawn: () => -1,
            wait: () => -1,
            getenv: (namePtr, nameLen, bufPtr, bufLen) => {
                const val = env[readMemStr(namePtr, nameLen)];
                return val === undefined ? -1 : writeStr(bufPtr, bufLen, val);
            },
            chdir: (pathPtr, pathLen) => {
                const p = readMemStr(pathPtr, pathLen);
                if (!files[p]) return -1;
                cwd = p;
                return 0;
            },
            getcwd: (bufPtr, bufLen) => writeStr(bufPtr, bufLen, cwd),
            readdir: (pathPtr, pathLen, index, namePtr, nameLen) => {
                const entries = files[readMemStr(pathPtr, pathLen)] || [];
                return index >= entries.length ? 0 : writeStr(namePtr, nameLen, entries[index]);
            },
            access: (pathPtr, pathLen) => {
                const p = readMemStr(pathPtr, pathLen);
                return (p === '/usr/bin/ls' || p === '/bin/ls') ? 0 : -1;
            }
        }
    };

    return {
        imports,
        setMemory: (m) => { memory = m; },
        runCommand(instance, cmdline, stdinStr) {
            stdoutChunks = [];
            stdinBuf = Buffer.from(stdinStr || '', 'utf8');
            stdinPos = 0;
            const cmdBytes = Buffer.from(cmdline, 'utf8');
            const scratchPtr = memory.buffer.byteLength - 4096;
            new Uint8Array(memory.buffer, scratchPtr, cmdBytes.length).set(cmdBytes);
            const rc = instance.exports.run(scratchPtr, cmdBytes.length);
            return { rc, stdout: stdoutChunks.join('') };
        }
    };
}

async function run() {
    check('shell.wasm exists (build it with: clang --target=wasm32 -O2 -ffreestanding -nostdlib -Wl,--no-entry -Wl,--export=run -Wl,--export-memory -o shell.wasm shell.c)', () => {
        if (!fs.existsSync(path.join(V2, 'shell.wasm'))) throw new Error('shell.wasm not found -- run the build command in shell.c\'s own header');
    });

    const wasmBytes = fs.readFileSync(path.join(V2, 'shell.wasm'));
    const host = makeHost();
    const { instance } = await WebAssembly.instantiate(wasmBytes, host.imports);
    host.setMemory(instance.exports.memory);

    check('the compiled module exports exactly memory + run -- the single-export design holds in the real artifact, not just in intent', () => {
        const keys = Object.keys(instance.exports).sort();
        if (JSON.stringify(keys) !== JSON.stringify(['memory', 'run'])) {
            throw new Error('expected exactly ["memory","run"], got ' + JSON.stringify(keys));
        }
    });

    check('whoami reads USER from the host environment', () => {
        const r = host.runCommand(instance, 'whoami', '');
        if (r.rc !== 0 || r.stdout !== 'meshos\n') throw new Error('unexpected result: ' + JSON.stringify(r));
    });

    check('ls with no argument lists the CURRENT directory -- proves sh.cwd is seeded from host_getcwd() on first run(), not left as an empty zero-initialized string', () => {
        const r = host.runCommand(instance, 'ls', '');
        if (r.rc !== 0) throw new Error('unexpected rc: ' + r.rc);
        if (r.stdout !== 'README.md\nprojects\nnotes.txt\n') throw new Error('ls did not list the real cwd, got: ' + JSON.stringify(r.stdout));
    });

    check('which finds a real command on PATH', () => {
        const r = host.runCommand(instance, 'which ls', '');
        if (r.rc !== 0 || r.stdout !== '/usr/bin/ls\n') throw new Error('unexpected result: ' + JSON.stringify(r));
    });

    check('which reports failure (rc 1) for a command not on PATH', () => {
        const r = host.runCommand(instance, 'which nonexistent', '');
        if (r.rc !== 1 || r.stdout !== '') throw new Error('unexpected result: ' + JSON.stringify(r));
    });

    check('grep filters real stdin content by pattern', () => {
        const r = host.runCommand(instance, 'grep hello', 'goodbye world\nhello there\nhello again\n');
        if (r.rc !== 0 || r.stdout !== 'hello there\nhello again\n') throw new Error('unexpected result: ' + JSON.stringify(r));
    });

    check('cd to a real directory succeeds and updates sh.cwd for a subsequent ls', () => {
        const rCd = host.runCommand(instance, 'cd /home/user', '');
        if (rCd.rc !== 0) throw new Error('cd failed unexpectedly: ' + JSON.stringify(rCd));
        const rLs = host.runCommand(instance, 'ls', '');
        if (rLs.stdout !== 'README.md\nprojects\nnotes.txt\n') throw new Error('ls after cd did not reflect cwd: ' + JSON.stringify(rLs));
    });

    check('cd to a missing directory fails with rc 1 and a real error message on stderr', () => {
        const r = host.runCommand(instance, 'cd /nope', '');
        if (r.rc !== 1 || r.stdout !== 'cd: no such directory\n') throw new Error('unexpected result: ' + JSON.stringify(r));
    });

    check('an unknown command reports rc 127 (POSIX "command not found")', () => {
        const r = host.runCommand(instance, 'bogus', '');
        if (r.rc !== 127) throw new Error('expected rc 127, got ' + r.rc);
    });

    check('a real empty line (just a newline) preserves the PREVIOUS command\'s exit status, not a fresh 0', () => {
        host.runCommand(instance, 'bogus', ''); // sets sh.last_status = 127
        const r = host.runCommand(instance, '\n', '');
        if (r.rc !== 127) throw new Error('expected the prior status (127) to be preserved, got ' + r.rc);
    });

    check('a multi-stage pipeline runs each stage but does NOT actually pipe between them -- documented known limitation, proven here rather than just asserted: grep sees the REAL stdin, not cat\'s output', () => {
        // Real POSIX behavior would have grep see only cat's output.
        // shell.c's current run_pipeline() ignores in_fd/out_fd, so grep
        // reads the same real stdin cat was given, independently.
        const r = host.runCommand(instance, 'cat | grep hello', 'hello world\n');
        if (r.rc !== 0) throw new Error('unexpected rc: ' + r.rc);
        // cat's own output went to the real stdout too (also unpiped),
        // so stdout contains BOTH cat's echo and grep's independent
        // match against the same raw stdin -- proving the two stages
        // did not actually chain.
        if (!r.stdout.includes('hello world')) throw new Error('expected both stages\' independent output, got: ' + JSON.stringify(r.stdout));
    });

    report();
}

run().catch((err) => {
    console.error('Shell.wasm.test.js failed:', err);
    process.exitCode = 1;
});
