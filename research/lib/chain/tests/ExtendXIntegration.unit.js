/**
 * @file research/lib/chain/tests/ExtendXIntegration.unit.js
 * @author Will Fobbs
 * @description Coverage for our actual usage of ExtendX/StructureMixin/
 *              SecurityMixin composed over Tensor — not a re-test of
 *              ExtendX's own internals (that suite lives upstream), but
 *              proof our integration works: graph tracking, activation-
 *              token gating, locked-layer refusal, and multiple mixins
 *              coexisting from a single extend() call (the documented-safe
 *              pattern, since stacking separate extend() calls has a known
 *              upstream gap — see ExtendX.js's own version history).
 *
 *              Each mixin factory below is called exactly ONCE at suite
 *              registration time and the resulting mixin objects/classes
 *              are reused across test cases — calling createStructureMixin/
 *              createSecurityMixin again with the same BaseClass would mint
 *              a mixinId that collides with the one already registered.
 */
const assert = require('assert');
const Tensor = require('../Tensor.js');
const ExtendX = require('../ExtendX.js');
const StructureMixin = require('../StructureMixin.js');
const SecurityMixin = require('../SecurityMixin.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('ExtendX integration: StructureMixin + SecurityMixin over Tensor', () =>
  {
    const structMixin = StructureMixin.createStructureMixin(Tensor, { mode: 'graph' });
    const secMixin = SecurityMixin.createSecurityMixin(Tensor);

    const StructuredTensor = ExtendX.extend(Tensor, structMixin);
    const GuardedTensor = ExtendX.extend(Tensor, secMixin);
    const BothTensor = ExtendX.extend(Tensor, structMixin, secMixin);

    runner.test('graph mode: addChild/getParent/getChildren track structure', () =>
    {
      const parent = new StructuredTensor().init({ shape: [2] }, [1, 2]);
      const child = new StructuredTensor().init({ shape: [2] }, [3, 4]);
      parent.addChild(child._extId);
      assert.strictEqual(parent.getChildren().length, 1);
      assert.strictEqual(child.getParent(), parent._extId);
    });

    runner.test('SecurityMixin: armed after construction, dispatched calls succeed', () =>
    {
      const g = new GuardedTensor().init({ shape: [2] }, [3, 4]);
      assert.ok(secMixin._securityArmed.call(g));
      assert.deepStrictEqual(g.toFlat().data, [3, 4]);
    });

    runner.test('SecurityMixin: dispose revokes the token, subsequent calls throw', () =>
    {
      const g = new GuardedTensor().init({ shape: [3] }, [1, 2, 3]);
      g.dispose();
      assert.ok(!secMixin._securityArmed.call(g));
      assert.throws(() => g.toFlat(), /no activation token/);
    });

    runner.test('a locked mixin refuses enableLayer/disableLayer unconditionally', () =>
    {
      const g = new GuardedTensor().init({ shape: [2] }, [1, 2]);
      assert.throws(() => g.disableLayer(secMixin), /locked/);
      assert.throws(() => g.enableLayer(secMixin), /locked/);
    });

    runner.test('multiple mixins from a single extend() call coexist correctly', () =>
    {
      const a = new BothTensor().init({ shape: [2] }, [1, 2]);
      const b = new BothTensor().init({ shape: [2] }, [3, 4]);
      a.addChild(b._extId);
      assert.strictEqual(b.getParent(), a._extId);
      assert.deepStrictEqual(a.toFlat().data, [1, 2]); // security-gated call still works while armed
    });
  });

  // 'graph' mode (parent/child tree only) was the only StructureMixin mode
  // exercised above. It also supports 'relational' (arbitrary linkTo/
  // unlinkFrom edges, no hierarchy) and 'both' — covered here so the edge
  // half isn't left untested. mixinId embeds the mode ('structure:<mode>:
  // Tensor'), so composing one of each mode over the same BaseClass=Tensor
  // mints three distinct ids, no collision with each other or with the
  // 'graph' mixin in the suite above.
  runner.suite('StructureMixin: relational and both modes (arbitrary edges)', () =>
  {
    const relMixin = StructureMixin.createStructureMixin(Tensor, { mode: 'relational' });
    const RelationalTensor = ExtendX.extend(Tensor, relMixin);

    const bothMixin = StructureMixin.createStructureMixin(Tensor, { mode: 'both' });
    const BothStructTensor = ExtendX.extend(Tensor, bothMixin);

    runner.test('relational mode has no tree API at all (addChild/getParent undefined)', () =>
    {
      const a = new RelationalTensor().init({ shape: [2] }, [1, 2]);
      assert.strictEqual(typeof a.addChild, 'undefined');
      assert.strictEqual(typeof a.getParent, 'undefined');
    });

    runner.test('linkTo/getConnected: one-hop adjacency, both directions recorded', () =>
    {
      const a = new RelationalTensor().init({ shape: [2] }, [1, 2]);
      const b = new RelationalTensor().init({ shape: [2] }, [3, 4]);
      a.linkTo(b._extId, 'friend');
      assert.deepStrictEqual(a.getConnected(), [b._extId]);
      assert.deepStrictEqual(b.getConnected(), [a._extId]); // linkTo records EDGES_IN on the target too
    });

    runner.test('getConnectedGraph: BFS transitive closure, not just direct neighbors', () =>
    {
      const a = new RelationalTensor().init({ shape: [2] }, [1, 2]);
      const b = new RelationalTensor().init({ shape: [2] }, [3, 4]);
      const c = new RelationalTensor().init({ shape: [2] }, [5, 6]);
      a.linkTo(b._extId, 'friend');
      b.linkTo(c._extId, 'friend');
      // a-b direct, b-c direct, so a reaches c only transitively
      assert.strictEqual(a.getConnected().length, 1); // one hop: b only
      const reachable = a.getConnectedGraph();
      assert.strictEqual(reachable.length, 2); // b and c
      assert.ok(reachable.includes(b._extId));
      assert.ok(reachable.includes(c._extId));
    });

    runner.test('unlinkFrom removes the edge in both directions', () =>
    {
      const a = new RelationalTensor().init({ shape: [2] }, [1, 2]);
      const b = new RelationalTensor().init({ shape: [2] }, [3, 4]);
      a.linkTo(b._extId, 'friend');
      a.unlinkFrom(b._extId, 'friend');
      assert.strictEqual(a.getConnected().length, 0);
      assert.strictEqual(b.getConnected().length, 0);
    });

    runner.test('unlinkFrom with no label matches any label on that edge', () =>
    {
      const a = new RelationalTensor().init({ shape: [2] }, [1, 2]);
      const b = new RelationalTensor().init({ shape: [2] }, [3, 4]);
      a.linkTo(b._extId, 'friend');
      a.unlinkFrom(b._extId); // no label filter
      assert.strictEqual(a.getConnected().length, 0);
    });

    runner.test('both mode: tree API and relational API coexist on the same instance', () =>
    {
      const p = new BothStructTensor().init({ shape: [2] }, [1, 2]);
      const ch = new BothStructTensor().init({ shape: [2] }, [3, 4]);
      p.addChild(ch._extId);
      p.linkTo(ch._extId, 'also-related');
      assert.strictEqual(ch.getParent(), p._extId);
      assert.ok(p.getConnected().includes(ch._extId));
    });
  });
}

if (require.main === module)
{
  const TestRunner = require('./TestRunner.js');
  const runner = new TestRunner();
  register(runner);
  const result = runner.run();
  process.exitCode = result.failed > 0 ? 1 : 0;
}

module.exports = register;
