// Individual-class (white-box) test: SecurityMixin + StructureMixin
// composed onto BIOS, whose boot() is async and constructs a Kernel via
// an injectable factory (mirroring Physical's cpuFactory fix) after
// internal awaits -- exactly the shape that breaks StructureMixin's
// synchronous inference and needs the explicit addChild() escape hatch.
//
// NOTE: helpers.js's check() only catches SYNCHRONOUS throws -- it does
// not await a returned promise. Every async outcome below is awaited
// first, with the result/rejection captured into a plain value or
// exception, and check()/expectThrows() only ever run a synchronous
// assertion against that already-settled value. Do not pass an
// async/promise-returning function directly to check() -- it would log
// PASS immediately regardless of how the promise eventually settles.
//
// Run with: node test/BIOS.security.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
require(path.join(V2, 'BaseClassX.js'));
const BIOS = require(path.join(V2, 'BIOS.js'));
const Kernel = require(path.join(V2, 'Kernel.js'));
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { createSecurityMixin, seal, isSealed } = require(path.join(V2, 'SecurityMixin.js'));
const { createStructureMixin } = require(path.join(V2, 'StructureMixin.js'));
const { check, expectThrows, sealedAndUnsealed, report } = require('./helpers.js');

const biosSecurity = createSecurityMixin(BIOS);
const kernelSecurity = createSecurityMixin(Kernel);
const SecuredBIOS = ExtendX.extend(BIOS, biosSecurity, createStructureMixin(BIOS, { mode: 'graph' }));
const SecuredKernel = ExtendX.extend(Kernel, kernelSecurity, createStructureMixin(Kernel, { mode: 'graph' }));

function fakePhysical() {
    return { post() { this.poweredOn = true; }, poweredOn: false, getCPU: () => ({ config: { halted: false } }), ramBytes: 0x400000 };
}
function fakeFs(entry) {
    return { findBootEntry: async () => entry || null };
}

// Runs a thunk and returns { ok, value } or { ok: false, error } instead of
// letting either outcome throw across an async boundary check() can't see.
// Takes a THUNK, not an already-evaluated promise: SecurityMixin's gate
// throws SYNCHRONOUSLY (its wrapper function is not itself async), so for a
// blocked call bios.boot(...) never even produces a promise to await --
// evaluating the call expression itself throws immediately. Passing a
// function defers that evaluation inside this try, catching both the
// synchronous-throw case and the normal async-rejection case uniformly.
async function settle(fn) {
    try {
        const value = await fn();
        return { ok: true, value: value };
    } catch (e) {
        return { ok: false, error: e };
    }
}

async function run() {
    // --- basic life cycle ---
    const bios = new SecuredBIOS({ kernelFactory: (opts) => new SecuredKernel(opts) });
    check('armed immediately after construction', () => {
        if (!bios._securityArmed()) throw new Error('not armed');
    });

    // --- regression: injectable kernelFactory closes the raw-unsecured
    // -Kernel leak (same class of bug as Physical's raw-unsecured-CPU) ---
    const kernel1 = await bios.boot(fakePhysical(), fakeFs());
    check('injected kernelFactory: boot() returns a SECURED, armed Kernel', () => {
        if (typeof kernel1._securityArmed !== 'function') throw new Error('injection did not take effect');
        if (!kernel1._securityArmed()) throw new Error('leaked kernel is secured but not armed');
    });

    const plainBios = new SecuredBIOS({});
    const plainKernel = await plainBios.boot(fakePhysical(), fakeFs());
    check('default behavior unaffected: a BIOS built WITHOUT kernelFactory returns a plain Kernel', () => {
        if (typeof plainKernel._securityArmed === 'function') throw new Error('default behavior regressed');
    });

    // --- regression: iso truthy-check hazard. boot(physical, fs) with
    // exactly 2 arguments used to crash with "iso.verifyIntegrity is not a
    // function" because ExtendX's dispatcher injects its own next()
    // callback into the omitted 3rd (iso) slot, and a bare `iso &&` treated
    // that truthy function as a real ISO. ---
    global.Installer = { install: async () => { throw new Error('Installer.install should NEVER be called -- there is no real iso'); } };
    const isoHazardResult = await settle(() => bios.boot(fakePhysical(), fakeFs()));
    delete global.Installer;
    check('next()-collision regression: boot(physical, fs) with NO iso does not crash even when Installer exists globally', () => {
        if (!isoHazardResult.ok) throw new Error('boot() crashed: ' + isoHazardResult.error.message);
    });

    // --- regression: StructureMixin's documented "construction after an
    // internal await" limitation, confirmed on REAL production code (not a
    // synthetic delay test) -- boot()'s kernelFactory() call happens after
    // the findBootEntry scan's awaits, so plain inference silently fails
    // and returns null. The explicit addChild() call boot() now makes is
    // the actual fix. ---
    const bios2 = new SecuredBIOS({ kernelFactory: (opts) => new SecuredKernel(opts) });
    const kernel2 = await bios2.boot(fakePhysical(), fakeFs());
    check('explicit addChild(): boot() correctly attributes the constructed Kernel as its child despite the async gap inference cannot cover', () => {
        if (kernel2.getParent() !== bios2._extId) throw new Error('expected parent ' + bios2._extId + ', got ' + kernel2.getParent());
        if (!bios2.getChildren().includes(kernel2._extId)) throw new Error('bios2.getChildren() missing the booted kernel');
    });

    // --- regression: BaseClassX's OWN native addChild(childInstance) must
    // never be confused with StructureMixin's -- boot() must not crash
    // when StructureMixin isn't composed at all. ---
    const UnstructuredBIOS = ExtendX.extend(BIOS, biosSecurity, { mixinId: 'noop:BIOS-unstructured' });
    const unstructured = new UnstructuredBIOS({ kernelFactory: (opts) => new Kernel(opts) });
    const unstructuredResult = await settle(() => unstructured.boot(fakePhysical(), fakeFs()));
    check("BIOS composed WITHOUT StructureMixin: boot() does not crash on BaseClassX's own native addChild", () => {
        if (!unstructuredResult.ok) throw new Error('boot() crashed: ' + unstructuredResult.error.message);
    });

    // --- dispose / sealed / unsealed ---
    bios.dispose();
    check('disarmed after dispose()', () => {
        if (bios._securityArmed()) throw new Error('still armed');
    });
    const postDisposeResult = await settle(() => bios.boot(fakePhysical(), fakeFs()));
    check('boot() after dispose() is blocked, not falling through', () => {
        if (postDisposeResult.ok) throw new Error('expected boot() to be blocked, it resolved instead');
    });

    const { unsealed, sealed } = sealedAndUnsealed(SecuredBIOS, { kernelFactory: (opts) => new SecuredKernel(opts) }, seal);
    expectThrows('locked: disableLayer refuses the security mixin', () => {
        unsealed.disableLayer(SecuredBIOS._rawMixins[0]);
    });
    check('sealed', () => { if (!isSealed(sealed)) throw new Error('not sealed'); });
    expectThrows('sealed: dispose is locked', () => { sealed.dispose(); });
    const sealedBootResult = await settle(() => sealed.boot(fakePhysical(), fakeFs()));
    check('sealed: boot() still works normally', () => {
        if (!sealedBootResult.ok) throw new Error('sealed boot() failed: ' + sealedBootResult.error.message);
    });

    report();
}

run().catch((err) => {
    console.error('BIOS.security.test.js failed:', err);
    process.exitCode = 1;
});
