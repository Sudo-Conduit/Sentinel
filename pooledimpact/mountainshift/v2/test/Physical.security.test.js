// Individual-class (white-box) test: SecurityMixin composed onto Physical,
// which extends BaseClassX -- a genuinely different case from CPU (a plain
// class) since BaseClassX's constructor returns a Proxy. Run with:
// node test/Physical.security.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
require(path.join(V2, 'BaseClassX.js'));
const CPU = require(path.join(V2, 'CPU.js'));
const Physical = require(path.join(V2, 'Physical.js'));
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const { createSecurityMixin, seal, isSealed } = require(path.join(V2, 'SecurityMixin.js'));
const { check, expectThrows, sealedAndUnsealed, report } = require('./helpers.js');

const SecuredPhysical = ExtendX.extend(Physical, createSecurityMixin(Physical));
const physical = new SecuredPhysical({ capacityMHz: 2600, ramBytes: 0x400000 });

check('_extId is reachable on a BaseClassX-Proxy-wrapped instance', () => {
    if (typeof physical._extId !== 'string') throw new Error('_extId is ' + typeof physical._extId);
});
check('armed immediately after construction', () => {
    if (!physical._securityArmed()) throw new Error('not armed');
});
check('post() succeeds while armed', () => { physical.post(); });
let leakedCPU;
check('getCPU() succeeds while armed', () => {
    leakedCPU = physical.getCPU();
    if (!leakedCPU) throw new Error('getCPU() returned nothing');
});
check('DEFAULT (no cpuFactory injected): getCPU() returns a plain, unsecured CPU', () => {
    if (typeof leakedCPU._securityArmed === 'function') throw new Error('default behavior changed');
    leakedCPU.execute('MOV', ['EAX', '0xFF']);
    if (leakedCPU.EAX !== 0xFF) throw new Error('expected EAX=0xff, got ' + leakedCPU.EAX);
});
check('reset() succeeds while armed', () => { physical.reset(); });

physical.dispose();
check('disarmed after dispose()', () => {
    if (physical._securityArmed()) throw new Error('still armed');
});
expectThrows('post() after dispose() is blocked, not falling through', () => {
    physical.post();
});

// Sealed vs. unsealed dual fixture.
const { unsealed, sealed } = sealedAndUnsealed(SecuredPhysical, { capacityMHz: 2600, ramBytes: 0x400000 }, seal);
expectThrows('locked: disableLayer refuses the security mixin (unsealed instance, BaseClassX target)', () => {
    unsealed.disableLayer(SecuredPhysical._rawMixins[0]);
});
check('sealed', () => { if (!isSealed(sealed)) throw new Error('not sealed'); });
expectThrows('sealed: dispose is locked', () => { sealed.dispose(); });
expectThrows('sealed: disableLayer is locked', () => {
    sealed.disableLayer(SecuredPhysical._rawMixins[0]);
});
check('sealed: post()/getCPU() still work normally', () => {
    sealed.post();
    sealed.getCPU();
});

// Fix verification: injectable cpuFactory closes the raw-unsecured-CPU leak.
const SecuredCPU = ExtendX.extend(CPU, createSecurityMixin(CPU));
const physicalWithSecuredCPU = new SecuredPhysical({
    capacityMHz: 2600,
    ramBytes: 0x400000,
    cpuFactory: (memBytes) => new SecuredCPU({ memorySize: memBytes })
});
check('injected cpuFactory: getCPU() now returns a SECURED, armed CPU', () => {
    physicalWithSecuredCPU.post();
    const internalCPU = physicalWithSecuredCPU.getCPU();
    if (typeof internalCPU._securityArmed !== 'function') throw new Error('injection did not take effect');
    if (!internalCPU._securityArmed()) throw new Error('leaked CPU is secured but not armed');
    internalCPU.execute('MOV', ['EDI', '0x3']);
    if (internalCPU.EDI !== 3) throw new Error('expected EDI=3, got ' + internalCPU.EDI);
});
check('a Physical instance built WITHOUT cpuFactory is unaffected by the feature existing', () => {
    const plainAgain = new SecuredPhysical({ capacityMHz: 2600, ramBytes: 0x400000 });
    plainAgain.post();
    if (typeof plainAgain.getCPU()._securityArmed === 'function') throw new Error('default behavior regressed');
});

report();
