// Individual-class (white-box) test: ExtendX.extend() called on top of an
// ALREADY-composed class ("stacking" -- Outer = ExtendX.extend(Inner, mixinB)
// where Inner = ExtendX.extend(Raw, mixinA)). No production call site in
// this codebase does this today (every real composition passes every mixin
// to a single extend() call), but E.1's opaque closure factory was about to
// make this shape reachable, so it was audited before being trusted.
//
// Run with: node test/ExtendX.stacking.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { check, report } = require('./helpers.js');

class Raw {
    constructor() { this.tag = 'raw'; }
}

function freshMixins(suffix) {
    return {
        a: { mixinId: 'stacking:a' + suffix, hello() { return 'A'; } },
        b: { mixinId: 'stacking:b' + suffix, world() { return 'B'; } },
        c: { mixinId: 'stacking:c' + suffix, third() { return 'C'; } }
    };
}

function run() {
    // --- the constructor bug: new.target was not forwarded ---
    // Root cause: Inner's own constructor closure called
    // Reflect.construct(BaseClass, args, Subclass) with its OWN closed-over
    // Subclass (itself), ignoring the new.target Outer's constructor had
    // actually passed down via Reflect.construct(Inner, args, Outer).
    // Because Inner's body explicitly returns an object, that wrong-newTarget
    // object OVERRIDES the this-binding the engine would have created from
    // Outer.prototype -- so the final instance's prototype chain stopped at
    // Inner.prototype and never reached Outer.prototype at all. Fixed by
    // forwarding new.target (falling back to the closed-over Subclass for an
    // ordinary, non-nested `new Inner()` call, where new.target === Subclass
    // already).
    {
        const { a, b } = freshMixins('1');
        const Inner = ExtendX.extend(Raw, a);
        const Outer = ExtendX.extend(Inner, b);
        const instance = new Outer();

        check('stacked composition: the INNER layer\'s method still dispatches', () => {
            if (instance.hello() !== 'A') throw new Error('expected "A", got ' + instance.hello());
        });
        check('stacked composition: the OUTER layer\'s method dispatches -- this is exactly what silently returned undefined before the fix', () => {
            if (typeof instance.world !== 'function') throw new Error('instance.world is not a function -- the outer layer was dropped');
            if (instance.world() !== 'B') throw new Error('expected "B", got ' + instance.world());
        });
        check('stacked composition: instance instanceof Outer -- false before the fix', () => {
            if (!(instance instanceof Outer)) throw new Error('instance is not an instanceof Outer');
        });
        check('stacked composition: instance instanceof Inner still holds', () => {
            if (!(instance instanceof Inner)) throw new Error('instance is not an instanceof Inner');
        });
        check('stacked composition: the instance\'s DIRECT prototype is Outer.prototype, not Inner.prototype', () => {
            if (Object.getPrototypeOf(instance) !== Outer.prototype) throw new Error('direct prototype is not Outer.prototype');
        });
    }

    // --- three layers deep, for extra confidence beyond the minimal repro ---
    {
        const { a, b, c } = freshMixins('2');
        const L1 = ExtendX.extend(Raw, a);
        const L2 = ExtendX.extend(L1, b);
        const L3 = ExtendX.extend(L2, c);
        const instance = new L3();
        check('three layers deep: all three methods dispatch', () => {
            if (instance.hello() !== 'A') throw new Error('layer 1 method missing');
            if (instance.world() !== 'B') throw new Error('layer 2 method missing');
            if (instance.third() !== 'C') throw new Error('layer 3 method missing');
        });
        check('three layers deep: instanceof holds for every layer', () => {
            if (!(instance instanceof L1)) throw new Error('not instanceof L1');
            if (!(instance instanceof L2)) throw new Error('not instanceof L2');
            if (!(instance instanceof L3)) throw new Error('not instanceof L3');
        });
        check('three layers deep: direct prototype is the OUTERMOST class', () => {
            if (Object.getPrototypeOf(instance) !== L3.prototype) throw new Error('direct prototype is not L3.prototype');
        });
    }

    // --- regression guard: plain, non-nested composition (every real call
    // site in this codebase today) must be completely unaffected by the fix,
    // since new.target === Subclass already for an ordinary `new Inner()` ---
    {
        const { a } = freshMixins('3');
        const Plain = ExtendX.extend(Raw, a);
        const instance = new Plain();
        check('non-nested composition: unaffected by the new.target fix', () => {
            if (instance.hello() !== 'A') throw new Error('plain composition regressed');
            if (!(instance instanceof Plain)) throw new Error('instanceof regressed for plain composition');
            if (Object.getPrototypeOf(instance) !== Plain.prototype) throw new Error('direct prototype regressed for plain composition');
        });
    }

    // --- FIXED (was a known gap): stacked dispose() chaining used to
    // silently drop an INNER layer's mixin dispose hook. Every layer's
    // dispose wrapper called the same conflated ExtendX.prototype.dispose(),
    // which (a) always read this.constructor._rawMixins -- always the
    // OUTERMOST class, due to prototype shadowing, so an inner layer's
    // wrapper could never reach ITS OWN mixin's hook through it at all --
    // and (b) set DISPOSED.add(id) on its first call, so the inner layer's
    // own chained call to the same shared method returned immediately on
    // the idempotency guard before doing anything. Fixed by splitting the
    // once-only bookkeeping (finalizeDisposeBookkeeping) from each layer's
    // own mixin-hook run (runLayerDisposeHooks/Async), deduped per mixinId
    // rather than gated by one whole-instance flag -- see ExtendX.js's
    // "Dispose helpers (stacking fix, v1.4.0)" section.
    {
        let innerDisposed = false;
        let outerDisposed = false;
        const inner = { mixinId: 'stacking:disposeInner', dispose() { innerDisposed = true; } };
        const outer = { mixinId: 'stacking:disposeOuter', dispose() { outerDisposed = true; } };
        const Inner = ExtendX.extend(Raw, inner);
        const Outer = ExtendX.extend(Inner, outer);
        const instance = new Outer();
        instance.dispose();
        check('stacked dispose(): BOTH the outer layer\'s and the inner layer\'s mixin hooks run', () => {
            if (!outerDisposed) throw new Error('expected the outer mixin\'s dispose hook to run');
            if (!innerDisposed) throw new Error('expected the inner mixin\'s dispose hook to run -- this is the bug that was fixed');
        });

        innerDisposed = false;
        outerDisposed = false;
        instance.dispose();
        check('stacked dispose(): a SECOND top-level dispose() call does not re-run either layer\'s hook', () => {
            if (innerDisposed || outerDisposed) throw new Error('a hook re-ran on a repeat dispose() call -- per-mixinId dedup regressed');
        });
    }

    // --- FIXED: installWrappers()'s `Subclass._wrapped || (Subclass._wrapped
    // = new Set())` did not check for an OWN property -- extend() sets
    // Object.setPrototypeOf(Subclass, BaseClass), so a stacked Outer's
    // `_wrapped` lookup silently resolved up the STATIC prototype chain to
    // Inner's already-populated Set the first time installWrappers(Outer)
    // ran (Outer had no own `_wrapped` yet). Whenever Outer's own mixin
    // shared a method NAME with something Inner already wrapped, Outer's
    // installWrappers() saw that name as "already installed" (reading
    // Inner's Set) and never defined its OWN dispatcher for it on
    // Outer.prototype at all -- so a call fell straight through the
    // prototype chain to INNER's dispatcher, running ONLY Inner's chain.
    // This is security-relevant: confirmed live, a SecurityMixin composed
    // as the OUTER layer over an inner layer sharing a guarded method name
    // never actually enforced -- the guarded call reached the inner,
    // unguarded implementation directly -- while mixins()/activeMixins()
    // (reading _rawMixins/_resolvePipeline, not _wrapped) still reported
    // the security mixin as active, since those two mechanisms don't
    // agree with each other at all. Fixed by checking
    // Object.prototype.hasOwnProperty.call(Subclass, '_wrapped') instead
    // of bare truthiness, so every Subclass gets its own independent Set.
    {
        let armed = false;
        const inner = { mixinId: 'stacking:wrapInner', handle() { return 'INNER-UNGUARDED'; } };
        const security = {
            mixinId: 'stacking:wrapSecurity',
            handle() {
                if (!armed) throw new Error('BLOCKED: not armed');
                return this.super.handle();
            }
        };
        const Inner = ExtendX.extend(Raw, inner);
        const Outer = ExtendX.extend(Inner, security);
        const instance = new Outer();

        check('stacked composition: Outer gets its OWN _wrapped Set, not Inner\'s', () => {
            if (Outer._wrapped === Inner._wrapped) throw new Error('Outer._wrapped is the SAME object as Inner._wrapped -- static prototype inheritance leaked through');
        });
        check('stacked composition: Outer.prototype has its OWN dispatcher for a method name Inner also defines', () => {
            if (!Object.prototype.hasOwnProperty.call(Outer.prototype, 'handle')) throw new Error('Outer.prototype has no own "handle" -- the outer layer\'s dispatcher was never installed');
        });
        check('stacked composition: the OUTER layer\'s guard actually enforces (unarmed -> throws), not silently bypassed to the inner layer', () => {
            armed = false;
            let threw = false;
            try { instance.handle(); } catch (e) { threw = true; }
            if (!threw) throw new Error('expected the outer SecurityMixin-shaped guard to block an unarmed call -- it silently returned a value instead');
        });
        check('stacked composition: once armed, the outer layer correctly delegates to the inner layer via this.super', () => {
            armed = true;
            if (instance.handle() !== 'INNER-UNGUARDED') throw new Error('expected the outer layer to chain down to the inner layer\'s implementation');
        });
    }
}

async function runAsync() {
    // --- disposeAsync() gets the identical fix, proven at three layers
    // deep for extra confidence beyond the two-layer sync case above ---
    let a = false, b = false, c = false;
    const mA = { mixinId: 'stacking:asyncA', dispose() { a = true; } };
    const mB = { mixinId: 'stacking:asyncB', dispose() { b = true; } };
    const mC = { mixinId: 'stacking:asyncC', dispose() { c = true; } };
    const L1 = ExtendX.extend(Raw, mA);
    const L2 = ExtendX.extend(L1, mB);
    const L3 = ExtendX.extend(L2, mC);
    const instance = new L3();
    await instance.disposeAsync();
    check('stacked disposeAsync(): all three layers\' mixin hooks run', () => {
        if (!a || !b || !c) throw new Error('expected all three hooks to run, got a=' + a + ' b=' + b + ' c=' + c);
    });
}

run();
runAsync()
    .then(report)
    .catch((err) => {
        console.error('ExtendX.stacking.test.js (async section) failed:', err);
        process.exitCode = 1;
    });
