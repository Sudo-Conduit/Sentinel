/**
 * @file research/lib/chain/Polynomial.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Math.ext.Polynomial -- coefficients + degree, evaluate/
 *              derivative/integral. The shared foundation Bezier's
 *              Bernstein basis and each B-spline knot-span sit on: both
 *              are, on their respective domains, genuine polynomials in
 *              t (see ROADMAP.md's Supplemental Addendum, Category H).
 *              Coefficients are stored ascending: coefficients[i] is the
 *              coefficient of t^i, so coefficients[0] is the constant
 *              term. Zero dependency, like Vector -- a coefficient array
 *              needs nothing from the rest of this chain to be evaluated
 *              or differentiated.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example Math.ext.Polynomial.evaluate([1, 2, 3], 2); // 1 + 2*2 + 3*4 = 17
 * @example Math.ext.Polynomial.derivative([1, 2, 3]); // [2, 6] -- d/dt(1+2t+3t^2) = 2+6t
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
    root.Chain.Polynomial = factory();
  }
}(typeof self !== 'undefined' ? self : this, function ()
{
  'use strict';

  /**
   * Horner's method: process coefficients from the highest degree down,
   * result = result*t + coefficients[i] -- fewer multiplications than a
   * naive Sum coefficients[i]*t^i, and numerically the standard choice.
   * @param {number[]} coefficients ascending: coefficients[i] is the coefficient of t^i
   * @param {number} t
   * @returns {number}
   */
  function evaluate(coefficients, t)
  {
    let result = 0;
    for (let i = coefficients.length - 1; i >= 0; i--)
    {
      result = result * t + coefficients[i];
    }
    return result;
  }

  /**
   * d/dt Sum coefficients[i]*t^i = Sum i*coefficients[i]*t^(i-1) for i>=1.
   * A constant (length <= 1) differentiates to the zero polynomial [0],
   * not an empty array -- keeps "a polynomial" as the return type always.
   * @param {number[]} coefficients
   * @returns {number[]}
   */
  function derivative(coefficients)
  {
    if (coefficients.length <= 1)
    {
      return [0];
    }
    const result = new Array(coefficients.length - 1);
    for (let i = 1; i < coefficients.length; i++)
    {
      result[i - 1] = coefficients[i] * i;
    }
    return result;
  }

  /**
   * Integral(Sum coefficients[i]*t^i)dt = Sum (coefficients[i]/(i+1))*t^(i+1) + constant.
   * @param {number[]} coefficients
   * @param {number} [constant=0] the constant of integration
   * @returns {number[]}
   */
  function integral(coefficients, constant)
  {
    const c = constant === undefined ? 0 : constant;
    const result = new Array(coefficients.length + 1);
    result[0] = c;
    for (let i = 0; i < coefficients.length; i++)
    {
      result[i + 1] = coefficients[i] / (i + 1);
    }
    return result;
  }

  /** @param {number[]} coefficients @returns {number} coefficients.length-1 -- no trailing-zero trimming, matching "stay dumb" */
  function degree(coefficients)
  {
    return coefficients.length - 1;
  }

  /** @param {number[]} a @param {number[]} b @returns {number[]} a+b, shorter side implicitly zero-padded */
  function add(a, b)
  {
    const length = Math.max(a.length, b.length);
    const result = new Array(length);
    for (let i = 0; i < length; i++)
    {
      result[i] = (a[i] || 0) + (b[i] || 0);
    }
    return result;
  }

  /** @param {number[]} coefficients @param {number} k @returns {number[]} coefficients*k, elementwise */
  function scale(coefficients, k)
  {
    return coefficients.map((c) => c * k);
  }

  class Polynomial
  {
    static extName = 'Polynomial';
    static name = 'Polynomial';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Math.ext.Polynomial -- coefficients + degree, evaluate/derivative/integral, zero dependency, the shared foundation Bezier/B-spline basis functions sit on.';
    static docs = ['research/lib/chain/docs/Polynomial.md'];
    static tests = ['research/lib/chain/tests/Polynomial.unit.js'];
    static config_default = {};

    static evaluate = evaluate;
    static derivative = derivative;
    static integral = integral;
    static degree = degree;
    static add = add;
    static scale = scale;

    constructor()
    {
    }

    /** @returns {Polynomial} this, for chaining -- no configuration required */
    init()
    {
      return this;
    }

    evaluate(coefficients, t) { return evaluate(coefficients, t); }
    derivative(coefficients) { return derivative(coefficients); }
    integral(coefficients, constant) { return integral(coefficients, constant); }
    degree(coefficients) { return degree(coefficients); }
    add(a, b) { return add(a, b); }
    scale(coefficients, k) { return scale(coefficients, k); }
  }

  if (typeof Math !== 'undefined' && typeof Math.init === 'function')
  {
    Math.init(Polynomial);
  }

  return Polynomial;
}));
