/**
 * @file research/lib/chain/tests/Vector.unit.js
 * @author Will Fobbs
 * @description Coverage for Math.ext.Vector: elementwise arithmetic,
 *              dimension-mismatch errors, non-mutation, dot/norm against
 *              hand-computed values, and linearCombination() verified
 *              against an independently-computed quadratic Bezier
 *              evaluation (the exact operation control-point blending
 *              needs) -- not just internal self-consistency.
 */
const assert = require('assert');
require('../MathExt.js');
const Vector = require('../Vector.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Vector', () =>
  {
    runner.test('Math.init(Vector) installed it at Math.ext.Vector', () =>
    {
      assert.strictEqual(typeof Math.ext.Vector, 'object');
      assert.deepStrictEqual(Math.ext.Vector.add([1, 2], [3, 4]), [4, 6]);
    });

    runner.test('add / subtract / scale, elementwise', () =>
    {
      assert.deepStrictEqual(Vector.add([1, 2, 3], [10, 20, 30]), [11, 22, 33]);
      assert.deepStrictEqual(Vector.subtract([10, 20, 30], [1, 2, 3]), [9, 18, 27]);
      assert.deepStrictEqual(Vector.scale([1, 2, 3], 2), [2, 4, 6]);
    });

    runner.test('add / subtract throw on dimension mismatch', () =>
    {
      assert.throws(() => Vector.add([1, 2], [1, 2, 3]), /dimension mismatch/);
      assert.throws(() => Vector.subtract([1, 2], [1]), /dimension mismatch/);
    });

    runner.test('operations are non-mutating', () =>
    {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      Vector.add(a, b);
      Vector.scale(a, 10);
      assert.deepStrictEqual(a, [1, 2, 3]);
      assert.deepStrictEqual(b, [4, 5, 6]);
    });

    runner.test('dot: (1,2,3).(4,5,6) = 32', () =>
    {
      assert.strictEqual(Vector.dot([1, 2, 3], [4, 5, 6]), 32);
    });

    runner.test('dot throws on dimension mismatch', () =>
    {
      assert.throws(() => Vector.dot([1, 2], [1, 2, 3]), /dimension mismatch/);
    });

    runner.test('norm: ||(3,4)|| = 5', () =>
    {
      assert.strictEqual(Vector.norm([3, 4]), 5);
    });

    runner.test('linearCombination throws on weights/vectors length mismatch', () =>
    {
      assert.throws(() => Vector.linearCombination([1, 2], [[1, 1]]), /weights\.length/);
    });

    runner.test('linearCombination throws on a vector of the wrong dimension', () =>
    {
      assert.throws(() => Vector.linearCombination([1, 1], [[1, 1], [1, 1, 1]]), /dimension/);
    });

    runner.test('linearCombination: control-point blending matches an independently-computed quadratic Bezier at t=0.5', () =>
    {
      // B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2 -- computed by hand at
      // t=0.5 with P0=(0,0), P1=(2,4), P2=(4,0):
      //   B(0.5) = 0.25*(0,0) + 0.5*(2,4) + 0.25*(4,0) = (1,2) + (1,0) = (2,2)
      const P0 = [0, 0], P1 = [2, 4], P2 = [4, 0];
      const weights = [0.25, 0.5, 0.25]; // Bernstein basis values at t=0.5, computed independently of Vector
      const blended = Vector.linearCombination(weights, [P0, P1, P2]);
      assert.deepStrictEqual(blended, [2, 2]);
    });

    runner.test('linearCombination with a single vector returns weight*vector', () =>
    {
      assert.deepStrictEqual(Vector.linearCombination([3], [[1, 2]]), [3, 6]);
    });

    runner.test('static functions and instance methods agree', () =>
    {
      const v = new Vector().init();
      assert.deepStrictEqual(v.add([1, 2], [3, 4]), Vector.add([1, 2], [3, 4]));
      assert.strictEqual(v.dot([1, 2], [3, 4]), Vector.dot([1, 2], [3, 4]));
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
