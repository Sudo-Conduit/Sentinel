/**
 * @file research/lib/chain/FlatTensor.js
 * @author Will Fobbs
 * @version 2.0.0
 * @description Specialization of Link 2 (Tensor): a Tensor whose canonical
 *              `values` reading is always the flat coordinate view,
 *              composed via ExtendX over Tensor with a 1:M set of formula
 *              mixins (sum, mean, min, max, variance, magnitude) — each its
 *              own independently toggleable layer (ft.disableLayer(...)),
 *              not a single bundled method.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const ft = new FlatTensor().init({shape:[4]}, [1,2,3,4]);
 * @example ft.magnitude();                          // sqrt(1+4+9+16)
 * @example ft.disableLayer(FlatTensor.FORMULAS.sum); ft.sum(); // undefined
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
    root.Chain.FlatTensor = factory(root.Chain.Tensor, root.Chain.ExtendX);
  }
}(typeof self !== 'undefined' ? self : this, function (Tensor, ExtendX)
{
  'use strict';

  // ── one mixin per formula: each is its own toggleable layer ──────────────

  const SumMixin = {
    mixinId: 'FlatTensor.sum',
    sum()
    {
      return this._flat.reduce((a, b) => a + b, 0);
    },
  };

  const MeanMixin = {
    mixinId: 'FlatTensor.mean',
    // Composes on top of SumMixin via a normal dispatched call, so disabling
    // sum on an instance is reflected here too.
    mean()
    {
      return this._flat.length ? this.sum() / this._flat.length : 0;
    },
  };

  const MinMixin = {
    mixinId: 'FlatTensor.min',
    min()
    {
      return Math.min(...this._flat);
    },
  };

  const MaxMixin = {
    mixinId: 'FlatTensor.max',
    max()
    {
      return Math.max(...this._flat);
    },
  };

  const VarianceMixin = {
    mixinId: 'FlatTensor.variance',
    variance()
    {
      if (!this._flat.length)
      {
        return 0;
      }
      const m = this.mean();
      return this._flat.reduce((acc, v) => acc + (v - m) * (v - m), 0) / this._flat.length;
    },
  };

  const MagnitudeMixin = {
    mixinId: 'FlatTensor.magnitude',
    // L2 norm: sqrt(sum of squares) — the Hilbert-space norm formula, one
    // link ahead in the chain.
    magnitude()
    {
      return Math.sqrt(this._flat.reduce((acc, v) => acc + v * v, 0));
    },
  };

  const FlatTensor = ExtendX.extend(Tensor, SumMixin, MeanMixin, MinMixin, MaxMixin, VarianceMixin, MagnitudeMixin);

  Object.defineProperty(FlatTensor, 'name', { value: 'FlatTensor', configurable: true });
  FlatTensor.author = 'Will Fobbs';
  FlatTensor.version = '2.0.0';
  FlatTensor.description = 'Tensor fixed to its flat coordinate presentation, composed with one independently toggleable mixin per formula.';
  FlatTensor.docs = ['research/lib/chain/docs/FlatTensor.md'];
  FlatTensor.tests = ['research/lib/chain/tests/FlatTensor.unit.js'];
  FlatTensor.config_default = { order: 'ordered' };

  // Name -> mixin lookup, so a caller can toggle a specific formula:
  //   ft.disableLayer(FlatTensor.FORMULAS.variance);
  FlatTensor.FORMULAS = Object.freeze({
    sum: SumMixin,
    mean: MeanMixin,
    min: MinMixin,
    max: MaxMixin,
    variance: VarianceMixin,
    magnitude: MagnitudeMixin,
  });

  // Fixed presentation accessor — not a togglable layer, so defined directly
  // rather than as a dispatched mixin method.
  Object.defineProperty(FlatTensor.prototype, 'values', {
    get() { return this.toFlat(); },
    enumerable: false,
    configurable: true,
  });

  // Convenience aggregate over whatever formulas are CURRENTLY active on this
  // instance (an instance where variance was disabled reports variance:
  // undefined, rather than silently omitting it).
  Object.defineProperty(FlatTensor.prototype, 'computeAll', {
    value()
    {
      const out = {};
      for (const name of Object.keys(FlatTensor.FORMULAS))
      {
        out[name] = typeof this[name] === 'function' ? this[name]() : undefined;
      }
      return out;
    },
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return FlatTensor;
}));
