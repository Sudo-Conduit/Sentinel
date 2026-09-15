// White-box test for KernelVisibilityMixin.js: proves it really mirrors
// a Shell background-job start into a stub kernel's fork() (list-only
// unification, per the file's own documented scope), does nothing for a
// non-backgrounded command, and never touches kill (documented gap, not
// tested as "working" since it deliberately isn't wired).
//
// Run with: node test/KernelVisibilityMixin.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const V2 = path.join(__dirname, '..');
const ShellFactory = require(path.join(V2, 'Shell.js'));
const { createKernelVisibilityMixin } = require(path.join(V2, 'KernelVisibilityMixin.js'));
const { check, expectThrows, report } = require('./helpers.js');

function startWasmServer() {
    return new Promise((resolve) => {
        const bytes = fs.readFileSync(path.join(V2, 'wasm', 'shell.wasm'));
        const server = http.createServer((req, res) => { res.end(bytes); });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ url: `http://127.0.0.1:${port}/shell.wasm`, close: () => server.close() });
        });
    });
}

function fakeKernel() {
    const forked = [];
    return { forked, fork: (cmd) => { forked.push(cmd); return { pid: 999, cmd }; } };
}

async function run() {
    expectThrows('requires a real kernel.fork()', () => createKernelVisibilityMixin(function Shell(){}, {}));

    const kernel = fakeKernel();
    const wasmServer = await startWasmServer();
    const factory = ShellFactory({
        wasmUrl: wasmServer.url, cwd: '/', uid: 0,
        composeMixins: (Shell) => [createKernelVisibilityMixin(Shell, kernel)]
    });
    const caps = await factory.boot();
    wasmServer.close();

    await caps.exec('ls /');
    check('a non-backgrounded command never touches the kernel', () => {
        if (kernel.forked.length !== 0) throw new Error('expected no fork() calls, got ' + JSON.stringify(kernel.forked));
    });

    const started = await caps.exec('top &');
    check('a real backgrounded job mirrors into kernel.fork()', () => {
        if (kernel.forked.length !== 1) throw new Error('expected exactly one fork() call, got ' + JSON.stringify(kernel.forked));
        if (kernel.forked[0] !== 'top') throw new Error('expected fork("top"), got ' + JSON.stringify(kernel.forked[0]));
    });

    const pid = Number(/^\[(\d+)\]/.exec(started.stdout)[1]);
    await caps.kill(pid);
    check('kill is deliberately NOT forwarded to the kernel (documented gap, not silently pretended to work)', () => {
        if (kernel.forked.length !== 1) throw new Error('kill should not have called fork() again');
    });

    report();
}

run();
