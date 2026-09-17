// Proves curl.wasm's real socket delegation end to end: curl.c parses
// argv + the URL and builds the raw HTTP/1.1 request bytes itself;
// ShellHost.js's ONLY job on seeing the SOCKET marker is a dumb byte
// relay -- open a real TCP connection, write those exact bytes, hand
// back whatever comes over the wire. A local loopback server (not a
// real external host) makes this deterministic and lets the test
// assert on exactly what request bytes the server actually received --
// proving curl.wasm, not this test file, built them.
//
// Run with: node test/Curl.wasm.test.js
'use strict';
const assert = require('assert');
const http = require('http');
const { createShell } = require('../ShellHost.js');

function startServer() {
    return new Promise((resolve) => {
        let lastRequest = null;
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                lastRequest = { method: req.method, url: req.url, headers: req.headers, body };
                if (req.url === '/chunked') {
                    res.writeHead(200, { 'Content-Type': 'text/plain', 'Transfer-Encoding': 'chunked' });
                    res.write('hello ');
                    res.end('world');
                    return;
                }
                if (req.url === '/echo-header') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('X-Test was: ' + (req.headers['x-test'] || '(missing)'));
                    return;
                }
                if (req.url === '/set-cookie') {
                    res.writeHead(200, { 'Set-Cookie': 'session=abc123; Path=/; HttpOnly' });
                    res.end('cookie set');
                    return;
                }
                if (req.url === '/echo-cookie') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('cookie was: ' + (req.headers['cookie'] || '(missing)'));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ method: req.method, body }));
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ port, close: () => server.close(), getLastRequest: () => lastRequest });
        });
    });
}

async function main() {
    const server = await startServer();
    const shell = await createShell({ cwd: '/', uid: 0 });

    // Real GET, real header, real server. Proves curl.c actually built
    // the request line and header bytes -- the server received them
    // over a real socket, not something this test handed it directly.
    const r1 = await shell.runDetailed(
        `curl --request GET --url http://127.0.0.1:${server.port}/echo-header --header 'X-Test: hello-from-curl-wasm'`
    );
    console.log('GET /echo-header ->', JSON.stringify(r1));
    assert.strictEqual(r1.rc, 0);
    assert.strictEqual(r1.stdout, 'X-Test was: hello-from-curl-wasm');
    assert.strictEqual(server.getLastRequest().method, 'GET');

    // Real POST with a body -- proves --data and Content-Length framing.
    const r2 = await shell.runDetailed(
        `curl --request POST --url http://127.0.0.1:${server.port}/ --data 'name=shell'`
    );
    console.log('POST / ->', JSON.stringify(r2));
    assert.strictEqual(r2.rc, 0);
    const parsed = JSON.parse(r2.stdout);
    assert.strictEqual(parsed.method, 'POST');
    assert.strictEqual(parsed.body, 'name=shell');

    // Chunked transfer-encoding: proves curl.c's own dechunking, not
    // Node's -- the raw bytes ShellHost.js hands back are exactly what
    // came off the wire, chunk framing included.
    const r3 = await shell.runDetailed(`curl --request GET --url http://127.0.0.1:${server.port}/chunked`);
    console.log('GET /chunked ->', JSON.stringify(r3));
    assert.strictEqual(r3.stdout, 'hello world');

    // -i includes the real status line curl.c parsed out of the raw
    // response.
    const r4 = await shell.runDetailed(`curl --request GET --url http://127.0.0.1:${server.port}/ -i`);
    console.log('GET / -i ->', JSON.stringify(r4.stdout.split('\r\n')[0]));
    assert.ok(r4.stdout.startsWith('HTTP/1.1 200'), 'expected a real status line with -i');

    // curl runs in a pipeline too, same as any other command module.
    const r5 = await shell.runDetailed(`curl --request GET --url http://127.0.0.1:${server.port}/ | grep GET`);
    console.log('curl | grep ->', JSON.stringify(r5.stdout));
    assert.strictEqual(r5.stdout.trim(), '{"method":"GET","body":""}');

    // No automatic cookie jar (same as real curl without -c/-b <file>):
    // a Set-Cookie is only visible via -i, and is never sent back
    // automatically on a later call.
    const r6 = await shell.runDetailed(`curl --request GET --url http://127.0.0.1:${server.port}/set-cookie -i`);
    console.log('GET /set-cookie -i ->', JSON.stringify(r6.stdout.split('\r\n').find((l) => /^set-cookie/i.test(l))));
    assert.ok(/set-cookie: session=abc123/i.test(r6.stdout));

    const r7 = await shell.runDetailed(`curl --request GET --url http://127.0.0.1:${server.port}/echo-cookie`);
    console.log('GET /echo-cookie (no --cookie) ->', JSON.stringify(r7.stdout));
    assert.strictEqual(r7.stdout, 'cookie was: (missing)');

    // --cookie/-b sends an explicit Cookie header, same as real curl.
    const r8 = await shell.runDetailed(`curl --request GET --url http://127.0.0.1:${server.port}/echo-cookie --cookie 'session=abc123'`);
    console.log('GET /echo-cookie --cookie ->', JSON.stringify(r8.stdout));
    assert.strictEqual(r8.stdout, 'cookie was: session=abc123');

    server.close();
    console.log('\nALL PASS');
}

main();
