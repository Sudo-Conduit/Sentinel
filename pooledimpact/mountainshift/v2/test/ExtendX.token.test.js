// ExtendX v1.6.1 -- tokenFor()'s leading-zero collision.
//
// This fix existed only on a fork (research/lib/chain/ExtendX.js, released
// there as v1.5.1) and was ported back into the canonical file. It had no
// test on either side, which is how a one-character fix to the canonical
// file managed to live somewhere else for three days without anyone
// noticing. That is the gap this file closes.
//
// The defect: tokenFor() reverses the mask's bit array before parsing it as
// a binary literal, so the just-disabled bit -- always the array's last and
// highest-index element, because disableLayer() never appends past it --
// becomes the literal's FIRST character. A leading zero is numerically
// invisible (BigInt('0b0111') === BigInt('0b111')), so disabling the
// highest-bitIndex mixin produced the SAME token as the all-enabled case.
//
// Why that is not cosmetic: PIPELINE_CACHE and METHOD_CACHE are both keyed
// by this token. An unchanged token means the memo hands back the chain it
// already resolved -- the all-enabled one -- for a configuration that is
// genuinely disabled. The layer stays live after being switched off.
//
// Run with: node test/ExtendX.token.test.js
'use strict';
const path = require('path');
const ExtendX = require(path.join(__dirname, '..', 'ExtendX.js'));
const { check, report } = require('./helpers.js');

// Reproducing this needs the exact situation the changelog describes, and
// nothing less does it: an instance whose mask array was sized when its
// mixin sat at some bit index, and which then has that mixin pushed to a
// HIGHER index by a later, unrelated extend(). reindex() is global and
// alphabetical and re-runs on every extend(), so composing anything whose
// mixinId sorts BEFORE ours shifts ours up.
//
// The instance's mask array is not grown by that shift. disableLayer() then
// writes 0 at the new, higher index, extending the array and leaving holes
// behind it -- and tokenFor() normalizes holes to 1. The array is reversed
// before parsing, so that trailing 0 becomes the literal's leading
// character, where it is numerically invisible. The result equals the token
// the instance had while fully enabled.
//
// A test that merely disables the highest-bit mixin of a freshly composed
// class does NOT reproduce this: the mask array is already sized to that
// index, so no holes appear and the token moves correctly. That version of
// this test passed against the unfixed file, which is worth stating plainly
// -- it would have shipped as false assurance.
function shiftUp(tag) {
    // Sorts before 'm.' so it takes a lower bit and pushes 'm.*' up by one.
    ExtendX.extend(class {}, { mixinId: 'aaa.shift.' + tag });
}

function run() {
    check('a bit shifted higher, then disabled, changes the cacheToken', () => {
        class Core { pick() { return 'base'; } }
        const m = { mixinId: 'm.token', pick() { return 'layer'; } };
        const inst = new (ExtendX.extend(Core, m))();

        const enabled = inst.cacheToken;     // mask sized at the ORIGINAL index
        shiftUp('token');                    // reindex() pushes m.token higher
        inst.disableLayer(m);

        if (inst.cacheToken === enabled) {
            throw new Error(`token "${enabled}" unchanged after disabling a `
                + 'shifted bit -- the memo will serve the all-enabled chain');
        }
    });

    // Invariant, not a repro: this one passes against the unfixed file too.
    // METHOD_CACHE is keyed by prop + token + registry generation, and the
    // extend() that does the shifting also moves the generation, so dispatch
    // is protected here even when the token collides. The demonstrated damage
    // is therefore to the token as an IDENTIFIER -- which is precisely the
    // use CPE puts it to when recording which configuration produced a
    // measurement. Kept so a future change cannot quietly lose the guard.
    check('...and the disabled layer actually stops dispatching', () => {
        class Core { pick() { return 'base'; } }
        const m = { mixinId: 'm.dispatch', pick() { return 'layer'; } };
        const inst = new (ExtendX.extend(Core, m))();

        if (inst.pick() !== 'layer') throw new Error('baseline wrong');
        inst.cacheToken;                     // resolve and memoize while enabled
        shiftUp('dispatch');
        inst.disableLayer(m);

        const after = inst.pick();
        if (after !== 'base') {
            throw new Error(`disabled layer still served: got "${after}" -- the `
                + 'token collision reaching real dispatch, not just reporting');
        }
    });

    check('re-enabling returns to the shifted all-enabled token', () => {
        class Core { pick() { return 'base'; } }
        const m = { mixinId: 'm.roundtrip', pick() { return 'layer'; } };
        const inst = new (ExtendX.extend(Core, m))();

        shiftUp('roundtrip');
        inst.disableLayer(m);
        const off = inst.cacheToken;
        inst.enableLayer(m);
        const on = inst.cacheToken;

        if (on === off) throw new Error('enable/disable share a token: ' + on);
        if (inst.pick() !== 'layer') throw new Error('re-enabled layer not dispatching');
    });

    // The token is the natural fingerprint for "which engine configuration
    // produced this measurement" (CPE records results per configuration), so
    // two genuinely different configurations must never share one.
    check('distinct configurations get distinct tokens', () => {
        class Core { pick() { return 'base'; } }
        const a = { mixinId: 'm.cfg.a', pick(s, next) { return 'a' + next(s); } };
        const b = { mixinId: 'aaa.cfg.b', pick() { return 'b'; } };
        const Tier = ExtendX.extend(Core, a, b);

        const seen = new Map();
        for (const combo of [[], [a], [b], [a, b]]) {
            const inst = new Tier();
            for (const m of combo) inst.disableLayer(m);
            const tok = inst.cacheToken;
            const label = combo.map(m => m.mixinId).join('+') || '(none disabled)';
            if (seen.has(tok)) {
                throw new Error(`token "${tok}" shared by "${seen.get(tok)}" and "${label}"`);
            }
            seen.set(tok, label);
        }
    });

    report();
}

if (require.main === module) run();
module.exports = { run };
