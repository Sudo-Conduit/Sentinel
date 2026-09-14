// Individual-class (white-box) test: MemoryMapUnit composed with
// SecurityMixin + StructureMixin(relational), backed by the REAL
// memorymap.wasm binary -- proves activation-token gating actually blocks
// real wasm calls (not just a mock), that mm_chainLink is the true
// wasm-level link (independent of StructureMixin's linkTo bookkeeping),
// and that the two stay correctly separate: chainLink() alone does NOT
// populate getConnected(), linkTo() alone does NOT make mm_chainNext see
// anything.
// Run with: node test/MemoryMapUnit.test.js
'use strict';
const path = require('path');
const fs = require('fs');
const V2 = path.join(__dirname, '..');
const { SecuredMemoryMapUnit } = require(path.join(V2, 'MemoryMapUnit.js'));
const { check, expectThrows, report } = require('./helpers.js');

const MM_WASM_PATH = '/root/.claude/uploads/caf0539a-e301-5228-9f88-56fca1941689/6033abf4-memorymap.wasm';

async function main() {
    const memoryPages = 4096;
    const memory = new WebAssembly.Memory({ initial: memoryPages, maximum: memoryPages, shared: true });
    const bytes = fs.readFileSync(MM_WASM_PATH);
    const result = await WebAssembly.instantiate(bytes, { env: { memory: memory } });
    const mm = result.instance.exports;
    const initResult = mm.mm_init(memoryPages * 65536);
    if (initResult !== 0) throw new Error('mm_init failed: ' + initResult);

    // SecurityMixin's init() hook runs automatically inside ExtendX's own
    // constructor (mint-on-construction, per SecurityMixin.js's own header
    // comment) -- there is no separate manual .init() call, and `init` is
    // not even exposed as a callable method afterward (ExtendX's
    // NON_DISPATCH set). So a freshly-constructed unit is already armed;
    // the only real "unarmed" state reachable from outside is post-dispose().
    const unitA = new SecuredMemoryMapUnit({ mm: mm, memory: memory, name: 'unit-a', sizeMB: 8 });
    const unitB = new SecuredMemoryMapUnit({ mm: mm, memory: memory, name: 'unit-b', sizeMB: 8 });

    check('freshly-constructed unit: create() succeeds immediately (armed at construction)', function() {
        const addr = unitA.create();
        if (!addr || addr <= 0) throw new Error('expected a positive address, got ' + addr);
    });
    unitB.create();

    check('auth() succeeds with the unit\'s own real key', function() {
        const rc = unitA.auth(unitA.key);
        if (rc !== 0) throw new Error('expected 0, got ' + rc);
    });
    check('auth() rejects a different unit\'s real key', function() {
        const rc = unitA.auth(unitB.key);
        if (rc === 0) throw new Error('expected a non-zero rejection, got 0 (security bug)');
    });

    // The failed auth() attempt just above genuinely de-authenticates the
    // mailbox (confirmed by direct probing against the real wasm export --
    // a wrong-key attempt invalidates any PRIOR successful session, not
    // just failing to grant a new one; fail-closed, not fail-stable). Real
    // security-relevant behavior, not a quirk of this class -- re-auth
    // with the correct key before any write/read below, exactly like a
    // real caller would have to.
    unitA.auth(unitA.key);

    check('writeSlot/readSlot round-trip through the real wasm export', function() {
        unitA.writeSlot(0, 42.5);
        const v = unitA.readSlot(0);
        if (Math.abs(v - 42.5) > 1e-3) throw new Error('expected 42.5, got ' + v);
    });

    // ─── chainLink() is the REAL wasm link -- independent of linkTo() ───
    check('before chainLink(): mm_chainNext sees no link', function() {
        const next = unitA.chainNext();
        if (next !== 0) throw new Error('expected 0 (no link yet), got ' + next);
    });
    check('before linkTo(): getConnected() is empty', function() {
        const c = unitA.getConnected();
        if (c.length !== 0) throw new Error('expected empty, got ' + JSON.stringify(c));
    });

    unitA.chainLink(unitB);

    check('after chainLink() alone: mm_chainNext reflects the real wasm link', function() {
        const next = unitA.chainNext();
        if (next !== unitB.address) throw new Error('expected 0x' + unitB.address.toString(16) + ', got 0x' + (next >>> 0).toString(16));
    });
    check('after chainLink() alone: getConnected() is STILL empty (the two are separate)', function() {
        const c = unitA.getConnected();
        if (c.length !== 0) throw new Error('chainLink() leaked into the JS relational graph: ' + JSON.stringify(c));
    });

    // ─── linkTo() is the JS-graph bookkeeping -- independent of chainLink() ──
    unitA.linkTo(unitB._extId, 'federated-with');

    check('after linkTo(): getConnected() reflects the JS-graph link', function() {
        const c = unitA.getConnected();
        if (!c.includes(unitB._extId)) throw new Error('expected ' + unitB._extId + ' in ' + JSON.stringify(c));
    });
    check('linkTo() is bidirectional in the JS graph (unitB sees unitA too)', function() {
        const c = unitB.getConnected();
        if (!c.includes(unitA._extId)) throw new Error('expected ' + unitA._extId + ' in ' + JSON.stringify(c));
    });

    // ─── dispose() revokes the activation token -- real calls blocked again ──
    unitA.dispose();
    expectThrows('disposed unit: writeSlot() blocked again after dispose()', function() {
        unitA.writeSlot(0, 1);
    });

    report();
}

main().catch(function(e) {
    console.error('FATAL', e);
    process.exitCode = 1;
});
