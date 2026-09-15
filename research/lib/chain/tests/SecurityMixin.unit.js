/**
 * @file research/lib/chain/tests/SecurityMixin.unit.js
 * @author Will Fobbs
 * @description Regression coverage for the reported mixinId-collision bug:
 *              createSecurityMixin() derived mixinId from BaseClass.name,
 *              but every class ExtendX.extend() composes is generated with
 *              the literal name "Subclass" -- so two independently secured
 *              composed classes collided on the identical mixinId
 *              'security:Subclass'. That collision hit twice: extend()'s
 *              registry guard refused the second composition, and
 *              MIXIN_FINGERPRINTS silently overwrote the first class's
 *              recorded fingerprint with the second's, corrupting verify()
 *              for the first. This suite builds exactly that scenario --
 *              two different ExtendX-composed classes, both named
 *              "Subclass" -- and asserts both collisions are gone.
 */
const assert = require('assert');
const Tensor = require('../Tensor.js');
const Hilbert = require('../Hilbert.js');
const ExtendX = require('../ExtendX.js');
const SecurityMixin = require('../SecurityMixin.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('SecurityMixin: mixinId collision across same-named composed classes', () =>
  {
    // Both of these are themselves ExtendX-composed classes before they
    // ever reach createSecurityMixin() -- so BaseClass.name is "Subclass"
    // for both, reproducing the exact shape of the reported bug (securing
    // two DIFFERENT composed classes, not two raw classes that happen to
    // share a literal name).
    const NoopMixinA = { mixinId: 'noop:a', ping: function() { return 'a'; } };
    const NoopMixinB = { mixinId: 'noop:b', ping: function() { return 'b'; } };
    const ComposedA = ExtendX.extend(Tensor, NoopMixinA);
    const ComposedB = ExtendX.extend(Hilbert, NoopMixinB);

    assert.strictEqual(ComposedA.name, 'Subclass');
    assert.strictEqual(ComposedB.name, 'Subclass');
    assert.strictEqual(ComposedA.name, ComposedB.name, 'precondition: both composed classes share the same generated name');

    const secA = SecurityMixin.createSecurityMixin(ComposedA);
    const secB = SecurityMixin.createSecurityMixin(ComposedB);

    runner.test('two same-named BaseClasses get distinct mixinIds', () =>
    {
      assert.notStrictEqual(secA.mixinId, secB.mixinId);
    });

    runner.test('createSecurityMixin is idempotent: same BaseClass reference yields the same mixinId again', () =>
    {
      const secAAgain = SecurityMixin.createSecurityMixin(ComposedA);
      assert.strictEqual(secAAgain.mixinId, secA.mixinId);
    });

    runner.test('extend() composes both secured classes without a registry collision', () =>
    {
      assert.doesNotThrow(() =>
      {
        ExtendX.extend(ComposedA, secA);
        ExtendX.extend(ComposedB, secB);
      });
    });

    runner.test('verify() checks each mixin against its OWN fingerprint, not the other class\'s', () =>
    {
      const resultA = SecurityMixin.verify(secA);
      const resultB = SecurityMixin.verify(secB);
      assert.ok(resultA.verified, 'secA problems: ' + JSON.stringify(resultA.problems));
      assert.ok(resultB.verified, 'secB problems: ' + JSON.stringify(resultB.problems));
    });

    runner.test('both secured composites remain independently armable/dispatchable', () =>
    {
      const GuardedA = ExtendX.extend(ComposedA, secA);
      const GuardedB = ExtendX.extend(ComposedB, secB);
      const a = new GuardedA().init({ shape: [2] }, [1, 2]);
      const b = new GuardedB().init({ shape: [2] }, [3, 4]);
      assert.ok(secA._securityArmed.call(a));
      assert.ok(secB._securityArmed.call(b));
      assert.deepStrictEqual(a.toFlat().data, [1, 2]);
      assert.deepStrictEqual(b.toFlat().data, [3, 4]);
    });
  });
}

if (require.main === module)
{
  const TestRunner = require('./TestRunner.js');
  const runner = new TestRunner();
  register(runner);
  runner.run().then((result) => { process.exitCode = result.failed > 0 ? 1 : 0; });
}

module.exports = register;
