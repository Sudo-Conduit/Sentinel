// Proves ShellServer.js for real: boots it as a genuinely separate OS
// process (not a function call in this test's own process), then drives
// it only through real HTTP requests -- exactly what Shell-Terminal.html
// itself does. No reaching into Shell.js/ShellHost.js internals here; this is
// the actual, dumb-client-facing contract.
//
// Run with: node test/ShellServer.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');

function startServer() {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, '..', 'ShellServer.js'), '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        const onData = (chunk) => {
            buf += chunk;
            const m = /http:\/\/localhost:(\d+)/.exec(buf);
            if (m) {
                child.stdout.removeListener('data', onData);
                resolve({ baseUrl: 'http://127.0.0.1:' + m[1], close: () => child.kill() });
            }
        };
        child.stdout.on('data', onData);
        child.once('error', reject);
        setTimeout(() => reject(new Error('ShellServer.js never printed its listening line')), 15000);
    });
}

async function execViaHttp(baseUrl, cmdline) {
    const res = await fetch(baseUrl + '/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmdline })
    });
    return res.json();
}

async function main() {
    const server = await startServer();

    // GET / serves the actual terminal page.
    const page = await fetch(server.baseUrl + '/');
    const html = await page.text();
    assert.strictEqual(page.status, 200);
    assert.ok(html.includes('MSOS Shell Terminal'), 'expected the real Shell-Terminal.html to be served');
    console.log('GET / serves the real terminal page -> OK');

    // A real command that currently FAILS, through real HTTP -- proving the
    // exit code propagates across the contract, not just the text.
    //
    // This assertion used to read `rc === 0` and `stdout.trim().length > 0`
    // under the message "expected a real username", and it passed on the
    // string "unknown" -- which is exactly what whoami emitted when it could
    // NOT resolve a uid. A check that accepts the failure value as proof of
    // success is worse than no check: it reports green while the command
    // lies. whoami now exits non-zero and names the reason (real whoami(1)
    // does the same), so the honest assertion is this one.
    //
    // When G.13 lands and whoami can read a real /etc/passwd, THIS test
    // should start failing -- that is the point. Update it then to assert a
    // resolved name, deliberately, rather than discovering it was never
    // testing anything.
    const whoami = await execViaHttp(server.baseUrl, 'whoami');
    console.log('POST /exec whoami ->', JSON.stringify(whoami));
    assert.strictEqual(whoami.rc, 1, 'whoami must report failure, not a placeholder');
    assert.match(whoami.stdout, /^whoami: cannot /, 'must name why it failed');
    assert.ok(!/unknown/.test(whoami.stdout), 'must not emit a placeholder name');

    // node/php delegation reachable through the same HTTP contract.
    const nodeResult = await execViaHttp(server.baseUrl, `node --eval 'console.log(21*2)'`);
    console.log('POST /exec node ->', JSON.stringify(nodeResult));
    assert.strictEqual(nodeResult.rc, 0);
    assert.strictEqual(nodeResult.stdout, '42\n');

    // Job control reachable through the same HTTP contract.
    const bg = await execViaHttp(server.baseUrl, 'top &');
    const pidMatch = /^\[(\d+)\]/.exec(bg.stdout);
    assert.ok(pidMatch, 'expected a real background-start ack, got ' + JSON.stringify(bg));
    const jobs = await execViaHttp(server.baseUrl, 'jobs');
    assert.ok(jobs.stdout.includes('[' + pidMatch[1] + '] running'));
    await execViaHttp(server.baseUrl, 'kill ' + pidMatch[1]);
    console.log('job control (top &, jobs, kill) reachable over real HTTP -> OK');

    // Unknown route: a plain 404, not a crash.
    const missing = await fetch(server.baseUrl + '/nonexistent');
    assert.strictEqual(missing.status, 404);
    console.log('unknown route -> 404, server still alive -> OK');

    server.close();
    console.log('\nALL PASS');
}

main();
