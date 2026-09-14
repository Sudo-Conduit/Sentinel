// Individual-class (white-box) FULL LIFE-CYCLE test: the entire boot chain
// -- CPU, Physical, Kernel, BIOS -- each composed with SecurityMixin (and
// graph-mode StructureMixin on Kernel/BIOS), wired together exactly the way
// the real system wires them (Physical.cpuFactory -> secured CPU,
// BIOS.kernelFactory -> secured Kernel), then driven through boot -> fork
// several processes -> several scheduler ticks -> a kill cascade -> disposal,
// confirming security gates hold and structure links are correct at every
// stage. This is the "full life cycle so we can harden the shape" pass for
// the whole chain, not just one class in isolation -- every bug fixed
// individually in CPU/Physical/Kernel/BIOS (WeakMap-by-this, the next()
// injection hazard, raw-unsecured-child leaks, async inference) has to
// survive being wired together for real.
//
// The outer closure/opaque factory does not exist yet -- this legitimately
// requires() internals, per the project's own two-tier test convention (see
// helpers.js's header comment). Run with:
// node test/FullBootChain.lifecycle.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
require(path.join(V2, 'BaseClassX.js'));
const CPU = require(path.join(V2, 'CPU.js'));
const Physical = require(path.join(V2, 'Physical.js'));
const Kernel = require(path.join(V2, 'Kernel.js'));
const BIOS = require(path.join(V2, 'BIOS.js'));
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { createSecurityMixin } = require(path.join(V2, 'SecurityMixin.js'));
const { createStructureMixin } = require(path.join(V2, 'StructureMixin.js'));
const { check, expectThrows, report } = require('./helpers.js');

const SecuredCPU = ExtendX.extend(CPU, createSecurityMixin(CPU));
const SecuredPhysical = ExtendX.extend(Physical, createSecurityMixin(Physical), createStructureMixin(Physical, { mode: 'graph' }));
const SecuredKernel = ExtendX.extend(Kernel, createSecurityMixin(Kernel), createStructureMixin(Kernel, { mode: 'graph' }));
const SecuredBIOS = ExtendX.extend(BIOS, createSecurityMixin(BIOS), createStructureMixin(BIOS, { mode: 'graph' }));

function fakeFs() {
    return { findBootEntry: async () => null };
}

async function run() {
    // ─── Boot the whole chain ────────────────────────────────────────
    const bios = new SecuredBIOS({ kernelFactory: (opts) => new SecuredKernel(opts) });
    const physical = new SecuredPhysical({
        capacityMHz: 2600,
        ramBytes: 0x10000,
        cpuFactory: (memBytes) => new SecuredCPU({ memorySize: memBytes })
    });

    check('pre-boot: bios and physical are both armed independently', () => {
        if (!bios._securityArmed()) throw new Error('bios not armed');
        if (!physical._securityArmed()) throw new Error('physical not armed');
    });

    const kernel = await bios.boot(physical, fakeFs());

    check('post-boot: kernel is a SECURED, armed Kernel (BIOS.kernelFactory closed the raw-leak)', () => {
        if (typeof kernel._securityArmed !== 'function' || !kernel._securityArmed()) throw new Error('kernel not secured/armed');
    });
    check('post-boot: kernel.getPhysical() is the SAME secured physical instance passed to boot()', () => {
        if (kernel.getPhysical() !== physical) throw new Error('_host fix regression -- getPhysical() lost the attached instance');
    });
    check('post-boot: the CPU reachable through physical.getCPU() is SECURED and armed (cpuFactory closed the raw-leak)', () => {
        const cpu = kernel.getPhysical().getCPU();
        if (typeof cpu._securityArmed !== 'function' || !cpu._securityArmed()) throw new Error('leaked CPU is not secured/armed');
    });
    check('post-boot: structure graph -- bios is the (explicitly attributed) parent of kernel', () => {
        if (kernel.getParent() !== bios._extId) throw new Error('expected bios as parent, got ' + kernel.getParent());
        if (!bios.getChildren().includes(kernel._extId)) throw new Error('bios.getChildren() missing kernel');
    });

    // ─── fork several processes, tick the scheduler, confirm real
    // execution flows all the way down to the secured CPU ────────────
    const shell = kernel.fork('sh');
    const editor = kernel.fork('vi', shell.pid);
    const grep = kernel.fork('grep', shell.pid);
    check('fork(): three processes created with correct ppid lineage (next()-collision fix holds under a real chain, not just in isolation)', () => {
        if (typeof shell.ppid !== 'number' || shell.ppid !== 0) throw new Error('shell ppid wrong: ' + shell.ppid);
        if (editor.ppid !== shell.pid || grep.ppid !== shell.pid) throw new Error('child ppid lineage wrong');
    });

    for (let i = 0; i < 3; i++) kernel.tick();
    check('tick() x3: every process actually ran real CPU cycles through the secured Physical/CPU', () => {
        kernel.ps().forEach((p) => {
            if (typeof p.lastExecuted !== 'number') throw new Error(p.cmd + ': lastExecuted not set');
        });
    });

    // ─── kill cascade under the full chain ────────────────────────────
    kernel.kill(shell.pid);
    check('kill() cascades to editor and grep (both children of shell) under full-chain dispatch', () => {
        const pids = kernel.ps().map((p) => p.pid);
        if (pids.includes(shell.pid) || pids.includes(editor.pid) || pids.includes(grep.pid)) {
            throw new Error('kill() cascade failed under full-chain composition');
        }
    });

    // ─── independent lifecycles: disposing BIOS does NOT cascade-dispose
    // the kernel it booted -- StructureMixin's dispose() only detaches the
    // graph link (orphans the child, per its own documented "orphan, don't
    // re-parent" policy), it never disposes descendants. Boot-time
    // parentage is a lineage record, not an ownership/cascade relationship
    // -- worth confirming explicitly since it is easy to assume otherwise. ──
    bios.dispose();
    check('disposing bios does NOT cascade-dispose kernel -- kernel remains armed and functional', () => {
        if (!kernel._securityArmed()) throw new Error('kernel was unexpectedly disarmed by bios.dispose()');
        kernel.fork('still-alive');
    });
    check("disposing bios orphans kernel's structure link (detach, not re-parent)", () => {
        if (kernel.getParent() !== null) throw new Error('expected kernel to be orphaned after its parent disposed, got ' + kernel.getParent());
    });
    expectThrows('bios itself is correctly disarmed after its own dispose()', () => {
        bios.boot(physical, fakeFs());
    });

    // ─── full teardown: kernel, then physical (and therefore its CPU) ──
    kernel.dispose();
    expectThrows('kernel disarmed after dispose(): fork() now blocked', () => {
        kernel.fork('evil');
    });

    const cpuBeforeDispose = physical.getCPU();
    check('cpu is still armed while physical (its owner) is not yet disposed', () => {
        if (!cpuBeforeDispose._securityArmed()) throw new Error('cpu should still be armed');
    });
    physical.dispose();
    expectThrows('physical disarmed after dispose(): post()/getCPU() now blocked', () => {
        physical.getCPU();
    });
    check('disposing physical does NOT reach into the CPU it once held -- the CPU instance itself has its own independent lifecycle and is still armed', () => {
        if (!cpuBeforeDispose._securityArmed()) throw new Error('cpu should remain armed -- physical.dispose() must not reach into a separately-owned instance');
    });
    cpuBeforeDispose.dispose();
    expectThrows('cpu disarmed after its OWN explicit dispose(): execute() now blocked', () => {
        cpuBeforeDispose.execute('MOV', ['EAX', '0x1']);
    });

    report();
}

run().catch((err) => {
    console.error('FullBootChain.lifecycle.test.js failed:', err);
    process.exitCode = 1;
});
