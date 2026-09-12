/**
 * Tensor.js
 *
 * Link 2 of Data -> Tensor -> Hilbert -> Hamiltonian -> Continuity -> VonNeumann -> Diagonal/Dense
 *
 * A Tensor here is the coordinate representation of a multi-index object
 * once a basis/ordering has been fixed on the incoming Data: a flat buffer
 * plus a shape (and row-major strides), with an optional nested view.
 * "Nested or Flat, Ordered or Unordered, Custom" are all valid backings —
 * which one is correct is situational (nested for jagged/structural data,
 * flat+strides for dense numeric access, unordered when row identity, not
 * row position, is canonical and a key function is required to fix an order
 * before coordinates mean anything).
 *
 * Tensor does not construct its own Data — Data is injected. No requires.
 * UMD, browser global falls back to `window.Chain.Tensor`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.Chain = root.Chain || {};
    root.Chain.Tensor = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LAYOUTS = Object.freeze({ FLAT: 'flat', NESTED: 'nested' });
  const ORDERS = Object.freeze({ ORDERED: 'ordered', UNORDERED: 'unordered', CUSTOM: 'custom' });

  function rowMajorStrides(shape) {
    const strides = new Array(shape.length);
    let acc = 1;
    for (let d = shape.length - 1; d >= 0; d--) {
      strides[d] = acc;
      acc *= shape[d];
    }
    return strides;
  }

  function product(arr) {
    return arr.reduce((a, b) => a * b, 1);
  }

  class Tensor {
    /**
     * @param {Data} data - injected Data instance (dependency, not constructed here)
     * @param {Object} opts
     * @param {string} [opts.layout='flat'] - LAYOUTS.FLAT | LAYOUTS.NESTED
     * @param {string} [opts.order='ordered'] - ORDERS.ORDERED | UNORDERED | CUSTOM
     * @param {Function} [opts.compare] - required when order is UNORDERED (Array.sort comparator over rows)
     * @param {Function} [opts.indexFn] - required when order is CUSTOM: (row, i, rows) => scalar sort key
     * @param {string} [opts.field] - field to extract a numeric scalar from each record; defaults to 'value' for key/value rows, else the row itself if already a number
     * @param {number[]} [opts.shape] - explicit shape; defaults to [rows.length] (rank-1)
     */
    constructor(data, opts) {
      if (!data || typeof data.toArray !== 'function') {
        throw new TypeError('Tensor: data must be an injected Data-like instance (needs toArray())');
      }
      opts = opts || {};
      this.layout = opts.layout || LAYOUTS.FLAT;
      this.order = opts.order || ORDERS.ORDERED;
      this.field = opts.field;

      let rows = data.toArray();
      rows = Tensor._applyOrder(rows, this.order, opts);

      const values = rows.map((r) => Tensor._extractScalar(r, this.field));
      const shape = opts.shape ? opts.shape.slice() : [values.length];

      if (product(shape) !== values.length) {
        throw new RangeError(
          'Tensor: shape ' + JSON.stringify(shape) +
          ' (size ' + product(shape) + ') does not match ' + values.length + ' extracted values'
        );
      }

      this.shape = shape;
      this.strides = rowMajorStrides(shape);
      this._flat = values; // canonical backing store regardless of requested view
    }

    static get LAYOUTS() { return LAYOUTS; }
    static get ORDERS() { return ORDERS; }

    static _applyOrder(rows, order, opts) {
      switch (order) {
        case ORDERS.ORDERED:
          return rows;
        case ORDERS.UNORDERED:
          if (typeof opts.compare !== 'function') {
            throw new TypeError('Tensor: order "unordered" requires opts.compare');
          }
          return rows.slice().sort(opts.compare);
        case ORDERS.CUSTOM: {
          if (typeof opts.indexFn !== 'function') {
            throw new TypeError('Tensor: order "custom" requires opts.indexFn');
          }
          const keyed = rows.map((r, i) => ({ r, k: opts.indexFn(r, i, rows) }));
          keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
          return keyed.map((x) => x.r);
        }
        default:
          throw new TypeError('Tensor: unknown order "' + order + '"');
      }
    }

    static _extractScalar(row, field) {
      if (typeof row === 'number') return row;
      if (row && typeof row === 'object') {
        const key = field || (Object.prototype.hasOwnProperty.call(row, 'value') ? 'value' : null);
        if (key && Object.prototype.hasOwnProperty.call(row, key)) return Number(row[key]);
      }
      const n = Number(row);
      if (Number.isNaN(n)) {
        throw new TypeError('Tensor: cannot extract a numeric scalar from row ' + JSON.stringify(row));
      }
      return n;
    }

    rank() {
      return this.shape.length;
    }

    size() {
      return this._flat.length;
    }

    /** @param {...number} indices - multi-index, one per axis */
    get(...indices) {
      if (indices.length !== this.shape.length) {
        throw new RangeError('Tensor.get: expected ' + this.shape.length + ' indices, got ' + indices.length);
      }
      let offset = 0;
      for (let d = 0; d < indices.length; d++) {
        offset += indices[d] * this.strides[d];
      }
      return this._flat[offset];
    }

    /** @param {...number} indicesThenValue - multi-index followed by the value to set */
    set(...indicesThenValue) {
      const value = indicesThenValue.pop();
      if (indicesThenValue.length !== this.shape.length) {
        throw new RangeError('Tensor.set: expected ' + this.shape.length + ' indices, got ' + indicesThenValue.length);
      }
      let offset = 0;
      for (let d = 0; d < indicesThenValue.length; d++) {
        offset += indicesThenValue[d] * this.strides[d];
      }
      this._flat[offset] = value;
    }

    /** @returns {{data:number[], shape:number[], strides:number[]}} flat coordinate representation */
    toFlat() {
      return { data: this._flat.slice(), shape: this.shape.slice(), strides: this.strides.slice() };
    }

    /** @returns {*} nested-array coordinate representation, built recursively from the flat buffer */
    toNested() {
      const build = (shape, offset, stride) => {
        if (shape.length === 0) return this._flat[offset];
        const [head, ...rest] = shape;
        const innerStride = stride / head;
        const out = new Array(head);
        for (let i = 0; i < head; i++) {
          out[i] = build(rest, offset + i * innerStride, innerStride);
        }
        return out;
      };
      return build(this.shape, 0, product(this.shape));
    }
  }

  return Tensor;
});
