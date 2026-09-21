// BLACK-BOX test: CPE.js's opaque closure factory. Mirrors
// MountainShift.opaque.test.js -- same claim, same tier, same introspection
// mechanisms a curious page script would reach for.
//
// Nothing in this file require()s ComputeCore.js or any provider. Everything
// goes through the single run() the factory hands back. The white-box tier
// (CPE.portability.test.js) is the one allowed to reach inside; that
// asymmetry is deliberate and is the whole point of having two tiers.
//
// Run with: node test/CPE.opaque.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const CPE = require(path.join(V2, 'CPE.js'));
const { check, report } = require('./helpers.js');

// Built through run() alone -- no alloc(), no provider, no engine handle.
// Plain typed arrays are all a caller has, so they are all this uses.
function problem(B, K, N, E) {
    const X = new Float32Array(B * K);
    for (let i = 0; i < X.length; i++) X[i] = ((i * 37) % 1000) / 1000 - 0.5;
    const W = [];
    for (let e = 0; e < E; e++) {
        const w = new Float32Array(K * N);
        for (let i = 0; i < w.length; i++) w[i] = ((i + e * 7919) % 997) / 997 - 0.5;
        W.push(w);
    }
    const route = new Int32Array(B);
    for (let b = 0; b < B; b++) route[b] = (b * 31 + 7) % E;
    return { X, W, route, B, K, N, E };
}

function worstRelErr(a, b) {
    let worst = 0;
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]) / (Math.abs(b[i]) || 1);
        if (d > worst) worst = d;
    }
    return worst;
}

function settleSync(fn) {
    try { fn(); return { ok: true }; } catch (e) { return { ok: false, error: e }; }
}

function run() {
    const cpe = CPE();

    // ─── surface: ONLY run() exists ─────────────────────────────────
    check('Object.keys() reports exactly ["run"]', () => {
        const k = Object.keys(cpe);
        if (k.length !== 1 || k[0] !== 'run') throw new Error(JSON.stringify(k));
    });

    check('Reflect.ownKeys() reports exactly ["run"]', () => {
        const k = Reflect.ownKeys(cpe);
        if (k.length !== 1 || k[0] !== 'run') throw new Error(JSON.stringify(k));
    });

    check('getPrototypeOf is null -- no inherited Object.prototype at all', () => {
        if (Object.getPrototypeOf(cpe) !== null) throw new Error('has a prototype');
        if (typeof cpe.hasOwnProperty !== 'undefined') throw new Error('hasOwnProperty reachable');
        if (typeof cpe.toString !== 'undefined') throw new Error('toString reachable');
        if (typeof cpe.constructor !== 'undefined') throw new Error('constructor reachable');
    });

    check('cpe is not an instanceof Object', () => {
        if (cpe instanceof Object) throw new Error('instanceof Object');
    });

    // The things a caller must not be able to reach: the engine, its
    // provider (which closes over the FFI handle), and the composed class.
    check('no internals are reachable by name', () => {
        for (const name of ['engine', 'provider', 'available', 'options', 'alloc',
                            'ops', 'use', 'create', 'Core', 'mixins', '_gather',
                            '_out', '_scratch', 'cacheToken', 'activeMixins']) {
            if (name in cpe) throw new Error(`"${name}" is reachable`);
            if (cpe[name] !== undefined) throw new Error(`"${name}" reads back a value`);
        }
    });

    check('assigning a new property throws under strict mode', () => {
        const r = settleSync(() => { cpe.provider = 'evil'; });
        if (r.ok) throw new Error('assignment succeeded');
        if (cpe.provider !== undefined) throw new Error('property was added');
    });

    check('deleting run throws, and run still works afterward', () => {
        const r = settleSync(() => { delete cpe.run; });
        if (r.ok) throw new Error('delete succeeded');
        if (typeof cpe.run !== 'function') throw new Error('run is gone');
    });

    check('reassigning run throws and does not change it', () => {
        const original = cpe.run;
        const r = settleSync(() => { cpe.run = () => 'hijacked'; });
        if (r.ok) throw new Error('reassignment succeeded');
        if (cpe.run !== original) throw new Error('run was replaced');
    });

    check('setPrototypeOf cannot re-attach a prototype', () => {
        settleSync(() => { Object.setPrototypeOf(cpe, { sneak() { return 1; } }); });
        if (Object.getPrototypeOf(cpe) !== null) throw new Error('prototype attached');
        if (typeof cpe.sneak !== 'undefined') throw new Error('sneak reachable');
    });

    // ─── the gate actually does the work ────────────────────────────
    check('run("caps") reports a real provider and the composed ops', () => {
        const caps = cpe.run('caps');
        if (!caps || typeof caps.provider !== 'string') throw new Error('no provider');
        for (const op of ['caps', 'matmul', 'routed', 'dense', 'bench']) {
            if (!caps.ops.includes(op)) throw new Error('missing op ' + op);
        }
    });

    check('run() computes the routed diagonal, matching dense exactly', () => {
        const args = problem(91, 64, 64, 7);
        const d = cpe.run(Object.assign({ op: 'dense' }, args));
        const r = cpe.run(Object.assign({ op: 'routed' }, args));
        const err = worstRelErr(r, d);
        if (!(err < 1e-4)) throw new Error('max rel err ' + err);
    });

    check('an unknown op is refused and names the ops that exist', () => {
        const r = settleSync(() => cpe.run({ op: 'exfiltrate' }));
        if (r.ok) throw new Error('unknown op was accepted');
        if (!/unknown op/.test(r.error.message)) throw new Error(r.error.message);
    });

    check('a malformed cmd is refused', () => {
        for (const bad of [null, undefined, 42, {}, { notAnOp: 1 }]) {
            if (settleSync(() => cpe.run(bad)).ok) {
                throw new Error('accepted ' + JSON.stringify(bad));
            }
        }
    });

    // ─── construction-time extension, and only construction-time ────
    check('a layer passed at construction is usable through run()', () => {
        const extended = CPE({
            mixins: [{ mixinId: 'opaque.test.echo', op_echo(cmd) { return cmd.value; } }]
        });
        if (extended.run({ op: 'echo', value: 7 }) !== 7) throw new Error('layer not composed');
    });

    check('a layer cannot be added to an already-built engine', () => {
        const r = settleSync(() => { cpe.use = m => m; });
        if (r.ok) throw new Error('use() could be attached');
        if (typeof cpe.use !== 'undefined') throw new Error('use() is reachable');
    });

    check('an engine built with a custom layer does not leak it to others', () => {
        const plain = CPE();
        const r = settleSync(() => plain.run({ op: 'echo', value: 1 }));
        if (r.ok) throw new Error('echo leaked into a separate engine');
    });

    // ─── independence ───────────────────────────────────────────────
    check('two CPE() calls produce independent opaque objects', () => {
        const a = CPE(), b = CPE();
        if (a === b) throw new Error('same object');
        if (a.run === b.run) throw new Error('shared run()');
        const args = problem(40, 32, 32, 4);
        const ya = a.run(Object.assign({ op: 'routed' }, args));
        const yb = b.run(Object.assign({ op: 'routed' }, args));
        if (ya === yb) throw new Error('shared output buffer across engines');
        if (worstRelErr(ya, yb) !== 0) throw new Error('same input, different answer');
    });

    // The opacity claim is load-order dependent -- Object.create(null),
    // freeze and Proxy all behave the same everywhere, but the UMD browser
    // branch takes a different path to build the same object, and that path
    // is the one a page actually runs. Assert it by executing it in a context
    // with no module/require/process/Buffer, not by reading the source.
    check('the browser branch is equally opaque and still computes', () => {
        const fs = require('fs');
        const vm = require('vm');
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

        for (const f of ['ExtendX.js', 'ComputeCore.js', 'CPE.js']) {
            vm.runInContext(fs.readFileSync(path.join(V2, f), 'utf8'),
                            sandbox, { filename: f });
        }

        const out = vm.runInContext(`(function () {
            'use strict';
            const cpe = CPE();
            const keys = Object.keys(cpe);
            const proto = Object.getPrototypeOf(cpe);
            let addThrew = false;
            try { cpe.provider = 'evil'; } catch (e) { addThrew = true; }

            const B = 60, K = 32, N = 32, E = 5;
            const X = new Float32Array(B * K);
            for (let i = 0; i < X.length; i++) X[i] = ((i * 37) % 1000) / 1000 - 0.5;
            const W = [];
            for (let x = 0; x < E; x++) {
                const w = new Float32Array(K * N);
                for (let i = 0; i < w.length; i++) w[i] = ((i + x * 7919) % 997) / 997 - 0.5;
                W.push(w);
            }
            const route = new Int32Array(B);
            for (let b = 0; b < B; b++) route[b] = (b * 31 + 7) % E;
            const args = { X, W, route, B, K, N, E };
            const d = cpe.run(Object.assign({ op: 'dense' }, args));
            const r = cpe.run(Object.assign({ op: 'routed' }, args));
            let worst = 0;
            for (let i = 0; i < d.length; i++) {
                const q = Math.abs(r[i] - d[i]) / (Math.abs(d[i]) || 1);
                if (q > worst) worst = q;
            }
            return { keys, protoIsNull: proto === null, addThrew,
                     node: cpe.run('caps').host.node, worst };
        })()`, sandbox);

        if (out.node !== false) throw new Error('claimed to be Node in the sandbox');
        if (out.keys.length !== 1 || out.keys[0] !== 'run') {
            throw new Error('browser surface is ' + JSON.stringify(out.keys));
        }
        if (!out.protoIsNull) throw new Error('browser object has a prototype');
        if (!out.addThrew) throw new Error('browser object accepted a new property');
        if (!(out.worst < 1e-4)) throw new Error('browser routed != dense: ' + out.worst);
    });

    check('forcing a provider that does not exist is refused at construction', () => {
        const r = settleSync(() => CPE({ provider: 'nosuchprovider' }));
        if (r.ok) throw new Error('bogus provider accepted');
        if (!/no provider/.test(r.error.message)) throw new Error(r.error.message);
    });

    report();
}

if (require.main === module) run();
module.exports = { run };
