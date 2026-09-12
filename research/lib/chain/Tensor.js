/**
 * Tensor.js
 *
 * Link 2 of Data -> Tensor -> Hilbert -> Hamiltonian -> Continuity -> VonNeumann -> Diagonal/Dense
 *
 * A Tensor is two injected parts, not one object:
 *   R1 — the structural/rank spec: shape, ordering rule, field-extraction
 *        rule. This is the frame/basis-choice half; it carries no data.
 *   R2 — the data itself: a Data instance, a flat array, or a nested array.
 *        R2 is legitimately shaped either way going IN (that's situational,
 *        not a defect — nested for jagged/structural data, flat for dense
 *        numeric access) and Tensor normalizes whichever it receives to one
 *        canonical flat buffer + row-major strides, from which toFlat() and
 *        toNested() are just two read-out views of the same thing.
 * "Ordered / Unordered / Custom" (R1.order) governs how R2's row identity
 * maps to index position when R2 arrives flat and unordered — a key
 * function is required to fix an order before coordinates mean anything.
 *
 * Tensor does not construct its own R2 — it is injected. No requires.
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
     * @param {Object} R1 - structural/rank spec (data-free)
     * @param {number[]} [R1.shape] - explicit shape; defaults to the shape inferred from R2
     *   (rank-1 [length] for a Data dependency or a flat array, or R2's own
     *   rectangular nesting depth/extents when R2 arrives as a nested array)
     * @param {string} [R1.order='ordered'] - ORDERS.ORDERED | UNORDERED | CUSTOM;
     *   only meaningful when R2 is a Data dependency or a flat array of records
     * @param {Function} [R1.compare] - required when order is UNORDERED (Array.sort comparator over rows)
     * @param {Function} [R1.indexFn] - required when order is CUSTOM: (row, i, rows) => scalar sort key
     * @param {string} [R1.field] - field to extract a numeric scalar from each record; defaults to 'value' for key/value rows, else the row itself if already a number
     * @param {string} [R1.layout] - purely descriptive label (LAYOUTS.FLAT | LAYOUTS.NESTED); inferred from R2's shape if omitted
     * @param {Data|Array} R2 - the data: an injected Data instance, a flat array, or a nested array
     */
    constructor(R1, R2) {
      R1 = R1 || {};
      if (R2 === undefined || R2 === null) {
        throw new TypeError('Tensor: R2 (data) is required');
      }
      this.order = R1.order || ORDERS.ORDERED;
      this.field = R1.field;

      const resolved = Tensor._resolveR2(R2, this.order, R1, this.field);
      const shape = R1.shape ? R1.shape.slice() : resolved.shape;

      if (product(shape) !== resolved.flat.length) {
        throw new RangeError(
          'Tensor: shape ' + JSON.stringify(shape) +
          ' (size ' + product(shape) + ') does not match ' + resolved.flat.length + ' extracted values'
        );
      }

      this.layout = R1.layout || (resolved.wasNested ? LAYOUTS.NESTED : LAYOUTS.FLAT);
      this.shape = shape;
      this.strides = rowMajorStrides(shape);
      this._flat = resolved.flat; // canonical backing store regardless of requested view

      // Surface the two injected halves explicitly, matching the R1/R2 contract itself.
      this.R1 = { shape: this.shape.slice(), order: this.order, layout: this.layout };
      this.R2 = R2;
    }

    static get LAYOUTS() { return LAYOUTS; }
    static get ORDERS() { return ORDERS; }

    /**
     * Normalize R2 (Data dependency | flat array | nested array) to one
     * canonical flat buffer + inferred shape, regardless of which shape it
     * arrived in.
     */
    static _resolveR2(R2, order, R1, field) {
      if (R2 && typeof R2.toArray === 'function') {
        const rows = Tensor._applyOrder(R2.toArray(), order, R1);
        const flat = rows.map((r) => Tensor._extractScalar(r, field));
        return { flat, shape: [flat.length], wasNested: false };
      }
      if (Array.isArray(R2)) {
        if (R2.length > 0 && Array.isArray(R2[0])) {
          const nested = Tensor._flattenNested(R2);
          return { flat: nested.flat, shape: nested.shape, wasNested: true };
        }
        const rows = Tensor._applyOrder(R2, order, R1);
        const flat = rows.map((r) => Tensor._extractScalar(r, field));
        return { flat, shape: [flat.length], wasNested: false };
      }
      throw new TypeError('Tensor: R2 must be a Data instance, a flat array, or a nested array');
    }

    /** Flattens a rectangular nested array and infers its shape from nesting depth/extents. */
    static _flattenNested(nested) {
      const shape = [];
      let cur = nested;
      while (Array.isArray(cur)) {
        shape.push(cur.length);
        cur = cur[0];
      }
      const flat = [];
      const walk = (node, depth) => {
        if (depth === shape.length) {
          flat.push(Tensor._extractScalar(node));
          return;
        }
        if (!Array.isArray(node) || node.length !== shape[depth]) {
          throw new RangeError('Tensor: ragged nested array is not rectangular at depth ' + depth);
        }
        for (let i = 0; i < node.length; i++) walk(node[i], depth + 1);
      };
      walk(nested, 0);
      return { shape, flat };
    }

    static _applyOrder(rows, order, R1) {
      switch (order) {
        case ORDERS.ORDERED:
          return rows;
        case ORDERS.UNORDERED:
          if (typeof R1.compare !== 'function') {
            throw new TypeError('Tensor: order "unordered" requires R1.compare');
          }
          return rows.slice().sort(R1.compare);
        case ORDERS.CUSTOM: {
          if (typeof R1.indexFn !== 'function') {
            throw new TypeError('Tensor: order "custom" requires R1.indexFn');
          }
          const keyed = rows.map((r, i) => ({ r, k: R1.indexFn(r, i, rows) }));
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

    /**
     * Hereditary (von Neumann) nesting: NOT rectangular sibling-nesting like
     * toNested(). Each successive element contains the *entire* structure
     * built from all prior elements, mirroring the ordinal construction
     * 0 = ∅, n = (n-1) ∪ {n-1}, i.e. ord(n) = ord(n-1) ++ [ord(n-1)].
     * Here the payload (each flat value) rides along at every step instead
     * of the pure structural placeholder used by Tensor.ordinal():
     *   acc_0 = []
     *   acc_i = [acc_{i-1}, flat[i-1]]
     * so acc_n for n values is depth-n, and unwrapping it front-to-back
     * recovers the original sequence and its arrival order in one object,
     * with no separate index array needed.
     * @returns {*} hereditarily-nested array
     */
    toVonNeumannNested() {
      let acc = [];
      for (let i = 0; i < this._flat.length; i++) {
        acc = [acc, this._flat[i]];
      }
      return acc;
    }

    /**
     * Pure von Neumann ordinal construction (no payload): the canonical
     * set-theoretic natural number n, built purely from nested empty sets.
     *   ord(0) = []
     *   ord(n) = ord(n-1) ++ [ord(n-1)]
     * Note ord(n-1) is reused by reference as both the prefix and the new
     * last element — n-1 literally *is* the set {0,...,n-2} in this
     * construction, not a copy of it.
     * @param {number} n - non-negative integer
     * @returns {*} nested-array encoding of the von Neumann ordinal n
     */
    static ordinal(n) {
      if (!Number.isInteger(n) || n < 0) {
        throw new RangeError('Tensor.ordinal: n must be a non-negative integer');
      }
      let prev = [];
      for (let i = 0; i < n; i++) {
        prev = prev.concat([prev]);
      }
      return prev;
    }
  }

  return Tensor;
});
