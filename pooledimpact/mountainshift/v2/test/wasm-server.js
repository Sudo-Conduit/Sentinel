// A standalone real HTTP server -- its own OS process, not a function
// living in Shell.wasm.test.js's own process -- serving only
// shell.wasm's bytes. That's the one piece of real disk access this
// whole demo still needs on the JS side: fetch() doesn't speak
// file://, so shell.wasm has to be served from somewhere. Everything
// shell.wasm's commands themselves touch (real files, real
// directories, the real environment) goes straight through real WASI
// instead -- no JS server, no JS glue, involved in any of that at all.
//
// Run with: node test/wasm-server.js [port]
// Prints "READY <port>" on stdout once listening.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 0;

const server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://localhost').pathname === '/shell.wasm') {
        res.writeHead(200, { 'Content-Type': 'application/wasm' });
        res.end(fs.readFileSync(path.join(__dirname, '..', 'shell.wasm')));
        return;
    }
    res.writeHead(404);
    res.end();
});

server.listen(port, '127.0.0.1', () => {
    console.log('READY ' + server.address().port);
});
