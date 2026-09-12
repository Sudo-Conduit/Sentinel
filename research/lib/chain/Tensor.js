/**
 * @file research/lib/chain/Tensor.js
 * @author Will Fobbs
 * @version 1.1.0
 * @description Link 2 of Data -> Tensor -> Hilbert -> Hamiltonian -> Continuity -> VonNeumann -> Diagonal/Dense.
 *              A Tensor is two injected parts, not one object:
 *                R1 — the structural/rank spec: shape, ordering rule,
 *                     field-extraction rule. The frame/basis-choice half;
 *                     carries no data.
 *                R2 — the data itself: a Data instance, a flat array, or a
 *                     nested array. R2 is legitimately shaped either way
 *                     going IN (situational, not a defect — nested for
 *                     jagged/structural data, flat for dense numeric access)
 *                     and Tensor normalizes whichever it receives to one
 *                     canonical flat buffer + row-major strides, from which
 *                     toFlat() and toNested() are just two read-out views
 *                     of the same thing.
 *              "Ordered / Unordered / Custom" (R1.order) governs how R2's
 *              row identity maps to index position when R2 arrives flat and
 *              unordered — a key function is required to fix an order
 *              before coordinates mean anything.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const t = new Tensor().init({shape:[2,2]}, [1,0,1,1]);
 * @example const t = new Tensor().init({}, [[1,2],[3,4]]);
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory(require('./Complex.js'));
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./Complex'], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.Tensor = factory(root.Chain.Complex);
  }
}(typeof self !== 'undefined' ? self : this, function (Complex)
{
  'use strict';

  function rowMajorStrides(shape)
  {
    const strides = new Array(shape.length);
    let acc = 1;
    for (let d = shape.length - 1; d >= 0; d--)
    {
      strides[d] = acc;
      acc *= shape[d];
    }
    return strides;
  }

  function product(arr)
  {
    return arr.reduce((a, b) => a * b, 1);
  }

  class Tensor
  {
    static name = 'Tensor';
    static author = 'Will Fobbs';
    static version = '1.1.0';
    static description = 'Coordinate representation of a multi-index object: (R1) structural/rank spec + (R2) injected data, flat or nested.';
    static docs = ['research/lib/chain/docs/Tensor.md'];
    static tests = ['research/lib/chain/tests/Tensor.unit.js'];
    static config_default = { order: 'ordered' };

    static LAYOUTS = Object.freeze({ FLAT: 'flat', NESTED: 'nested' });
    static ORDERS = Object.freeze({ ORDERED: 'ordered', UNORDERED: 'unordered', CUSTOM: 'custom' });
    // REAL: elements are plain JS numbers. COMPLEX: elements are Complex
    // instances — every value in _flat is coerced through Complex.from()
    // at init() time, so downstream code never has to branch on "is this
    // element a number or a Complex" itself; it only has to know the
    // tensor's own dtype once.
    static DTYPES = Object.freeze({ REAL: 'real', COMPLEX: 'complex' });
    // 2GB (binary: 2048 * 1024 * 1024 bytes), matching the MB convention
    // (1024*1024 bytes/MB) already used throughout the size-estimate methods.
    static MAX_DENSE_MB_DEFAULT = 2048;

    /**
     * Allocates an uninitialized Tensor. No R1/R2 are read here — call
     * init() to actually resolve data into coordinate form. Splitting
     * allocation from initialization keeps the instance re-init-able (a
     * Tensor can be reshaped/re-sourced by calling init() again) and keeps
     * construction-time failures out of `new`.
     */
    constructor()
    {
      this.order = Tensor.ORDERS.ORDERED;
      this.field = undefined;
      this.layout = Tensor.LAYOUTS.FLAT;
      this.dtype = Tensor.DTYPES.REAL;
      this.shape = [];
      this.strides = [];
      this._flat = [];
      this.R1 = null;
      this.R2 = null;
    }

    /**
     * Initializes this Tensor from an injected (R1, R2) pair.
     * @param {Object} R1 - structural/rank spec (data-free)
     * @param {number[]} [R1.shape] - explicit shape; defaults to the shape inferred from R2
     *   (rank-1 [length] for a Data dependency or a flat array, or R2's own
     *   rectangular nesting depth/extents when R2 arrives as a nested array)
     * @param {string} [R1.order='ordered'] - Tensor.ORDERS.ORDERED | UNORDERED | CUSTOM;
     *   only meaningful when R2 is a Data dependency or a flat array of records
     * @param {Function} [R1.compare] - required when order is UNORDERED (Array.sort comparator over rows)
     * @param {Function} [R1.indexFn] - required when order is CUSTOM: (row, i, rows) => scalar sort key
     * @param {string} [R1.field] - field to extract a numeric scalar from each record; defaults to 'value' for key/value rows, else the row itself if already a number
     * @param {string} [R1.layout] - purely descriptive label (Tensor.LAYOUTS.FLAT | NESTED); inferred from R2's shape if omitted
     * @param {string} [R1.dtype='real'] - Tensor.DTYPES.REAL | COMPLEX. When COMPLEX, every
     *   extracted element is coerced through Complex.from() (a plain number becomes re
     *   with im=0), so _flat holds Complex instances instead of plain numbers throughout.
     * @param {Data|Array} R2 - the data: an injected Data instance, a flat array, or a nested array
     * @returns {Tensor} this, for chaining
     * @throws {TypeError} if R2 is missing or of an unsupported shape
     * @throws {RangeError} if R1.shape does not match R2's extracted size, or R2 is ragged
     */
    init(R1, R2)
    {
      R1 = R1 || {};
      if (R2 === undefined || R2 === null)
      {
        throw new TypeError('Tensor.init: R2 (data) is required');
      }

      this.order = R1.order || Tensor.ORDERS.ORDERED;
      this.field = R1.field;
      this.dtype = R1.dtype || Tensor.DTYPES.REAL;

      const resolved = Tensor._resolveR2(R2, this.order, R1, this.field, this.dtype);
      const shape = R1.shape ? R1.shape.slice() : resolved.shape;

      if (product(shape) !== resolved.flat.length)
      {
        throw new RangeError(
          'Tensor.init: shape ' + JSON.stringify(shape) +
          ' (size ' + product(shape) + ') does not match ' + resolved.flat.length + ' extracted values'
        );
      }

      this.layout = R1.layout || (resolved.wasNested ? Tensor.LAYOUTS.NESTED : Tensor.LAYOUTS.FLAT);
      this.shape = shape;
      this.strides = rowMajorStrides(shape);
      this._flat = resolved.flat; // canonical backing store regardless of requested view

      // Surface the two injected halves explicitly, matching the R1/R2 contract itself.
      this.R1 = { shape: this.shape.slice(), order: this.order, layout: this.layout, dtype: this.dtype };
      this.R2 = R2;

      return this;
    }

    /**
     * Normalize R2 (Data dependency | flat array | nested array) to one
     * canonical flat buffer + inferred shape, regardless of which shape it
     * arrived in.
     */
    static _resolveR2(R2, order, R1, field, dtype)
    {
      if (R2 && typeof R2.toArray === 'function')
      {
        const rows = Tensor._applyOrder(R2.toArray(), order, R1);
        const flat = rows.map((r) => Tensor._extractScalar(r, field, dtype));
        return { flat, shape: [flat.length], wasNested: false };
      }
      if (Array.isArray(R2))
      {
        if (R2.length > 0 && Array.isArray(R2[0]))
        {
          const nested = Tensor._flattenNested(R2, dtype);
          return { flat: nested.flat, shape: nested.shape, wasNested: true };
        }
        const rows = Tensor._applyOrder(R2, order, R1);
        const flat = rows.map((r) => Tensor._extractScalar(r, field, dtype));
        return { flat, shape: [flat.length], wasNested: false };
      }
      throw new TypeError('Tensor: R2 must be a Data instance, a flat array, or a nested array');
    }

    /** Flattens a rectangular nested array and infers its shape from nesting depth/extents. */
    static _flattenNested(nested, dtype)
    {
      const shape = [];
      let cur = nested;
      while (Array.isArray(cur))
      {
        shape.push(cur.length);
        cur = cur[0];
      }
      const flat = [];
      const walk = (node, depth) =>
      {
        if (depth === shape.length)
        {
          flat.push(Tensor._extractScalar(node, undefined, dtype));
          return;
        }
        if (!Array.isArray(node) || node.length !== shape[depth])
        {
          throw new RangeError('Tensor: ragged nested array is not rectangular at depth ' + depth);
        }
        for (let i = 0; i < node.length; i++)
        {
          walk(node[i], depth + 1);
        }
      };
      walk(nested, 0);
      return { shape, flat };
    }

    static _applyOrder(rows, order, R1)
    {
      switch (order)
      {
        case Tensor.ORDERS.ORDERED:
          return rows;
        case Tensor.ORDERS.UNORDERED:
          if (typeof R1.compare !== 'function')
          {
            throw new TypeError('Tensor: order "unordered" requires R1.compare');
          }
          return rows.slice().sort(R1.compare);
        case Tensor.ORDERS.CUSTOM:
        {
          if (typeof R1.indexFn !== 'function')
          {
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

    /**
     * @param {*} row - a raw record, number, or (dtype=complex) Complex/{re,im}
     * @param {string} [field] - key to pull the value from when row is an object
     * @param {string} [dtype=Tensor.DTYPES.REAL]
     * @returns {number|Complex}
     */
    static _extractScalar(row, field, dtype)
    {
      if (dtype === Tensor.DTYPES.COMPLEX)
      {
        if (row instanceof Complex)
        {
          return row;
        }
        if (typeof row === 'number')
        {
          return Complex.from(row);
        }
        if (row && typeof row === 'object')
        {
          const key = field || (Object.prototype.hasOwnProperty.call(row, 'value') ? 'value' : null);
          const source = key && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : row;
          return Complex.from(source);
        }
        throw new TypeError('Tensor: cannot extract a complex value from row ' + JSON.stringify(row));
      }

      if (typeof row === 'number')
      {
        return row;
      }
      if (row && typeof row === 'object')
      {
        const key = field || (Object.prototype.hasOwnProperty.call(row, 'value') ? 'value' : null);
        if (key && Object.prototype.hasOwnProperty.call(row, key))
        {
          return Number(row[key]);
        }
      }
      const n = Number(row);
      if (Number.isNaN(n))
      {
        throw new TypeError('Tensor: cannot extract a numeric scalar from row ' + JSON.stringify(row));
      }
      return n;
    }

    rank()
    {
      return this.shape.length;
    }

    size()
    {
      return this._flat.length;
    }

    /** @param {...number} indices - multi-index, one per axis */
    get(...indices)
    {
      if (indices.length !== this.shape.length)
      {
        throw new RangeError('Tensor.get: expected ' + this.shape.length + ' indices, got ' + indices.length);
      }
      let offset = 0;
      for (let d = 0; d < indices.length; d++)
      {
        offset += indices[d] * this.strides[d];
      }
      return this._flat[offset];
    }

    /** @param {...number} indicesThenValue - multi-index followed by the value to set */
    set(...indicesThenValue)
    {
      const value = indicesThenValue.pop();
      if (indicesThenValue.length !== this.shape.length)
      {
        throw new RangeError('Tensor.set: expected ' + this.shape.length + ' indices, got ' + indicesThenValue.length);
      }
      let offset = 0;
      for (let d = 0; d < indicesThenValue.length; d++)
      {
        offset += indicesThenValue[d] * this.strides[d];
      }
      this._flat[offset] = value;
    }

    /** @param {number} offset - a flat-store index @returns {number[]} the multi-index it corresponds to under this.strides */
    _indicesForOffset(offset)
    {
      const idx = new Array(this.shape.length);
      let rem = offset;
      for (let d = 0; d < this.shape.length; d++)
      {
        idx[d] = Math.floor(rem / this.strides[d]);
        rem = rem % this.strides[d];
      }
      return idx;
    }

    // ── Iteration ─────────────────────────────────────────────────────────

    /**
     * @param {function(value, indices:number[], offset:number, tensor:Tensor)} fn
     * @returns {Tensor} this, for chaining
     */
    forEach(fn)
    {
      for (let i = 0; i < this._flat.length; i++)
      {
        fn(this._flat[i], this._indicesForOffset(i), i, this);
      }
      return this;
    }

    /**
     * @param {function(value, indices:number[], offset:number, tensor:Tensor): *} fn
     * @returns {Tensor} a NEW instance of this.constructor, same shape/dtype, with fn applied elementwise
     */
    map(fn)
    {
      const mapped = this._flat.map((v, i) => fn(v, this._indicesForOffset(i), i, this));
      return new this.constructor().init({ shape: this.shape.slice(), dtype: this.dtype }, mapped);
    }

    /** @returns {Generator<[number[], *]>} [multiIndex, value] pairs in flat-store order */
    * entries()
    {
      for (let i = 0; i < this._flat.length; i++)
      {
        yield [this._indicesForOffset(i), this._flat[i]];
      }
    }

    // ── dtype-aware value arithmetic (static: takes an explicit dtype rather
    // than reading `this`, since outer()/contract() combine two tensors that
    // may not share a dtype — the RESULT's dtype, not either operand's own,
    // is what decides which arithmetic to use for a given combination) ──────

    static _add(a, b, dtype)
    {
      return dtype === Tensor.DTYPES.COMPLEX ? Complex.from(a).add(b) : a + b;
    }

    static _sub(a, b, dtype)
    {
      return dtype === Tensor.DTYPES.COMPLEX ? Complex.from(a).subtract(b) : a - b;
    }

    static _mul(a, b, dtype)
    {
      return dtype === Tensor.DTYPES.COMPLEX ? Complex.from(a).multiply(b) : a * b;
    }

    static _scaleValue(a, s, dtype)
    {
      return dtype === Tensor.DTYPES.COMPLEX ? Complex.from(a).multiply(s) : a * s;
    }

    // ── Contraction / outer product ─────────────────────────────────────────

    /**
     * Outer product: resultShape = this.shape.concat(other.shape), every
     * pairwise product of an element of this with an element of other,
     * this-index varying slower (matches the row-major shape concatenation).
     * @param {Tensor} other
     * @returns {Tensor} rank this.rank()+other.rank() tensor
     */
    outer(other)
    {
      const resultDtype = (this.dtype === Tensor.DTYPES.COMPLEX || other.dtype === Tensor.DTYPES.COMPLEX)
        ? Tensor.DTYPES.COMPLEX : Tensor.DTYPES.REAL;
      const resultShape = this.shape.concat(other.shape);
      const flat = new Array(this._flat.length * other._flat.length);
      for (let i = 0; i < this._flat.length; i++)
      {
        for (let j = 0; j < other._flat.length; j++)
        {
          flat[i * other._flat.length + j] = Tensor._mul(this._flat[i], other._flat[j], resultDtype);
        }
      }
      return new this.constructor().init({ shape: resultShape, dtype: resultDtype }, flat);
    }

    /**
     * Single-axis contraction, generalizing matrix multiplication (and,
     * contracting a matrix's own two axes against each other via two
     * separate rank-2 tensors sharing one axis, a trace-like reduction):
     * sums this[..., k, ...] * other[..., k, ...] over the contracted
     * dimension k, for every combination of the remaining ("free") indices
     * of each operand. resultShape = (this.shape minus axisSelf) concat
     * (other.shape minus axisOther); a rank-1 . rank-1 contraction over
     * their only axes collapses to a rank-0 scalar tensor (shape []).
     * @param {Tensor} other
     * @param {number} [axisSelf=this.rank()-1]
     * @param {number} [axisOther=0]
     * @returns {Tensor}
     * @throws {RangeError} if the contracted dimensions' sizes disagree
     */
    contract(other, axisSelf, axisOther)
    {
      if (axisSelf === undefined)
      {
        axisSelf = this.rank() - 1;
      }
      if (axisOther === undefined)
      {
        axisOther = 0;
      }
      if (this.shape[axisSelf] !== other.shape[axisOther])
      {
        throw new RangeError(
          'Tensor.contract: dimension mismatch at axisSelf=' + axisSelf + ' (' + this.shape[axisSelf] +
          ') vs axisOther=' + axisOther + ' (' + other.shape[axisOther] + ')'
        );
      }
      const dim = this.shape[axisSelf];
      const resultDtype = (this.dtype === Tensor.DTYPES.COMPLEX || other.dtype === Tensor.DTYPES.COMPLEX)
        ? Tensor.DTYPES.COMPLEX : Tensor.DTYPES.REAL;

      const selfFreeAxes = this.shape.map((_, d) => d).filter((d) => d !== axisSelf);
      const otherFreeAxes = other.shape.map((_, d) => d).filter((d) => d !== axisOther);
      const resultShape = selfFreeAxes.map((d) => this.shape[d]).concat(otherFreeAxes.map((d) => other.shape[d]));

      const enumerateIndices = (shape) =>
      {
        const total = product(shape) || 1;
        const all = new Array(shape.length === 0 ? 1 : total);
        for (let i = 0; i < all.length; i++)
        {
          const idx = new Array(shape.length);
          let rem = i;
          for (let d = shape.length - 1; d >= 0; d--)
          {
            idx[d] = rem % shape[d];
            rem = Math.floor(rem / shape[d]);
          }
          all[i] = idx;
        }
        return all;
      };

      const selfFreeCombos = enumerateIndices(selfFreeAxes.map((d) => this.shape[d]));
      const otherFreeCombos = enumerateIndices(otherFreeAxes.map((d) => other.shape[d]));
      const flat = new Array(selfFreeCombos.length * otherFreeCombos.length);

      for (let a = 0; a < selfFreeCombos.length; a++)
      {
        const selfIdx = new Array(this.rank());
        selfFreeAxes.forEach((axis, i) => { selfIdx[axis] = selfFreeCombos[a][i]; });

        for (let b = 0; b < otherFreeCombos.length; b++)
        {
          const otherIdx = new Array(other.rank());
          otherFreeAxes.forEach((axis, i) => { otherIdx[axis] = otherFreeCombos[b][i]; });

          let sum = resultDtype === Tensor.DTYPES.COMPLEX ? new Complex().init(0, 0) : 0;
          for (let k = 0; k < dim; k++)
          {
            selfIdx[axisSelf] = k;
            otherIdx[axisOther] = k;
            const term = Tensor._mul(this.get(...selfIdx), other.get(...otherIdx), resultDtype);
            sum = Tensor._add(sum, term, resultDtype);
          }
          flat[a * otherFreeCombos.length + b] = sum;
        }
      }

      return new this.constructor().init({ shape: resultShape, dtype: resultDtype }, flat);
    }

    // ── Elementwise arithmetic (same-shape, same-dtype tensors) ────────────

    /** @param {Tensor} other @returns {Tensor} elementwise this + other */
    add(other)
    {
      Tensor._assertSameShape(this, other, 'add');
      const flat = this._flat.map((v, i) => Tensor._add(v, other._flat[i], this.dtype));
      return new this.constructor().init({ shape: this.shape.slice(), dtype: this.dtype }, flat);
    }

    /** @param {Tensor} other @returns {Tensor} elementwise this - other */
    subtract(other)
    {
      Tensor._assertSameShape(this, other, 'subtract');
      const flat = this._flat.map((v, i) => Tensor._sub(v, other._flat[i], this.dtype));
      return new this.constructor().init({ shape: this.shape.slice(), dtype: this.dtype }, flat);
    }

    /** @param {number|Complex} scalar @returns {Tensor} elementwise this * scalar */
    scale(scalar)
    {
      const flat = this._flat.map((v) => Tensor._scaleValue(v, scalar, this.dtype));
      return new this.constructor().init({ shape: this.shape.slice(), dtype: this.dtype }, flat);
    }

    static _assertSameShape(a, b, opName)
    {
      if (a.shape.length !== b.shape.length || a.shape.some((d, i) => d !== b.shape[i]))
      {
        throw new RangeError(
          'Tensor.' + opName + ': shape mismatch ' + JSON.stringify(a.shape) + ' vs ' + JSON.stringify(b.shape)
        );
      }
    }

    // ── Shape operations ────────────────────────────────────────────────────

    /**
     * Same flat data, reinterpreted under a new shape (must match total size).
     * @param {number[]} newShape
     * @returns {Tensor}
     * @throws {RangeError} if product(newShape) !== this.size()
     */
    reshape(newShape)
    {
      if (product(newShape) !== this._flat.length)
      {
        throw new RangeError(
          'Tensor.reshape: new shape ' + JSON.stringify(newShape) + ' does not match size ' + this._flat.length
        );
      }
      return new this.constructor().init({ shape: newShape.slice(), dtype: this.dtype }, this._flat.slice());
    }

    /**
     * Permutes axes, MATERIALIZING the reordered data into a new row-major
     * flat store (not a strides-only view) so the row-major invariant every
     * other method relies on stays true of the result.
     * @param {number[]} [axesPermutation] - a permutation of 0..rank()-1; defaults to reversing every axis
     * @returns {Tensor}
     * @throws {RangeError} if axesPermutation is not a permutation of this tensor's axes
     */
    transpose(axesPermutation)
    {
      const rank = this.rank();
      const perm = axesPermutation || this.shape.map((_, i) => rank - 1 - i);
      if (perm.length !== rank || new Set(perm).size !== rank || perm.some((d) => d < 0 || d >= rank))
      {
        throw new RangeError('Tensor.transpose: axesPermutation must be a permutation of 0..' + (rank - 1));
      }
      const newShape = perm.map((axis) => this.shape[axis]);
      const newStrides = rowMajorStrides(newShape);
      const flat = new Array(this._flat.length);
      for (let offset = 0; offset < this._flat.length; offset++)
      {
        const oldIdx = this._indicesForOffset(offset);
        const newIdx = perm.map((axis) => oldIdx[axis]);
        let newOffset = 0;
        for (let d = 0; d < newIdx.length; d++)
        {
          newOffset += newIdx[d] * newStrides[d];
        }
        flat[newOffset] = this._flat[offset];
      }
      return new this.constructor().init({ shape: newShape, dtype: this.dtype }, flat);
    }

    // ── Tensor-native classification & algebra ──────────────────────────────
    //
    // Everything above (sum/mean/variance/magnitude, formula mixins) is
    // generic array statistics — none of it is specific to being a TENSOR
    // rather than a plain buffer of numbers. Rank/shape structure carries
    // real tensor-algebraic properties (square-ness, symmetry, trace,
    // diagonality) that a flat array alone doesn't have an opinion about.
    // These belong on the base class, not a formula mixin, because they're
    // properties of the coordinate structure (R1) itself, not reductions
    // over the data (R2) — true regardless of flat/nested presentation.

    /** @returns {boolean} rank 0 (a single value, no axes) */
    isScalar()
    {
      return this.rank() === 0;
    }

    /** @returns {boolean} rank 1 */
    isVector()
    {
      return this.rank() === 1;
    }

    /** @returns {boolean} rank 2 */
    isMatrix()
    {
      return this.rank() === 2;
    }

    /** @returns {boolean} rank 2 with equal row/column dimension */
    isSquare()
    {
      return this.rank() === 2 && this.shape[0] === this.shape[1];
    }

    /** @param {number|Complex} v @returns {boolean} dtype-aware "is this element zero" */
    _isZeroValue(v)
    {
      return this.dtype === Tensor.DTYPES.COMPLEX ? (v.re === 0 && v.im === 0) : v === 0;
    }

    /** @param {number|Complex} a @param {number|Complex} b @returns {boolean} dtype-aware value equality */
    _valuesEqual(a, b)
    {
      return this.dtype === Tensor.DTYPES.COMPLEX ? Complex.from(a).equals(b) : a === b;
    }

    /** @returns {boolean} true if every element is zero (any rank) */
    isZero()
    {
      return this._flat.every((v) => this._isZeroValue(v));
    }

    /**
     * @returns {number|Complex} the sum of diagonal elements T[i][i]
     * @throws {RangeError} if this is not a square rank-2 tensor
     */
    trace()
    {
      if (!this.isSquare())
      {
        throw new RangeError('Tensor.trace: requires a square rank-2 tensor, got shape ' + JSON.stringify(this.shape));
      }
      const n = this.shape[0];
      let sum = this.dtype === Tensor.DTYPES.COMPLEX ? new Complex().init(0, 0) : 0;
      for (let i = 0; i < n; i++)
      {
        sum = Tensor._add(sum, this.get(i, i), this.dtype);
      }
      return sum;
    }

    /**
     * @returns {Array<number|Complex>} the diagonal elements [T[0][0], T[1][1], ...]
     * @throws {RangeError} if this is not a square rank-2 tensor
     */
    diagonal()
    {
      if (!this.isSquare())
      {
        throw new RangeError('Tensor.diagonal: requires a square rank-2 tensor, got shape ' + JSON.stringify(this.shape));
      }
      const n = this.shape[0];
      const out = new Array(n);
      for (let i = 0; i < n; i++)
      {
        out[i] = this.get(i, i);
      }
      return out;
    }

    /**
     * @returns {boolean} true if every off-diagonal element is zero
     *   (a non-square tensor is not diagonal, by definition, not an error)
     */
    isDiagonal()
    {
      if (!this.isSquare())
      {
        return false;
      }
      const n = this.shape[0];
      for (let i = 0; i < n; i++)
      {
        for (let j = 0; j < n; j++)
        {
          if (i !== j && !this._isZeroValue(this.get(i, j)))
          {
            return false;
          }
        }
      }
      return true;
    }

    /**
     * @returns {boolean} true if T[i][j] === T[j][i] for every i,j
     *   (a non-square tensor is not symmetric, by definition, not an error)
     */
    isSymmetric()
    {
      if (!this.isSquare())
      {
        return false;
      }
      const n = this.shape[0];
      for (let i = 0; i < n; i++)
      {
        for (let j = i + 1; j < n; j++)
        {
          if (!this._valuesEqual(this.get(i, j), this.get(j, i)))
          {
            return false;
          }
        }
      }
      return true;
    }

    // ── Storage size estimates (deterministic, formula-based) ──────────────
    //
    // "Deterministic" specifically rules out process.memoryUsage()-style
    // measurement: actual JS engine memory (V8 array headers, per-element
    // boxing, alignment padding) varies by engine, engine VERSION, and even
    // array contents in ways that are not reproducible run to run. These
    // methods instead compute a pure function of shape + dtype alone —
    // IEEE-754 double-precision storage assumed throughout (8 bytes per
    // real element, 16 bytes per complex element — two doubles, re and
    // im) — so the same tensor always reports the same size, on any
    // engine, without ever touching a live buffer. This is the actual
    // point of the diagonal/dense distinction made concrete: a dense n x n
    // matrix needs n^2 elements; its diagonal needs only n.

    /** @returns {number} bytes assumed per element for this tensor's dtype (8 real, 16 complex) */
    bytesPerElement()
    {
      return this.dtype === Tensor.DTYPES.COMPLEX ? 16 : 8;
    }

    /** @returns {number} elements needed to store every value densely (rows*cols*...) */
    denseElementCount()
    {
      return this.size();
    }

    /** @returns {number} bytes to store every element densely */
    denseSizeBytes()
    {
      return this.denseElementCount() * this.bytesPerElement();
    }

    /**
     * Static so it can be called on a SHAPE before any tensor exists —
     * the actual point of a size guard is deciding whether to materialize
     * something dense in the first place (e.g. before Hilbert/Hamiltonian
     * builds a dim x dim operator for an n-qubit system, where dim = 2^n
     * and dense storage grows as dim^2 — 65 GB already at n=16). Checking
     * after construction is too late; the array is already built.
     * @param {number[]} shape
     * @param {string} [dtype=Tensor.DTYPES.REAL]
     * @param {number} [maxMB=Tensor.MAX_DENSE_MB_DEFAULT] - throws if the
     *   estimate exceeds this. Pass Infinity for a pure estimate with no guard.
     * @returns {number} estimated MB to store `shape` densely at `dtype`
     * @throws {RangeError} if the estimate exceeds maxMB
     */
    static estimateDenseSizeMB(shape, dtype, maxMB)
    {
      const limit = maxMB === undefined ? Tensor.MAX_DENSE_MB_DEFAULT : maxMB;
      const bytesPerElement = dtype === Tensor.DTYPES.COMPLEX ? 16 : 8;
      const mb = (product(shape) * bytesPerElement) / (1024 * 1024);
      if (mb > limit)
      {
        throw new RangeError(
          'Tensor.estimateDenseSizeMB: shape ' + JSON.stringify(shape) + ' at dtype "' +
          (dtype || Tensor.DTYPES.REAL) + '" would need ' + mb.toFixed(2) + ' MB densely, exceeding the ' +
          limit + ' MB limit. Pass a larger maxMB explicitly if this is intentional (or Infinity for no ' +
          'limit), or use a diagonal/sparse representation instead.'
        );
      }
      return mb;
    }

    /**
     * @returns {number} MB (1024*1024 bytes) to store every element densely
     *
     * Unguarded (maxMB=Infinity): this tensor already exists — its dense
     * data is already materialized in this._flat — so there is nothing
     * left to prevent by throwing here. The guard belongs at
     * Tensor.estimateDenseSizeMB(shape, dtype), called BEFORE deciding to
     * build something this size, not on an object that already exists.
     */
    denseSizeMB()
    {
      return Tensor.estimateDenseSizeMB(this.shape, this.dtype, Infinity);
    }

    /**
     * @returns {number} elements needed to store only the diagonal —
     *   min(rows, cols) for an m x n matrix, the standard definition even
     *   when the matrix is rectangular (m !== n), not just square
     * @throws {RangeError} if this is not rank-2
     */
    diagonalElementCount()
    {
      if (!this.isMatrix())
      {
        throw new RangeError('Tensor.diagonalElementCount: requires a rank-2 tensor, got rank ' + this.rank());
      }
      return Math.min(this.shape[0], this.shape[1]);
    }

    /** @returns {number} bytes to store only the diagonal @throws {RangeError} if not rank-2 */
    diagonalSizeBytes()
    {
      return this.diagonalElementCount() * this.bytesPerElement();
    }

    /** @returns {number} MB to store only the diagonal @throws {RangeError} if not rank-2 */
    diagonalSizeMB()
    {
      return this.diagonalSizeBytes() / (1024 * 1024);
    }

    /**
     * @returns {number} denseSizeBytes / diagonalSizeBytes — how many times
     *   larger dense storage is than diagonal-only storage for this shape
     * @throws {RangeError} if not rank-2
     */
    compressionRatio()
    {
      return this.denseSizeBytes() / this.diagonalSizeBytes();
    }

    /**
     * A structured summary of this tensor's own algebraic properties —
     * the "report" half of "do and report tensor things": what trace()/
     * diagonal()/isDiagonal()/isSymmetric() compute, without requiring the
     * caller to know which ones are even meaningful for this tensor's rank.
     * @returns {Object} { rank, shape, dtype, size, layout, isZero,
     *   square?, denseSizeMB?, diagonalSizeMB?, compressionRatio?,
     *   symmetric?, diagonal?, trace? } — matrix-only fields present only
     *   when isMatrix() (undefined, not false/thrown, for any other rank,
     *   since "is a rank-3 tensor symmetric" isn't a question this class
     *   answers); symmetric/diagonal/trace further require isSquare()
     */
    report()
    {
      const out = {
        rank: this.rank(),
        shape: this.shape.slice(),
        dtype: this.dtype,
        size: this.size(),
        layout: this.layout,
        isZero: this.isZero(),
      };
      if (this.isMatrix())
      {
        out.square = this.isSquare();
        out.denseSizeMB = this.denseSizeMB();
        out.diagonalSizeMB = this.diagonalSizeMB();
        out.compressionRatio = this.compressionRatio();
        if (out.square)
        {
          out.symmetric = this.isSymmetric();
          out.diagonal = this.isDiagonal();
          out.trace = this.trace();
        }
      }
      return out;
    }

    /**
     * @returns {{data:number[], shape:number[], strides:number[]}} flat coordinate representation
     *
     * Defensive against uninitialized state (this._flat/this.shape
     * undefined) rather than throwing: reflection-based tooling (e.g.
     * ExtendX mixins that enumerate BaseClass.prototype own property
     * names to build a security/structure wrapper) invokes any accessor
     * getter it finds merely by touching the property — including
     * FlatTensor/NestedTensor's `values` getter, which calls this method
     * — with `this` bound to the bare prototype object, which was never
     * routed through init(). Returning empty defaults there is correct;
     * throwing would break generic prototype introspection that has no
     * way to know this getter needs a real instance first.
     */
    toFlat()
    {
      const flat = this._flat || [];
      const shape = this.shape || [];
      const strides = this.strides || [];
      return { data: flat.slice(), shape: shape.slice(), strides: strides.slice() };
    }

    /** @returns {*} nested-array coordinate representation, built recursively from the flat buffer. Same uninitialized-state defense as toFlat() above. */
    toNested()
    {
      const flat = this._flat || [];
      const shape = this.shape || [];
      const build = (s, offset, stride) =>
      {
        if (s.length === 0)
        {
          return flat[offset];
        }
        const [head, ...rest] = s;
        const innerStride = stride / head;
        const out = new Array(head);
        for (let i = 0; i < head; i++)
        {
          out[i] = build(rest, offset + i * innerStride, innerStride);
        }
        return out;
      };
      return build(shape, 0, product(shape));
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
    toVonNeumannNested()
    {
      let acc = [];
      for (let i = 0; i < this._flat.length; i++)
      {
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
    static ordinal(n)
    {
      if (!Number.isInteger(n) || n < 0)
      {
        throw new RangeError('Tensor.ordinal: n must be a non-negative integer');
      }
      let prev = [];
      for (let i = 0; i < n; i++)
      {
        prev = prev.concat([prev]);
      }
      return prev;
    }
  }

  return Tensor;
}));
