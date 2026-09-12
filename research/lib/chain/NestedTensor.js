/**
 * @file research/lib/chain/NestedTensor.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Specialization of Link 2 (Tensor): a Tensor whose canonical
 *              `values` reading is always the nested coordinate view, with a
 *              registry of formulas defined structurally over that nesting
 *              (depth, leafCount, sum/mean computed by genuine recursion
 *              over the nested array rather than by reading the flat
 *              buffer). Extends Tensor rather than composing it.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const nt = new NestedTensor().init({shape:[2,2]}, [1,2,3,4]);
 * @example nt.compute('depth'); // 2
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
    root.Chain.NestedTensor = factory(root.Chain.Tensor);
  }
}(typeof self !== 'undefined' ? self : this, function (Tensor)
{
  'use strict';

  class NestedTensor extends Tensor
  {
    static name = 'NestedTensor';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Tensor fixed to its nested coordinate presentation, with formulas defined by recursion over that nesting.';
    static docs = ['research/lib/chain/docs/NestedTensor.md'];
    static tests = ['research/lib/chain/tests/NestedTensor.unit.js'];
    static config_default = { order: 'ordered' };

    static FORMULAS = Object.freeze({
      // Nesting depth: how many array levels wrap a leaf — equals rank() for
      // a rectangular Tensor, but computed by walking the nested structure
      // itself rather than reading this.shape.
      depth: (nested) =>
      {
        let d = 0;
        let cur = nested;
        while (Array.isArray(cur))
        {
          d += 1;
          cur = cur[0];
        }
        return d;
      },
      leafCount: (nested) =>
      {
        let count = 0;
        const walk = (node) =>
        {
          if (Array.isArray(node))
          {
            node.forEach(walk);
          }
          else
          {
            count += 1;
          }
        };
        walk(nested);
        return count;
      },
      sum: (nested) =>
      {
        let total = 0;
        const walk = (node) =>
        {
          if (Array.isArray(node))
          {
            node.forEach(walk);
          }
          else
          {
            total += node;
          }
        };
        walk(nested);
        return total;
      },
      mean: (nested) =>
      {
        const total = NestedTensor.FORMULAS.sum(nested);
        const count = NestedTensor.FORMULAS.leafCount(nested);
        return count ? total / count : 0;
      },
    });

    constructor()
    {
      super();
    }

    /**
     * @param {Object} R1 - see Tensor.init
     * @param {Data|Array} R2 - see Tensor.init
     * @returns {NestedTensor} this, for chaining
     */
    init(R1, R2)
    {
      super.init(R1, R2);
      return this;
    }

    /** @returns {*} the fixed nested presentation */
    get values()
    {
      return this.toNested();
    }

    /**
     * @param {string} name - a key in NestedTensor.FORMULAS
     * @returns {number} the formula applied to this tensor's nested view
     * @throws {TypeError} if name is not a registered formula
     */
    compute(name)
    {
      const fn = NestedTensor.FORMULAS[name];
      if (typeof fn !== 'function')
      {
        throw new TypeError('NestedTensor.compute: unknown formula "' + name + '"');
      }
      return fn(this.toNested());
    }

    /** @returns {Object} every registered formula evaluated against this tensor */
    computeAll()
    {
      const out = {};
      for (const name of Object.keys(NestedTensor.FORMULAS))
      {
        out[name] = this.compute(name);
      }
      return out;
    }
  }

  return NestedTensor;
}));
