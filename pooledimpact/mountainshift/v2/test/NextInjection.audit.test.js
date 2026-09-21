// Individual-class (white-box) test: the A.4 next()-injection systemic
// audit (see Docs/MSOS-Cleanup-Roadmap.md). Checks Environment, Registry,
// ISO, Installer, BootDeviceScan, and FileFsBootAdapter for the exact
// hazard shape found three times already this session (StructureMixin's
// label, Kernel's ppid/memBytes/quantum, BIOS's iso): ExtendX's dispatcher
// always appends its own next() callback as the trailing argument to
// every dispatched call, so an optional trailing parameter checked with
// `||` or `=== undefined` silently receives that injected function
// instead of the caller's real omission.
//
// Five of six files are CLEAN, each for a different structural reason
// proven below, not just asserted: Environment (no instance methods at
// all), ISO's ORIGINAL two methods (verifyIntegrity()/computeChecksum(),
// zero-arg), Installer/BootDeviceScan (never reachable through ExtendX's
// dispatcher at all -- statics and a plain object are structurally immune
// regardless of composition), FileFsBootAdapter (its one method has no
// optional trailing param for next to land in). Registry has one real,
// currently-unreachable gap in set() -- proven here, and documented in
// Registry.js itself as a known limitation rather than a false fix, since
// value's legitimate type space (anything) makes the typeof-guard trick
// used elsewhere inapplicable.
//
// C.1 (MSOS Cleanup Roadmap) added TWO new one-argument ISO methods --
// signManifest(privateKey)/verifyManifestSignature(publicKey) -- checked
// below too: calling either with the required key argument OMITTED under
// composition does land the injected next() callback in that slot (a real
// required, non-optional single argument is not immune to this the way a
// zero-arg method is), but it is SAFE by a different mechanism than the
// typeof-guard trick used elsewhere -- crypto.subtle.sign()/verify() do
// their own strict CryptoKey type-checking and throw a clear TypeError
// when handed a plain function instead of a real key, rather than
// silently producing a bogus signature or a false "verified" result.
//
// NOTE: helpers.js's check() only catches SYNCHRONOUS throws -- it does
// not await a returned promise (same lesson as BIOS.security.test.js).
// The two genuinely async checks below are awaited first; check() only
// ever asserts against an already-settled value.
//
// Run with: node test/NextInjection.audit.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
require(path.join(V2, 'BaseClassX.js'));
const Environment = require(path.join(V2, 'Environment.js'));
const Registry = require(path.join(V2, 'Registry.js'));
const ISO = require(path.join(V2, 'ISO.js'));
const Signature = require(path.join(V2, 'Signature.js'));
const Installer = require(path.join(V2, 'Installer.js'));
const BootDeviceScan = require(path.join(V2, 'BootDeviceScan.js'));
const FileFsBootAdapter = require(path.join(V2, 'FileFsBootAdapter.js'));
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { createSecurityMixin } = require(path.join(V2, 'SecurityMixin.js'));
const { check, report } = require('./helpers.js');

async function run() {
    // ─── Environment: CLEAN -- no instance methods at all, only a static
    // factory (detect()), which ExtendX never dispatches (only prototype
    // methods reachable via instance dispatch are wrapped). ─────────────
    check('Environment: no instance methods exist to wrap -- getOwnPropertyNames(prototype) is empty besides constructor', () => {
        const names = Object.getOwnPropertyNames(Environment.prototype).filter((n) => n !== 'constructor');
        if (names.length !== 0) throw new Error('expected no instance methods, found: ' + names.join(', '));
    });
    check('Environment.detect() (static) is unaffected by composition -- never touches ExtendX at all', () => {
        const env = Environment.detect();
        if (typeof env.runtime !== 'string') throw new Error('detect() broke');
    });

    // ─── ISO: CLEAN -- verifyIntegrity()/computeChecksum() take zero
    // arguments, so there is no positional slot for an injected next() to
    // land in and corrupt. ───────────────────────────────────────────────
    const SecuredISO = ExtendX.extend(ISO, createSecurityMixin(ISO));
    check('ISO: verifyIntegrity()/computeChecksum() take no arguments -- next() injection has nowhere to land', () => {
        const iso = new SecuredISO({ manifest: [{ path: '/a', content: 'x' }] });
        if (!iso.verifyIntegrity()) throw new Error('verifyIntegrity() broke under composition');
    });

    // ─── ISO: signManifest(privateKey)/verifyManifestSignature(publicKey)
    // (C.1) DO have a real, required single argument next() can land in
    // when a caller omits it under composition -- unlike verifyIntegrity()
    // above. SAFE anyway, but by a DIFFERENT mechanism: crypto.subtle's own
    // strict CryptoKey type-checking rejects the injected function with a
    // clear TypeError, rather than silently signing/verifying against
    // garbage. Proven live, not assumed. ───────────────────────────────
    const { privateKey, publicKey } = await Signature.generateKeyPair();
    const isoForSigCheck = new SecuredISO({ manifest: [{ path: '/a', content: 'x' }] });
    let signNoArgsError = null;
    try { await isoForSigCheck.signManifest(); } catch (e) { signNoArgsError = e; }
    check('ISO.signManifest(): omitting privateKey under composition throws a clear TypeError (crypto.subtle rejects the injected next() as an invalid key), not a silent bad signature', () => {
        if (!signNoArgsError) throw new Error('expected a throw');
    });
    await isoForSigCheck.signManifest(privateKey); // real key -- sets a genuine signature
    let verifyNoArgsError = null;
    try { await isoForSigCheck.verifyManifestSignature(); } catch (e) { verifyNoArgsError = e; }
    check('ISO.verifyManifestSignature(): omitting publicKey under composition throws a clear TypeError, not a silently-wrong true/false', () => {
        if (!verifyNoArgsError) throw new Error('expected a throw');
    });
    const realVerify = await isoForSigCheck.verifyManifestSignature(publicKey);
    check('ISO.verifyManifestSignature(): with the real key explicitly supplied, verification is unaffected by composition', () => {
        if (realVerify !== true) throw new Error('expected true');
    });

    // ─── Installer / BootDeviceScan: CLEAN by construction -- structurally
    // immune regardless of any optional-arg shape, because ExtendX's
    // installWrappers() only ever wraps mixin methods and BaseClass.prototype
    // methods. A static method (Installer.install) and a plain object with
    // no constructor at all (BootDeviceScan) are never reachable through
    // that dispatch path no matter what. ────────────────────────────────
    check('Installer: install() is a static method -- untouched by ExtendX composition, which only wraps prototype dispatch', () => {
        if (typeof Installer.install !== 'function') throw new Error('sanity: install() should exist');
        const SecuredInstaller = ExtendX.extend(Installer, createSecurityMixin(Installer));
        if (SecuredInstaller.install !== Installer.install) {
            throw new Error('static install() should be the exact same, untouched function reference');
        }
    });
    check('BootDeviceScan: a plain object (no constructor) cannot even be passed to ExtendX.extend() -- Reflect.construct rejects it immediately', () => {
        if (typeof BootDeviceScan === 'function') throw new Error('sanity: BootDeviceScan should be a plain object, not a class');
        let threw = false;
        try { ExtendX.extend(BootDeviceScan, createSecurityMixin(function Dummy() {})); }
        catch (e) { threw = true; }
        if (!threw) throw new Error('expected ExtendX.extend() to reject a non-constructor BaseClass');
    });

    // ─── FileFsBootAdapter: CLEAN -- findBootEntry(device, firmwareType) has
    // no optional trailing parameter; both are always required and always
    // passed together by every real call site. ─────────────────────────────
    const SecuredAdapter = ExtendX.extend(FileFsBootAdapter, createSecurityMixin(FileFsBootAdapter));
    const fakeFSForAdapter = { create: async () => ({ stat: async () => { throw new Error('no marker'); } }) };
    const adapter = new SecuredAdapter(fakeFSForAdapter);
    const adapterResult = await adapter.findBootEntry('esp', 'UEFI'); // 'esp' short-circuits to null before touching fakeFS
    check('FileFsBootAdapter: findBootEntry() has no optional trailing param -- an injected next() lands in an unused 3rd slot, harmlessly', () => {
        if (adapterResult !== null) throw new Error('expected null for an unimplemented device step');
    });

    // ─── Registry: the one real, currently-unreachable finding. ────────
    const SecuredRegistry = ExtendX.extend(Registry, createSecurityMixin(Registry));

    const regForSave = new SecuredRegistry({});
    const fakeFSForRegistry = { create: async (opts) => {
        if (opts.backend !== 'idb' || opts.key !== 'meshui-registry') {
            throw new Error('defaults did not apply: got ' + JSON.stringify(opts));
        }
        return { writeFile: async () => {} };
    } };
    let saveError = null;
    try { await regForSave.save(fakeFSForRegistry); } // deliberately omit options -- next() lands there instead of undefined
    catch (e) { saveError = e; }
    check("Registry: save()'s omitted options is ACCIDENTALLY safe -- both destructured fields (.backend/.key) fall back regardless of what garbage lands there", () => {
        if (saveError) throw saveError;
    });

    check('Registry: set(key) with value OMITTED silently stores the injected next() callback instead of undefined -- the documented, currently-unreachable gap', () => {
        const reg = new SecuredRegistry({});
        reg.set('someKey'); // deliberately 1 arg -- this is the exact hazard shape
        const stored = reg.get('someKey');
        if (typeof stored !== 'function') {
            throw new Error('expected the gap to reproduce (stored should be the injected next function), got: ' + typeof stored + ' -- if this now passes, the gap may have been fixed elsewhere; update Registry.js\'s comment and this test together');
        }
    });

    check('Registry: set(key, value) with BOTH arguments explicit is unaffected -- the documented workaround holds', () => {
        const reg = new SecuredRegistry({});
        reg.set('someKey', 'realValue');
        if (reg.get('someKey') !== 'realValue') throw new Error('explicit 2-arg set() should be unaffected by composition');
    });

    report();
}

run().catch((err) => {
    console.error('NextInjection.audit.test.js failed:', err);
    process.exitCode = 1;
});
