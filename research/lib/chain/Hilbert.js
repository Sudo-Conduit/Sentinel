/**
 * @file research/lib/chain/Hilbert.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Link 3 of Data -> Tensor -> Hilbert -> Hamiltonian -> Continuity -> VonNeumann -> Diagonal/Dense.
 *              A Hilbert vector is a Tensor fixed to rank-1 (a "ket"), with
 *              the inner-product structure that makes a plain vector space
 *              into a Hilbert space: ⟨ψ,φ⟩ = Σ conj(ψ_i) · φ_i — sesquilinear
 *              (conjugate-linear in the first argument, linear in the
 *              second, the physics ⟨ψ|φ⟩ convention), not the plain
 *              symmetric dot product Tensor.contract() computes. That
 *              distinction is the entire reason this is its own link and
 *              not just "contract() on a vector": contract() has no notion
 *              of conjugation, so ⟨ψ|φ⟩ would silently be wrong for any
 *              complex-dtype vector if computed that way.
 *
 *              Composed via ExtendX.extend(Tensor, ...) — one mixin per
 *              operation (innerProduct/norm/normalize/isNormalized/
 *              isOrthogonalTo/distance/projectOnto), matching the 1:M
 *              formula-mixin pattern FlatTensor/NestedTensor already
 *              established: each is independently toggleable per instance
 *              via enableLayer/disableLayer. dtype-agnostic throughout
 *              (works for a real Hilbert space too — conjugate() is the
 *              identity on dtype REAL, so ⟨ψ,φ⟩ reduces to the ordinary
 *              real dot product with no special-casing needed here).
 *
 *              Completeness (the "complete" in "complete inner-product
 *              space") is trivial in finite dimension — every Cauchy
 *              sequence in a finite-dimensional normed space converges —
 *              so it is not separately implemented; it is simply true of
 *              any finite-rank Hilbert vector by construction.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const psi = new Hilbert().init({shape:[2], dtype: Tensor.DTYPES.COMPLEX}, [{re:1,im:0},{re:0,im:1}]);
 * @example psi.norm(); // sqrt(2)
 * @example psi.normalize().isNormalized(); // true
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory(require('./Tensor.js'), require('./ExtendX.js'), require('./Complex.js'));
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./Tensor', './ExtendX', './Complex'], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.Hilbert = factory(root.Chain.Tensor, root.Chain.ExtendX, root.Chain.Complex);
  }
}(typeof self !== 'undefined' ? self : this, function (Tensor, ExtendX, Complex)
{
  'use strict';

  const DEFAULT_EPSILON = 1e-9;

  /** @param {number|Complex} v @returns {number} the real part (v itself, if v is already a plain number) */
  function realPart(v)
  {
    return v instanceof Complex ? v.re : v;
  }

  /** @param {number|Complex} v @returns {number} |v| (Complex.abs(), or Math.abs() for a plain number) */
  function magnitudeOf(v)
  {
    return v instanceof Complex ? v.abs() : Math.abs(v);
  }

  /** @param {Tensor} vector @param {string} opName @throws {RangeError} if vector is not rank-1 */
  function assertVector(vector, opName)
  {
    if (!vector.isVector())
    {
      throw new RangeError('Hilbert.' + opName + ': requires a rank-1 tensor (a ket), got rank ' + vector.rank());
    }
  }

  /** @param {Tensor} a @param {Tensor} b @param {string} opName @throws {RangeError} if dimensions disagree */
  function assertSameDimension(a, b, opName)
  {
    if (a.size() !== b.size())
    {
      throw new RangeError('Hilbert.' + opName + ': dimension mismatch (' + a.size() + ' vs ' + b.size() + ')');
    }
  }

  const InnerProductMixin = {
    mixinId: 'Hilbert.innerProduct',
    /**
     * ⟨this, other⟩ = Σ conj(this_i) · other_i
     * @param {Tensor} other
     * @returns {number|Complex}
     */
    innerProduct(other)
    {
      assertVector(this, 'innerProduct');
      assertVector(other, 'innerProduct');
      assertSameDimension(this, other, 'innerProduct');

      const resultDtype = (this.dtype === Tensor.DTYPES.COMPLEX || other.dtype === Tensor.DTYPES.COMPLEX)
        ? Tensor.DTYPES.COMPLEX : Tensor.DTYPES.REAL;
      const conjThis = this.conjugate().toFlat().data;
      const otherFlat = other.toFlat().data;

      let sum = resultDtype === Tensor.DTYPES.COMPLEX ? new Complex().init(0, 0) : 0;
      for (let i = 0; i < conjThis.length; i++)
      {
        sum = Tensor._add(sum, Tensor._mul(conjThis[i], otherFlat[i], resultDtype), resultDtype);
      }
      return sum;
    },
  };

  const NormMixin = {
    mixinId: 'Hilbert.norm',
    // Composes on top of InnerProductMixin via a normal dispatched call, so
    // disabling innerProduct on an instance is reflected here too.
    // ⟨ψ,ψ⟩ is always real and non-negative for a sesquilinear inner
    // product (⟨ψ,ψ⟩ = Σ conj(ψ_i)·ψ_i = Σ |ψ_i|^2), so only the real part
    // needs extracting before the square root.
    norm()
    {
      return Math.sqrt(realPart(this.innerProduct(this)));
    },
  };

  const NormalizeMixin = {
    mixinId: 'Hilbert.normalize',
    /** @returns {Tensor} a new vector scaled to unit norm @throws {RangeError} on a zero vector */
    normalize()
    {
      const n = this.norm();
      if (n === 0)
      {
        throw new RangeError('Hilbert.normalize: cannot normalize a zero vector');
      }
      return this.scale(1 / n);
    },
  };

  const IsNormalizedMixin = {
    mixinId: 'Hilbert.isNormalized',
    /**
     * @param {number} [epsilon=1e-9]
     * @returns {boolean}
     *
     * NOTE on the `epsilon` parameter: ExtendX's dispatcher always appends
     * its own `next` callback as the trailing argument to EVERY dispatched
     * call, regardless of how many arguments the caller actually passed —
     * see StructureMixin.js's own file header for the identical hazard it
     * hit first. A caller doing isNormalized() with zero arguments does
     * NOT get epsilon === undefined here; it gets epsilon === (ExtendX's
     * injected next function). Checking `typeof epsilon === 'number'`
     * instead of `=== undefined` is the fix — a real epsilon is always a
     * number, and the injected `next` is always a function, so the two
     * can never be confused.
     */
    isNormalized(epsilon)
    {
      const eps = typeof epsilon === 'number' ? epsilon : DEFAULT_EPSILON;
      return Math.abs(this.norm() - 1) < eps;
    },
  };

  const IsOrthogonalMixin = {
    mixinId: 'Hilbert.isOrthogonalTo',
    /**
     * @param {Tensor} other
     * @param {number} [epsilon=1e-9]
     * @returns {boolean} true if |⟨this,other⟩| < epsilon
     *
     * Same injected-`next`-vs-omitted-epsilon hazard as isNormalized()
     * above — `typeof epsilon === 'number'`, never `=== undefined`.
     */
    isOrthogonalTo(other, epsilon)
    {
      const eps = typeof epsilon === 'number' ? epsilon : DEFAULT_EPSILON;
      return magnitudeOf(this.innerProduct(other)) < eps;
    },
  };

  const DistanceMixin = {
    mixinId: 'Hilbert.distance',
    /** @param {Tensor} other @returns {number} ||this - other|| */
    distance(other)
    {
      assertVector(this, 'distance');
      assertVector(other, 'distance');
      assertSameDimension(this, other, 'distance');
      return this.subtract(other).norm();
    },
  };

  const ProjectOntoMixin = {
    mixinId: 'Hilbert.projectOnto',
    /**
     * The projection of this onto basisVector: (⟨e,ψ⟩ / ⟨e,e⟩) · e.
     * basisVector need not already be normalized — the ⟨e,e⟩ denominator
     * handles that generally; pass a normalized basisVector for the
     * familiar ⟨e,ψ⟩·e form.
     * @param {Tensor} basisVector
     * @returns {Tensor}
     * @throws {RangeError} if basisVector is the zero vector
     */
    projectOnto(basisVector)
    {
      const numerator = basisVector.innerProduct(this);
      const denominator = realPart(basisVector.innerProduct(basisVector));
      if (denominator === 0)
      {
        throw new RangeError('Hilbert.projectOnto: cannot project onto a zero vector');
      }
      const coeff = numerator instanceof Complex ? numerator.multiply(1 / denominator) : numerator / denominator;
      return basisVector.scale(coeff);
    },
  };

  const Hilbert = ExtendX.extend(
    Tensor,
    InnerProductMixin, NormMixin, NormalizeMixin, IsNormalizedMixin, IsOrthogonalMixin, DistanceMixin, ProjectOntoMixin
  );

  Object.defineProperty(Hilbert, 'name', { value: 'Hilbert', configurable: true });
  Hilbert.author = 'Will Fobbs';
  Hilbert.version = '1.0.0';
  Hilbert.description = 'A Tensor fixed to rank-1 with sesquilinear inner-product structure (Hilbert-space kets), composed as one independently toggleable mixin per operation.';
  Hilbert.docs = ['research/lib/chain/docs/Hilbert.md'];
  Hilbert.tests = ['research/lib/chain/tests/Hilbert.unit.js'];
  Hilbert.config_default = { order: 'ordered', dtype: Tensor.DTYPES.COMPLEX };

  // Name -> mixin lookup, so a caller can toggle a specific operation:
  //   psi.disableLayer(Hilbert.OPERATIONS.normalize);
  Hilbert.OPERATIONS = Object.freeze({
    innerProduct: InnerProductMixin,
    norm: NormMixin,
    normalize: NormalizeMixin,
    isNormalized: IsNormalizedMixin,
    isOrthogonalTo: IsOrthogonalMixin,
    distance: DistanceMixin,
    projectOnto: ProjectOntoMixin,
  });

  // Fixed presentation accessor — not a togglable layer (a ket's flat
  // component list is not itself an operation), so defined directly
  // rather than as a dispatched mixin method, matching FlatTensor's
  // `values`.
  Object.defineProperty(Hilbert.prototype, 'values', {
    get() { return this.toFlat(); },
    enumerable: false,
    configurable: true,
  });

  return Hilbert;
}));
