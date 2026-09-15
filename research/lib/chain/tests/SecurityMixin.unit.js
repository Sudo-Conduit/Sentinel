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
    // Both built over Tensor (not Hilbert): Tensor is never itself the
    // product of an extend() call, so it carries no own `_wrapped`
    // bookkeeping Set for ExtendX.extend() to inherit and mutate -- each
    // extend() call over it gets an independent Set. Hilbert IS already a
    // composed class (built internally via ExtendX.extend(Tensor, ...) in
    // Hilbert.js) and is reserved for the separate suite below, which
    // needs Hilbert untouched by any other extend() call first.
    const NoopMixinA = { mixinId: 'noop:a', ping: function() { return 'a'; } };
    const NoopMixinB = { mixinId: 'noop:b', ping: function() { return 'b'; } };
    const ComposedA = ExtendX.extend(Tensor, NoopMixinA);
    const ComposedB = ExtendX.extend(Tensor, NoopMixinB);

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

  runner.suite('SecurityMixin: base-class (inherited) methods must be gated too', () =>
  {
    // Hilbert extends Tensor -- Hilbert.prototype's OWN properties are
    // Hilbert's methods only (add/norm/etc. from HilbertMixins); Tensor's
    // own methods (toFlat, etc.) are reached purely through inheritance.
    // securing Hilbert must gate BOTH levels, not just Hilbert's own.
    const secHilbert = SecurityMixin.createSecurityMixin(Hilbert);

    runner.test('an inherited (Tensor-level) method name is present in the gated set', () =>
    {
      assert.strictEqual(typeof secHilbert.toFlat, 'function', 'toFlat lives on Tensor.prototype, inherited by Hilbert -- must still be wrapped');
    });

    runner.test('a composed class (BaseClass.prototype = only dispatch wrappers) still gates the underlying base methods', () =>
    {
      const NoopMixinC = { mixinId: 'noop:c', ping: function() { return 'c'; } };
      const Composed = ExtendX.extend(Tensor, NoopMixinC);
      // Composed.prototype's OWN properties are just the 'ping' dispatch
      // wrapper installWrappers() installed for NoopMixinC -- Tensor's
      // real methods (toFlat, etc.) are inherited, not own, on
      // Composed.prototype.
      const secComposed = SecurityMixin.createSecurityMixin(Composed);
      assert.strictEqual(typeof secComposed.toFlat, 'function', 'Tensor.prototype.toFlat is inherited by Composed.prototype, not own -- must still be gated');
      assert.strictEqual(typeof secComposed.ping, 'function', 'the composed-in mixin method itself must still be gated too');
    });

    runner.test('gated inherited methods actually enforce the activation token at runtime', () =>
    {
      const GuardedHilbert = ExtendX.extend(Hilbert, secHilbert);
      const h = new GuardedHilbert().init({ shape: [2] }, [1, 0]);
      h.dispose();
      assert.throws(() => h.toFlat(), /no activation token/, 'toFlat is inherited from Tensor -- must be blocked once disposed, same as an own method would be');
    });

    runner.test('an accessor property on the prototype chain (Hilbert.prototype.values, a getter) is never invoked during introspection', () =>
    {
      // createSecurityMixin(Hilbert) above must not have thrown or hung --
      // if collectMethodNames() indexed into the prototype instead of
      // reading descriptors, evaluating the `values` getter with `this`
      // bound to the bare prototype object (not a real instance) would be
      // unsound. Confirmed here by the mere fact secHilbert exists, plus:
      assert.strictEqual(typeof secHilbert.values, 'undefined', 'values is an accessor, not a method -- must not be wrapped as one');
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
