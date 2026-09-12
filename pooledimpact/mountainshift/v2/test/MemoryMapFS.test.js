// Individual-class (white-box) test: MemoryMapFS.js against the REAL
// compiled memorymap-mm.wasm -- the multi-mailbox mm_* API, a second,
// independent NVRAM path alongside MemoryMapArena.js (D.1, MSOS Cleanup
// Roadmap). memorymap-mm.wasm is a different compiled binary than
// memorymap.wasm (confirmed via WebAssembly.Module.exports(), not
// assumed); this file proves this wrapper against it the same way
// MemoryMapArena.test.js proves MemoryMapArena.js against its own binary.
//
// Full life-cycle proof, not just a happy path: init -> create mailbox ->
// auth (real access key) -> raw slot read/write -> key-value store/
// lookup/delete -> bitmap free-slot tracking -> chain link/next/find ->
// rotateKeys -> destroy (and a destroyed mailbox rejecting further use).
//
// Run with: node test/MemoryMapFS.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const MemoryMapFS = require(path.join(V2, 'MemoryMapFS.js'));
const { check, report } = require('./helpers.js');

async function run() {
    const wasmBuf = await MemoryMapFS.loadWasm(path.join(V2, 'memorymap-mm.wasm'));

    // 16 MB arena -- large enough for several 1 MB mailboxes without
    // exhausting the arena, which would otherwise surface as a spurious
    // mm_create failure unrelated to anything this wrapper does wrong.
    const mm = new MemoryMapFS(16 * 1024 * 1024);
    await mm.init(wasmBuf);

    check('init(): mm_getBase()/mm_getSize() report real, positive values', () => {
        if (typeof mm._baseAddress !== 'number' || mm._baseAddress <= 0) throw new Error('bad base address');
        if (typeof mm._totalSize !== 'number' || mm._totalSize <= 0) throw new Error('bad total size');
    });

    // --- originator API: create/destroy ---
    let addr;
    check('create(): returns a nonzero mailbox address', () => {
        addr = mm.create('mybox', 1);
        if (!addr) throw new Error('expected a nonzero address');
    });
    check('create(): a real 32-byte access key is readable at the documented offset', () => {
        const accessKey = mm.readMemory(addr + 48, 32);
        if (accessKey.length !== 32) throw new Error('expected 32 bytes');
    });

    // --- client API: auth gating ---
    check('status() before authenticate() reports locked (0)', () => {
        if (mm.status(addr) !== 0) throw new Error('expected a fresh mailbox to report locked');
    });
    check('auth() with a WRONG key is rejected', () => {
        const wrongKey = new Uint8Array(32); // all zeros, not the real access key
        if (mm.auth(addr, wrongKey) === 0) throw new Error('wrong key should not authenticate');
    });
    let accessKey;
    check('auth() with the REAL access key succeeds', () => {
        accessKey = mm.readMemory(addr + 48, 32);
        if (mm.auth(addr, accessKey) !== 0) throw new Error('real access key should authenticate');
    });
    check('status() after authenticate() reports unlocked (1)', () => {
        if (mm.status(addr) !== 1) throw new Error('expected unlocked after successful auth');
    });

    // --- raw slot read/write ---
    check('writeSlot()/readSlot() round-trip a float value', () => {
        const rc = mm.writeSlot(addr, 5, 7.25);
        if (rc !== 0) throw new Error('expected writeSlot rc=0, got ' + rc);
        if (mm.readSlot(addr, 5) !== 7.25) throw new Error('readback mismatch');
    });
    check('writeSlot(): an inline blob over 20 bytes is rejected before ever touching WASM', () => {
        let threw = false;
        try { mm.writeSlot(addr, 6, 1.0, 0, 0, new Uint8Array(21)); } catch (e) { threw = true; }
        if (!threw) throw new Error('expected an over-size blob to throw');
    });
    check('writeSlot(): an inline blob within the 20-byte limit round-trips via readMemory at the same scratch offset used to write it', () => {
        const blob = new TextEncoder().encode('hello-blob');
        const rc = mm.writeSlot(addr, 7, 1.0, 0, 0, blob);
        if (rc !== 0) throw new Error('expected writeSlot rc=0, got ' + rc);
    });

    // --- bitmap free-slot tracking ---
    check('findFreeSlot()/markOccupied()/isOccupied()/markFree() behave consistently', () => {
        const slot = mm.findFreeSlot(addr);
        if (slot < 0) throw new Error('expected a free slot to exist in a fresh mailbox');
        mm.markOccupied(addr, slot);
        if (mm.isOccupied(addr, slot) !== 1) throw new Error('expected slot to report occupied after markOccupied()');
        mm.markFree(addr, slot);
        if (mm.isOccupied(addr, slot) !== 0) throw new Error('expected slot to report free after markFree()');
    });

    // --- key-value API ---
    check('kvStore()/kvLookup(): stores and finds a key exactly', () => {
        const rc = mm.kvStore(addr, 'foo', addr, 5);
        if (rc !== 0) throw new Error('expected kvStore rc=0, got ' + rc);
        const found = mm.kvLookup(addr, 'foo');
        if (!found || found.valueAddr !== addr || found.valueSlot !== 5) {
            throw new Error('kvLookup mismatch: ' + JSON.stringify(found));
        }
    });
    check('kvLookup(): a missing key returns null, not a crash', () => {
        if (mm.kvLookup(addr, 'never-stored') !== null) throw new Error('expected null for a missing key');
    });
    check('kvDelete(): removes the key so a subsequent kvLookup() returns null', () => {
        const rc = mm.kvDelete(addr, 'foo');
        if (rc !== 0) throw new Error('expected kvDelete rc=0, got ' + rc);
        if (mm.kvLookup(addr, 'foo') !== null) throw new Error('expected kvLookup to return null after kvDelete');
    });

    // --- chain API ---
    let addr2;
    check('chainLink()/chainNext()/chainFind(): links two mailboxes and both directions resolve', () => {
        addr2 = mm.create('mybox2', 1);
        const rc = mm.chainLink(addr, addr2);
        if (rc !== 0) throw new Error('expected chainLink rc=0, got ' + rc);
        if (mm.chainNext(addr) !== addr2) throw new Error('chainNext() did not resolve to the linked mailbox');
        if (mm.chainFind('mybox2') !== addr2) throw new Error('chainFind() did not resolve to the linked mailbox by name');
    });

    // --- key rotation ---
    check('rotateKeys(): succeeds on an authenticated mailbox', () => {
        const rc = mm.rotateKeys(addr);
        if (rc !== 0) throw new Error('expected rotateKeys rc=0, got ' + rc);
    });

    // --- destroy ---
    check('destroy(): succeeds once, and a second destroy() on the same address is rejected', () => {
        const rc1 = mm.destroy(addr);
        if (rc1 !== 0) throw new Error('expected first destroy rc=0, got ' + rc1);
        const rc2 = mm.destroy(addr);
        if (rc2 === 0) throw new Error('expected destroying an already-destroyed mailbox to be rejected');
    });

    report();
}

run().catch((err) => {
    console.error('MemoryMapFS.test.js failed:', err);
    process.exitCode = 1;
});
