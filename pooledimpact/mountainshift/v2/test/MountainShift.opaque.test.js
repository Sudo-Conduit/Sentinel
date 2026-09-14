// BLACK-BOX-SHAPED test (E.1, MSOS Cleanup Roadmap): MountainShift.js's
// opaque closure factory. This is the FIRST test in this codebase that
// does not require() BIOS/Kernel/CPU internals directly to prove the boot
// chain works -- it goes through the same single MountainShift(options)
// entry point a real caller (or a future black-box E.2 tier) would use.
// The one exception -- options.onBoot -- is a deliberate, documented
// test-only escape hatch (see MountainShift.js's header comment): it is
// supplied BY this test to ITS OWN MountainShift() call and never
// reachable from the returned opaque object itself, so using it here does
// not contradict the black-box claim about the returned object's surface.
//
// NOTE: helpers.js's check() only catches SYNCHRONOUS throws -- every
// async outcome below is awaited to a settled value first.
//
// Run with: node test/MountainShift.opaque.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const MountainShift = require(path.join(V2, 'MountainShift.js'));
const { check, report } = require('./helpers.js');

const CONFIRMED_ENTRY = { surface: 'idb', id: 'root', removable: false, path: '/EFI/BOOT/BOOTX64.EFI', confirmed: true };

function fakeFs(entry) {
    return { findBootEntry: async () => entry || null };
}

// Mirrors BIOS.security.test.js's settle() -- some of what we're testing
// (a frozen/trapped Proxy under 'use strict') throws SYNCHRONOUSLY on the
// assignment expression itself, not via a rejected promise.
function settleSync(fn) {
    try {
        fn();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e };
    }
}

async function run() {
    const os = MountainShift({ fs: fakeFs(CONFIRMED_ENTRY) });

    // --- surface: ONLY run() exists, by every introspection mechanism a
    // curious page script could reach for ---
    check('Object.keys() reports exactly ["run"]', () => {
        const keys = Object.keys(os);
        if (keys.length !== 1 || keys[0] !== 'run') throw new Error('expected ["run"], got ' + JSON.stringify(keys));
    });
    check('Reflect.ownKeys() reports exactly ["run"]', () => {
        const keys = Reflect.ownKeys(os);
        if (keys.length !== 1 || keys[0] !== 'run') throw new Error('expected ["run"], got ' + JSON.stringify(keys));
    });
    check('typeof os.run === "function", nothing else is even undefined-but-present', () => {
        if (typeof os.run !== 'function') throw new Error('run is not a function');
        if (os.registry !== undefined || os.bios !== undefined || os.kernel !== undefined || os.physical !== undefined) {
            throw new Error('an internal instance leaked onto the returned object');
        }
    });
    check('Object.getPrototypeOf(os) is null -- no inherited Object.prototype methods at all', () => {
        if (Object.getPrototypeOf(os) !== null) throw new Error('expected a null prototype');
        if (os.toString !== undefined) throw new Error('toString should not exist (inherited from Object.prototype)');
        if (os.constructor !== undefined) throw new Error('constructor should not exist (inherited from Object.prototype)');
        if (os.hasOwnProperty !== undefined) throw new Error('hasOwnProperty should not exist (inherited from Object.prototype)');
    });
    check('os is not an instanceof Object', () => {
        if (os instanceof Object) throw new Error('expected instanceof Object to be false for a null-prototype object');
    });
    check('JSON.stringify(os) is "{}" -- run is a function, which JSON.stringify always omits', () => {
        if (JSON.stringify(os) !== '{}') throw new Error('expected "{}", got ' + JSON.stringify(os));
    });

    // --- tamper resistance: every mutation attempt is rejected exactly
    // like a genuinely frozen object would reject it -- no special
    // "you have been detected" signal, no successful mutation either ---
    check('assigning a new property throws under strict mode (this file is strict) and does not add it', () => {
        const result = settleSync(() => { os.injected = 'evil'; });
        if (result.ok) throw new Error('expected the assignment to throw under strict mode');
        if (os.injected !== undefined) throw new Error('the property was added despite the throw');
    });
    check('deleting run throws under strict mode and run is still callable afterward', () => {
        const result = settleSync(() => { delete os.run; });
        if (result.ok) throw new Error('expected delete to throw under strict mode');
        if (typeof os.run !== 'function') throw new Error('run is no longer callable after a failed delete attempt');
    });
    check('reassigning run itself throws and does not change it', () => {
        const originalRun = os.run;
        const result = settleSync(() => { os.run = () => 'hijacked'; });
        if (result.ok) throw new Error('expected the reassignment to throw under strict mode');
        if (os.run !== originalRun) throw new Error('run was successfully reassigned');
    });
    check("Object.setPrototypeOf() cannot change the object's prototype", () => {
        const result = settleSync(() => { Object.setPrototypeOf(os, Array.prototype); });
        if (result.ok && Object.getPrototypeOf(os) === Array.prototype) throw new Error('prototype was successfully changed');
    });

    // --- the real payoff: run() actually performs a REAL boot underneath,
    // proven via the test-only onBoot hook -- captured internals are never
    // reachable through `os` itself, only through this closure's own
    // MountainShift() call ---
    let captured = null;
    const os2 = MountainShift({
        fs: fakeFs(CONFIRMED_ENTRY),
        onBoot: (internals) => { captured = internals; }
    });
    const bootResult = await os2.run();
    check('run() resolves a capability object with ok:true on a successful boot', () => {
        if (!bootResult || bootResult.ok !== true) throw new Error('expected {ok:true, ...}, got ' + JSON.stringify(bootResult));
    });
    check('the capability object exposes EXACTLY the real entry points the Terminal actually needs, nothing else', () => {
        const keys = Object.keys(bootResult).sort();
        const expected = ['bootedFrom', 'cores', 'fork', 'getMemory', 'kill', 'ok', 'ps', 'tick'].sort();
        if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(keys));
        if (bootResult.kernel !== undefined || bootResult.bios !== undefined || bootResult.physical !== undefined || bootResult.registry !== undefined) {
            throw new Error('a raw internal instance leaked into the capability object');
        }
    });
    check('the capability object is frozen -- no new capability can be added, none can be reassigned', () => {
        const result = settleSync(() => { bootResult.evil = () => {}; });
        if (result.ok) throw new Error('expected the assignment to throw under strict mode');
        const result2 = settleSync(() => { bootResult.fork = () => 'hijacked'; });
        if (result2.ok) throw new Error('expected reassigning fork to throw under strict mode');
    });
    check('capability.fork()/ps() dispatch through the REAL secured Kernel -- a forked process is really there', () => {
        const before = bootResult.ps().length;
        bootResult.fork('test-proc', 0);
        const after = bootResult.ps();
        if (after.length !== before + 1) throw new Error('expected one more process after fork(), got ' + before + ' -> ' + after.length);
        if (!after.some((p) => p.cmd === 'test-proc')) throw new Error('forked process not found in ps()');
    });
    check('capability.kill() really removes the process via the real Kernel', () => {
        const proc = bootResult.ps().find((p) => p.cmd === 'test-proc');
        bootResult.kill(proc.pid);
        if (bootResult.ps().some((p) => p.pid === proc.pid)) throw new Error('expected the process to be gone after kill()');
    });
    check('capability.tick() runs without throwing', () => {
        bootResult.tick();
    });
    check('capability.cores is a real number matching the booted Physical', () => {
        if (typeof bootResult.cores !== 'number' || bootResult.cores < 1) throw new Error('expected a real cores count, got ' + bootResult.cores);
    });
    check('capability.getMemory() does not throw (Memory.js is not globally wired in this test environment, so null is the correct, documented result)', () => {
        const mem = bootResult.getMemory();
        if (mem !== null) throw new Error('expected null in this environment, got ' + JSON.stringify(mem));
    });
    check('onBoot captured a REAL, armed, secured Kernel -- the boot genuinely happened, this is not a lie', () => {
        if (!captured || !captured.kernel) throw new Error('onBoot did not fire with a kernel');
        if (typeof captured.kernel._securityArmed !== 'function' || !captured.kernel._securityArmed()) {
            throw new Error('the booted kernel is not a secured, armed instance');
        }
        if (captured.kernel.bootedFrom === 'none') throw new Error('expected a real bootedFrom device, got "none"');
    });
    check('os2 itself STILL exposes nothing beyond run(), even after a real boot happened underneath', () => {
        if (Object.keys(os2).length !== 1 || Object.keys(os2)[0] !== 'run') throw new Error('surface changed after boot');
        if (os2.kernel !== undefined || os2.bios !== undefined) throw new Error('post-boot internals leaked onto the returned object');
    });

    // --- idempotency: run() twice does not double-boot ---
    let bootCount = 0;
    const os3 = MountainShift({
        fs: fakeFs(CONFIRMED_ENTRY),
        onBoot: () => { bootCount++; }
    });
    const r1 = await os3.run();
    const r2 = await os3.run();
    const r3 = await os3.run();
    check('run() called three times only boots once', () => {
        if (bootCount !== 1) throw new Error('expected exactly 1 boot, got ' + bootCount);
    });
    check('run() called again returns the SAME cached capability object, not a fresh one', () => {
        if (r1 !== r2 || r2 !== r3) throw new Error('expected identical object references across repeat calls');
    });

    // --- nothing bootable (no fs/iso configured -- the Terminal's own REAL
    // deployment shape) is NOT a failure: BIOS.boot() always hands back a
    // fully working Kernel regardless of bootedFrom, confirmed live before
    // this contract was finalized. ok stays true; bootedFrom reports the
    // real status; every capability still works normally. ---
    const os4 = MountainShift({ fs: fakeFs(null) });
    const nothingBootableResult = await os4.run();
    check('nothing bootable: ok is still true, bootedFrom reports "none" -- this is NOT a failure', () => {
        if (!nothingBootableResult || nothingBootableResult.ok !== true) throw new Error('expected ok:true, got ' + JSON.stringify(nothingBootableResult));
        if (nothingBootableResult.bootedFrom !== 'none') throw new Error('expected bootedFrom "none", got ' + nothingBootableResult.bootedFrom);
    });
    check('nothing bootable: every capability still works normally on a bootedFrom:"none" Kernel', () => {
        const proc = nothingBootableResult.fork('probe', 0);
        if (!nothingBootableResult.ps().some((p) => p.pid === proc.pid)) throw new Error('fork()/ps() did not work on a bootedFrom:none kernel');
    });
    check('nothing bootable still leaves the returned object fully opaque', () => {
        if (Object.keys(os4).length !== 1 || Object.keys(os4)[0] !== 'run') throw new Error('surface changed after a bootedFrom:none boot');
    });

    // --- a GENUINE failure (something inside boot() itself throwing) DOES
    // propagate as a rejected promise -- the real failure signal this
    // codebase uses everywhere else, not a parallel {ok:false} sentinel ---
    const os5 = MountainShift({ fs: { findBootEntry: async () => { throw new Error('simulated disk read error'); } } });
    let genuineFailureError = null;
    try {
        await os5.run();
    } catch (e) {
        genuineFailureError = e;
    }
    check('a genuine failure inside boot() rejects run(), it does not resolve a fake {ok:false}', () => {
        if (!genuineFailureError) throw new Error('expected run() to reject');
        if (genuineFailureError.message !== 'simulated disk read error') throw new Error('unexpected error: ' + genuineFailureError.message);
    });

    // --- two separate MountainShift() calls are fully independent ---
    const osA = MountainShift({ fs: fakeFs(CONFIRMED_ENTRY) });
    const osB = MountainShift({ fs: fakeFs(CONFIRMED_ENTRY) });
    check('two MountainShift() calls produce independent opaque objects, not the same one', () => {
        if (osA === osB) throw new Error('expected two distinct objects');
        if (osA.run === osB.run) throw new Error('expected two distinct run closures, not a shared one');
    });

    report();
}

run().catch((err) => {
    console.error('MountainShift.opaque.test.js failed:', err);
    process.exitCode = 1;
});
