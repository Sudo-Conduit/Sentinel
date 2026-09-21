/**
 * @file research/lib/chain/Vector.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Math.ext.Vector -- plain linear-algebra vector arithmetic
 *              over flat number arrays. Deliberately the most general,
 *              least-assumption layer: no monotonicity (that is
 *              KnotVector's concern), no sesquilinearity (that is
 *              Hilbert's concern, and belongs to the complex-dtype case
 *              specifically -- see Hilbert.js's own header for why
 *              conflating the two would be wrong), no dependency on
 *              Tensor or anything else in this chain at all. This is the
 *              layer Bezier/B-spline/NURBS control-point blending and any
 *              future Math.ext group actually need underneath them, kept
 *              reusable outside the Data -> Tensor -> ... -> Quantum
 *              pipeline entirely, per its own design goal.
 *
 *              Every operation is non-mutating (returns a new array),
 *              matching Complex's own convention for the identical reason:
 *              a value another caller is holding a reference to must never
 *              change out from under it.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example Math.ext.Vector.add([1,2], [3,4]); // [4,6]
 * @example Math.ext.Vector.linearCombination([0.25, 0.5, 0.25], [[0,0],[2,4],[4,0]]); // control-point blending
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    require('./MathExt.js');
    require('./MathPrecision.js');
    module.exports = factory();
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./MathExt'], function () { return factory(); });
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.Vector = factory();
  }
}(typeof self !== 'undefined' ? self : this, function ()
{
  'use strict';

  /** @param {Array} a @param {Array} b @param {string} op */
  function assertSameLength(a, b, op)
  {
    if (a.length !== b.length)
    {
      throw new RangeError('Vector.' + op + ': dimension mismatch (' + a.length + ' vs ' + b.length + ')');
    }
  }

  /** @param {Array} a @param {Array} b @returns {Array} a+b, elementwise */
  function add(a, b)
  {
    assertSameLength(a, b, 'add');
    return a.map((v, i) => v + b[i]);
  }

  /** @param {Array} a @param {Array} b @returns {Array} a-b, elementwise */
  function subtract(a, b)
  {
    assertSameLength(a, b, 'subtract');
    return a.map((v, i) => v - b[i]);
  }

  /** @param {Array} a @param {number} k @returns {Array} a*k, elementwise */
  function scale(a, k)
  {
    return a.map((v) => v * k);
  }

  /** @param {Array} a @param {Array} b @returns {number} ordinary (non-conjugate) dot product Sum a_i*b_i */
  function dot(a, b)
  {
    assertSameLength(a, b, 'dot');
    let sum = 0;
    for (let i = 0; i < a.length; i++)
    {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * Elementwise Math.fround(x, type) -- reuses MathPrecision directly
   * rather than Vector reimplementing any rounding math of its own.
   * Arithmetic (add/subtract/scale/dot/linearCombination) stays
   * precision-agnostic; quantizing a result is this explicit, separate,
   * caller-invoked step.
   * @param {Array} a
   * @param {string} [type] one of MathPrecision's PRECISION values; omitted uses native F32
   * @returns {Array}
   */
  function round(a, type)
  {
    return a.map((v) => Math.fround(v, type));
  }

  /** @param {Array} a @returns {number} Euclidean norm sqrt(dot(a,a)) */
  function norm(a)
  {
    return Math.sqrt(dot(a, a));
  }

  /**
   * The operation control-point blending (Bezier/B-spline/NURBS) actually
   * needs: Sum_i weights[i] * vectors[i], elementwise across same-dimension
   * vectors.
   * @param {number[]} weights
   * @param {Array[]} vectors
   * @returns {Array}
   */
  function linearCombination(weights, vectors)
  {
    if (weights.length !== vectors.length)
    {
      throw new RangeError('Vector.linearCombination: weights.length (' + weights.length + ') must match vectors.length (' + vectors.length + ')');
    }
    if (vectors.length === 0)
    {
      throw new RangeError('Vector.linearCombination: requires at least one vector');
    }
    const dim = vectors[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < vectors.length; i++)
    {
      if (vectors[i].length !== dim)
      {
        throw new RangeError('Vector.linearCombination: vector ' + i + ' has dimension ' + vectors[i].length + ', expected ' + dim);
      }
      for (let d = 0; d < dim; d++)
      {
        result[d] += weights[i] * vectors[i][d];
      }
    }
    return result;
  }

  class Vector
  {
    static extName = 'Vector';
    static name = 'Vector';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Math.ext.Vector -- plain linear-algebra vector arithmetic over flat number arrays, zero dependency on Tensor or anything else in this chain.';
    static docs = ['research/lib/chain/docs/Vector.md'];
    static tests = ['research/lib/chain/tests/Vector.unit.js'];
    static config_default = {};

    static add = add;
    static subtract = subtract;
    static scale = scale;
    static dot = dot;
    static norm = norm;
    static round = round;
    static linearCombination = linearCombination;

    constructor()
    {
    }

    /** @returns {Vector} this, for chaining -- no configuration required */
    init()
    {
      return this;
    }

    add(a, b) { return add(a, b); }
    subtract(a, b) { return subtract(a, b); }
    scale(a, k) { return scale(a, k); }
    dot(a, b) { return dot(a, b); }
    norm(a) { return norm(a); }
    round(a, type) { return round(a, type); }
    linearCombination(weights, vectors) { return linearCombination(weights, vectors); }
  }

  if (typeof Math !== 'undefined' && typeof Math.init === 'function')
  {
    Math.init(Vector);
  }

  return Vector;
}));
