// shell.wasm, run for real: real compiled module, real commands. No
// assertions, no pass/fail, no host-side fake path table -- just each
// command and exactly what it produced.
//
// ShellHost.js itself has NO filesystem access -- no `fs`, not even
// for open()/access(). Everything shell.wasm's commands can see comes
// from a `files` map THIS file builds by making real HTTP requests
// against a real local server (which does use `fs`, because something
// has to actually have disk access to serve real content -- exactly
// the role a real web server plays, not the role ShellHost.js plays).
// shell.wasm's own bytes are loaded the same way, via fetch(), not
// fs.readFileSync().
//
// Run with: node test/Shell.wasm.test.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createShell } = require('../ShellHost.js');

const V2_DIR = path.join(__dirname, '..');

// The one place in this whole demo allowed to touch real disk: a
// small real HTTP server, standing in for wherever shell.wasm and its
// content would actually be served from in production.
function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const u = new URL(req.url, 'http://localhost');
            if (u.pathname === '/shell.wasm') {
                res.writeHead(200, { 'Content-Type': 'application/wasm' });
                res.end(fs.readFileSync(path.join(V2_DIR, 'shell.wasm')));
                return;
            }
            if (u.pathname === '/fs') {
                const p = u.searchParams.get('p');
                try {
                    const stat = fs.statSync(p);
                    const body = stat.isDirectory() ? fs.readdirSync(p).join('\0') + '\0' : fs.readFileSync(p);
                    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
                    res.end(body);
                } catch (e) {
                    res.writeHead(404);
                    res.end();
                }
                return;
            }
            res.writeHead(404);
            res.end();
        });
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({ baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() });
        });
    });
}

// Fetches one real path's content over HTTP. Returns undefined (not
// added to the files map) on 404 -- so paths deliberately left
// unfetched, like the nonexistent-file demo below, stay genuinely
// absent rather than silently resolving.
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
