/**
 * test/helpers.js — shared harness for the "individual classes" (white-box,
 * pre-closure) test tier.
 *
 * This tier legitimately requires() internals (ExtendX.js, SecurityMixin.js,
 * the raw machine classes) -- at this layer nothing has claimed to be
 * opaque yet, so these tests verify the building blocks directly. Once the
 * outer closure factory exists, the SEPARATE integrated tier tests ONLY
 * through the single run() it exposes -- no requiring its internals, no
 * exception for Node. Do not reuse this file's check()/expectThrows() shape
 * to justify reaching into the closure once that tier exists; the two
 * tiers are deliberately asymmetric.
 */
'use strict';

let failures = 0;
let ran = 0;

function check(label, fn) {
    ran++;
    try {
        fn();
        console.log('PASS: ' + label);
    } catch (e) {
        failures++;
        console.log('FAIL: ' + label + ' -- ' + e.message);
    }
}

function expectThrows(label, fn) {
    ran++;
    try {
        fn();
        failures++;
        console.log('FAIL: ' + label + ' -- expected throw, none occurred');
    } catch (e) {
        console.log('PASS: ' + label + ' (threw: ' + e.message + ')');
    }
}

/**
 * The standard dual-fixture pattern this whole test tier is built on:
 * every security-relevant behavior needs to be checked against BOTH an
 * unsealed instance (ExtendX's normal, dev-friendly default -- layers/
 * dispose toggleable) and a sealed one (seal() has locked dispose/
 * disposeAsync down; enableLayer/disableLayer are already unconditionally
 * refused by ExtendX's own mixin.locked, sealed or not). A finding that
 * only shows up in one half is still a real finding -- see the CPU/
 * Physical proofs, where the sealed/unsealed split is exactly what
 * surfaced the dispose()-mask-collapse and self-lockout bugs.
 *
 * @param {Function} SecuredClass - output of ExtendX.extend(Base, securityMixin, ...)
 * @param {Object} ctorOptions - passed to `new SecuredClass(ctorOptions)` for both instances
 * @param {Function} sealFn - SecurityMixin.seal
 * @returns {{ unsealed: object, sealed: object }}
 */
function sealedAndUnsealed(SecuredClass, ctorOptions, sealFn) {
    const unsealed = new SecuredClass(ctorOptions);
    const sealed = new SecuredClass(ctorOptions);
    sealFn(sealed);
    return { unsealed: unsealed, sealed: sealed };
}

function report() {
    console.log('');
    console.log(failures === 0 ? ('ALL ' + ran + ' CHECKS PASSED') : (failures + ' of ' + ran + ' CHECK(S) FAILED'));
    process.exitCode = failures === 0 ? 0 : 1;
}

module.exports = { check: check, expectThrows: expectThrows, sealedAndUnsealed: sealedAndUnsealed, report: report };
