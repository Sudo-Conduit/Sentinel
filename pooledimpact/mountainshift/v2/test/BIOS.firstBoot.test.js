// Individual-class (white-box) test: BIOS.boot()'s first-boot vs.
// steady-state distinction (C.4, MSOS Cleanup Roadmap) -- against a REAL
// Registry.js instance, not a mock, matching test/BIOS.nvramFastPath.test.js's
// convention.
//
// NOTE: helpers.js's check() only catches SYNCHRONOUS throws -- every
// async outcome below is awaited to a settled value first.
//
// Run with: node test/BIOS.firstBoot.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
require(path.join(V2, 'BaseClassX.js'));
const BIOS = require(path.join(V2, 'BIOS.js'));
const Registry = require(path.join(V2, 'Registry.js'));
const { check, report } = require('./helpers.js');

function fakePhysical() {
    return { post() { this.poweredOn = true; }, poweredOn: false, getCPU: () => ({ config: { halted: false } }), ramBytes: 0x400000 };
}
function fakeFs(entry) {
    return { findBootEntry: async () => entry || null };
}

const CONFIRMED_DISK_ENTRY = { surface: 'idb', id: 'root', removable: false, path: '/EFI/BOOT/BOOTX64.EFI', confirmed: true };

async function run() {
    // --- a fresh Registry starts as an unambiguous first boot ---
    check('a fresh Registry defaults firstBootComplete to false and has no machineId yet', () => {
        const registry = new Registry();
        if (registry.get('firstBootComplete') !== false) throw new Error('expected firstBootComplete to default to false');
        if (registry.has('machineId')) throw new Error('expected no machineId before any boot');
    });

    // --- successful first boot: mints machineId, marks firstBootComplete ---
    const registry = new Registry();
    const bios = new BIOS();
    bios.attachRegistry(registry);
    await bios.boot(fakePhysical(), fakeFs(CONFIRMED_DISK_ENTRY));
    check('first successful boot: firstBootComplete becomes true', () => {
        if (registry.get('firstBootComplete') !== true) throw new Error('expected firstBootComplete to be true after a successful boot');
    });
    let firstMachineId;
    check('first successful boot: a machineId is minted', () => {
        firstMachineId = registry.get('machineId');
        if (!firstMachineId || typeof firstMachineId !== 'string') throw new Error('expected a real machineId string, got ' + JSON.stringify(firstMachineId));
    });

    // --- steady-state: a second boot on the SAME registry does not re-mint ---
    await bios.boot(fakePhysical(), fakeFs(CONFIRMED_DISK_ENTRY));
    check('steady-state boot: machineId is NOT regenerated on a later boot', () => {
        if (registry.get('machineId') !== firstMachineId) throw new Error('machineId changed across boots: ' + firstMachineId + ' -> ' + registry.get('machineId'));
    });

    // --- a FAILED first boot (nothing bootable anywhere) must not mark
    // firstBootComplete or mint a machineId -- setup did not meaningfully
    // happen, so it must be free to actually run on the next real boot ---
    const registryFailed = new Registry();
    const biosFailed = new BIOS();
    biosFailed.attachRegistry(registryFailed);
    await biosFailed.boot(fakePhysical(), fakeFs(null));
    check('a failed boot (no bootable device found) does NOT mark firstBootComplete', () => {
        if (registryFailed.get('firstBootComplete') !== false) throw new Error('expected firstBootComplete to remain false after a failed boot');
    });
    check('a failed boot does NOT mint a machineId', () => {
        if (registryFailed.has('machineId')) throw new Error('expected no machineId to be minted on a failed boot');
    });

    // --- a subsequent SUCCESSFUL boot after that failure still runs setup,
    // since the earlier failure never marked it complete ---
    await biosFailed.boot(fakePhysical(), fakeFs(CONFIRMED_DISK_ENTRY));
    check('a later successful boot, after an earlier failure, still runs first-boot setup', () => {
        if (registryFailed.get('firstBootComplete') !== true) throw new Error('expected firstBootComplete to become true once a boot actually succeeds');
        if (!registryFailed.has('machineId')) throw new Error('expected a machineId to be minted once a boot actually succeeds');
    });

    // --- no Registry attached: every boot looks like a first boot (matches
    // real hardware with no battery-backed NVRAM) -- boot() must not crash
    // trying to persist setup with nothing to persist to ---
    const biosNoRegistry = new BIOS();
    const settleNoRegistry = await (async () => {
        try {
            await biosNoRegistry.boot(fakePhysical(), fakeFs(CONFIRMED_DISK_ENTRY));
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e };
        }
    })();
    check('no Registry attached: boot() completes without crashing (first-boot setup has nowhere to persist, and that is fine)', () => {
        if (!settleNoRegistry.ok) throw new Error('boot() crashed: ' + settleNoRegistry.error.message);
    });

    // --- defensive second layer: a Registry that ALREADY has a machineId
    // but was never marked firstBootComplete (e.g. a crash between the two
    // writes) does not mint a SECOND id on the next boot ---
    const registryPartial = new Registry();
    registryPartial.set('machineId', 'pre-existing-id');
    const biosPartial = new BIOS();
    biosPartial.attachRegistry(registryPartial);
    await biosPartial.boot(fakePhysical(), fakeFs(CONFIRMED_DISK_ENTRY));
    check('a pre-existing machineId (from a partial prior run) is never overwritten', () => {
        if (registryPartial.get('machineId') !== 'pre-existing-id') throw new Error('expected the pre-existing machineId to survive, got ' + registryPartial.get('machineId'));
    });
    check('firstBootComplete still gets marked true even when machineId already existed', () => {
        if (registryPartial.get('firstBootComplete') !== true) throw new Error('expected firstBootComplete to be marked true');
    });

    report();
}

run().catch((err) => {
    console.error('BIOS.firstBoot.test.js failed:', err);
    process.exitCode = 1;
});
