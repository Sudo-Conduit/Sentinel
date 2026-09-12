// Individual-class (white-box) test: MemoryMapArena.js (D.1, MSOS Cleanup
// Roadmap) against the REAL compiled memorymap.wasm, and Registry.js's
// saveToArena()/loadFromArena() built on top of it.
//
// Full life-cycle proof, not just a happy path: init -> auth (correct and
// wrong key) -> raw slot read/write -> byte packing round-trip (including
// multi-byte UTF-8) -> Registry round-trip through the arena -> the
// pre-authenticate gating a real capability-gated arena should enforce.
//
// Run with: node test/MemoryMapArena.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const MemoryMapArena = require(path.join(V2, 'MemoryMapArena.js'));
require(path.join(V2, 'BaseClassX.js'));
const Registry = require(path.join(V2, 'Registry.js'));
const { check, expectThrows, report } = require('./helpers.js');

async function run() {
    const wasmBuf = await MemoryMapArena.loadWasm(path.join(V2, 'memorymap.wasm'));

    // --- basic life cycle ---
    const arena = new MemoryMapArena();
    await arena.init(wasmBuf);
    check('init(): maxSlots() reports a real, positive slot count', () => {
        if (typeof arena.maxSlots() !== 'number' || arena.maxSlots() <= 0) throw new Error('maxSlots() did not report a real arena size');
    });

    // --- authentication gating ---
    const preAuthArena = new MemoryMapArena();
    await preAuthArena.init(wasmBuf);
    check('writeSlot() before authenticate() is rejected (nonzero rc)', () => {
        const rc = preAuthArena.writeSlot(0, 1.0);
        if (rc === 0) throw new Error('expected a pre-auth write to be rejected, it succeeded');
    });

    arena.provisionKey('correct-horse-battery-staple');
    check('authenticate() with the WRONG key is rejected', () => {
        if (arena.authenticate('totally-wrong-key') !== false) throw new Error('wrong key should not authenticate');
    });
    check('authenticate() with the CORRECT key succeeds', () => {
        if (arena.authenticate('correct-horse-battery-staple') !== true) throw new Error('correct key should authenticate');
    });
    check('writeSlot()/readSlot() work once authenticated', () => {
        const rc = arena.writeSlot(3, 99.5);
        if (rc !== 0) throw new Error('expected writeSlot rc=0, got ' + rc);
        if (arena.readSlot(3) !== 99.5) throw new Error('readback mismatch');
    });

    // --- byte packing round-trip, including multi-byte UTF-8 ---
    check('packBytes()/unpackBytes(): plain ASCII round-trips exactly', () => {
        const payload = new TextEncoder().encode('hello, arena');
        arena.packBytes(20, payload);
        const back = arena.unpackBytes(20);
        if (new TextDecoder().decode(back) !== 'hello, arena') throw new Error('ASCII round-trip failed');
    });
    check('packBytes()/unpackBytes(): multi-byte UTF-8 (emoji) round-trips exactly', () => {
        const text = 'MSOS NVRAM 🚀 — capability-gated, not filesystem-gated';
        const payload = new TextEncoder().encode(text);
        arena.packBytes(50, payload);
        const back = arena.unpackBytes(50);
        if (new TextDecoder().decode(back) !== text) throw new Error('UTF-8 round-trip failed');
    });
    check('packBytes()/unpackBytes(): byte length not a multiple of 3 (the padding edge case) round-trips exactly', () => {
        const payload = new Uint8Array([1, 2, 3, 4]); // 4 bytes -> 2 groups, second group padded
        arena.packBytes(90, payload);
        const back = arena.unpackBytes(90);
        if (back.length !== 4 || back[0] !== 1 || back[1] !== 2 || back[2] !== 3 || back[3] !== 4) {
            throw new Error('non-multiple-of-3 round-trip failed: ' + Array.from(back).join(','));
        }
    });

    // --- Registry NVRAM round-trip through the arena ---
    const registry = new Registry({ entries: { bootDeviceOrder: ['esp', 'disk', 'network'], firmwareType: 'UEFI', secureBoot: true, note: 'saved via arena 🎉' } });
    check('Registry.saveToArena()/loadFromArena(): full round-trip preserves every entry exactly', () => {
        registry.saveToArena(arena, 200);
        const loaded = Registry.loadFromArena(arena, 200);
        if (JSON.stringify(loaded.entries) !== JSON.stringify(registry.entries)) {
            throw new Error('round-trip mismatch: ' + JSON.stringify(loaded.entries) + ' !== ' + JSON.stringify(registry.entries));
        }
    });
    check('Registry.loadFromArena(): reading an untouched slot range falls back to a fresh default Registry, not a crash', () => {
        const empty = Registry.loadFromArena(arena, 5000);
        if (!empty.has('bootDeviceOrder')) throw new Error('expected the default Registry entries, got something else');
    });
    check('Registry.saveToArena() is blocked before authenticate() the same way raw writeSlot() is', () => {
        const unauthedArena = preAuthArena; // never successfully authenticated above
        const reg = new Registry({ entries: { x: 1 } });
        let threw = false;
        try { reg.saveToArena(unauthedArena, 0); } catch (e) { threw = true; }
        if (!threw) throw new Error('expected saveToArena() to throw when the underlying arena is not authenticated');
    });

    // --- deauthenticate() actually revokes ---
    arena.deauthenticate();
    check('deauthenticate() actually revokes write access', () => {
        const rc = arena.writeSlot(3, 1.0);
        if (rc === 0) throw new Error('expected writeSlot to be rejected after deauthenticate()');
    });

    report();
}

run().catch((err) => {
    console.error('MemoryMapArena.test.js failed:', err);
    process.exitCode = 1;
});
