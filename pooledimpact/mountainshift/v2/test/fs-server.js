// A standalone real HTTP server -- its own OS process, not a function
// living inside Shell.wasm.test.js's own process. Something,
// somewhere, has to have real disk access to originate real bytes --
// the same is true of any real production web server -- but that
// something must not be ShellHost.js or the test driver script itself.
// Running this as a genuinely separate process (not just a separate
// function) is what actually proves that separation, rather than one
// script quietly answering its own HTTP requests in-process.
//
// Run with: node test/fs-server.js [port]
// Prints "READY <port>" on stdout once listening.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const V2_DIR = path.join(__dirname, '..');
const port = Number(process.argv[2]) || 0;

const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/shell.wasm') {
        res.writeHead(200, { 'Content-Type': 'application/wasm' });
        res.end(fs.readFileSync(path.join(V2_DIR, 'wasm', 'shell.wasm')));
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

server.listen(port, '127.0.0.1', () => {
    console.log('READY ' + server.address().port);
});
