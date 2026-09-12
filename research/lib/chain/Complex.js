/**
 * @file research/lib/chain/Complex.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Minimal complex value type: re + im*i. Backs Tensor's
 *              dtype='complex' element storage — a Tensor never assumes
 *              plain JS numbers; a Complex instance IS the element when
 *              dtype is complex, exactly the way a real-dtype element is
 *              just a plain number. Every operation returns a NEW Complex
 *              rather than mutating in place, so a value sitting in a
 *              Tensor's flat store is never silently changed out from
 *              under it by an unrelated computation holding a reference.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const z = new Complex().init(3, 4); z.abs(); // 5
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory();
  }
  else if (typeof define === 'function' && define.amd)
  {
    define([], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.Complex = factory();
  }
}(typeof self !== 'undefined' ? self : this, function ()
{
  'use strict';

  class Complex
  {
    static name = 'Complex';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Minimal immutable-by-convention complex value type (re + im*i) backing Tensor dtype=complex elements.';
    static docs = ['research/lib/chain/docs/Complex.md'];
    static tests = ['research/lib/chain/tests/Complex.unit.js'];
    static config_default = { re: 0, im: 0 };

    constructor()
    {
      this.re = 0;
      this.im = 0;
    }

    /**
     * @param {number} [re=0]
     * @param {number} [im=0]
     * @returns {Complex} this, for chaining
     */
    init(re, im)
    {
      this.re = re === undefined ? 0 : re;
      this.im = im === undefined ? 0 : im;
      return this;
    }

    /**
     * Normalizes any of: a Complex instance, a plain real number, or a
     * {re, im} plain object into a Complex. This is the single coercion
     * point Tensor's dtype=complex path routes every raw value through.
     * @param {Complex|number|{re:number,im:number}} v
     * @returns {Complex}
     */
    static from(v)
    {
      if (v instanceof Complex)
      {
        return v;
      }
      if (typeof v === 'number')
      {
        return new Complex().init(v, 0);
      }
      if (v && typeof v === 'object' && typeof v.re === 'number')
      {
        return new Complex().init(v.re, v.im || 0);
      }
      throw new TypeError('Complex.from: cannot coerce ' + JSON.stringify(v) + ' to a Complex');
    }

    /** @param {Complex|number} other @returns {Complex} */
    add(other)
    {
      const o = Complex.from(other);
      return new Complex().init(this.re + o.re, this.im + o.im);
    }

    /** @param {Complex|number} other @returns {Complex} */
    subtract(other)
    {
      const o = Complex.from(other);
      return new Complex().init(this.re - o.re, this.im - o.im);
    }

    /** @param {Complex|number} other @returns {Complex} */
    multiply(other)
    {
      const o = Complex.from(other);
      return new Complex().init(
        this.re * o.re - this.im * o.im,
        this.re * o.im + this.im * o.re
      );
    }

    /** @returns {Complex} the complex conjugate (re, -im) */
    conjugate()
    {
      return new Complex().init(this.re, -this.im);
    }

    /** @returns {number} the modulus |z| = sqrt(re^2 + im^2) */
    abs()
    {
      return Math.sqrt(this.re * this.re + this.im * this.im);
    }

    /** @param {Complex|number} other @returns {boolean} */
    equals(other)
    {
      const o = Complex.from(other);
      return this.re === o.re && this.im === o.im;
    }

    /** @returns {string} e.g. "3+4i", "3-4i", "5" (im===0), "4i" (re===0) */
    toString()
    {
      if (this.im === 0)
      {
        return String(this.re);
      }
      if (this.re === 0)
      {
        return this.im + 'i';
      }
      return this.re + (this.im >= 0 ? '+' : '') + this.im + 'i';
    }
  }

  return Complex;
}));
