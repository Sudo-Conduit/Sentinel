// Individual-class (white-box) test: BIOS.boot()'s Registry NVRAM fast
// path (C.2, MSOS Cleanup Roadmap) -- "write once, read first" against a
// REAL Registry.js instance, not a mock, since the whole point is that
// boot() reads/writes a real Registry the same way an attached one would
// in production.
//
// NOTE: helpers.js's check() only catches SYNCHRONOUS throws -- every
// async outcome below is awaited to a settled value first.
//
// Run with: node test/BIOS.nvramFastPath.test.js
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

// Records every device queried, in order, and answers per a caller-supplied
// map -- lets each check assert exactly which devices boot() actually
// tried, which is the only real way to prove a "fast path" skipped the
// full scan rather than just happening to find the same answer.
function spyFs(answers) {
    const calls = [];
    return {
        calls,
        findBootEntry: async (device) => {
            calls.push(device);
            return answers[device] || null;
        }
    };
}

const CONFIRMED_DISK_ENTRY = { surface: 'idb', id: 'root', removable: false, path: '/EFI/BOOT/BOOTX64.EFI', confirmed: true };
const CONFIRMED_NETWORK_ENTRY = { surface: 'net', id: 'pxe', removable: false, path: '/pxe/boot', confirmed: true };

async function run() {
    // --- no registry attached: unaffected, full scan every time ---
    const biosNoRegistry = new BIOS();
    const fs1 = spyFs({ disk: CONFIRMED_DISK_ENTRY });
    await biosNoRegistry.boot(fakePhysical(), fs1);
    check('no Registry attached: boot() still performs the full scan (esp before disk)', () => {
        if (fs1.calls.join(',') !== 'esp,disk') throw new Error('unexpected call order: ' + fs1.calls.join(','));
    });

    // --- registry attached, empty: first boot does a full scan and then
    // WRITES a confirmed entry back for next time ---
    const registry = new Registry({ entries: { bootDeviceOrder: ['esp', 'disk', 'network'], firmwareType: 'UEFI' } });
    const bios = new BIOS();
    bios.attachRegistry(registry);
    const fs2 = spyFs({ disk: CONFIRMED_DISK_ENTRY });
    await bios.boot(fakePhysical(), fs2);
    check('first boot with an empty Registry: full scan happens (no confirmed entry to try yet)', () => {
        if (fs2.calls.join(',') !== 'esp,disk') throw new Error('unexpected call order: ' + fs2.calls.join(','));
    });
    check('first boot: a CONFIRMED entry is written back to the Registry afterward', () => {
        const saved = registry.get('confirmedBootEntry');
        if (!saved || saved.device !== 'disk' || saved.entry.path !== CONFIRMED_DISK_ENTRY.path) {
            throw new Error('expected a confirmed disk entry to be persisted, got ' + JSON.stringify(saved));
        }
    });

    // --- second boot, same registry: fast path tries ONLY the confirmed
    // device, never re-scanning esp first ---
    const fs3 = spyFs({ disk: CONFIRMED_DISK_ENTRY });
    await bios.boot(fakePhysical(), fs3);
    check('second boot: fast path tries ONLY the confirmed device -- esp is never queried', () => {
        if (fs3.calls.join(',') !== 'disk') throw new Error('unexpected call order: ' + fs3.calls.join(',') + ' -- fast path did not skip the full scan');
    });

    // --- fast path miss: the confirmed device no longer confirms (media
    // removed/corrupted) -- falls through to the full scan and re-persists
    // whatever the full scan finds ---
    const fs4 = spyFs({ network: CONFIRMED_NETWORK_ENTRY }); // disk no longer answers
    await bios.boot(fakePhysical(), fs4);
    check('fast-path miss: tries the stale confirmed device first (disk), then falls through to the full scan', () => {
        if (fs4.calls.join(',') !== 'disk,esp,disk,network') throw new Error('unexpected call order: ' + fs4.calls.join(','));
    });
    check('fast-path miss: the Registry record is updated to the NEW confirmed device', () => {
        const saved = registry.get('confirmedBootEntry');
        if (!saved || saved.device !== 'network') throw new Error('expected the record to move to network, got ' + JSON.stringify(saved));
    });

    // --- bootDeviceOrder policy override: the confirmed device (network)
    // is no longer in bootDeviceOrder at all -- the fast path must not
    // even be attempted, so removing a device from policy actually takes
    // effect instead of being bypassed by a stale cached record ---
    registry.set('bootDeviceOrder', ['esp', 'disk']); // network removed
    const biosPolicy = new BIOS();
    biosPolicy.attachRegistry(registry); // re-reads bootDeviceOrder from the registry
    const fs5 = spyFs({ disk: CONFIRMED_DISK_ENTRY }); // no network answer at all
    await biosPolicy.boot(fakePhysical(), fs5);
    check('policy override: a confirmed device no longer in bootDeviceOrder is never queried by the fast path', () => {
        if (fs5.calls.includes('network')) throw new Error('fast path queried a device outside current bootDeviceOrder policy: ' + fs5.calls.join(','));
        if (fs5.calls.join(',') !== 'esp,disk') throw new Error('unexpected call order: ' + fs5.calls.join(','));
    });

    // --- unconfirmed raw BootDeviceScan fallback hit must NEVER be cached
    // as a confirmed entry -- it doesn't carry the real {confirmed:true}
    // verification a real fs adapter produces ---
    const registry2 = new Registry({ entries: { bootDeviceOrder: ['esp', 'disk', 'network'] } });
    global.BootDeviceScan = { scanAll: async () => [{ surface: 'idb', id: 'root' }] }; // no `confirmed` field
    const biosRaw = new BIOS();
    biosRaw.attachRegistry(registry2);
    await biosRaw.boot(fakePhysical(), undefined); // no fs adapter at all -- forces the raw BootDeviceScan fallback
    delete global.BootDeviceScan;
    check('an unconfirmed raw BootDeviceScan hit is never persisted as a confirmed NVRAM entry', () => {
        const saved = registry2.get('confirmedBootEntry');
        if (saved !== undefined) throw new Error('expected no confirmed entry to be cached, got ' + JSON.stringify(saved));
    });

    report();
}

run().catch((err) => {
    console.error('BIOS.nvramFastPath.test.js failed:', err);
    process.exitCode = 1;
});
