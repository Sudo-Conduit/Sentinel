/**
 * @file research/lib/chain/KnotVector.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Math.ext.KnotVector -- the validated data layer a B-spline
 *              or NURBS basis function sits on top of, matching the same
 *              "canonical, validated structure before the algorithm that
 *              assumes it holds" discipline `Data -> Tensor` already uses
 *              (see ROADMAP.md's Supplemental Addendum, Category H). This
 *              file never evaluates a basis function -- that is H.3
 *              (`BSpline`)'s job. It only answers: is this array of knots
 *              actually a valid knot vector for a curve of this degree
 *              with this many control points, and if I need one, can you
 *              hand me a canonical one.
 *
 *              A knot vector is a non-decreasing sequence `t_0 <= t_1 <=
 *              ... <= t_m`. For a degree-`p` curve with `n+1` control
 *              points, the standard length contract (Piegl & Tiller,
 *              "The NURBS Book", eq. 2.1) is `m+1 = n+p+2` knots, i.e.
 *              `knots.length === numControlPoints + degree + 1`.
 *
 *              Two named modes, deliberately distinguished (NURBS
 *              terminology is notoriously inconsistent across sources --
 *              this file picks one convention and documents it plainly
 *              rather than silently assuming the reader already agrees):
 *              - `MODE.OPEN` (default): only monotonicity + the length
 *                contract are required. No constraint on the endpoints --
 *                the curve need not pass through its first/last control
 *                point.
 *              - `MODE.CLAMPED`: everything `OPEN` requires, PLUS the
 *                first and last knot values must each repeat with
 *                multiplicity exactly `degree+1`. This is the
 *                interpolating construction most CAD/graphics libraries
 *                actually mean when they informally say "open knot
 *                vector" (Piegl & Tiller's own usage) -- named `CLAMPED`
 *                here specifically so this file's `OPEN` (the lenient
 *                default) is never confused with that stricter,
 *                endpoint-repeating convention.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example Math.ext.KnotVector.validate([0,0,0,1,2,3,3,3], 5, 2, Math.ext.KnotVector.MODE.CLAMPED); // true
 * @example Math.ext.KnotVector.clamped(5, 2); // [0,0,0,0.5,1,1,1] -- canonical clamped knot vector
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    require('./MathExt.js');
    module.exports = factory();
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./MathExt'], function () { return factory(); });
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.KnotVector = factory();
  }
}(typeof self !== 'undefined' ? self : this, function ()
{
  'use strict';

  const MODE = Object.freeze({ OPEN: 'open', CLAMPED: 'clamped' });

  /** @param {number[]} knots @returns {boolean} true iff knots[i] <= knots[i+1] for every i */
  function isMonotonic(knots)
  {
    for (let i = 1; i < knots.length; i++)
    {
      if (knots[i] < knots[i - 1])
      {
        return false;
      }
    }
    return true;
  }

  /** @param {number} numControlPoints @param {number} degree @returns {number} required knot count, n+p+2 for n+1 control points */
  function expectedLength(numControlPoints, degree)
  {
    return numControlPoints + degree + 1;
  }

  /**
   * How many consecutive knots at and around index `i` share `knots[i]`'s
   * value -- e.g. multiplicityAt([0,0,0,1,2],0) === 3. Requires `knots` to
   * already be monotonic (a caller doing validation calls isMonotonic
   * first; this does not re-check, since it is also used internally by
   * validate() after that check already ran).
   * @param {number[]} knots
   * @param {number} i
   * @returns {number}
   */
  function multiplicityAt(knots, i)
  {
    const value = knots[i];
    let lo = i;
    while (lo > 0 && knots[lo - 1] === value)
    {
      lo--;
    }
    let hi = i;
    while (hi < knots.length - 1 && knots[hi + 1] === value)
    {
      hi++;
    }
    return hi - lo + 1;
  }

  /**
   * Throws a descriptive error on the first violation found; returns true
   * if `knots` is a valid knot vector for a degree-`degree` curve with
   * `numControlPoints` control points under `mode`. Fail-fast, matching
   * `Vector.js`'s own `assertSameLength` convention -- a caller building a
   * curve on top of an invalid knot vector wants to know immediately, not
   * receive a silently-wrong basis function later.
   * @param {number[]} knots
   * @param {number} numControlPoints
   * @param {number} degree
   * @param {string} [mode=MODE.OPEN]
   * @returns {true}
   */
  function validate(knots, numControlPoints, degree, mode)
  {
    const m = mode === undefined ? MODE.OPEN : mode;
    if (!Array.isArray(knots) || knots.length === 0)
    {
      throw new TypeError('KnotVector.validate: knots must be a non-empty array');
    }
    if (!Number.isInteger(numControlPoints) || numControlPoints <= 0)
    {
      throw new TypeError('KnotVector.validate: numControlPoints must be a positive integer');
    }
    if (!Number.isInteger(degree) || degree < 0)
    {
      throw new TypeError('KnotVector.validate: degree must be a non-negative integer');
    }
    if (numControlPoints <= degree)
    {
      throw new RangeError('KnotVector.validate: numControlPoints (' + numControlPoints + ') must exceed degree (' + degree + ') -- a degree-' + degree + ' curve needs at least ' + (degree + 1) + ' control points');
    }
    if (!isMonotonic(knots))
    {
      throw new RangeError('KnotVector.validate: knots must be non-decreasing');
    }
    const expected = expectedLength(numControlPoints, degree);
    if (knots.length !== expected)
    {
      throw new RangeError('KnotVector.validate: expected ' + expected + ' knots (numControlPoints + degree + 1), got ' + knots.length);
    }
    if (m === MODE.CLAMPED)
    {
      const requiredMultiplicity = degree + 1;
      const startMultiplicity = multiplicityAt(knots, 0);
      const endMultiplicity = multiplicityAt(knots, knots.length - 1);
      if (startMultiplicity !== requiredMultiplicity)
      {
        throw new RangeError('KnotVector.validate: CLAMPED requires the first knot to repeat ' + requiredMultiplicity + ' times (degree+1), found multiplicity ' + startMultiplicity);
      }
      if (endMultiplicity !== requiredMultiplicity)
      {
        throw new RangeError('KnotVector.validate: CLAMPED requires the last knot to repeat ' + requiredMultiplicity + ' times (degree+1), found multiplicity ' + endMultiplicity);
      }
    }
    else if (m !== MODE.OPEN)
    {
      throw new TypeError('KnotVector.validate: unknown mode "' + m + '" -- expected KnotVector.MODE.OPEN or KnotVector.MODE.CLAMPED');
    }
    return true;
  }

  /**
   * A canonical MODE.OPEN knot vector: the plain integer sequence
   * `0..(numControlPoints+degree)`, satisfying monotonicity and the
   * length contract with no endpoint constraint.
   * @param {number} numControlPoints
   * @param {number} degree
   * @returns {number[]}
   */
  function uniform(numControlPoints, degree)
  {
    const length = expectedLength(numControlPoints, degree);
    const knots = new Array(length);
    for (let i = 0; i < length; i++)
    {
      knots[i] = i;
    }
    return knots;
  }

  /**
   * A canonical MODE.CLAMPED knot vector on `[0,1]`: `degree+1` zeros,
   * then evenly-spaced interior knots, then `degree+1` ones -- the
   * standard interpolating construction (Piegl & Tiller §2.2's "open
   * uniform" knot vector).
   * @param {number} numControlPoints
   * @param {number} degree
   * @returns {number[]}
   */
  function clamped(numControlPoints, degree)
  {
    if (!Number.isInteger(numControlPoints) || numControlPoints <= degree)
    {
      throw new RangeError('KnotVector.clamped: numControlPoints (' + numControlPoints + ') must exceed degree (' + degree + ')');
    }
    const interiorCount = numControlPoints - degree - 1;
    const knots = new Array(expectedLength(numControlPoints, degree));
    for (let i = 0; i <= degree; i++)
    {
      knots[i] = 0;
    }
    for (let i = 1; i <= interiorCount; i++)
    {
      knots[degree + i] = i / (interiorCount + 1);
    }
    for (let i = 0; i <= degree; i++)
    {
      knots[knots.length - 1 - i] = 1;
    }
    return knots;
  }

  class KnotVector
  {
    static extName = 'KnotVector';
    static name = 'KnotVector';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Math.ext.KnotVector -- the validated (monotonic, length-contract) data layer under B-spline/NURBS, zero dependency beyond MathExt registration.';
    static docs = ['research/lib/chain/docs/KnotVector.md'];
    static tests = ['research/lib/chain/tests/KnotVector.unit.js'];
    static config_default = {};

    static MODE = MODE;
    static isMonotonic = isMonotonic;
    static expectedLength = expectedLength;
    static multiplicityAt = multiplicityAt;
    static validate = validate;
    static uniform = uniform;
    static clamped = clamped;

    constructor()
    {
    }

    /** @returns {KnotVector} this, for chaining -- no configuration required */
    init()
    {
      return this;
    }

    isMonotonic(knots) { return isMonotonic(knots); }
    expectedLength(numControlPoints, degree) { return expectedLength(numControlPoints, degree); }
    multiplicityAt(knots, i) { return multiplicityAt(knots, i); }
    validate(knots, numControlPoints, degree, mode) { return validate(knots, numControlPoints, degree, mode); }
    uniform(numControlPoints, degree) { return uniform(numControlPoints, degree); }
    clamped(numControlPoints, degree) { return clamped(numControlPoints, degree); }
  }

  if (typeof Math !== 'undefined' && typeof Math.init === 'function')
  {
    Math.init(KnotVector);
  }

  return KnotVector;
}));
