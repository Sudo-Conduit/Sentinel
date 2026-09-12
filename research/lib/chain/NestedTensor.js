/**
 * @file research/lib/chain/NestedTensor.js
 * @author Will Fobbs
 * @version 2.0.0
 * @description Specialization of Link 2 (Tensor): a Tensor whose canonical
 *              `values` reading is always the nested coordinate view,
 *              composed via ExtendX over Tensor with a 1:M set of formula
 *              mixins (depth, leafCount, sum, mean) — each its own
 *              independently toggleable layer (nt.disableLayer(...)), not a
 *              single bundled method. Each formula is computed by genuine
 *              recursion over the nested structure, not by reading the flat
 *              buffer underneath.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const nt = new NestedTensor().init({shape:[2,2]}, [1,2,3,4]);
 * @example nt.depth();                          // 2
 * @example nt.disableLayer(NestedTensor.FORMULAS.mean); nt.mean(); // undefined
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory(require('./Tensor.js'), require('./ExtendX.js'));
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./Tensor', './ExtendX'], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.NestedTensor = factory(root.Chain.Tensor, root.Chain.ExtendX);
  }
}(typeof self !== 'undefined' ? self : this, function (Tensor, ExtendX)
{
  'use strict';

  function walkLeaves(nested, onLeaf)
  {
    if (Array.isArray(nested))
    {
      nested.forEach((child) => walkLeaves(child, onLeaf));
    }
    else
    {
      onLeaf(nested);
    }
  }

  // ── one mixin per formula: each is its own toggleable layer ──────────────

  const DepthMixin = {
    mixinId: 'NestedTensor.depth',
    depth()
    {
      let d = 0;
      let cur = this.toNested();
      while (Array.isArray(cur))
      {
        d += 1;
        cur = cur[0];
      }
      return d;
    },
  };

  const LeafCountMixin = {
    mixinId: 'NestedTensor.leafCount',
    leafCount()
    {
      let count = 0;
      walkLeaves(this.toNested(), () => { count += 1; });
      return count;
    },
  };

  const SumMixin = {
    mixinId: 'NestedTensor.sum',
    sum()
    {
      let total = 0;
      walkLeaves(this.toNested(), (v) => { total += v; });
      return total;
    },
  };

  const MeanMixin = {
    mixinId: 'NestedTensor.mean',
    // Composes on top of the other layers via normal dispatched calls, so
    // disabling sum or leafCount on an instance is reflected here too.
    mean()
    {
      const total = this.sum();
      const count = this.leafCount();
      return count ? total / count : 0;
    },
  };

  const MinMixin = {
    mixinId: 'NestedTensor.min',
    min()
    {
      let m = Infinity;
      walkLeaves(this.toNested(), (v) => { if (v < m) m = v; });
      return m;
    },
  };

  const MaxMixin = {
    mixinId: 'NestedTensor.max',
    max()
    {
      let m = -Infinity;
      walkLeaves(this.toNested(), (v) => { if (v > m) m = v; });
      return m;
    },
  };

  const VarianceMixin = {
    mixinId: 'NestedTensor.variance',
    variance()
    {
      const count = this.leafCount();
      if (!count)
      {
        return 0;
      }
      const m = this.mean();
      let acc = 0;
      walkLeaves(this.toNested(), (v) => { acc += (v - m) * (v - m); });
      return acc / count;
    },
  };

  const MagnitudeMixin = {
    mixinId: 'NestedTensor.magnitude',
    // L2 norm, matching FlatTensor.magnitude — same formula, computed by
    // recursion over the nesting rather than reading a flat buffer.
    magnitude()
    {
      let acc = 0;
      walkLeaves(this.toNested(), (v) => { acc += v * v; });
      return Math.sqrt(acc);
    },
  };

  const NestedTensor = ExtendX.extend(
    Tensor,
    DepthMixin, LeafCountMixin, SumMixin, MeanMixin, MinMixin, MaxMixin, VarianceMixin, MagnitudeMixin
  );

  Object.defineProperty(NestedTensor, 'name', { value: 'NestedTensor', configurable: true });
  NestedTensor.author = 'Will Fobbs';
  NestedTensor.version = '2.0.0';
  NestedTensor.description = 'Tensor fixed to its nested coordinate presentation, composed with one independently toggleable mixin per formula.';
  NestedTensor.docs = ['research/lib/chain/docs/NestedTensor.md'];
  NestedTensor.tests = ['research/lib/chain/tests/NestedTensor.unit.js'];
  NestedTensor.config_default = { order: 'ordered' };

  // Name -> mixin lookup, so a caller can toggle a specific formula:
  //   nt.disableLayer(NestedTensor.FORMULAS.mean);
  NestedTensor.FORMULAS = Object.freeze({
    depth: DepthMixin,
    leafCount: LeafCountMixin,
    sum: SumMixin,
    mean: MeanMixin,
    min: MinMixin,
    max: MaxMixin,
    variance: VarianceMixin,
    magnitude: MagnitudeMixin,
  });

  // Fixed presentation accessor — not a togglable layer, so defined directly
  // rather than as a dispatched mixin method.
  Object.defineProperty(NestedTensor.prototype, 'values', {
    get() { return this.toNested(); },
    enumerable: false,
    configurable: true,
  });

  // Convenience aggregate over whatever formulas are CURRENTLY active on this
  // instance (an instance where mean was disabled reports mean: undefined,
  // rather than silently omitting it).
  Object.defineProperty(NestedTensor.prototype, 'computeAll', {
    value()
    {
      const out = {};
      for (const name of Object.keys(NestedTensor.FORMULAS))
      {
        out[name] = typeof this[name] === 'function' ? this[name]() : undefined;
      }
      return out;
    },
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return NestedTensor;
}));
