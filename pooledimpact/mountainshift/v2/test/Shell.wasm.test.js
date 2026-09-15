// shell.wasm, run for real: real compiled module, real commands. No
// assertions, no pass/fail, no host-side fake path table -- just each
// command and exactly what it produced.
//
// ShellHost.js itself has NO filesystem access -- no `fs`, not even
// for open()/access(). Everything shell.wasm's commands can see comes
// from a `files` map THIS file builds by making real HTTP requests
// against test/fs-server.js, spawned here as a genuinely separate OS
// process (not a function living in this same script) -- the real
// disk access something has to do to originate real bytes happens
// over there, in a different process, reached only through a real
// socket, the same way a browser would reach a real remote server.
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
        const child = spawn(process.execPath, [path.join(__dirname, 'fs-server.js'), '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
        const rl = readline.createInterface({ input: child.stdout });
        rl.once('line', (line) => {
            const m = /^READY (\d+)$/.exec(line);
            if (!m) { reject(new Error('fs-server.js did not report READY: ' + line)); return; }
            resolve({ baseUrl: `http://127.0.0.1:${m[1]}`, close: () => child.kill() });
        });
        child.once('error', reject);
    });
}

// Fetches one real path's content over HTTP, from the separate server
// process. Returns undefined (not added to the files map) on 404 --
// so paths deliberately left unfetched, like the nonexistent-file demo
// below, stay genuinely absent rather than silently resolving.
async function fetchPath(baseUrl, absPath) {
    const res = await fetch(`${baseUrl}/fs?p=${encodeURIComponent(absPath)}`);
    if (!res.ok) return undefined;
    return Buffer.from(await res.arrayBuffer()).toString('utf8');
}

async function main() {
    const server = await startServer();

    // Every real path this demo's commands will actually open --
    // fetched up front because ShellHost.js's open() is a synchronous
    // WASM import and can't itself await a fetch() mid-run(). This
    // list is the one thing standing in for "the user's browser
    // already has these pages loaded" in a real deployment.
    const wantedPaths = [
        V2_DIR,
        '/',
        '/bin',
        path.join(V2_DIR, 'shell.c'),
        path.join(V2_DIR, 'ShellHost.js'),
        path.join(V2_DIR, 'test'),
        '/etc/passwd'
        // Deliberately NOT fetching V2_DIR/test/nonexistent.txt --
        // the real "cat: cannot open" demo below depends on it
        // staying genuinely absent from the files map.
    ];
    const files = {};
    for (const p of wantedPaths) {
        const content = await fetchPath(server.baseUrl, p);
        if (content !== undefined) files[p] = content;
    }

    const shell = await createShell({ wasmUrl: `${server.baseUrl}/shell.wasm`, cwd: V2_DIR, files });
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
    show('cat shell.c | grep host_');
    show('cd test');
    show('ls');
    show('cat nonexistent.txt');
    show('bogus');
}

main();
