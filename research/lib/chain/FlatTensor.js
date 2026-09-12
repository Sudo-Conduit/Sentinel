/**
 * @file research/lib/chain/FlatTensor.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Specialization of Link 2 (Tensor): a Tensor whose canonical
 *              `values` reading is always the flat coordinate view, with a
 *              registry of formulas naturally defined over a contiguous
 *              numeric buffer (sum, mean, min, max, variance, magnitude).
 *              Extends Tensor rather than composing it — FlatTensor IS a
 *              Tensor with a fixed presentation and an attached formula set,
 *              not a wrapper around one.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const ft = new FlatTensor().init({shape:[4]}, [1,2,3,4]);
 * @example ft.compute('magnitude'); // sqrt(1+4+9+16)
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory(require('./Tensor.js'));
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./Tensor'], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.FlatTensor = factory(root.Chain.Tensor);
  }
}(typeof self !== 'undefined' ? self : this, function (Tensor)
{
  'use strict';

  class FlatTensor extends Tensor
  {
    static name = 'FlatTensor';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Tensor fixed to its flat coordinate presentation, with formulas defined over a contiguous numeric buffer.';
    static docs = ['research/lib/chain/docs/FlatTensor.md'];
    static tests = ['research/lib/chain/tests/FlatTensor.unit.js'];
    static config_default = { order: 'ordered' };

    static FORMULAS = Object.freeze({
      sum: (flat) => flat.reduce((a, b) => a + b, 0),
      mean: (flat) => (flat.length ? FlatTensor.FORMULAS.sum(flat) / flat.length : 0),
      min: (flat) => Math.min(...flat),
      max: (flat) => Math.max(...flat),
      variance: (flat) =>
      {
        if (!flat.length)
        {
          return 0;
        }
        const m = FlatTensor.FORMULAS.mean(flat);
        return flat.reduce((acc, v) => acc + (v - m) * (v - m), 0) / flat.length;
      },
      // L2 norm: sqrt(sum of squares) — the Hilbert-space norm formula, one link ahead.
      magnitude: (flat) => Math.sqrt(flat.reduce((acc, v) => acc + v * v, 0)),
    });

    constructor()
    {
      super();
    }

    /**
     * @param {Object} R1 - see Tensor.init
     * @param {Data|Array} R2 - see Tensor.init
     * @returns {FlatTensor} this, for chaining
     */
    init(R1, R2)
    {
      super.init(R1, R2);
      return this;
    }

    /** @returns {{data:number[], shape:number[], strides:number[]}} the fixed flat presentation */
    get values()
    {
      return this.toFlat();
    }

    /**
     * @param {string} name - a key in FlatTensor.FORMULAS
     * @returns {number} the formula applied to this tensor's flat buffer
     * @throws {TypeError} if name is not a registered formula
     */
    compute(name)
    {
      const fn = FlatTensor.FORMULAS[name];
      if (typeof fn !== 'function')
      {
        throw new TypeError('FlatTensor.compute: unknown formula "' + name + '"');
      }
      return fn(this._flat);
    }

    /** @returns {Object} every registered formula evaluated against this tensor */
    computeAll()
    {
      const out = {};
      for (const name of Object.keys(FlatTensor.FORMULAS))
      {
        out[name] = this.compute(name);
      }
      return out;
    }
  }

  return FlatTensor;
}));
