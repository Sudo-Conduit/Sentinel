/**
 * @file research/lib/chain/tests/Bezier.unit.js
 * @author Will Fobbs
 * @description Coverage for Math.ext.Bezier: a hand-computed quadratic
 *              Bezier point (independently checkable by hand, not just
 *              internal self-consistency), the two independent curve
 *              evaluators (De Casteljau vs the direct Bernstein sum)
 *              cross-validated against each other, `bernstein` vs
 *              `bernsteinViaPolynomial` (the same basis function computed
 *              two structurally different ways -- direct binomial
 *              formula vs H.1's `Polynomial.evaluate` on the expanded
 *              coefficients), and the hodograph-based derivative.
 */
const assert = require('assert');
require('../MathExt.js');
require('../Polynomial.js');
require('../Vector.js');
const Bezier = require('../Bezier.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Bezier', () =>
  {
    runner.test('Math.init(Bezier) installed it at Math.ext.Bezier', () =>
    {
      assert.strictEqual(typeof Math.ext.Bezier, 'object');
    });

    runner.test('binomial: hand-computed values, including out-of-range k', () =>
    {
      assert.strictEqual(Bezier.binomial(4, 2), 6);
      assert.strictEqual(Bezier.binomial(5, 0), 1);
      assert.strictEqual(Bezier.binomial(5, 5), 1);
      assert.strictEqual(Bezier.binomial(5, 6), 0);
      assert.strictEqual(Bezier.binomial(5, -1), 0);
    });

    runner.test('bernsteinAll: partition of unity (sums to 1) for any degree/t', () =>
    {
      [1, 2, 3, 5].forEach((n) =>
      {
        [0, 0.1, 0.5, 0.9, 1].forEach((t) =>
        {
          const sum = Bezier.bernsteinAll(n, t).reduce((a, b) => a + b, 0);
          assert.ok(Math.abs(sum - 1) < 1e-9, 'n=' + n + ' t=' + t + ' summed to ' + sum);
        });
      });
    });

    runner.test('bernstein vs bernsteinViaPolynomial: the same basis function, two independent computations, agree', () =>
    {
      for (let n = 0; n <= 5; n++)
      {
        for (let i = 0; i <= n; i++)
        {
          [0, 0.2, 0.5, 0.8, 1].forEach((t) =>
          {
            const direct = Bezier.bernstein(i, n, t);
            const viaPoly = Bezier.bernsteinViaPolynomial(i, n, t);
            assert.ok(Math.abs(direct - viaPoly) < 1e-9, 'n=' + n + ' i=' + i + ' t=' + t + ': direct=' + direct + ', viaPolynomial=' + viaPoly);
          });
        }
      }
    });

    runner.test('bernsteinCoefficients: degree-2 basis functions match hand-expanded binomials', () =>
    {
      // B_{0,2}(t) = (1-t)^2 = 1 - 2t + t^2
      assert.deepStrictEqual(Bezier.bernsteinCoefficients(2, 0), [1, -2, 1]);
      // B_{1,2}(t) = 2t(1-t) = 2t - 2t^2
      assert.deepStrictEqual(Bezier.bernsteinCoefficients(2, 1), [0, 2, -2]);
      // B_{2,2}(t) = t^2
      assert.deepStrictEqual(Bezier.bernsteinCoefficients(2, 2), [0, 0, 1]);
    });

    runner.test('evaluate: hand-computed quadratic Bezier point at t=0.5 (independently checkable)', () =>
    {
      // (0,0),(2,4),(4,0) at t=0.5: 0.25*(0,0)+0.5*(2,4)+0.25*(4,0) = (2,2)
      assert.deepStrictEqual(Bezier.evaluate([[0, 0], [2, 4], [4, 0]], 0.5), [2, 2]);
    });

    runner.test('evaluate: endpoints are exactly the first/last control points', () =>
    {
      const cps = [[0, 0], [2, 4], [4, 0]];
      assert.deepStrictEqual(Bezier.evaluate(cps, 0), [0, 0]);
      assert.deepStrictEqual(Bezier.evaluate(cps, 1), [4, 0]);
    });

    runner.test('cross-validation: De Casteljau and the direct Bernstein sum agree across degree/t', () =>
    {
      const cubics = [[0, 0], [1, 3], [3, 3], [4, 0]];
      [0, 0.1, 0.33, 0.5, 0.75, 0.9, 1].forEach((t) =>
      {
        const a = Bezier.evaluate(cubics, t);
        const b = Bezier.evaluateBernstein(cubics, t);
        a.forEach((v, i) =>
        {
          assert.ok(Math.abs(v - b[i]) < 1e-9, 't=' + t + ' dim=' + i + ': deCasteljau=' + v + ', bernstein=' + b[i]);
        });
      });
    });

    runner.test('derivative: a straight line (degree 1) has constant derivative n*(P1-P0)', () =>
    {
      const line = [[0, 0], [4, 8]];
      assert.deepStrictEqual(Bezier.derivative(line, 0.3), [4, 8]);
      assert.deepStrictEqual(Bezier.derivative(line, 0.7), [4, 8]);
    });

    runner.test('derivative: a single control point (degree 0) is the zero vector', () =>
    {
      assert.deepStrictEqual(Bezier.derivative([[5, -3]], 0.5), [0, 0]);
    });

    runner.test('derivative: matches a central-difference numerical estimate for a quadratic', () =>
    {
      const cps = [[0, 0], [2, 4], [4, 0]];
      const h = 1e-6;
      const t = 0.4;
      const numeric = Bezier.evaluate(cps, t + h).map((v, i) => (v - Bezier.evaluate(cps, t - h)[i]) / (2 * h));
      const analytic = Bezier.derivative(cps, t);
      numeric.forEach((v, i) =>
      {
        assert.ok(Math.abs(v - analytic[i]) < 1e-4, 'dim=' + i + ': numeric=' + v + ', analytic=' + analytic[i]);
      });
    });

    runner.test('static functions and instance methods agree', () =>
    {
      const b = new Bezier().init();
      const cps = [[0, 0], [2, 4], [4, 0]];
      assert.deepStrictEqual(b.evaluate(cps, 0.5), Bezier.evaluate(cps, 0.5));
      assert.strictEqual(b.bernstein(1, 2, 0.5), Bezier.bernstein(1, 2, 0.5));
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
