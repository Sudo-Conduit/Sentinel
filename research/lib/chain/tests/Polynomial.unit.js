/**
 * @file research/lib/chain/tests/Polynomial.unit.js
 * @author Will Fobbs
 * @description Coverage for Math.ext.Polynomial: evaluate() via Horner's
 *              method against hand-computed values, derivative()/integral()
 *              as genuine inverse operations of each other, degree(),
 *              add() with implicit zero-padding, scale(), and the
 *              constant-differentiates-to-zero edge case.
 */
const assert = require('assert');
require('../MathExt.js');
const Polynomial = require('../Polynomial.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Polynomial', () =>
  {
    runner.test('Math.init(Polynomial) installed it at Math.ext.Polynomial', () =>
    {
      assert.strictEqual(typeof Math.ext.Polynomial, 'object');
      assert.strictEqual(Math.ext.Polynomial.evaluate([1, 2, 3], 2), 17);
    });

    runner.test('evaluate: 1 + 2t + 3t^2 at t=2 -> 1+4+12=17 (hand-computed)', () =>
    {
      assert.strictEqual(Polynomial.evaluate([1, 2, 3], 2), 17);
    });

    runner.test('evaluate: a constant polynomial is constant everywhere', () =>
    {
      assert.strictEqual(Polynomial.evaluate([5], 0), 5);
      assert.strictEqual(Polynomial.evaluate([5], 100), 5);
    });

    runner.test('evaluate: empty coefficients evaluates to 0', () =>
    {
      assert.strictEqual(Polynomial.evaluate([], 5), 0);
    });

    runner.test('derivative: d/dt(1+2t+3t^2) = 2+6t (hand-computed)', () =>
    {
      assert.deepStrictEqual(Polynomial.derivative([1, 2, 3]), [2, 6]);
    });

    runner.test('derivative: a constant differentiates to the zero polynomial [0]', () =>
    {
      assert.deepStrictEqual(Polynomial.derivative([7]), [0]);
      assert.deepStrictEqual(Polynomial.derivative([]), [0]);
    });

    runner.test('integral: Integral(2+6t)dt = 2t+3t^2 (+C), matches [1,2,3] undoing the derivative above', () =>
    {
      const original = [1, 2, 3];
      const d = Polynomial.derivative(original);
      const integratedBack = Polynomial.integral(d, original[0]); // restore the original constant term
      assert.deepStrictEqual(integratedBack, original);
    });

    runner.test('integral: default constant of integration is 0', () =>
    {
      assert.deepStrictEqual(Polynomial.integral([2, 6]), [0, 2, 3]);
    });

    runner.test('integral: explicit constant of integration is honored', () =>
    {
      assert.deepStrictEqual(Polynomial.integral([2, 6], 10), [10, 2, 3]);
    });

    runner.test('degree: length-1, no trailing-zero trimming', () =>
    {
      assert.strictEqual(Polynomial.degree([1, 2, 3]), 2);
      assert.strictEqual(Polynomial.degree([1, 2, 3, 0, 0]), 4, 'no trimming -- caller-supplied trailing zeros are honored as-is');
      assert.strictEqual(Polynomial.degree([5]), 0);
    });

    runner.test('add: elementwise, implicitly zero-padding the shorter side', () =>
    {
      assert.deepStrictEqual(Polynomial.add([1, 2, 3], [10, 20]), [11, 22, 3]);
      assert.deepStrictEqual(Polynomial.add([1], [1, 1, 1]), [2, 1, 1]);
    });

    runner.test('scale: elementwise multiplication', () =>
    {
      assert.deepStrictEqual(Polynomial.scale([1, 2, 3], 10), [10, 20, 30]);
    });

    runner.test('static functions and instance methods agree', () =>
    {
      const p = new Polynomial().init();
      assert.strictEqual(p.evaluate([1, 2, 3], 2), Polynomial.evaluate([1, 2, 3], 2));
      assert.deepStrictEqual(p.derivative([1, 2, 3]), Polynomial.derivative([1, 2, 3]));
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
