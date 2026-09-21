/**
 * @file research/lib/chain/NURBS.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Math.ext.NURBS -- rational weighting over H.3
 * (`BSpline`)'s own basis functions: `R_{i,p}(t) = wᵢ·Nᵢ,ₚ(t) /
 * Σⱼ wⱼ·Nⱼ,ₚ(t)`. This file does not reimplement Cox-de Boor -- every
 * `R_{i,p}` and its derivative are built directly from
 * `BSpline.basisAll`/`BSpline.basisDerivative`, matching this chain's
 * own layering discipline (H.5 sits strictly on top of H.3, per
 * ROADMAP.md's "additional rational weighting... not an independent
 * construction").
 *
 * **Why NURBS at all, concretely, not just asserted:** a plain B-spline
 * curve (uniform weights) can only ever represent a polynomial shape --
 * it cannot trace a true circular arc exactly, no matter the degree or
 * control point placement, because a circle's parametrization is
 * fundamentally rational, not polynomial. The classic textbook
 * construction (Piegl & Tiller §7.3) -- three control points
 * `(1,0),(1,1),(0,1)`, weights `(1, 1/√2, 1)`, degree 2, knots
 * `[0,0,0,1,1,1]` -- traces a quarter circle EXACTLY (`‖C(t)‖=1` for
 * every `t`, not approximately). `NURBS.unit.js` checks this directly,
 * not as a claim in a comment.
 *
 * **A second, structural check, needing no external reference at
 * all:** when every weight is equal, `R_{i,p}(t)` reduces algebraically
 * to plain `N_{i,p}(t)` (the constant weight cancels out of the
 * numerator/denominator ratio) -- so `NURBS.evaluate` with uniform
 * weights must agree with `BSpline.evaluate` on the identical control
 * points/knots/degree, exactly. `NURBS.unit.js` checks this too.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example Math.ext.NURBS.evaluate([[1,0],[1,1],[0,1]], [1, 1/Math.SQRT2, 1], [0,0,0,1,1,1], 2, 0.5); // [0.707..., 0.707...] -- radius 1
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    require('./MathExt.js');
    require('./KnotVector.js');
    require('./BSpline.js');
    require('./Vector.js');
    module.exports = factory(require('./KnotVector.js'), require('./BSpline.js'), require('./Vector.js'));
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./MathExt', './KnotVector', './BSpline', './Vector'], function (KnotVector, BSpline, Vector) { return factory(KnotVector, BSpline, Vector); });
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.NURBS = factory(root.Chain.KnotVector, root.Chain.BSpline, root.Chain.Vector);
  }
}(typeof self !== 'undefined' ? self : this, function (KnotVector, BSpline, Vector)
{
  'use strict';

  /**
   * @param {number[]} weights
   * @param {number} numControlPoints
   * @returns {void}
   */
  function assertValidWeights(weights, numControlPoints)
  {
    if (!Array.isArray(weights) || weights.length !== numControlPoints)
    {
      throw new RangeError('NURBS: weights.length (' + (weights && weights.length) + ') must match the control point count (' + numControlPoints + ')');
    }
    for (let i = 0; i < weights.length; i++)
    {
      if (!(weights[i] > 0))
      {
        throw new RangeError('NURBS: weights[' + i + '] = ' + weights[i] + ' -- every weight must be strictly positive (a non-positive weight breaks the convex-hull property the whole construction relies on)');
      }
    }
  }

  /**
   * `R_{i,p}(t) = wᵢ·Nᵢ,ₚ(t) / Σⱼ wⱼ·Nⱼ,ₚ(t)` for every `i`, at `t`.
   * @param {number} t @param {number} degree @param {number[]} knots @param {number[]} weights
   * @returns {number[]}
   */
  function rationalBasisAll(t, degree, knots, weights)
  {
    const N = BSpline.basisAll(t, degree, knots, weights.length);
    const weighted = N.map((n, i) => n * weights[i]);
    const denominator = weighted.reduce((a, b) => a + b, 0);
    return weighted.map((w) => w / denominator);
  }

  /**
   * Point on the NURBS curve at `t`. Validates the knot vector (H.2's
   * `KnotVector.validate`, same as `BSpline.evaluate` does -- called
   * explicitly here too, since `rationalBasisAll` goes through
   * `BSpline.basisAll` directly, which does NOT validate) and the
   * weights array (the one piece of the contract `BSpline` itself has
   * no reason to know about).
   * @param {number[][]} controlPoints
   * @param {number[]} weights
   * @param {number[]} knots
   * @param {number} degree
   * @param {number} t
   * @returns {number[]}
   */
  function evaluate(controlPoints, weights, knots, degree, t)
  {
    KnotVector.validate(knots, controlPoints.length, degree, KnotVector.MODE.OPEN);
    assertValidWeights(weights, controlPoints.length);
    const R = rationalBasisAll(t, degree, knots, weights);
    return Vector.linearCombination(R, controlPoints);
  }

  /**
   * Tangent vector at `t`, via the quotient rule on `C(t) = A(t)/W(t)`
   * where `A(t) = Σᵢ wᵢ·Nᵢ,ₚ(t)·Pᵢ` (vector-valued numerator) and
   * `W(t) = Σᵢ wᵢ·Nᵢ,ₚ(t)` (scalar denominator):
   * `C'(t) = (A'(t)·W(t) - A(t)·W'(t)) / W(t)²`. `A'`/`W'` reuse
   * `BSpline.basisDerivative` directly -- no separate rational-basis
   * derivative formula is derived or needed.
   * @param {number[][]} controlPoints
   * @param {number[]} weights
   * @param {number[]} knots
   * @param {number} degree
   * @param {number} t
   * @returns {number[]}
   */
  function derivative(controlPoints, weights, knots, degree, t)
  {
    KnotVector.validate(knots, controlPoints.length, degree, KnotVector.MODE.OPEN);
    assertValidWeights(weights, controlPoints.length);
    const N = BSpline.basisAll(t, degree, knots, controlPoints.length);
    const Nd = controlPoints.map((_, i) => BSpline.basisDerivative(i, degree, t, knots));

    let W = 0;
    let Wd = 0;
    for (let i = 0; i < weights.length; i++)
    {
      W += weights[i] * N[i];
      Wd += weights[i] * Nd[i];
    }

    const weightedN = N.map((n, i) => n * weights[i]);
    const weightedNd = Nd.map((n, i) => n * weights[i]);
    const A = Vector.linearCombination(weightedN, controlPoints);
    const Ad = Vector.linearCombination(weightedNd, controlPoints);

    const numerator = Vector.subtract(Vector.scale(Ad, W), Vector.scale(A, Wd));
    return Vector.scale(numerator, 1 / (W * W));
  }

  class NURBS
  {
    static extName = 'NURBS';
    static name = 'NURBS';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Math.ext.NURBS -- rational weighting over BSpline (H.3)\'s Cox-de Boor basis, via BSpline.basisAll/basisDerivative. Never reimplements the basis functions themselves.';
    static docs = ['research/lib/chain/docs/NURBS.md'];
    static tests = ['research/lib/chain/tests/NURBS.unit.js'];
    static config_default = {};

    static rationalBasisAll = rationalBasisAll;
    static evaluate = evaluate;
    static derivative = derivative;

    constructor()
    {
    }

    /** @returns {NURBS} this, for chaining -- no configuration required */
    init()
    {
      return this;
    }

    rationalBasisAll(t, degree, knots, weights) { return rationalBasisAll(t, degree, knots, weights); }
    evaluate(controlPoints, weights, knots, degree, t) { return evaluate(controlPoints, weights, knots, degree, t); }
    derivative(controlPoints, weights, knots, degree, t) { return derivative(controlPoints, weights, knots, degree, t); }
  }

  if (typeof Math !== 'undefined' && typeof Math.init === 'function')
  {
    Math.init(NURBS);
  }

  return NURBS;
}));
