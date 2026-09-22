// Proves curl.wasm itself: curl.c parses argv + the URL, builds the raw
// HTTP/1.1 request bytes, and later parses a raw response back into
// status/headers/body. Both halves are pure computation inside the
// module, so this file tests them the way the module is actually
// structured -- phase 1 in, phase 2 out -- and needs no server, no
// socket, and no Node-only API to do it.
//
// That is deliberate. curl.wasm is runtime-neutral C; a test that stands
// up an http.createServer can only ever run in Node, which would make a
// runtime-neutral module look Node-specific and would only ever prove it
// works behind one door. It also asserts LESS: a Node HTTP server hands
// back its own parsed, lowercased view of the request, where the SOCKET
// marker carries the literal bytes curl.c emitted.
//
// What this file deliberately does NOT cover: the relay itself (does a
// host really open a socket and move those bytes). That is door-specific
// -- Node's answer is net/tls, a browser's is not -- so it belongs to
// whichever door's own test, not to curl.wasm's.
//
// Run with: node test/Curl.wasm.test.js
'use strict';
const assert = require('assert');
const proto = require('../WasmBlobProtocol.js');
const CURL = require('../commands/curl.js');

const NUL = String.fromCharCode(0);
const compiled = proto.compile(CURL.base64);

// One fresh instance, one call -- exactly how ShellHost.js drives it.
function callCurl(cmdline, files) {
    const { instance, memory } = proto.instantiate(compiled);
    const r = proto.callModule(instance, memory, {
        cwd: '/', uid: 0, home: '', path: '', cmdline, files: files || {}
    });
    return proto.bytesToUtf8(r, 0, r.length);
}

// Phase 1: what did curl.c ask the host to send, and to whom?
function requestOf(cmdline) {
    const t = callCurl(cmdline);
    assert.ok(t.indexOf('SOCKET' + NUL) === 0, 'expected a SOCKET delegation, got: ' + JSON.stringify(t.slice(0, 80)));
    const p = t.split(NUL);
    const headerLen = p[0].length + p[1].length + p[2].length + p[3].length + p[4].length + 5;
    return { host: p[1], port: Number(p[2]), tls: p[3] === '1', bytes: Number(p[4]), wire: t.slice(headerLen) };
}

// Phase 2: hand back a canned raw response, read what curl.c made of it.
function answerOf(cmdline, rawResponse) {
    const t = callCurl(cmdline, { '/dev/socket_response': proto.utf8Bytes(rawResponse) });
    assert.ok(t.indexOf('SOCKET' + NUL) !== 0, 'expected an answer, got another SOCKET delegation');
    const firstNul = t.indexOf(NUL);
    const secondNul = t.indexOf(NUL, firstNul + 1);
    return { rc: Number(t.slice(firstNul + 1, secondNul)), stdout: t.slice(secondNul + 1) };
}

const body = (s, extra) => 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n' + (extra || '') + 'Content-Length: ' + s.length + '\r\n\r\n' + s;

function main() {
    // --- phase 1: request building, asserted on the literal bytes ---

    const g = requestOf('curl --request GET --url http://example.com/echo');
    console.log('GET      ->', JSON.stringify(g.wire));
    assert.strictEqual(g.host, 'example.com');
    assert.strictEqual(g.port, 80);
    assert.strictEqual(g.tls, false);
    assert.ok(g.wire.startsWith('GET /echo HTTP/1.1\r\n'), 'request line built by curl.c');
    assert.ok(g.wire.includes('Host: example.com\r\n'), 'Host header built by curl.c');
    assert.strictEqual(g.wire.length, g.bytes, 'declared byte count matches the payload');

    // https must resolve to port 443 + tls, from the URL alone.
    const s = requestOf('curl --request GET --url https://example.com/');
    console.log('HTTPS    ->', s.host + ':' + s.port, 'tls=' + s.tls);
    assert.strictEqual(s.port, 443);
    assert.strictEqual(s.tls, true);

    // an explicit port in the URL wins.
    const p8080 = requestOf('curl --request GET --url http://example.com:8080/x');
    assert.strictEqual(p8080.port, 8080);

    // --header lands verbatim, case preserved -- a Node server would
    // have lowercased this before the old test could see it.
    const h = requestOf("curl --request GET --url http://example.com/ --header 'X-Test: hello-from-curl-wasm'");
    console.log('--header ->', JSON.stringify(h.wire.split('\r\n').find((l) => /^X-Test/.test(l))));
    assert.ok(h.wire.includes('X-Test: hello-from-curl-wasm\r\n'), 'header verbatim, original case');

    // --data implies a body and its Content-Length framing.
    const post = requestOf("curl --request POST --url http://example.com/ --data 'name=shell'");
    console.log('POST     ->', JSON.stringify(post.wire));
    assert.ok(post.wire.startsWith('POST / HTTP/1.1\r\n'), 'method taken from --request');
    assert.ok(post.wire.includes('Content-Length: 10\r\n'), 'Content-Length computed by curl.c');
    assert.ok(post.wire.endsWith('\r\n\r\nname=shell'), 'body appended after the blank line');

    // --cookie/-b is an explicit Cookie header, nothing automatic.
    const c = requestOf("curl --request GET --url http://example.com/ --cookie 'session=abc123'");
    assert.ok(c.wire.includes('Cookie: session=abc123\r\n'), '--cookie sends a real Cookie header');
    const cShort = requestOf("curl --request GET --url http://example.com/ -b 'session=abc123'");
    assert.ok(cShort.wire.includes('Cookie: session=abc123\r\n'), '-b is the same as --cookie');

    // no jar: a plain call carries no Cookie at all.
    assert.ok(!g.wire.includes('Cookie:'), 'no automatic cookie jar');
    console.log('cookies  -> explicit only, no jar');

    // --- phase 2: response parsing, from canned raw bytes ---

    const plain = answerOf('curl --request GET --url http://example.com/', body('hello world'));
    console.log('body     ->', JSON.stringify(plain.stdout));
    assert.strictEqual(plain.rc, 0);
    assert.strictEqual(plain.stdout, 'hello world');

    // dechunking is curl.c's own, not any host's.
    const chunked = answerOf('curl --request GET --url http://example.com/',
        'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\nhello \r\n5\r\nworld\r\n0\r\n\r\n');
    console.log('chunked  ->', JSON.stringify(chunked.stdout));
    assert.strictEqual(chunked.stdout, 'hello world', 'curl.c dechunked it itself');

    // -i prepends the real status line and headers curl.c parsed out.
    const withHead = answerOf('curl --request GET --url http://example.com/ -i',
        body('ok', 'Set-Cookie: session=abc123; Path=/; HttpOnly\r\n'));
    console.log('-i       ->', JSON.stringify(withHead.stdout.split('\r\n')[0]));
    assert.ok(withHead.stdout.startsWith('HTTP/1.1 200'), '-i includes the status line');
    assert.ok(/set-cookie: session=abc123/i.test(withHead.stdout), '-i surfaces Set-Cookie');
    assert.ok(withHead.stdout.endsWith('ok'), '-i still ends with the body');

    // without -i the headers are stripped and only the body is stdout.
    const noHead = answerOf('curl --request GET --url http://example.com/',
        body('ok', 'Set-Cookie: session=abc123; Path=/\r\n'));
    assert.strictEqual(noHead.stdout, 'ok', 'headers stripped without -i');

    console.log('\nALL PASS');
}

main();
