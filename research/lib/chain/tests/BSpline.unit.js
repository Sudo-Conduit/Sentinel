/**
 * @file research/lib/chain/tests/BSpline.unit.js
 * @author Will Fobbs
 * @description Coverage for Math.ext.BSpline: hand-verifiable invariants
 *              (partition of unity, clamped-endpoint interpolation), and
 *              the two independent cross-validations ROADMAP.md's H.3
 *              scoring note calls for:
 *
 *              1. Against `pooledimpact/mountainshift/apps/GeoAPI.js`'s
 *                 `GeoJS._computeBasis` (iterative) -- this is a live
 *                 require of the real file, not a reproduction, and the
 *                 comparison FOUND a real bug there (see BSpline.js's own
 *                 header): a `GeoJS` configured with `degree: 3` actually
 *                 evaluates a degree-2 basis, due to an off-by-one in its
 *                 recursion's loop bound. Asserted two ways: this file's
 *                 `basisAll(t, 2, ...)` matches GeoAPI's degree-3-config
 *                 output exactly, and this file's `basisAll(t, 3, ...)`
 *                 (the actually-correct degree-3 basis) does NOT.
 *              2. Against `pooledimpact/mountainshift/v2/Anomalies_Test017.js`'s
 *                 `_bsplineBasis`/`_bsplineDerivative` -- a private,
 *                 unexported closure, so reproduced verbatim here
 *                 (citing the exact source lines) rather than requiring
 *                 the whole module and reaching into its private state.
 *                 This one is textbook-correct and matches term for term.
 */
const assert = require('assert');
require('../MathExt.js');
require('../KnotVector.js');
require('../Vector.js');
const BSpline = require('../BSpline.js');
const KnotVector = require('../KnotVector.js');

// ─── Beacon reference, reproduced verbatim from
// pooledimpact/mountainshift/v2/Anomalies_Test017.js:118-147 (private,
// unexported closures -- cited, not required, since they are not on
// that module's returned surface).
function beaconKnots(n, p)
{
  const knotCount = n + p + 2;
  const knots = new Array(knotCount);
  for (let i = 0; i < knotCount; i++)
  {
    if (i <= p) knots[i] = 0;
    else if (i > n) knots[i] = 1;
    else knots[i] = (i - p) / (n - p + 1);
  }
  return knots;
}
function beaconBasis(i, p, t, knots)
{
  if (p === 0) return (knots[i] <= t && t < knots[i + 1]) ? 1 : 0;
  let left = 0, right = 0;
  const denom1 = knots[i + p] - knots[i];
  const denom2 = knots[i + p + 1] - knots[i + 1];
  if (denom1 > 1e-12) left = ((t - knots[i]) / denom1) * beaconBasis(i, p - 1, t, knots);
  if (denom2 > 1e-12) right = ((knots[i + p + 1] - t) / denom2) * beaconBasis(i + 1, p - 1, t, knots);
  return left + right;
}
function beaconDerivative(i, p, t, knots)
{
  if (p === 0) return 0;
  let left = 0, right = 0;
  const denom1 = knots[i + p] - knots[i];
  const denom2 = knots[i + p + 1] - knots[i + 1];
  if (denom1 > 1e-12) left = (p / denom1) * beaconBasis(i, p - 1, t, knots);
  if (denom2 > 1e-12) right = (p / denom2) * beaconBasis(i + 1, p - 1, t, knots);
  return left - right;
}

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('BSpline', () =>
  {
    runner.test('Math.init(BSpline) installed it at Math.ext.BSpline', () =>
    {
      assert.strictEqual(typeof Math.ext.BSpline, 'object');
    });

    runner.test('basisAll: partition of unity (sums to 1) across the parameter domain', () =>
    {
      const knots = KnotVector.clamped(5, 2);
      [0, 0.1, 0.33, 0.5, 0.9, 1].forEach((t) =>
      {
        const N = BSpline.basisAll(t, 2, knots, 5);
        const sum = N.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(sum - 1) < 1e-9, 't=' + t + ' summed to ' + sum);
      });
    });

    runner.test('basisAll: a CLAMPED knot vector interpolates its endpoints (hand-verifiable)', () =>
    {
      const knots = KnotVector.clamped(5, 2);
      assert.deepStrictEqual(BSpline.basisAll(0, 2, knots, 5), [1, 0, 0, 0, 0]);
      assert.deepStrictEqual(BSpline.basisAll(1, 2, knots, 5), [0, 0, 0, 0, 1]);
    });

    runner.test('evaluate: a CLAMPED curve passes through its first/last control points exactly', () =>
    {
      const knots = KnotVector.clamped(5, 2);
      const cps = [[0, 0], [1, 2], [2, 3], [3, 2], [4, 0]];
      assert.deepStrictEqual(BSpline.evaluate(cps, knots, 2, 0), [0, 0]);
      assert.deepStrictEqual(BSpline.evaluate(cps, knots, 2, 1), [4, 0]);
    });

    runner.test('evaluate: throws when the knot vector fails validation (delegates to KnotVector)', () =>
    {
      assert.throws(() => BSpline.evaluate([[0, 0], [1, 1]], [0, 0, 1], 2, 0.5), /KnotVector\.validate/);
    });

    runner.test('cross-validation (Beacon, Anomalies_Test017.js): basis matches its private recursive reference exactly', () =>
    {
      const n = 6, p = 3;
      const knots = beaconKnots(n, p);
      [0, 0.05, 0.2, 0.37, 0.5, 0.61, 0.8, 0.99].forEach((t) =>
      {
        for (let i = 0; i <= n; i++)
        {
          const expected = beaconBasis(i, p, t, knots);
          const actual = BSpline.basis(i, p, t, knots);
          assert.ok(Math.abs(expected - actual) < 1e-9, 'i=' + i + ' t=' + t + ': expected ' + expected + ', got ' + actual);
        }
      });
    });

    runner.test('cross-validation (Beacon, Anomalies_Test017.js): basisDerivative matches its private recursive reference exactly', () =>
    {
      const n = 6, p = 3;
      const knots = beaconKnots(n, p);
      [0, 0.05, 0.2, 0.37, 0.5, 0.61, 0.8, 0.99].forEach((t) =>
      {
        for (let i = 0; i <= n; i++)
        {
          const expected = beaconDerivative(i, p, t, knots);
          const actual = BSpline.basisDerivative(i, p, t, knots);
          assert.ok(Math.abs(expected - actual) < 1e-9, 'i=' + i + ' t=' + t + ': expected ' + expected + ', got ' + actual);
        }
      });
    });

    runner.test('cross-validation (GeoJS, GeoAPI.js): degree-3-configured GeoJS actually computes a degree-2 basis (found bug, confirmed live)', () =>
    {
      let GeoJS;
      try
      {
        ({ GeoJS } = require('../../../../pooledimpact/mountainshift/apps/GeoAPI.js'));
      }
      catch (e)
      {
        // Reference file not present in this checkout (e.g. a partial
        // clone) -- skip rather than fail; the Beacon cross-validation
        // above already independently confirms basis()/basisDerivative()
        // against a second, textbook-correct source.
        return;
      }
      const g = new GeoJS({ dimensions: 1, degree: 3 });
      g._controlPoints = [0, 1, 2, 3, 4].map((i) => ({ coordinates: [i], timestamp: i }));
      g._weights = new Float64Array([1, 1, 1, 1, 1]);
      g._rebuildKnots();
      const knots = Array.from(g._knots);
      const n = g._controlPoints.length - 1;

      // Exact match against THIS file's degree-2 basis on GeoJS's own
      // "degree 3" knot vector -- across the full domain, endpoints included.
      [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].forEach((t) =>
      {
        const geo = Array.from(g._computeBasis(t, n, 3)).slice(0, 5);
        const mineDeg2 = BSpline.basisAll(t, 2, knots, 5);
        geo.forEach((v, i) =>
        {
          assert.ok(Math.abs(v - mineDeg2[i]) < 1e-9, 't=' + t + ' i=' + i + ': GeoJS degree-3-config=' + v + ', this file degree-2=' + mineDeg2[i]);
        });
      });

      // And genuinely NOT a match against the degree GeoJS claims to
      // compute (3), at interior parameter values where degree actually
      // changes the shape (both endpoints collapse to the same [0,1] or
      // [0,...,1] vector regardless of degree, so they are excluded --
      // that agreement there is expected and not informative).
      [0.1, 0.25, 0.5, 0.75, 0.9].forEach((t) =>
      {
        const geo = Array.from(g._computeBasis(t, n, 3)).slice(0, 5);
        const mineDeg3 = BSpline.basisAll(t, 3, knots, 5);
        const allClose = geo.every((v, i) => Math.abs(v - mineDeg3[i]) < 1e-9);
        assert.strictEqual(allClose, false, 't=' + t + ': GeoJS degree-3-config unexpectedly matched an actual degree-3 basis -- the off-by-one this test documents may have been fixed upstream');
      });
    });

    runner.test('static functions and instance methods agree', () =>
    {
      const b = new BSpline().init();
      const knots = KnotVector.clamped(3, 2);
      assert.strictEqual(b.basis(0, 2, 0.5, knots), BSpline.basis(0, 2, 0.5, knots));
      assert.deepStrictEqual(b.basisAll(0.5, 2, knots, 3), BSpline.basisAll(0.5, 2, knots, 3));
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
