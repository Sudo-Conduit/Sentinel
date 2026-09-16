/**
 * @file research/lib/chain/tests/NURBS.unit.js
 * @author Will Fobbs
 * @description Coverage for Math.ext.NURBS: the classic exact-quarter-
 *              circle construction (a rational curve no plain B-spline
 *              can represent exactly -- the concrete reason NURBS exists
 *              at all, not just asserted in prose), the uniform-weight
 *              reduction to BSpline (a structural identity needing no
 *              external reference), the quotient-rule derivative
 *              cross-checked numerically, and weight validation.
 */
const assert = require('assert');
require('../MathExt.js');
require('../KnotVector.js');
require('../Vector.js');
require('../BSpline.js');
const NURBS = require('../NURBS.js');
const BSpline = require('../BSpline.js');
const KnotVector = require('../KnotVector.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('NURBS', () =>
  {
    // Piegl & Tiller §7.3's exact-circular-arc construction: three
    // control points, weights (1, 1/sqrt(2), 1), degree 2, knots
    // [0,0,0,1,1,1] -- traces a quarter circle of radius 1 EXACTLY.
    const circleControlPoints = [[1, 0], [1, 1], [0, 1]];
    const circleWeights = [1, 1 / Math.SQRT2, 1];
    const circleKnots = [0, 0, 0, 1, 1, 1];
    const circleDegree = 2;

    runner.test('Math.init(NURBS) installed it at Math.ext.NURBS', () =>
    {
      assert.strictEqual(typeof Math.ext.NURBS, 'object');
    });

    runner.test('evaluate: the exact-quarter-circle construction traces radius=1 at every t (the reason NURBS exists over BSpline)', () =>
    {
      [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1].forEach((t) =>
      {
        const p = NURBS.evaluate(circleControlPoints, circleWeights, circleKnots, circleDegree, t);
        const radius = Math.hypot(p[0], p[1]);
        assert.ok(Math.abs(radius - 1) < 1e-9, 't=' + t + ': radius=' + radius + ', expected 1');
      });
    });

    runner.test('evaluate: quarter-circle endpoints are exactly (1,0) and (0,1)', () =>
    {
      const start = NURBS.evaluate(circleControlPoints, circleWeights, circleKnots, circleDegree, 0);
      const end = NURBS.evaluate(circleControlPoints, circleWeights, circleKnots, circleDegree, 1);
      assert.deepStrictEqual(start, [1, 0]);
      assert.deepStrictEqual(end, [0, 1]);
    });

    runner.test('evaluate: quarter-circle midpoint is exactly (1/sqrt2, 1/sqrt2) (hand-computed)', () =>
    {
      const mid = NURBS.evaluate(circleControlPoints, circleWeights, circleKnots, circleDegree, 0.5);
      assert.ok(Math.abs(mid[0] - Math.SQRT1_2) < 1e-9);
      assert.ok(Math.abs(mid[1] - Math.SQRT1_2) < 1e-9);
    });

    runner.test('a plain BSpline (ignoring the weights) does NOT trace the same circle -- the rational weighting is load-bearing, not decorative', () =>
    {
      const p = BSpline.evaluate(circleControlPoints, circleKnots, circleDegree, 0.5);
      const radius = Math.hypot(p[0], p[1]);
      assert.ok(Math.abs(radius - 1) > 1e-3, 'expected the unweighted B-spline midpoint to NOT sit on the unit circle, radius was ' + radius);
    });

    runner.test('structural reduction: uniform weights make NURBS.evaluate agree with BSpline.evaluate exactly', () =>
    {
      const cps = [[0, 0], [1, 2], [2, 3], [3, 2], [4, 0]];
      const knots = KnotVector.clamped(5, 2);
      const uniformWeights = [1, 1, 1, 1, 1];
      [0, 0.2, 0.5, 0.8, 1].forEach((t) =>
      {
        const nurbsPoint = NURBS.evaluate(cps, uniformWeights, knots, 2, t);
        const bsplinePoint = BSpline.evaluate(cps, knots, 2, t);
        nurbsPoint.forEach((v, i) =>
        {
          assert.ok(Math.abs(v - bsplinePoint[i]) < 1e-9, 't=' + t + ' dim=' + i + ': nurbs=' + v + ', bspline=' + bsplinePoint[i]);
        });
      });
    });

    runner.test('rationalBasisAll: partition of unity (sums to 1) regardless of weights', () =>
    {
      [0, 0.1, 0.5, 0.9, 1].forEach((t) =>
      {
        const R = NURBS.rationalBasisAll(t, circleDegree, circleKnots, circleWeights);
        const sum = R.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(sum - 1) < 1e-9, 't=' + t + ' summed to ' + sum);
      });
    });

    runner.test('derivative: matches a central-difference numerical estimate on the quarter circle', () =>
    {
      const h = 1e-6;
      [0.1, 0.3, 0.5, 0.7, 0.9].forEach((t) =>
      {
        const plus = NURBS.evaluate(circleControlPoints, circleWeights, circleKnots, circleDegree, t + h);
        const minus = NURBS.evaluate(circleControlPoints, circleWeights, circleKnots, circleDegree, t - h);
        const numeric = plus.map((v, i) => (v - minus[i]) / (2 * h));
        const analytic = NURBS.derivative(circleControlPoints, circleWeights, circleKnots, circleDegree, t);
        numeric.forEach((v, i) =>
        {
          assert.ok(Math.abs(v - analytic[i]) < 1e-4, 't=' + t + ' dim=' + i + ': numeric=' + v + ', analytic=' + analytic[i]);
        });
      });
    });

    runner.test('evaluate: throws when weights.length does not match control point count', () =>
    {
      assert.throws(() => NURBS.evaluate(circleControlPoints, [1, 1], circleKnots, circleDegree, 0.5), /weights\.length/);
    });

    runner.test('evaluate: throws on a non-positive weight', () =>
    {
      assert.throws(() => NURBS.evaluate(circleControlPoints, [1, 0, 1], circleKnots, circleDegree, 0.5), /must be strictly positive/);
      assert.throws(() => NURBS.evaluate(circleControlPoints, [1, -1, 1], circleKnots, circleDegree, 0.5), /must be strictly positive/);
    });

    runner.test('evaluate: throws when the knot vector fails validation (delegates to KnotVector)', () =>
    {
      assert.throws(() => NURBS.evaluate(circleControlPoints, circleWeights, [0, 0, 1], circleDegree, 0.5), /KnotVector\.validate/);
    });

    runner.test('static functions and instance methods agree', () =>
    {
      const n = new NURBS().init();
      const a = n.evaluate(circleControlPoints, circleWeights, circleKnots, circleDegree, 0.5);
      const b = NURBS.evaluate(circleControlPoints, circleWeights, circleKnots, circleDegree, 0.5);
      assert.deepStrictEqual(a, b);
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
