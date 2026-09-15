// BLACK-BOX-SHAPED test for Shell.js, matching MountainShift.opaque.
// test.js's own convention: goes through the single ShellFactory(options)
// entry point only, never reaching into the Shell class ShellFactory
// deliberately never exports. Proves the capability-object surface is
// real (not just shaped right) by running actual commands through it --
// the exact same engine test/Shell.wasm.test.js/test/JobControl.test.js
// already prove directly, now proven reachable through the new facade
// too.
//
// Run with: node test/Shell.opaque.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const V2 = path.join(__dirname, '..');
const ShellFactory = require(path.join(V2, 'Shell.js'));
const { check, report } = require('./helpers.js');

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

async function run() {
    const wasmServer = await startWasmServer();
    const factory = ShellFactory({ wasmUrl: wasmServer.url, cwd: '/', uid: 0 });

    // --- surface: the factory itself exposes ONLY boot(), before boot ---
    check('ShellFactory() returns exactly {boot}', () => {
        const keys = Object.keys(factory);
        if (keys.length !== 1 || keys[0] !== 'boot') throw new Error('expected ["boot"], got ' + JSON.stringify(keys));
    });

    const caps = await factory.boot();
    wasmServer.close();

    // --- surface: the booted capability object's exact shape ---
    check('boot() resolves to the documented capability surface', () => {
        const expected = ['ok', 'exec', 'run', 'ps', 'jobs', 'fg', 'bg', 'kill'].sort();
        const actual = Object.keys(caps).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('got ' + JSON.stringify(actual));
        if (caps.ok !== true) throw new Error('expected ok:true');
    });

    const capsAgain = await factory.boot();
    check('boot() caches -- a second call returns the same frozen object', () => {
        if (caps !== capsAgain) throw new Error('expected the identical cached object');
    });

    // --- the real engine, reached only through the facade ---
    const nodeRun = await caps.exec(`node --eval 'console.log(1+1)'`);
    check('exec() runs a real node command through the facade', () => {
        if (nodeRun.rc !== 0 || nodeRun.stdout !== '2\n') throw new Error('got ' + JSON.stringify(nodeRun));
    });

    const runStdout = await caps.run('ls /');
    check('run() returns just stdout, and ls actually lists something real', () => {
        if (typeof runStdout !== 'string' || runStdout.length === 0) throw new Error('got ' + JSON.stringify(runStdout));
    });

    // --- job control, reached only through the facade ---
    const psEmpty = await caps.ps();
    check('ps() starts empty', () => {
        if (psEmpty !== 'PID\tSTATE\tCMD\n') throw new Error('got ' + JSON.stringify(psEmpty));
    });

    const topStart = await caps.exec('top &');
    const pidMatch = /^\[(\d+)\] \d+\n$/.exec(topStart.stdout);
    check('exec("top &") really backgrounds a job through the facade', () => {
        if (!pidMatch) throw new Error('got ' + JSON.stringify(topStart));
    });
    const pid = Number(pidMatch[1]);

    const jobsRunning = await caps.jobs();
    check('jobs() shows the backgrounded job through the facade', () => {
        if (!jobsRunning.includes('[' + pid + '] running')) throw new Error('got ' + JSON.stringify(jobsRunning));
    });

    await caps.kill(pid);
    const jobsAfterKill = await caps.jobs();
    check('kill() through the facade really removes it', () => {
        if (jobsAfterKill !== '') throw new Error('got ' + JSON.stringify(jobsAfterKill));
    });

    // --- composeMixins(Shell): ExtendX composition is real, not decorative ---
    {
        const { createPreflightMixin } = require(path.join(V2, 'PreflightMixin.js'));
        const wasmServer2 = await startWasmServer();
        const seen = [];
        const factory2 = ShellFactory({
            wasmUrl: wasmServer2.url,
            cwd: '/', uid: 0,
            composeMixins: (Shell) => [createPreflightMixin(Shell, {
                label: 'observe',
                after(ctx) { seen.push(ctx.method); }
            })]
        });
        const caps2 = await factory2.boot();
        wasmServer2.close();
        await caps2.exec('ls /');
        check('composeMixins(Shell) really wires an ExtendX mixin onto the real class', () => {
            if (!seen.includes('exec')) throw new Error('mixin never observed a call; seen=' + JSON.stringify(seen));
        });
    }

    report();
}

run();
