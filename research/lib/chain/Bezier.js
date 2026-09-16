/**
 * @file research/lib/chain/Bezier.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Math.ext.Bezier -- Bernstein basis, De Casteljau evaluation,
 *              and the derivative curve, built on H.1 (`Polynomial`, for
 *              the Bernstein basis's own coefficient expansion) and
 *              `Vector` (`add`/`subtract`/`scale`/`linearCombination`) for
 *              every control-point operation, none reimplemented. Depends
 *              on H.1 only -- a plain Bezier curve has no knot vector at
 *              all, so `KnotVector` (H.2) never enters here.
 *
 *              Two INDEPENDENT ways to evaluate the same curve are both
 *              implemented and cross-validated against each other in
 *              `Bezier.unit.js`, deliberately -- not redundancy for its
 *              own sake:
 *              - `evaluate` (De Casteljau): repeated linear interpolation
 *                between consecutive control points, `n` rounds for a
 *                degree-`n` curve. The numerically standard choice --
 *                stable for high degree, no explicit binomial
 *                coefficients computed at all.
 *              - `evaluateBernstein`: the direct textbook formula,
 *                `Σᵢ C(n,i)·tⁱ·(1−t)^(n−i)·Pᵢ`, via `bernsteinAll` +
 *                `Vector.linearCombination` -- simple, but `C(n,i)` and
 *                `tⁱ`/`(1−t)^(n−i)` can lose precision against each
 *                other for large `n` in a way De Casteljau's pure
 *                averaging never does. Kept specifically BECAUSE it is
 *                the more fragile of the two -- agreement between them
 *                is a real correctness check, not two copies of the same
 *                computation.
 *
 *              `bernsteinCoefficients(n, i)` returns `B_{i,n}(t)`'s own
 *              ascending Polynomial coefficient array (expanding the
 *              binomial `(1−t)^(n−i)` term by term) -- concretely
 *              cashing in the ROADMAP.md Category H addendum's claim
 *              that the Bernstein basis is "an explicit polynomial of
 *              degree n," verified in `Bezier.unit.js` against
 *              `Polynomial.evaluate` directly, not left as an assertion.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example Math.ext.Bezier.evaluate([[0,0],[2,4],[4,0]], 0.5); // [2,2]
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    require('./MathExt.js');
    require('./Polynomial.js');
    require('./Vector.js');
    module.exports = factory(require('./Polynomial.js'), require('./Vector.js'));
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./MathExt', './Polynomial', './Vector'], function (Polynomial, Vector) { return factory(Polynomial, Vector); });
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.Bezier = factory(root.Chain.Polynomial, root.Chain.Vector);
  }
}(typeof self !== 'undefined' ? self : this, function (Polynomial, Vector)
{
  'use strict';

  /** @param {number} n @param {number} k @returns {number} n choose k, 0 outside [0,n] */
  function binomial(n, k)
  {
    if (k < 0 || k > n)
    {
      return 0;
    }
    let result = 1;
    for (let i = 0; i < k; i++)
    {
      result = result * (n - i) / (i + 1);
    }
    return result;
  }

  /**
   * B_{i,n}(t) = C(n,i) * t^i * (1-t)^(n-i), evaluated directly.
   * @param {number} i @param {number} n degree @param {number} t
   * @returns {number}
   */
  function bernstein(i, n, t)
  {
    return binomial(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i);
  }

  /** @param {number} n degree @param {number} t @returns {number[]} [B_0,n(t)..B_n,n(t)] */
  function bernsteinAll(n, t)
  {
    const result = new Array(n + 1);
    for (let i = 0; i <= n; i++)
    {
      result[i] = bernstein(i, n, t);
    }
    return result;
  }

  /**
   * B_{i,n}(t)'s own ascending Polynomial coefficient array -- expand
   * `(1-t)^(n-i) = Sum_{k=0}^{n-i} C(n-i,k)*(-1)^k*t^k`, multiply by
   * `C(n,i)*t^i` (a pure index shift on an already-ascending array), so
   * coefficients[j] = 0 for j<i, and C(n,i)*C(n-i,j-i)*(-1)^(j-i) for
   * j in [i,n].
   * @param {number} n degree @param {number} i
   * @returns {number[]} length n+1, coefficients[j] is the coefficient of t^j
   */
  function bernsteinCoefficients(n, i)
  {
    const coefficients = new Array(n + 1).fill(0);
    const outer = binomial(n, i);
    for (let k = 0; k <= n - i; k++)
    {
      coefficients[i + k] = outer * binomial(n - i, k) * (k % 2 === 0 ? 1 : -1);
    }
    return coefficients;
  }

  /**
   * `bernstein(i,n,t)` computed a second, independent way: expand
   * `B_{i,n}` into its own coefficient array (`bernsteinCoefficients`)
   * and hand it to `Polynomial.evaluate` (H.1's Horner's-method
   * evaluator) instead of the direct `C(n,i)*tⁱ*(1-t)^(n-i)` formula.
   * This is genuine reuse, not decoration -- `Bezier.unit.js` asserts
   * this agrees with `bernstein()` across many `(i,n,t)` combinations,
   * cashing in the ROADMAP.md Category H addendum's "an explicit
   * polynomial of degree n" claim as a checked fact instead of leaving
   * it asserted in prose only.
   * @param {number} i @param {number} n degree @param {number} t
   * @returns {number}
   */
  function bernsteinViaPolynomial(i, n, t)
  {
    return Polynomial.evaluate(bernsteinCoefficients(n, i), t);
  }

  /**
   * De Casteljau's algorithm: repeated linear interpolation between
   * consecutive points, one round per degree, until a single point
   * remains. Numerically standard -- see this file's header for why it
   * is kept alongside, not instead of, `evaluateBernstein`.
   * @param {number[][]} controlPoints
   * @param {number} t
   * @returns {number[]}
   */
  function deCasteljau(controlPoints, t)
  {
    let points = controlPoints;
    while (points.length > 1)
    {
      const next = new Array(points.length - 1);
      for (let i = 0; i < points.length - 1; i++)
      {
        next[i] = Vector.add(
          Vector.scale(points[i], 1 - t),
          Vector.scale(points[i + 1], t)
        );
      }
      points = next;
    }
    return points[0];
  }

  /** @param {number[][]} controlPoints @param {number} t @returns {number[]} point on the curve at t, via De Casteljau */
  function evaluate(controlPoints, t)
  {
    return deCasteljau(controlPoints, t);
  }

  /** @param {number[][]} controlPoints @param {number} t @returns {number[]} point on the curve at t, via the direct Bernstein-weighted sum */
  function evaluateBernstein(controlPoints, t)
  {
    const n = controlPoints.length - 1;
    return Vector.linearCombination(bernsteinAll(n, t), controlPoints);
  }

  /**
   * The derivative (tangent) curve: a degree-(n-1) Bezier over the
   * "hodograph" control points `Q_i = n*(P_{i+1}-P_i)`, evaluated the
   * same way as the curve itself. Standard construction -- reuses
   * `deCasteljau` rather than a separate Bernstein-derivative formula.
   * @param {number[][]} controlPoints @param {number} t
   * @returns {number[]}
   */
  function derivative(controlPoints, t)
  {
    const n = controlPoints.length - 1;
    if (n === 0)
    {
      return controlPoints[0].map(() => 0);
    }
    const hodograph = new Array(n);
    for (let i = 0; i < n; i++)
    {
      hodograph[i] = Vector.scale(Vector.subtract(controlPoints[i + 1], controlPoints[i]), n);
    }
    return deCasteljau(hodograph, t);
  }

  class Bezier
  {
    static extName = 'Bezier';
    static name = 'Bezier';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Math.ext.Bezier -- Bernstein basis, De Casteljau evaluation (cross-validated against the direct Bernstein sum), and the derivative curve. Depends on Polynomial (H.1) and Vector only.';
    static docs = ['research/lib/chain/docs/Bezier.md'];
    static tests = ['research/lib/chain/tests/Bezier.unit.js'];
    static config_default = {};

    static binomial = binomial;
    static bernstein = bernstein;
    static bernsteinAll = bernsteinAll;
    static bernsteinCoefficients = bernsteinCoefficients;
    static bernsteinViaPolynomial = bernsteinViaPolynomial;
    static deCasteljau = deCasteljau;
    static evaluate = evaluate;
    static evaluateBernstein = evaluateBernstein;
    static derivative = derivative;

    constructor()
    {
    }

    /** @returns {Bezier} this, for chaining -- no configuration required */
    init()
    {
      return this;
    }

    binomial(n, k) { return binomial(n, k); }
    bernstein(i, n, t) { return bernstein(i, n, t); }
    bernsteinAll(n, t) { return bernsteinAll(n, t); }
    bernsteinCoefficients(n, i) { return bernsteinCoefficients(n, i); }
    bernsteinViaPolynomial(i, n, t) { return bernsteinViaPolynomial(i, n, t); }
    deCasteljau(controlPoints, t) { return deCasteljau(controlPoints, t); }
    evaluate(controlPoints, t) { return evaluate(controlPoints, t); }
    evaluateBernstein(controlPoints, t) { return evaluateBernstein(controlPoints, t); }
    derivative(controlPoints, t) { return derivative(controlPoints, t); }
  }

  if (typeof Math !== 'undefined' && typeof Math.init === 'function')
  {
    Math.init(Bezier);
  }

  return Bezier;
}));
