// Individual-class (white-box) test: SecurityMixin composed onto CPU
// alone, no boot chain, no BaseClassX. Run with: node test/CPU.security.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const CPU = require(path.join(V2, 'CPU.js'));
const { createSecurityMixin, seal, isSealed } = require(path.join(V2, 'SecurityMixin.js'));
const { check, expectThrows, sealedAndUnsealed, report } = require('./helpers.js');

const SecuredCPU = ExtendX.extend(CPU, createSecurityMixin(CPU));

// 1. Normal use: armed at construction (init() ran), real methods work.
const cpu = new SecuredCPU({ memorySize: 0x1000 });
check('armed immediately after construction', () => {
    if (!cpu._securityArmed()) throw new Error('not armed');
});
check('boot() succeeds while armed', () => { cpu.boot(); });
check('execute() succeeds while armed', () => {
    cpu.execute('MOV', ['EAX', '0x5']);
    cpu.execute('ADD', ['EAX', '0x3']);
    if (cpu.EAX !== 8) throw new Error('expected EAX=8, got ' + cpu.EAX);
});
check('dumpState() succeeds while armed', () => {
    const state = cpu.dumpState();
    if (state.registers.EAX !== '00000008') throw new Error('unexpected dumpState: ' + JSON.stringify(state.registers));
});

// 2. dispose() revokes the token; locked mixins survive the global
// override collapse (ExtendX.js _resolvePipeline), so the token check
// still runs and correctly blocks -- not a fall-through.
cpu.dispose();
check('disarmed after dispose()', () => {
    if (cpu._securityArmed()) throw new Error('still armed after dispose()');
});
expectThrows('execute() after dispose() is blocked, not falling through', () => {
    cpu.execute('MOV', ['EBX', '0x1']);
});
check('violation was recorded', () => {
    if (cpu._securityViolations() < 1) throw new Error('expected >=1 violation, got ' + cpu._securityViolations());
});

// 3. Sealed vs. unsealed dual fixture.
const { unsealed, sealed } = sealedAndUnsealed(SecuredCPU, { memorySize: 0x1000 }, seal);

expectThrows('locked: disableLayer refuses the security mixin from construction, unsealed or not', () => {
    unsealed.disableLayer(SecuredCPU._rawMixins[0]);
});
expectThrows('locked: enableLayer refuses the security mixin from construction, unsealed or not', () => {
    unsealed.enableLayer(SecuredCPU._rawMixins[0]);
});
check('unsealed instance: dispose() still works normally pre-seal', () => {
    unsealed.dispose();
});

check('sealed instance: isSealed() true', () => {
    if (!isSealed(sealed)) throw new Error('expected sealed');
});
expectThrows('sealed instance: dispose is locked', () => { sealed.dispose(); });
expectThrows('sealed instance: disposeAsync is locked', () => { sealed.disposeAsync(); });
check('sealed instance: real, gated methods still work normally', () => {
    sealed.execute('MOV', ['ESI', '0x7']);
    if (sealed.ESI !== 7) throw new Error('expected ESI=7, got ' + sealed.ESI);
});
check('calling seal() again on an already-sealed instance is a safe no-op', () => {
    seal(sealed);
    if (!isSealed(sealed)) throw new Error('should still be sealed');
});

report();
