// shell.wasm, run for real: real compiled module, real filesystem
// underneath ShellHost.js's open(), real commands. No assertions, no
// pass/fail, no host-side fake path table -- just each command and
// exactly what it produced.
//
// shell.wasm's own bytes come from a real fetch() over a real local
// HTTP server, not fs.readFileSync() -- Node's built-in fetch() only
// speaks http(s), not file://, so getting createShell() to load for
// real means actually serving the file, the same way a browser would
// pull it from wherever MountainShift OS itself serves it.
//
// Run with: node test/Shell.wasm.test.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createShell } = require('../ShellHost.js');

const V2_DIR = path.join(__dirname, '..');

function serveWasmOnce() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const bytes = fs.readFileSync(path.join(V2_DIR, 'shell.wasm'));
            res.writeHead(200, { 'Content-Type': 'application/wasm' });
            res.end(bytes);
        });
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({ url: `http://127.0.0.1:${port}/shell.wasm`, close: () => server.close() });
        });
    });
}

async function main() {
    const served = await serveWasmOnce();
    const shell = await createShell({ wasmUrl: served.url, cwd: V2_DIR });
    served.close();

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
    show('cat shell.c | grep host_');
    show('cd test');
    show('ls');
    show('cat nonexistent.txt');
    show('bogus');
}

main();
