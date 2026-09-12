// Node-to-Node test: MemoryMapFS.js's shared WebAssembly.Memory really
// crosses independent Node execution contexts, not just within one
// script's straight-line reasoning about a single WASM instance.
//
// Node's worker_threads is the ONLY mechanism that actually shares live
// memory in Node -- a WebAssembly.Memory backed by a SharedArrayBuffer is
// structured-clonable across threads in the same process (verified below,
// not assumed) and both sides then read/write the SAME linear memory. A
// child_process (separate OS process) does NOT share memory this way --
// that gap is the same "today's arena is per-process memory only" limit
// already documented in Registry.js/MemoryMapArena.js/MemoryMapFS.js;
// real cross-process persistence needs a host-layer decision about what
// backs the arena (a real mmap'd file, a daemon, etc.), deliberately out
// of scope here and there alike.
//
// Two things this proves that a single-thread test cannot:
// 1. A mailbox created/written/authenticated in one thread is immediately
//    visible in a SECOND thread's INDEPENDENT WebAssembly.Instance over
//    the same shared memory -- not the same JS object, a different one.
// 2. Calling MemoryMapFS.init() a second time against an ALREADY-init'd
//    shared memory (mm_init() runs again) does not corrupt existing
//    arena data -- confirmed live, since nothing in this codebase had
//    tested a second init() against a live arena before this file.
//
// Run with: node test/MemoryMapFS.nodeToNode.test.js
'use strict';
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const V2 = path.join(__dirname, '..');

if (isMainThread) {
    const MemoryMapFS = require(path.join(V2, 'MemoryMapFS.js'));
    const { check, report } = require('./helpers.js');

    async function run() {
        const wasmBuf = await MemoryMapFS.loadWasm(path.join(V2, 'memorymap-mm.wasm'));
        const sizeBytes = 4 * 1024 * 1024;

        const mm1 = new MemoryMapFS(sizeBytes);
        await mm1.init(wasmBuf);
        const addr = mm1.create('sharedbox', 1);
        const accessKey = mm1.readMemory(addr + 48, 32);
        const authRc = mm1.auth(addr, accessKey);
        const wRc = mm1.writeSlot(addr, 3, 42.5);

        check('setup: main thread create()/auth()/writeSlot() all succeed before handing off to the worker', () => {
            if (!addr) throw new Error('create() returned a falsy address');
            if (authRc !== 0) throw new Error('expected auth rc=0, got ' + authRc);
            if (wRc !== 0) throw new Error('expected writeSlot rc=0, got ' + wRc);
        });

        const workerResult = await new Promise((resolve, reject) => {
            const worker = new Worker(__filename, {
                workerData: { wasmBuf, sizeBytes, addr, memory: mm1._memory }
            });
            worker.on('message', (msg) => {
                worker.terminate();
                resolve(msg);
            });
            worker.on('error', reject);
        });

        check('worker thread: a SECOND init() against the already-init\'d shared memory does not error', () => {
            if (!workerResult.initOk) throw new Error('worker init() failed: ' + workerResult.initError);
        });
        check('worker thread: sees the SAME base/size as main -- the shared arena, not a fresh one', () => {
            if (workerResult.base !== mm1._baseAddress) throw new Error('base mismatch: worker=' + workerResult.base + ' main=' + mm1._baseAddress);
            if (workerResult.size !== mm1._totalSize) throw new Error('size mismatch: worker=' + workerResult.size + ' main=' + mm1._totalSize);
        });
        check('worker thread: reads the value main wrote, through its OWN independent WebAssembly.Instance', () => {
            if (workerResult.readFromMain !== 42.5) throw new Error('expected 42.5, got ' + workerResult.readFromMain);
        });
        check('worker thread: sees the mailbox as already authenticated -- auth state lives in shared arena data, not per-instance JS state', () => {
            if (workerResult.statusBeforeOwnAuth !== 1) throw new Error('expected status=1 (unlocked) without the worker ever calling auth() itself, got ' + workerResult.statusBeforeOwnAuth);
        });
        check('worker thread: its own writeSlot()/readSlot() round-trip locally', () => {
            if (workerResult.writeRc !== 0) throw new Error('expected worker writeSlot rc=0, got ' + workerResult.writeRc);
            if (workerResult.ownReadback !== 99.25) throw new Error('expected 99.25, got ' + workerResult.ownReadback);
        });
        check('main thread: reads back what the WORKER wrote, after the worker exits -- real bidirectional sharing, not a one-way handoff', () => {
            const back = mm1.readSlot(addr, 7);
            if (back !== 99.25) throw new Error('expected 99.25, got ' + back);
        });

        report();
    }

    run().catch((err) => {
        console.error('MemoryMapFS.nodeToNode.test.js failed:', err);
        process.exitCode = 1;
    });
} else {
    // --- worker thread body ---
    (async () => {
        const MemoryMapFS = require(path.join(V2, 'MemoryMapFS.js'));
        const { wasmBuf, sizeBytes, addr, memory } = workerData;
        const mm2 = new MemoryMapFS(sizeBytes);
        let initOk = true;
        let initError = null;
        try {
            await mm2.init(wasmBuf, memory);
        } catch (e) {
            initOk = false;
            initError = e.message;
        }
        if (!initOk) {
            parentPort.postMessage({ initOk, initError });
            return;
        }

        const readFromMain = mm2.readSlot(addr, 3);
        const statusBeforeOwnAuth = mm2.status(addr);
        const writeRc = mm2.writeSlot(addr, 7, 99.25);
        const ownReadback = mm2.readSlot(addr, 7);

        parentPort.postMessage({
            initOk,
            base: mm2._baseAddress,
            size: mm2._totalSize,
            readFromMain,
            statusBeforeOwnAuth,
            writeRc,
            ownReadback
        });
    })();
}
