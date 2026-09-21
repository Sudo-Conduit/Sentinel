// ExtendX defects found while designing CPE's provider tiers
// (LinuxMixin -> AMX/VNNI/BLAS, MacMixin -> SME/Accelerate, BrowserMixin ->
// WebGPU/WASM, with Cache/MemoryMap/Storage stacked on top).
//
// Each check below is written to PASS when the defect is fixed, so this file
// is a red bar until then, not documentation of accepted behavior. Minimal
// repros -- no CPE, no matmul, nothing but ExtendX.
//
// Found:
//   D1  stacking drops the LAST layer of the inner composition
//   D2  _defaultMaskState sets every bit below its highest, not its own bits
//   D3  removeMixin() deregisters but live dispatch keeps using the mixin
//
// D1 and D3 are behavioral. D2 is latent for dispatch (a set bit for a mixin
// a class does not have is never looked up) but wrong for anything reading
// masks relationally, which is what evaluateSetRelation() is for.
//
// Run with: node test/ExtendX.nesting-defects.test.js
'use strict';
const path = require('path');
const ExtendX = require(path.join(__dirname, '..', 'ExtendX.js'));
const { check, report } = require('./helpers.js');

function run() {
    // ── D1: stacking truncates the chain by exactly one layer ──────────
    //
    // A flat composition runs every layer. The same layers, composed as an
    // inner class and then extended, lose the innermost one: `next` at the
    // last surviving layer returns undefined instead of calling down.
    //
    // Note it is not "only the outer layer runs" -- a and b both run. It is
    // one layer short, which points at the cursor/`below` computation across
    // the nesting boundary rather than at chain assembly generally.
    //
    // Why it matters: in a platform tier the innermost layer is the FALLBACK
    // engine. LinuxMixin composed as (AMX, VNNI, BLAS) then stacked under a
    // CacheMixin silently loses BLAS -- the one engine that must never be
    // missing, since it is what serves every shape the others decline.
    check('D1: extend() over a composed class keeps the whole chain', () => {
        class Base { step() { return 'base'; } }
        const a = { mixinId: 'nest.a', step(s, next) { return 'a>' + next(s); } };
        const b = { mixinId: 'nest.b', step(s, next) { return 'b>' + next(s); } };
        const c = { mixinId: 'nest.c', step() { return 'c'; } };

        const flat = new (ExtendX.extend(Base, a, b, c))().step({});
        if (flat !== 'a>b>c') throw new Error('flat baseline changed: ' + flat);

        const Inner = ExtendX.extend(Base, b, c);
        const inner = new Inner().step({});
        if (inner !== 'b>c') throw new Error('inner baseline changed: ' + inner);

        const nested = new (ExtendX.extend(Inner, a))().step({});
        if (nested !== flat) {
            throw new Error(`nested gave "${nested}", flat gives "${flat}"`);
        }
    });

    // ── D2: the default mask claims bits the class does not own ────────
    //
    // Bit positions are global: a mixin's index in the alphabetically sorted
    // list of every mixinId ever registered. But _defaultMaskState is built
    // as "every bit up to my highest index set to 1" rather than "my own bits
    // set". A class composed from high-index mixins therefore claims every
    // low-index mixin too.
    //
    // Observed: A={mask.p, mask.q} (bits 0,1) -> [1,[1,1]]
    //           B={mask.r, mask.s} (bits 2,3) -> [1,[1,1,1,1]]
    // B's mask asserts it contains p and q. It does not.
    //
    // evaluateSetRelation() then faithfully reports SUBSET for two classes
    // that share no mixin at all. The relation is right about the mask; the
    // mask is wrong about the class.
    check('D2: _defaultMaskState sets only the bits the class owns', () => {
        class Base {}
        const p = { mixinId: 'mask.p' }, q = { mixinId: 'mask.q' };
        const r = { mixinId: 'mask.r' }, s = { mixinId: 'mask.s' };

        const A = ExtendX.extend(Base, p, q);
        const B = ExtendX.extend(Base, r, s);

        const bitsOf = C => C._defaultMaskState[1];
        const own = (C, mixins) => {
            const bits = bitsOf(C);
            const mine = new Set(mixins.map(m => m._bitIndex));
            for (let i = 0; i < bits.length; i++) {
                if (bits[i] === 1 && !mine.has(i)) return i;
            }
            return -1;
        };

        const strayA = own(A, [p, q]);
        if (strayA !== -1) {
            throw new Error(`A claims bit ${strayA} it does not own: ${JSON.stringify(bitsOf(A))}`);
        }
        const strayB = own(B, [r, s]);
        if (strayB !== -1) {
            throw new Error(`B claims bit ${strayB} it does not own: ${JSON.stringify(bitsOf(B))}`);
        }
    });

    check('D2b: disjoint compositions relate as disjoint', () => {
        class Base {}
        const p = { mixinId: 'rel.p' }, q = { mixinId: 'rel.q' };
        const r = { mixinId: 'rel.r' }, s = { mixinId: 'rel.s' };

        const A = ExtendX.extend(Base, p, q);
        const B = ExtendX.extend(Base, r, s);
        const C = ExtendX.extend(Base, p, q, r);

        // These two already hold and are asserted so a fix does not regress them.
        const sub = ExtendX.evaluateSetRelation(new A(), new C());
        if (sub !== 'SUBSET') throw new Error('A vs C should be SUBSET, got ' + sub);
        const sup = ExtendX.evaluateSetRelation(new C(), new A());
        if (sup !== 'SUPERSET') throw new Error('C vs A should be SUPERSET, got ' + sup);

        const rel = ExtendX.evaluateSetRelation(new A(), new B());
        if (rel !== 'DISJOINT_OR_INTERSECTING_SETS') {
            throw new Error('A vs B share no mixin but relate as ' + rel);
        }
    });

    // ── D3: removal deregisters without invalidating dispatch ──────────
    //
    // hasMixin() goes false, so the class agrees the mixin is gone -- but a
    // freshly constructed instance still dispatches into it. The resolved
    // pipeline is memoized on cacheToken plus a registry generation, and
    // removeMixin() appears not to move either, so the stale chain is served.
    //
    // The inconsistency is the problem: "removed" and "still running" cannot
    // both be true. Runtime removal is one of the four operations a provider
    // tier needs (drop a flaky WebGPU adapter and fall through to WASM), and
    // a removal that reports success without taking effect is worse than one
    // that refuses.
    check('D3: removeMixin() stops the mixin from dispatching', () => {
        class Core { pick() { return 'fallback'; } }
        const only = { mixinId: 'rm.only', pick() { return 'mixin'; } };
        const Eng = ExtendX.extend(Core, only);

        if (new Eng().pick() !== 'mixin') throw new Error('baseline wrong');
        if (!ExtendX.hasMixin(Eng, only)) throw new Error('hasMixin false before removal');

        ExtendX.removeMixin(Eng, only);

        if (ExtendX.hasMixin(Eng, only)) throw new Error('hasMixin true after removal');
        const after = new Eng().pick();
        if (after !== 'fallback') {
            throw new Error(`removed mixin still dispatching: got "${after}"`);
        }
    });

    // ── What is verified WORKING, so a fix to the above does not cost it ──

    check('OK: runtime override hot-swaps a live instance', () => {
        class Core { pick() { return 'none'; } }
        const v1 = { mixinId: 'ok.swap', pick() { return 'v1'; } };
        const e = new (ExtendX.extend(Core, v1))();
        if (e.pick() !== 'v1') throw new Error('baseline wrong');

        ExtendX.override({ mixinId: 'ok.swap', overrides: true, pick() { return 'v2'; } });
        if (e.pick() !== 'v2') throw new Error('override did not reach the live instance');
    });

    check('OK: disableLayer falls through, per instance only', () => {
        class Core { pick(s) { return 'cpu'; } }
        const gpu = { mixinId: 'ok.gpu', pick(s, next) { return s.big ? 'gpu' : next(s); } };
        const Tier = ExtendX.extend(Core, gpu);

        const a = new Tier(), b = new Tier();
        if (a.pick({ big: 1 }) !== 'gpu') throw new Error('baseline wrong');

        const tokenBefore = a.cacheToken;
        a.disableLayer(gpu);

        if (a.pick({ big: 1 }) !== 'cpu') throw new Error('disabled layer still served');
        if (b.pick({ big: 1 }) !== 'gpu') throw new Error('disable leaked to another instance');
        if (a.cacheToken === tokenBefore) throw new Error('cacheToken did not move');
    });

    check('OK: a provider tier falls through by claim', () => {
        class Core { pick() { return 'none'; } }
        const amx = { mixinId: 'ok.amx', pick(s, next) { return (s.int8 && s.rows >= 16) ? 'amx' : next(s); } };
        const vnni = { mixinId: 'ok.vnni', pick(s, next) { return s.int8 ? 'vnni' : next(s); } };
        const blas = { mixinId: 'ok.blas', pick() { return 'blas'; } };

        const t = new (ExtendX.extend(Core, amx, vnni, blas))();
        const got = [{ int8: 1, rows: 64 }, { int8: 1, rows: 3 }, { int8: 0 }].map(c => t.pick(c));
        if (got.join(',') !== 'amx,vnni,blas') throw new Error('tier resolved as ' + got.join(','));
    });

    report();
}

if (require.main === module) run();
module.exports = { run };
