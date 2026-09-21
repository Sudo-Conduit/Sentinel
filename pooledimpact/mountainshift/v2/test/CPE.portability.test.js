// ComputeCore.js (CPE's internals) -- the three things that must hold for the engine to be one engine
// across Linux, browser and Mac rather than three that happen to share a name:
//
//   1. correctness is provider-independent -- the routed diagonal and the
//      dense evaluation agree whichever matmul is underneath;
//   2. the browser branch really runs with NO Node globals (no module, no
//      require, no process, no Buffer), which is asserted by executing it in
//      a vm context that has none of them rather than by reading the source;
//   3. ops arrive by ExtendX composition, so a new op (Quantum, when it is
//      mainline) is a mixin rather than an edit to ComputeCore.js.
//
// Run with: node test/CPE.portability.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const V2 = path.join(__dirname, '..');
const ComputeCore = require(path.join(V2, 'ComputeCore.js'));
const { check, report } = require('./helpers.js');

// Small shared problem. Deliberately not a multiple of any tile height, and
// deliberately with an expert that owns no rows at all, since a zero-row
// block is the edge every gather/scatter gets wrong first.
function problem(engine, B, K, N, E, skipExpert) {
    const X = engine.alloc(Float32Array, B * K);
    for (let i = 0; i < X.length; i++) X[i] = ((i * 37) % 1000) / 1000 - 0.5;

    const W = [];
    for (let e = 0; e < E; e++) {
        const w = engine.alloc(Float32Array, K * N);
        for (let i = 0; i < w.length; i++) w[i] = ((i + e * 7919) % 997) / 997 - 0.5;
        W.push(w);
    }

    const route = new Int32Array(B);
    for (let b = 0; b < B; b++) {
        let e = (b * 31 + 7) % E;
        if (skipExpert !== undefined && e === skipExpert) e = (e + 1) % E;
        route[b] = e;
    }
    return { X, W, route, B, K, N, E };
}

function maxRelErr(a, b) {
    let worst = 0;
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        const s = Math.abs(b[i]) || 1;
        if (d / s > worst) worst = d / s;
    }
    return worst;
}

function run() {
    // --- 1. every provider agrees with the dense evaluation ---
    for (const p of ComputeCore.create().available.map(x => x.id)) {
        check(`provider "${p}": routed == dense`, () => {
            const e = ComputeCore.create({ provider: p });
            const args = problem(e, 91, 64, 64, 7);
            const Yd = e.run(Object.assign({ op: 'dense' }, args));
            const Yr = e.run(Object.assign({ op: 'routed' }, args));
            const err = maxRelErr(Yr, Yd);
            if (!(err < 1e-4)) throw new Error('max rel err ' + err);
        });

        check(`provider "${p}": an expert owning zero rows`, () => {
            const e = ComputeCore.create({ provider: p });
            const args = problem(e, 91, 64, 64, 7, 3);   // nothing routes to 3
            if (args.route.includes(3)) throw new Error('setup wrong');
            const Yd = e.run(Object.assign({ op: 'dense' }, args));
            const Yr = e.run(Object.assign({ op: 'routed' }, args));
            const err = maxRelErr(Yr, Yd);
            if (!(err < 1e-4)) throw new Error('max rel err ' + err);
        });
    }

    // --- 2. one engine reused across growing shapes ---
    // Regression: the gather/scatter scratch is cached between calls, and a
    // buffer kept from a smaller shape silently overflows the next gather.
    check('scratch survives a growing shape on one engine', () => {
        const e = ComputeCore.create();
        for (const [B, K, N, E] of [[64, 32, 32, 4], [64, 128, 128, 4], [256, 128, 128, 8]]) {
            const args = problem(e, B, K, N, E);
            const Yd = e.run(Object.assign({ op: 'dense' }, args));
            const Yr = e.run(Object.assign({ op: 'routed' }, args));
            const err = maxRelErr(Yr, Yd);
            if (!(err < 1e-4)) throw new Error(`${B}x${K}x${N}/E=${E}: err ${err}`);
        }
    });

    // --- 3. the browser branch, with nothing from Node in scope ---
    check('runs with no module/require/process/Buffer', () => {
        const sandbox = {
            console: { log() {} },
            ArrayBuffer, Float32Array, Int32Array, Uint8Array, BigInt,
            Math, Date, Error, Object, Set, Array, String, Number, Reflect,
            Proxy, Symbol, Promise, Map, WeakMap, JSON
        };
        sandbox.self = sandbox;
        sandbox.window = sandbox;
        sandbox.document = {};
        vm.createContext(sandbox);

        for (const f of ['ExtendX.js', 'ComputeCore.js']) {
            vm.runInContext(fs.readFileSync(path.join(V2, f), 'utf8'),
                            sandbox, { filename: f });
        }

        const out = vm.runInContext(`(function () {
            const e = ComputeCore.create();
            const caps = e.run('caps');
            const B = 60, K = 32, N = 32, E = 5;
            const X = e.alloc(Float32Array, B * K);
            for (let i = 0; i < X.length; i++) X[i] = ((i * 37) % 1000) / 1000 - 0.5;
            const W = [];
            for (let x = 0; x < E; x++) {
                const w = e.alloc(Float32Array, K * N);
                for (let i = 0; i < w.length; i++) w[i] = ((i + x * 7919) % 997) / 997 - 0.5;
                W.push(w);
            }
            const route = new Int32Array(B);
            for (let b = 0; b < B; b++) route[b] = (b * 31 + 7) % E;
            const args = { X, W, route, B, K, N, E };
            const Yd = e.run(Object.assign({ op: 'dense' }, args));
            const Yr = e.run(Object.assign({ op: 'routed' }, args));
            let worst = 0;
            for (let i = 0; i < Yd.length; i++) {
                const d = Math.abs(Yr[i] - Yd[i]), s = Math.abs(Yd[i]) || 1;
                if (d / s > worst) worst = d / s;
            }
            return { provider: caps.provider, node: caps.host.node, ops: caps.ops, worst };
        })()`, sandbox);

        if (out.node !== false) throw new Error('claimed to be Node inside the sandbox');
        if (out.provider !== 'js') throw new Error('expected the js provider, got ' + out.provider);
        if (!out.ops.includes('routed')) throw new Error('mixin ops missing in browser branch');
        if (!(out.worst < 1e-4)) throw new Error('browser routed != dense: ' + out.worst);
    });

    // --- 4. ops are composition, not inheritance ---
    check('a new op arrives as a mixin, with no edit to ComputeCore.js', () => {
        const before = ComputeCore.create().ops();
        if (before.includes('echo')) throw new Error('test op already present');

        ComputeCore.use({ mixinId: 'cpe.test.echo', op_echo(cmd) { return cmd.value; } });

        const e = ComputeCore.create();
        if (!e.ops().includes('echo')) throw new Error('mixin op did not compose');
        if (e.run({ op: 'echo', value: 42 }) !== 42) throw new Error('mixin op did not dispatch');
    });

    check('ComputeCore.use() rejects a layer with no stable id', () => {
        let threw = false;
        try { ComputeCore.use({ op_nope() {} }); } catch (e) { threw = true; }
        if (!threw) throw new Error('accepted a mixin with no mixinId');
    });

    check('an unknown op names the ops that do exist', () => {
        const e = ComputeCore.create();
        let msg = '';
        try { e.run({ op: 'nosuchop' }); } catch (err) { msg = err.message; }
        if (!/unknown op/.test(msg) || !/matmul/.test(msg)) {
            throw new Error('unhelpful error: ' + msg);
        }
    });

    report();
}

if (require.main === module) run();
module.exports = { run };
