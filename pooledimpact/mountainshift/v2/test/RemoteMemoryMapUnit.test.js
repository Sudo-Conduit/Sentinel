// Individual-class (white-box) test: RemoteMemoryMapUnit's wire protocol
// and serveMemoryMapUnit(), using a mock in-process channel pair (no real
// WebRTC/browser -- that end-to-end proof was run separately, against a
// genuine Chromium RTCPeerConnection over werift, and is not repeated here
// since this repo carries no network/browser test dependencies). What
// this DOES verify for real: request/response correlation, timeout
// handling when a peer never replies, and that serveMemoryMapUnit()
// correctly drives a REAL local MemoryMapUnit's real memorymap.wasm calls.
// Run with: node test/RemoteMemoryMapUnit.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const V2 = path.join(__dirname, '..');
const { SecuredMemoryMapUnit } = require(path.join(V2, 'MemoryMapUnit.js'));
const { SecuredRemoteMemoryMapUnit, serveMemoryMapUnit } = require(path.join(V2, 'RemoteMemoryMapUnit.js'));
const { check, expectThrows, report } = require('./helpers.js');

const MM_WASM_PATH = '/root/.claude/uploads/caf0539a-e301-5228-9f88-56fca1941689/6033abf4-memorymap.wasm';

// Two objects standing in for the two ends of a real DataChannel: whatever
// side A .send()s is delivered to side B's registered listeners, and vice
// versa -- same message-event shape (a plain string payload) a real
// RTCDataChannel/werift channel would deliver, just without any network.
function createMockChannelPair() {
    const listenersA = [];
    const listenersB = [];
    const sideA = {
        send(data) { setImmediate(() => listenersB.forEach((fn) => fn(data))); },
        addEventListener(type, fn) { if (type === 'message') listenersA.push(fn); }
    };
    const sideB = {
        send(data) { setImmediate(() => listenersA.forEach((fn) => fn(data))); },
        addEventListener(type, fn) { if (type === 'message') listenersB.push(fn); }
    };
    return { sideA, sideB };
}

// A channel that never delivers anything -- for the timeout test.
function createSilentChannel() {
    return { send() {}, addEventListener() {} };
}

async function main() {
    const memoryPages = 4096;
    const memory = new WebAssembly.Memory({ initial: memoryPages, maximum: memoryPages, shared: true });
    const bytes = fs.readFileSync(MM_WASM_PATH);
    const result = await WebAssembly.instantiate(bytes, { env: { memory: memory } });
    const mm = result.instance.exports;
    const initResult = mm.mm_init(memoryPages * 65536);
    if (initResult !== 0) throw new Error('mm_init failed: ' + initResult);

    const localUnit = new SecuredMemoryMapUnit({ mm: mm, memory: memory, name: 'unit-local', sizeMB: 8 });
    localUnit.create();

    const { sideA, sideB } = createMockChannelPair();
    serveMemoryMapUnit(localUnit, sideB);
    const remoteUnit = new SecuredRemoteMemoryMapUnit({ channel: sideA, name: 'unit-local-via-remote', timeoutMs: 2000 });

    check('readSlot() returns a real Promise', function() {
        const p = remoteUnit.readSlot(0);
        if (typeof p.then !== 'function') throw new Error('expected a thenable');
    });

    const writeRc = await remoteUnit.writeSlot(0, 77.25);
    check('writeSlot() round-trips through serveMemoryMapUnit to the real local unit', function() {
        if (writeRc !== 0) throw new Error('expected rc 0, got ' + writeRc);
    });

    const readBack = await remoteUnit.readSlot(0);
    check('readSlot() through the protocol matches what writeSlot() wrote', function() {
        if (Math.abs(readBack - 77.25) > 1e-3) throw new Error('expected 77.25, got ' + readBack);
    });

    const directRead = localUnit.readSlot(0);
    check('the local unit\'s own direct readSlot() sees the SAME value (not a protocol-only echo)', function() {
        if (Math.abs(directRead - 77.25) > 1e-3) throw new Error('expected 77.25, got ' + directRead);
    });

    // ─── Federation: linkTo works identically for a remote unit ────────
    localUnit.linkTo(remoteUnit._extId, 'federated-with');
    check('linkTo() federates a remote unit into the local relational graph', function() {
        const connected = localUnit.getConnected();
        if (!connected.includes(remoteUnit._extId)) throw new Error('expected ' + remoteUnit._extId + ' in ' + JSON.stringify(connected));
    });

    // ─── Real timeout: a channel that never replies must reject, not hang ──
    // Run and resolved BEFORE report() -- report() unconditionally sets
    // process.exitCode from its own sync-only counter, so an async failure
    // recorded after it would get silently clobbered back to 0 whenever
    // every sync check passed.
    const label = 'readSlot() against an unresponsive peer rejects on timeout, not hangs forever';
    const hungUnit = new SecuredRemoteMemoryMapUnit({ channel: createSilentChannel(), name: 'unhearing-peer', timeoutMs: 200 });
    let asyncTimeoutCheckFailed = false;
    try {
        await hungUnit.readSlot(0);
        console.log('FAIL: ' + label + ' -- expected rejection, promise resolved instead');
        asyncTimeoutCheckFailed = true;
    } catch (e) {
        console.log('PASS: ' + label + ' (rejected: ' + e.message.slice(0, 60) + '...)');
    }

    report();
    if (asyncTimeoutCheckFailed) process.exitCode = 1;
}

main().catch(function(e) {
    console.error('FATAL', e);
    process.exitCode = 1;
});
