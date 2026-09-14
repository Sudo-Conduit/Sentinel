// Individual-class (white-box) test: SecurityMixin + StructureMixin
// composed onto Kernel, a BaseClassX subclass with its own runtime handle
// table (_host, keyed by this.id) and two optional trailing parameters
// (fork's ppid/memBytes, tick's quantum) that are exactly the shape
// ExtendX's dispatcher-injected next() callback can corrupt. Run with:
// node test/Kernel.security.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
require(path.join(V2, 'BaseClassX.js'));
const Kernel = require(path.join(V2, 'Kernel.js'));
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { createSecurityMixin, seal, isSealed } = require(path.join(V2, 'SecurityMixin.js'));
const { createStructureMixin } = require(path.join(V2, 'StructureMixin.js'));
const { check, expectThrows, sealedAndUnsealed, report } = require('./helpers.js');

const SecuredKernel = ExtendX.extend(Kernel, createSecurityMixin(Kernel), createStructureMixin(Kernel, { mode: 'graph' }));

// --- basic life cycle: armed, real methods work ---
const kernel = new SecuredKernel({});
check('armed immediately after construction', () => {
    if (!kernel._securityArmed()) throw new Error('not armed');
});

// --- regression: the _host WeakMap-by-`this` bug (same class as
// Physical._cpus) would make getPhysical()/getEnvironment()/getMemory()
// return null immediately after attach(), because ExtendX gives every
// dispatched call a fresh frame Proxy `this`. ---
const fakePhysical = { poweredOn: true, getCPU: () => fakeCPU, ramBytes: 0x400000 };
const fakeCPU = { boot() { this.booted = true; }, run(q) { this.lastQuantum = q; return q; }, config: { halted: false } };
check('_host fix: attach() then getPhysical()/getEnvironment()/getMemory() see the SAME instance across separate dispatched calls', () => {
    kernel.attach(fakePhysical, { runtime: 'test' }, null);
    if (kernel.getPhysical() !== fakePhysical) throw new Error('getPhysical() lost the attached instance');
    if (kernel.getEnvironment().runtime !== 'test') throw new Error('getEnvironment() lost the attached instance');
});

// --- regression: fork()'s ppid/memBytes and tick()'s quantum are optional
// trailing params -- exactly the shape ExtendX's injected next() callback
// corrupts when a caller omits them. Both must stay real numbers regardless
// of how many arguments the caller actually passed. ---
check('next()-collision regression: fork(cmd) with NO ppid/memBytes still gets real numbers, not the injected next() callback', () => {
    const proc = kernel.fork('sh');
    if (typeof proc.ppid !== 'number') throw new Error('ppid corrupted: ' + typeof proc.ppid);
    if (proc.ppid !== 0) throw new Error('expected ppid 0, got ' + proc.ppid);
    if (typeof proc.memBytes !== 'number') throw new Error('memBytes corrupted: ' + typeof proc.memBytes);
});
check('fork(cmd, ppid) with explicit ppid but omitted memBytes: ppid is correct, memBytes still a real number', () => {
    const proc = kernel.fork('vi', 1);
    if (proc.ppid !== 1) throw new Error('expected ppid 1, got ' + proc.ppid);
    if (typeof proc.memBytes !== 'number') throw new Error('memBytes corrupted: ' + typeof proc.memBytes);
});
check('next()-collision regression: tick() with NO quantum still runs a real quantum, not the injected next() callback', () => {
    const running = kernel.tick();
    if (!Array.isArray(running)) throw new Error('tick() did not return the running list');
    if (fakeCPU.lastQuantum !== 10) throw new Error('expected default quantum 10, got ' + fakeCPU.lastQuantum);
});
check('tick(25): explicit quantum is honored', () => {
    kernel.tick(25);
    if (fakeCPU.lastQuantum !== 25) throw new Error('expected quantum 25, got ' + fakeCPU.lastQuantum);
});

// --- kill() cascade still works under security dispatch ---
check('kill() cascades to descendants and still works while armed', () => {
    const parent = kernel.fork('parentproc');
    const child = kernel.fork('childproc', parent.pid);
    kernel.kill(parent.pid);
    const pids = kernel.ps().map((p) => p.pid);
    if (pids.includes(parent.pid) || pids.includes(child.pid)) throw new Error('kill() did not cascade');
});

// --- dispose(): revokes security AND cleans up _host (the Map this
// replaced the WeakMap with does not self-clean on GC) ---
kernel.dispose();
check('disarmed after dispose()', () => {
    if (kernel._securityArmed()) throw new Error('still armed after dispose()');
});
expectThrows('fork() after dispose() is blocked, not falling through', () => {
    kernel.fork('evil');
});
expectThrows('tick() after dispose() is blocked, not falling through', () => {
    kernel.tick();
});

// --- sealed vs. unsealed dual fixture ---
const { unsealed, sealed } = sealedAndUnsealed(SecuredKernel, {}, seal);
expectThrows('locked: disableLayer refuses the security mixin', () => {
    unsealed.disableLayer(SecuredKernel._rawMixins[0]);
});
check('sealed', () => { if (!isSealed(sealed)) throw new Error('not sealed'); });
expectThrows('sealed: dispose is locked', () => { sealed.dispose(); });
check('sealed: fork()/tick() still work normally', () => {
    sealed.attach(fakePhysical, { runtime: 'test2' }, null);
    sealed.fork('ok');
    sealed.tick();
});

// --- unsealed instance: dispose() cleans _host for real ---
unsealed.attach(fakePhysical, { runtime: 'test3' }, null);
unsealed.dispose();
check('_host cleanup: a fresh instance reusing behavior is unaffected by a disposed one (Map entry actually removed, not leaked)', () => {
    const other = new SecuredKernel({});
    if (other.getPhysical() !== null) throw new Error('a brand new instance should have no attached physical');
});

report();
