/**
 * @file research/lib/chain/tests/KnotVector.unit.js
 * @author Will Fobbs
 * @description Coverage for Math.ext.KnotVector: monotonicity, the
 *              length contract (numControlPoints+degree+1), MODE.OPEN vs
 *              MODE.CLAMPED endpoint-multiplicity validation, and the two
 *              canonical generators (uniform/clamped) against a
 *              hand-computed example from Piegl & Tiller's own
 *              convention.
 */
const assert = require('assert');
require('../MathExt.js');
const KnotVector = require('../KnotVector.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('KnotVector', () =>
  {
    runner.test('Math.init(KnotVector) installed it at Math.ext.KnotVector', () =>
    {
      assert.strictEqual(typeof Math.ext.KnotVector, 'object');
      assert.strictEqual(Math.ext.KnotVector.expectedLength(5, 2), 8);
    });

    runner.test('MODE is a frozen enum with OPEN and CLAMPED', () =>
    {
      assert.strictEqual(KnotVector.MODE.OPEN, 'open');
      assert.strictEqual(KnotVector.MODE.CLAMPED, 'clamped');
      assert.strictEqual(Object.isFrozen(KnotVector.MODE), true);
      KnotVector.MODE.OPEN = 'mutated'; // silently a no-op outside strict mode -- frozen wins either way
      assert.strictEqual(KnotVector.MODE.OPEN, 'open');
    });

    runner.test('isMonotonic: non-decreasing sequences pass, a decrease fails', () =>
    {
      assert.strictEqual(KnotVector.isMonotonic([0, 0, 1, 2, 2, 3]), true);
      assert.strictEqual(KnotVector.isMonotonic([0, 1, 0.5, 3]), false);
    });

    runner.test('expectedLength: numControlPoints + degree + 1 (Piegl & Tiller eq. 2.1)', () =>
    {
      assert.strictEqual(KnotVector.expectedLength(5, 2), 8);
      assert.strictEqual(KnotVector.expectedLength(4, 3), 8);
    });

    runner.test('multiplicityAt: counts the run of equal values around an index', () =>
    {
      const knots = [0, 0, 0, 1, 2, 3, 3, 3];
      assert.strictEqual(KnotVector.multiplicityAt(knots, 0), 3);
      assert.strictEqual(KnotVector.multiplicityAt(knots, 1), 3);
      assert.strictEqual(KnotVector.multiplicityAt(knots, 2), 3);
      assert.strictEqual(KnotVector.multiplicityAt(knots, 3), 1);
      assert.strictEqual(KnotVector.multiplicityAt(knots, 7), 3);
    });

    runner.test('validate: a valid OPEN knot vector (hand-built) returns true', () =>
    {
      // 5 control points, degree 2 -> expectedLength 8. Plain non-decreasing,
      // no endpoint constraint -- satisfies OPEN.
      assert.strictEqual(KnotVector.validate([0, 0, 1, 2, 3, 4, 5, 5], 5, 2, KnotVector.MODE.OPEN), true);
    });

    runner.test('validate: OPEN is the default mode when omitted', () =>
    {
      assert.strictEqual(KnotVector.validate([0, 1, 2, 3, 4, 5, 6, 7], 5, 2), true);
    });

    runner.test('validate: throws on a non-monotonic sequence', () =>
    {
      assert.throws(() => KnotVector.validate([0, 1, 0.5, 3, 4, 5, 6, 7], 5, 2), /non-decreasing/);
    });

    runner.test('validate: throws when length does not match the contract', () =>
    {
      assert.throws(() => KnotVector.validate([0, 1, 2, 3], 5, 2), /expected 8 knots/);
    });

    runner.test('validate: throws when numControlPoints does not exceed degree', () =>
    {
      assert.throws(() => KnotVector.validate([0, 0, 0], 2, 2), /must exceed degree/);
    });

    runner.test('validate: CLAMPED accepts correct endpoint multiplicity (hand-built, Piegl & Tiller convention)', () =>
    {
      // 5 control points, degree 2 -> multiplicity 3 required at each end.
      assert.strictEqual(KnotVector.validate([0, 0, 0, 1, 2, 3, 3, 3], 5, 2, KnotVector.MODE.CLAMPED), true);
    });

    runner.test('validate: CLAMPED rejects a start multiplicity that is too low', () =>
    {
      // Monotonic, correct length (8), but only two leading zeros -- degree 2 requires three.
      assert.throws(() => KnotVector.validate([0, 0, 1, 2, 3, 3, 3, 4], 5, 2, KnotVector.MODE.CLAMPED), /first knot to repeat/);
    });

    runner.test('validate: CLAMPED rejects an end multiplicity that is too low', () =>
    {
      assert.throws(() => KnotVector.validate([0, 0, 0, 1, 2, 2, 3, 4], 5, 2, KnotVector.MODE.CLAMPED), /last knot to repeat/);
    });

    runner.test('validate: throws on an unknown mode string', () =>
    {
      assert.throws(() => KnotVector.validate([0, 1, 2, 3, 4, 5, 6, 7], 5, 2, 'periodic'), /unknown mode/);
    });

    runner.test('uniform: generates a valid OPEN knot vector, 0..(n+p)', () =>
    {
      const knots = KnotVector.uniform(5, 2);
      assert.deepStrictEqual(knots, [0, 1, 2, 3, 4, 5, 6, 7]);
      assert.strictEqual(KnotVector.validate(knots, 5, 2, KnotVector.MODE.OPEN), true);
    });

    runner.test('clamped: generates a valid CLAMPED knot vector on [0,1] (hand-computed)', () =>
    {
      // 5 control points, degree 2: interiorCount = 5-2-1 = 2, interior
      // knots at 1/3 and 2/3.
      const knots = KnotVector.clamped(5, 2);
      assert.deepStrictEqual(knots, [0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1]);
      assert.strictEqual(KnotVector.validate(knots, 5, 2, KnotVector.MODE.CLAMPED), true);
    });

    runner.test('clamped: degree+1 control points (no interior knots) is just the two endpoint clusters', () =>
    {
      const knots = KnotVector.clamped(3, 2);
      assert.deepStrictEqual(knots, [0, 0, 0, 1, 1, 1]);
      assert.strictEqual(KnotVector.validate(knots, 3, 2, KnotVector.MODE.CLAMPED), true);
    });

    runner.test('clamped: throws when numControlPoints does not exceed degree', () =>
    {
      assert.throws(() => KnotVector.clamped(2, 2), /must exceed degree/);
    });

    runner.test('static functions and instance methods agree', () =>
    {
      const kv = new KnotVector().init();
      assert.strictEqual(kv.expectedLength(5, 2), KnotVector.expectedLength(5, 2));
      assert.deepStrictEqual(kv.clamped(5, 2), KnotVector.clamped(5, 2));
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
