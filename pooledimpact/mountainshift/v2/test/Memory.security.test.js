// Individual-class (white-box) test: SecurityMixin + StructureMixin
// composed onto Memory, a BaseClassX subclass with its own runtime handle
// table (_backing, keyed by this.id -- the same WeakMap-by-`this` bug
// class as Physical._cpus/Kernel._host) and two optional/conditional
// arguments (attach's cpu, alloc's label) that are exactly the shape
// ExtendX's dispatcher-injected next() callback can corrupt.
//
// Scope note (B.6): this only hardens Memory.js itself, the same pass
// CPU/Physical/Kernel/BIOS already got. How Memory is actually USED
// (Kernel.attach's call pattern, Physical's relationship to it) is
// deliberately NOT changed here -- that waits for the Terminal 2.0
// reference implementation. Memory is not composed with any mixin
// anywhere else in this codebase yet; this proves the class is SAFE to
// compose whenever that happens.
//
// Run with: node test/Memory.security.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
require(path.join(V2, 'BaseClassX.js'));
const Memory = require(path.join(V2, 'Memory.js'));
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { createSecurityMixin, seal, isSealed } = require(path.join(V2, 'SecurityMixin.js'));
const { createStructureMixin } = require(path.join(V2, 'StructureMixin.js'));
const { check, expectThrows, sealedAndUnsealed, report } = require('./helpers.js');

const SecuredMemory = ExtendX.extend(Memory, createSecurityMixin(Memory), createStructureMixin(Memory, { mode: 'graph' }));

// --- basic life cycle: armed, real methods work ---
const memory = new SecuredMemory({ sizeBytes: 1024, pageSize: 256 });
check('armed immediately after construction', () => {
    if (!memory._securityArmed()) throw new Error('not armed');
});

// --- regression: the _backing WeakMap-by-`this` bug (same class as
// Physical._cpus/Kernel._host) would make read()/write()/alloc() throw
// "Memory.attach() must be called before use" immediately after attach(),
// because ExtendX gives every dispatched call a fresh frame Proxy `this`.
check('_backing fix: attach() then write()/read() see the SAME instance across separate dispatched calls', () => {
    memory.attach();
    memory.write(0, [10, 20, 30]);
    const bytes = Array.from(memory.read(0, 3));
    if (bytes.join(',') !== '10,20,30') throw new Error('read() after attach()/write() lost the backing store: ' + bytes.join(','));
});

// --- regression: attach()'s cpu and alloc()'s label are exactly the
// shape ExtendX's injected next() callback corrupts when a caller omits
// them. ---
check("next()-collision regression: attach() with NO cpu still falls back to a real Uint8Array, not the injected next() callback treated as a cpu", () => {
    const fresh = new SecuredMemory({ sizeBytes: 64 });
    fresh.attach(); // deliberately no cpu
    fresh.write(0, [1]);
    if (fresh.read(0, 1)[0] !== 1) throw new Error('attach() with omitted cpu did not produce a working backing store');
});
check('attach(cpu) with a REAL cpu-shaped object still uses its .memory buffer correctly', () => {
    const fakeCpu = { memory: new Uint8Array(32) };
    const withCpu = new SecuredMemory({ sizeBytes: 32 });
    withCpu.attach(fakeCpu);
    withCpu.write(0, [99]);
    if (fakeCpu.memory[0] !== 99) throw new Error('attach(cpu) did not back onto the real cpu.memory array');
});
check("next()-collision regression: alloc(pid, length) with NO label still gets a real string, not the injected next() callback", () => {
    const region = memory.alloc(7, 64);
    if (typeof region.label !== 'string') throw new Error('label corrupted: ' + typeof region.label);
    if (region.label !== '') throw new Error('expected empty-string default label, got ' + JSON.stringify(region.label));
});
check('alloc(pid, length, label) with an explicit label is honored', () => {
    const region = memory.alloc(8, 32, 'stack');
    if (region.label !== 'stack') throw new Error('expected label "stack", got ' + JSON.stringify(region.label));
});

// --- free() still works under security dispatch ---
check('free() removes the allocated region while armed', () => {
    const before = memory.regions.length;
    memory.free(7);
    if (memory.regions.length !== before - 1) throw new Error('free() did not remove exactly one region');
});

// --- dispose(): revokes security AND cleans up _backing (the Map this
// replaced the WeakMap with does not self-clean on GC) ---
memory.dispose();
check('disarmed after dispose()', () => {
    if (memory._securityArmed()) throw new Error('still armed after dispose()');
});
expectThrows('write() after dispose() is blocked, not falling through', () => {
    memory.write(0, [1]);
});
expectThrows('alloc() after dispose() is blocked, not falling through', () => {
    memory.alloc(9, 16);
});

// --- sealed vs. unsealed dual fixture ---
const { unsealed, sealed } = sealedAndUnsealed(SecuredMemory, { sizeBytes: 256 }, seal);
expectThrows('locked: disableLayer refuses the security mixin', () => {
    unsealed.disableLayer(SecuredMemory._rawMixins[0]);
});
check('sealed', () => { if (!isSealed(sealed)) throw new Error('not sealed'); });
expectThrows('sealed: dispose is locked', () => { sealed.dispose(); });
check('sealed: attach()/alloc()/read()/write() still work normally', () => {
    sealed.attach();
    sealed.alloc(1, 16, 'ok');
    sealed.write(0, [5]);
    if (sealed.read(0, 1)[0] !== 5) throw new Error('sealed instance read/write broke');
});

// --- StructureMixin composed cleanly alongside SecurityMixin (graph mode,
// no inference expected here -- Memory isn't constructed inside another
// instance's dispatched method in this test, just confirming composition
// itself doesn't conflict with SecurityMixin) ---
check('StructureMixin composes alongside SecurityMixin without conflict', () => {
    const m = new SecuredMemory({});
    if (typeof m.getParent !== 'function') throw new Error('graph mode API missing');
    if (m.getParent() !== null) throw new Error('expected no inferred parent at top-level construction');
});

report();
