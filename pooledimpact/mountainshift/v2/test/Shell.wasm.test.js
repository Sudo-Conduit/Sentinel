// shell.wasm has ZERO imports -- the only thing anything here ever
// does is pass it a string ("ls /") and get a string back. No
// assertions, no pass/fail, no host-side fake path table -- just each
// command and exactly what it produced.
//
// Real content (file bytes, directory listings, /etc/passwd) never
// arrives via a call shell.wasm makes mid-execution -- it can't, there
// is no import to make it through. This file gathers everything the
// demo commands below will touch, entirely outside any WASM
// interaction (via test/fs-server.js, a genuinely separate OS
// process), and bundles it into ShellHost.js's options.files before
// calling run() at all.
//
// Run with: node test/Shell.wasm.test.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const { createShell } = require('../ShellHost.js');

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

async function fetchPath(baseUrl, absPath) {
    const res = await fetch(`${baseUrl}/fs?p=${encodeURIComponent(absPath)}`);
    if (!res.ok) return undefined;
    return Buffer.from(await res.arrayBuffer()).toString('utf8');
}

async function main() {
    const server = await startServer();

    // Every real path this demo's commands will actually open --
    // gathered up front since shell.wasm has no way to ask for
    // anything mid-run() at all, let alone asynchronously.
    const wantedPaths = [
        '/',
        '/bin',
        '/etc',
        '/etc/passwd'
        // Deliberately NOT fetching /nonexistent.txt -- the real
        // "cat: cannot open" demo below depends on it staying
        // genuinely absent from the files map.
    ];
    const files = {};
    for (const p of wantedPaths) {
        const content = await fetchPath(server.baseUrl, p);
        if (content !== undefined) files[p] = content;
    }

    const shell = await createShell({
        wasmUrl: `${server.baseUrl}/shell.wasm`,
        cwd: '/',
        env: { HOME: '/root', PATH: '/usr/bin:/bin' },
        files
    });
    server.close();

    function show(cmdline) {
        const r = shell.runDetailed(cmdline);
        console.log('$ ' + cmdline);
        process.stdout.write(r.stdout);
        console.log('(rc=' + r.rc + ')\n');
    }

    show('whoami');
    show('ls');
    show('ls /bin');
    show('cat /etc/passwd');
    // ls is a command module (ls.wasm); grep is Native (shell.wasm).
    // ShellHost.js splits this pipeline itself before either module
    // ever runs: ls.wasm executes as its own atomic stage, and its
    // stdout becomes the stdinlen/stdin field of the call to
    // shell.wasm that actually runs grep.
    show('ls /etc | grep pass');
    show('cat /etc/passwd | grep root');
    show('cd /etc');
    show('ls');
    show('cat /nonexistent.txt');
    show('bogus');
}

main();
