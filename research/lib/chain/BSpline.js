/**
 * @file research/lib/chain/BSpline.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Math.ext.BSpline -- Cox-de Boor basis functions, their
 *              derivatives, and curve evaluation, built directly on top
 *              of H.1 (`Polynomial.evaluate`'s degree discipline) and H.2
 *              (`KnotVector.validate`, called first on every entry point
 *              here -- never evaluate a basis function against an
 *              unvalidated knot vector). Control-point blending itself is
 *              `Vector.linearCombination` (G's own "the one operation
 *              Bezier/B-spline/NURBS all actually need underneath them"),
 *              not reimplemented here.
 *
 *              `basis(i, degree, t, knots)` is the plain textbook
 *              recursive definition (Piegl & Tiller, "The NURBS Book",
 *              eq. 2.5) -- not the more efficient O(p) localized
 *              algorithm (their Algorithm A2.2). Deliberately: this
 *              chain's own convention (`Torus.js`, `Vector.js`) is to
 *              stay direct and simple over prematurely optimized, and an
 *              O(n·p) evaluation is not the bottleneck anywhere this
 *              chain is used yet. If that changes, a localized
 *              `findSpan`-based rewrite is a drop-in internal
 *              optimization -- the public surface here does not need to
 *              change for it.
 *
 *              **Cross-validated against two independent implementations
 *              already in this repository** (per ROADMAP.md's H.3
 *              scoring note):
 *              - `pooledimpact/mountainshift/apps/GeoAPI.js`
 *                (`GeoJS._computeBasis`, an iterative, whole-array Cox-de
 *                Boor) -- cross-checking this FOUND A REAL BUG in that
 *                file, not merely confirmed agreement: its recursive
 *                loop runs `for (p = 2; p <= k; p++)` starting from a
 *                degree-0 base case, which performs only `k-1` degree
 *                raises, not `k` -- so a `GeoJS` instance configured with
 *                `degree: 3` ("cubic, minimum for C²" per its own
 *                docblock) actually evaluates a DEGREE-2 basis. Confirmed
 *                directly: `GeoJS._computeBasis(t, n, 3)` on a given knot
 *                vector matches THIS file's `basisAll(t, 2, knots, ...)`
 *                on that same knot vector exactly (see
 *                `BSpline.unit.js`'s GeoAPI cross-validation suite for
 *                the reproduction) -- not this file's `basisAll(t, 3,
 *                ...)`, which is what `GeoJS`'s own docblock claims it
 *                computes. This file's loop bound (`p` runs `1..degree`
 *                inclusive from the degree-0 base case, `degree`
 *                iterations) does not have this off-by-one.
 *              - `pooledimpact/mountainshift/v2/Anomalies_Test017.js`
 *                (`_bsplineBasis`/`_bsplineDerivative`, a private,
 *                unexported recursive Cox-de Boor and its derivative) --
 *                this one is textbook-correct and matches this file's
 *                `basis`/`basisDerivative` exactly, term for term. Since
 *                it is a private closure (not exported by that module),
 *                `BSpline.unit.js` reproduces its exact recursive
 *                formula inline, citing the source file/line, rather
 *                than reaching into another module's private state.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example Math.ext.BSpline.evaluate([[0,0],[2,4],[4,0]], Math.ext.KnotVector.clamped(3, 2), 2, 0.5);
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    require('./MathExt.js');
    require('./KnotVector.js');
    require('./Vector.js');
    module.exports = factory(require('./KnotVector.js'), require('./Vector.js'));
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./MathExt', './KnotVector', './Vector'], function (KnotVector, Vector) { return factory(KnotVector, Vector); });
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.BSpline = factory(root.Chain.KnotVector, root.Chain.Vector);
  }
}(typeof self !== 'undefined' ? self : this, function (KnotVector, Vector)
{
  'use strict';

  const EPS = 1e-12;

  /**
   * Cox-de Boor recursion for a single basis function `N_{i,p}(t)`.
   * Base case (`p===0`): the characteristic function of knot span `i`.
   * Matches `Anomalies_Test017.js:_bsplineBasis` (lines ~129-137) term
   * for term -- see this file's header for why that specific match
   * matters (an independent cross-validation source, not a coincidence).
   * @param {number} i basis function index
   * @param {number} p degree
   * @param {number} t parameter
   * @param {number[]} knots
   * @returns {number}
   */
  function basis(i, p, t, knots)
  {
    if (p === 0)
    {
      return (t >= knots[i] && t < knots[i + 1]) ? 1 : 0;
    }
    let left = 0;
    let right = 0;
    const denom1 = knots[i + p] - knots[i];
    const denom2 = knots[i + p + 1] - knots[i + 1];
    if (denom1 > EPS)
    {
      left = ((t - knots[i]) / denom1) * basis(i, p - 1, t, knots);
    }
    if (denom2 > EPS)
    {
      right = ((knots[i + p + 1] - t) / denom2) * basis(i + 1, p - 1, t, knots);
    }
    return left + right;
  }

  /**
   * d/dt N_{i,p}(t) = p/(knots[i+p]-knots[i]) * N_{i,p-1}(t)
   *                 - p/(knots[i+p+1]-knots[i+1]) * N_{i+1,p-1}(t)
   * Matches `Anomalies_Test017.js:_bsplineDerivative` (lines ~139-147).
   * @param {number} i @param {number} p @param {number} t @param {number[]} knots
   * @returns {number}
   */
  function basisDerivative(i, p, t, knots)
  {
    if (p === 0)
    {
      return 0;
    }
    let left = 0;
    let right = 0;
    const denom1 = knots[i + p] - knots[i];
    const denom2 = knots[i + p + 1] - knots[i + 1];
    if (denom1 > EPS)
    {
      left = (p / denom1) * basis(i, p - 1, t, knots);
    }
    if (denom2 > EPS)
    {
      right = (p / denom2) * basis(i + 1, p - 1, t, knots);
    }
    return left - right;
  }

  /**
   * All `numControlPoints` basis function values at `t`, `N_0..N_{n}`.
   * Handles the `t === last knot` boundary explicitly: the degree-0 base
   * case's half-open `[knots[i], knots[i+1])` test excludes the curve's
   * own final parameter value from every span, which would otherwise
   * make the whole basis vanish exactly at `t=1` on a standard [0,1]
   * knot vector -- the same boundary case `GeoJS._computeBasis` (and
   * this file's own cross-validation of it) has to special-case too.
   * @param {number} t @param {number} degree @param {number[]} knots @param {number} numControlPoints
   * @returns {number[]}
   */
  function basisAll(t, degree, knots, numControlPoints)
  {
    const n = numControlPoints - 1;
    if (t === knots[knots.length - 1])
    {
      const result = new Array(numControlPoints).fill(0);
      result[n] = 1;
      return result;
    }
    const result = new Array(numControlPoints);
    for (let i = 0; i <= n; i++)
    {
      result[i] = basis(i, degree, t, knots);
    }
    return result;
  }

  /**
   * Point on the B-spline curve at `t`. Validates the knot vector first
   * (H.2's `KnotVector.validate`, MODE.OPEN -- a caller wanting the
   * stricter CLAMPED guarantee validates that themselves before calling
   * in, since a valid non-clamped curve is equally legitimate input
   * here) and blends control points via `Vector.linearCombination`
   * (G's shared control-point-blending primitive), never reimplementing
   * either.
   * @param {number[][]} controlPoints each an array of coordinates, e.g. [[0,0],[2,4],[4,0]]
   * @param {number[]} knots
   * @param {number} degree
   * @param {number} t
   * @returns {number[]}
   */
  function evaluate(controlPoints, knots, degree, t)
  {
    KnotVector.validate(knots, controlPoints.length, degree, KnotVector.MODE.OPEN);
    const weights = basisAll(t, degree, knots, controlPoints.length);
    return Vector.linearCombination(weights, controlPoints);
  }

  /**
   * Tangent vector (d/dt of the curve) at `t` -- the same control-point
   * blend as `evaluate`, with `basisDerivative` weights instead of
   * `basis` weights.
   * @param {number[][]} controlPoints
   * @param {number[]} knots
   * @param {number} degree
   * @param {number} t
   * @returns {number[]}
   */
  function derivative(controlPoints, knots, degree, t)
  {
    KnotVector.validate(knots, controlPoints.length, degree, KnotVector.MODE.OPEN);
    const weights = controlPoints.map((_, i) => basisDerivative(i, degree, t, knots));
    return Vector.linearCombination(weights, controlPoints);
  }

  class BSpline
  {
    static extName = 'BSpline';
    static name = 'BSpline';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Math.ext.BSpline -- Cox-de Boor basis/basisDerivative and curve evaluation, built on KnotVector (H.2) + Vector.linearCombination (G).';
    static docs = ['research/lib/chain/docs/BSpline.md'];
    static tests = ['research/lib/chain/tests/BSpline.unit.js'];
    static config_default = {};

    static basis = basis;
    static basisDerivative = basisDerivative;
    static basisAll = basisAll;
    static evaluate = evaluate;
    static derivative = derivative;

    constructor()
    {
    }

    /** @returns {BSpline} this, for chaining -- no configuration required */
    init()
    {
      return this;
    }

    basis(i, degree, t, knots) { return basis(i, degree, t, knots); }
    basisDerivative(i, degree, t, knots) { return basisDerivative(i, degree, t, knots); }
    basisAll(t, degree, knots, numControlPoints) { return basisAll(t, degree, knots, numControlPoints); }
    evaluate(controlPoints, knots, degree, t) { return evaluate(controlPoints, knots, degree, t); }
    derivative(controlPoints, knots, degree, t) { return derivative(controlPoints, knots, degree, t); }
  }

  if (typeof Math !== 'undefined' && typeof Math.init === 'function')
  {
    Math.init(BSpline);
  }

  return BSpline;
}));
