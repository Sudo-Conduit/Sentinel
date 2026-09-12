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

    // --- KNOWN GAP, found alongside the constructor bug, NOT YET FIXED:
    // stacked dispose() chaining silently drops an INNER layer's mixin
    // dispose hook. Each layer's dispose wrapper calls the shared
    // ExtendX.prototype.dispose(), which (a) always reads
    // this.constructor._rawMixins -- which is always the OUTERMOST class,
    // due to prototype shadowing, so an inner layer's wrapper can never
    // reach ITS OWN mixin's hook through it at all -- and (b) sets
    // DISPOSED.add(id) on its first call, so the inner layer's own chained
    // call to the same shared method returns immediately on the
    // idempotency guard before doing anything. Net effect: only the
    // OUTERMOST layer's mixin dispose hooks ever run; every layer below it
    // is silently skipped. This is a real, confirmed, currently-unfixed
    // limitation -- documented here the same way Registry.set()'s
    // next()-injection gap is, so it stays a known, tracked fact rather
    // than a silent regression if this test starts failing (which would
    // mean it was fixed -- update this check when that happens, don't just
    // delete it).
    {
        let innerDisposed = false;
        let outerDisposed = false;
        const inner = { mixinId: 'stacking:disposeInner', dispose() { innerDisposed = true; } };
        const outer = { mixinId: 'stacking:disposeOuter', dispose() { outerDisposed = true; } };
        const Inner = ExtendX.extend(Raw, inner);
        const Outer = ExtendX.extend(Inner, outer);
        const instance = new Outer();
        instance.dispose();
        check('KNOWN GAP: stacked dispose() only runs the OUTERMOST layer\'s mixin hook -- the inner layer\'s hook is silently skipped', () => {
            if (!outerDisposed) throw new Error('expected the outer mixin\'s dispose hook to run');
            if (innerDisposed) throw new Error('the inner mixin\'s dispose hook unexpectedly ran -- this gap appears to be FIXED; update this test to assert the correct behavior instead of the known-gap behavior');
        });
    }

    report();
}

run();
