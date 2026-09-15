// Individual-class (white-box) test for PreflightMixin.js: proves the
// generalized before/after wrapper does the same job SecurityMixin.js's
// hand-written pattern does (veto, rewrite, react), for both sync and
// async wrapped methods, and that two labeled preflight mixins can be
// composed onto the same class as independently toggleable layers.
//
// Run with: node test/PreflightMixin.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { createPreflightMixin } = require(path.join(V2, 'PreflightMixin.js'));
const { check, expectThrows, report } = require('./helpers.js');

class Greeter {
    greet(name) { return 'hello ' + name; }
    async greetAsync(name) { return 'hello ' + name; }
}

function run() {
    // --- before: veto ---
    {
        const Guarded = ExtendX.extend(Greeter, createPreflightMixin(Greeter, {
            label: 'veto',
            before(ctx) { if (ctx.args[0] === 'blocked') throw new Error('vetoed'); }
        }));
        const g = new Guarded();
        check('before() lets an allowed call through', () => {
            if (g.greet('world') !== 'hello world') throw new Error('unexpected result');
        });
        expectThrows('before() veto stops the real call', () => g.greet('blocked'));
    }

    // --- before: rewrite args ---
    {
        const Rewriter = ExtendX.extend(Greeter, createPreflightMixin(Greeter, {
            label: 'rewrite',
            before(ctx) { return ['REWRITTEN']; }
        }));
        const g = new Rewriter();
        check('before() rewriting args reaches the real call', () => {
            if (g.greet('anything') !== 'hello REWRITTEN') throw new Error('got: ' + g.greet('anything'));
        });
    }

    // --- after: rewrite result (sync method) ---
    {
        const Upper = ExtendX.extend(Greeter, createPreflightMixin(Greeter, {
            label: 'upper',
            after(ctx) { return ctx.result.toUpperCase(); }
        }));
        const g = new Upper();
        check('after() rewriting a sync result', () => {
            if (g.greet('world') !== 'HELLO WORLD') throw new Error('got: ' + g.greet('world'));
        });
    }

    // --- after: passthrough when returning undefined ---
    {
        let seen = null;
        const Logger = ExtendX.extend(Greeter, createPreflightMixin(Greeter, {
            label: 'log',
            after(ctx) { seen = ctx.result; /* no return -- observe only */ }
        }));
        const g = new Logger();
        check('after() returning undefined passes the real result through unchanged', () => {
            const r = g.greet('world');
            if (r !== 'hello world') throw new Error('got: ' + r);
            if (seen !== 'hello world') throw new Error('after() never observed the result');
        });
    }

    // --- async method: after() waits for the real Promise, stays a Promise ---
    {
        const AsyncUpper = ExtendX.extend(Greeter, createPreflightMixin(Greeter, {
            label: 'asyncUpper',
            after(ctx) { return ctx.result.toUpperCase(); }
        }));
        const g = new AsyncUpper();
        const p = g.greetAsync('world');
        check('a wrapped async method still returns a real Promise', () => {
            if (typeof p.then !== 'function') throw new Error('expected a Promise');
        });
        // synchronous check queue below waits on this before report()
        run._asyncCheck = p.then((v) => {
            check('after() rewrote the resolved async result', () => {
                if (v !== 'HELLO WORLD') throw new Error('got: ' + v);
            });
        });
    }

    // --- async before(): vetoes/rewrites before the real call, chain stays a Promise ---
    {
        const AsyncGate = ExtendX.extend(Greeter, createPreflightMixin(Greeter, {
            label: 'asyncGate',
            before(ctx) { return Promise.resolve(ctx.args[0] === 'blocked' ? Promise.reject(new Error('async veto')) : undefined); }
        }));
        const g = new AsyncGate();
        run._asyncBeforeCheck = g.greet('blocked').then(
            () => { check('async before() veto should have rejected', () => { throw new Error('did not reject'); }); },
            () => { check('async before() veto rejects the call', () => {}); }
        );
    }

    // --- two labeled preflight mixins compose independently on one class ---
    {
        const order = [];
        const First = createPreflightMixin(Greeter, { label: 'first', before() { order.push('first'); } });
        const Second = createPreflightMixin(Greeter, { label: 'second', before() { order.push('second'); } });
        const Both = ExtendX.extend(Greeter, First, Second);
        const g = new Both();
        g.greet('world');
        check('two labeled preflight mixins both ran, independently toggleable ids', () => {
            if (order.length !== 2) throw new Error('expected both to run, got: ' + JSON.stringify(order));
            if (First.mixinId === Second.mixinId) throw new Error('labels should produce distinct mixinIds');
        });
    }

    // --- construction guards ---
    expectThrows('createPreflightMixin() requires a constructor function', () => createPreflightMixin({}, { before() {} }));
    expectThrows('createPreflightMixin() requires at least one hook', () => createPreflightMixin(Greeter, {}));

    Promise.all([run._asyncCheck, run._asyncBeforeCheck]).finally(report);
}

run();
