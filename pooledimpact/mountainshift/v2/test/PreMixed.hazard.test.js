// Individual-class (white-box) test: what happens when a mixin is
// hand-merged from parts of other mixins ("pre-mixed") before being
// passed to ExtendX.extend(), instead of passed as a separate argument.
// Run with: node test/PreMixed.hazard.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const ExtendX = require(path.join(V2, 'ExtendX.js'));
const CPU = require(path.join(V2, 'CPU.js'));
const { createSecurityMixin, verify } = require(path.join(V2, 'SecurityMixin.js'));
const { check, expectThrows, report } = require('./helpers.js');

const loggingMixin = {
    mixinId: 'log:CPU',
    execute: function(instruction, args) {
        return this.super.execute(instruction, args);
    }
};

// --- Baseline: composed SEPARATELY -- ExtendX's own per-mixin chaining ---
const securityMixin = createSecurityMixin(CPU);
const SeparatelyComposed = ExtendX.extend(CPU, securityMixin, loggingMixin);
const sep = new SeparatelyComposed({ memorySize: 0x1000 });
check('separately composed: armed', () => { if (!sep._securityArmed()) throw new Error('not armed'); });
check('separately composed: execute() works, both layers run', () => { sep.execute('MOV', ['EAX', '0x1']); });
sep.dispose();
expectThrows('separately composed: after dispose(), execute() is STILL blocked -- security intact despite logging also composed', () => {
    sep.execute('MOV', ['EAX', '0x2']);
});

// --- Hazard: hand pre-mixed into ONE object before extend() ---
const securityMixin2 = createSecurityMixin(CPU);
const preMixed = Object.assign({}, securityMixin2, loggingMixin, { mixinId: 'combo:CPU' });
check('locked survives the merge here (loggingMixin never touches that key -- a different second mixin could still clobber it)', () => {
    if (!preMixed.locked) throw new Error('locked was lost in the merge');
});
const PreMixed = ExtendX.extend(CPU, preMixed);
const pm = new PreMixed({ memorySize: 0x1000 });
check('pre-mixed: armed', () => { if (!pm._securityArmed()) throw new Error('not armed'); });
check('HAZARD: execute() runs the LOGGING version only -- silently overwritten, no error', () => {
    pm.dispose();
    pm.execute('MOV', ['EAX', '0x9']); // does NOT throw
    if (pm.EAX !== 9) throw new Error('expected EAX=9, got ' + pm.EAX);
});
expectThrows('but boot() -- untouched by the merge -- is still correctly gated post-dispose', () => {
    pm.boot();
});

// --- verify(): the toString()-hash diagnostic that catches the hazard ---
check('verify() on a genuine, untouched mixin: clean', () => {
    const result = verify(createSecurityMixin(CPU));
    if (!result.verified) throw new Error('expected verified, got problems: ' + JSON.stringify(result.problems));
});
check('verify() on the pre-mixed hazard object: flags exactly "execute"', () => {
    const securityMixin3 = createSecurityMixin(CPU);
    const preMixed2 = Object.assign({}, securityMixin3, loggingMixin, { mixinId: securityMixin3.mixinId });
    const result = verify(preMixed2);
    if (result.verified) throw new Error('expected verify() to flag the tampering, it did not');
    if (result.problems.length !== 1 || result.problems[0].indexOf('execute') !== 0) {
        throw new Error('expected exactly one problem naming "execute", got: ' + JSON.stringify(result.problems));
    }
});

report();
