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
