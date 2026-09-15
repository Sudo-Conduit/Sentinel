// shell.wasm, run for real via real WASI: shell.c's own path_open(),
// fd_read(), fd_readdir(), and environ_get() calls go straight to
// Node's native `node:wasi` implementation, which calls the real OS
// directly -- ShellHost.js never touches a real file, a real
// directory, or the real environment itself. No assertions, no
// pass/fail, no prefetched content map -- just each command and
// exactly what it produced.
//
// The one real disk access anywhere in this demo: test/wasm-server.js,
// spawned here as a genuinely separate OS process, serving shell.wasm
// itself over a real HTTP socket (fetch() doesn't speak file://).
// Everything shell.wasm's commands touch after that -- real files,
// real directories, the real environment -- goes through real WASI,
// not through that server or this script.
//
// Run with: node test/Shell.wasm.test.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const { createShell } = require('../ShellHost.js');

const V2_DIR = path.join(__dirname, '..');

function startServer() {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'wasm-server.js'), '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
        const rl = readline.createInterface({ input: child.stdout });
        rl.once('line', (line) => {
            const m = /^READY (\d+)$/.exec(line);
            if (!m) { reject(new Error('wasm-server.js did not report READY: ' + line)); return; }
            resolve({ baseUrl: `http://127.0.0.1:${m[1]}`, close: () => child.kill() });
        });
        child.once('error', reject);
    });
}

async function main() {
    const server = await startServer();
    const shell = await createShell({ wasmUrl: `${server.baseUrl}/shell.wasm`, cwd: V2_DIR });
    server.close();

    function show(cmdline, stdin) {
        const r = shell.runDetailed(cmdline, stdin);
        console.log('$ ' + cmdline);
        process.stdout.write(r.stdout);
        console.log('(rc=' + r.rc + ')\n');
    }

    show('whoami');
    show('ls');
    show('ls /');
    show('ls /bin');
    show('cat shell.c');
    show('cat ShellHost.js');
    show('ls | grep .c');
    show('cat shell.c | grep FD_READ');
    show('which ls');
    show('cd /etc');
    show('ls');
    show('cd ' + V2_DIR);
    show('cat nonexistent.txt');
    show('bogus');
}

main();
