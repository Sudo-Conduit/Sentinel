/**
 * @file research/lib/chain/Hamiltonian.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Link 4 of Data -> Tensor -> Hilbert -> Hamiltonian -> Continuity -> VonNeumann -> Diagonal/Dense.
 *              A Hamiltonian is a Tensor fixed to a square rank-2
 *              (self-adjoint) operator on a Hilbert space — the object
 *              that generates BOTH observables (expectation values) and
 *              dynamics (time evolution via the Schrödinger equation).
 *              Composed via ExtendX.extend(Tensor, ...), one independently
 *              toggleable mixin per operation, matching Hilbert/FlatTensor/
 *              NestedTensor's established pattern:
 *
 *                adjoint()              — H† = conj(H)^T
 *                isHermitian(epsilon)   — H === H† (within tolerance);
 *                                          false (not thrown) on a
 *                                          non-square operator, same as
 *                                          Tensor.isSymmetric()
 *                applyTo(state)         — H|ψ⟩, a genuine matrix-vector
 *                                          product, returned as a Hilbert
 *                                          (not a Hamiltonian — the RESULT
 *                                          is a ket, not an operator)
 *                expectationValue(state)     — ⟨ψ|H|ψ⟩ (Complex or number;
 *                                                its imaginary part is the
 *                                                diagnostic for "is this H
 *                                                actually Hermitian")
 *                expectationValueReal(state, epsilon) — same, but asserts
 *                                          the imaginary part is negligible
 *                                          and returns a plain real number
 *                multiply(other)        — operator composition H·O (still
 *                                          an operator, so returned typed
 *                                          as this.constructor, unlike
 *                                          applyTo)
 *                commutator(other)      — [H,O] = H·O − O·H
 *                evolve(state, dt, hbar) — ONE first-order (forward Euler)
 *                                          step of iℏ∂ψ/∂t = Hψ:
 *                                          ψ(t+dt) ≈ ψ(t) − (i·dt/ℏ)·Hψ(t).
 *                                          This is an APPROXIMATION, not
 *                                          exact unitary evolution — it
 *                                          does not exactly conserve
 *                                          ||ψ||, only approximately for
 *                                          small dt. Exact evolution
 *                                          (e^{-iHt/ℏ} via diagonalization)
 *                                          is deliberately deferred to the
 *                                          chain's own Diagonal/Dense link,
 *                                          not built here.
 *
 *              Every mixin method below with an optional TRAILING
 *              parameter (epsilon, hbar) checks its actual expected type
 *              (typeof x === 'number'), never `=== undefined` — ExtendX's
 *              dispatcher always appends its own `next` callback as a
 *              trailing argument to every dispatched call, so a caller
 *              omitting that parameter does NOT get undefined there; it
 *              gets the injected function. This is the exact hazard
 *              StructureMixin.js's file header documents and Hilbert.js
 *              hit (and fixed) for isNormalized/isOrthogonalTo — applied
 *              here from the start instead of discovered via a failing
 *              test.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const H = new Hamiltonian().init({shape:[2,2], dtype:Tensor.DTYPES.COMPLEX}, [1,0,0,-1]); // Pauli Z
 * @example H.isHermitian(); // true
 * @example H.applyTo(ket0); // Hilbert instance
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory(require('./Tensor.js'), require('./ExtendX.js'), require('./Complex.js'), require('./Hilbert.js'));
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./Tensor', './ExtendX', './Complex', './Hilbert'], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.Hamiltonian = factory(root.Chain.Tensor, root.Chain.ExtendX, root.Chain.Complex, root.Chain.Hilbert);
  }
}(typeof self !== 'undefined' ? self : this, function (Tensor, ExtendX, Complex, Hilbert)
{
  'use strict';

  const DEFAULT_EPSILON = 1e-9;

  /** @param {number|Complex} a @param {number|Complex} b @returns {number} |a - b|, dtype-agnostic */
  function valueDistance(a, b)
  {
    if (a instanceof Complex || b instanceof Complex)
    {
      return Complex.from(a).subtract(b).abs();
    }
    return Math.abs(a - b);
  }

  const AdjointMixin = {
    mixinId: 'Hamiltonian.adjoint',
    /** @returns {Tensor} H† = conj(H)^T */
    adjoint()
    {
      return this.conjugate().transpose();
    },
  };

  const IsHermitianMixin = {
    mixinId: 'Hamiltonian.isHermitian',
    /**
     * @param {number} [epsilon=1e-9]
     * @returns {boolean} true if H === H† within tolerance; false (not
     *   thrown) on a non-square operator, matching Tensor.isSymmetric()
     */
    isHermitian(epsilon)
    {
      if (!this.isSquare())
      {
        return false;
      }
      const eps = typeof epsilon === 'number' ? epsilon : DEFAULT_EPSILON;
      const adj = this.adjoint();
      const n = this.shape[0];
      for (let i = 0; i < n; i++)
      {
        for (let j = 0; j < n; j++)
        {
          if (valueDistance(this.get(i, j), adj.get(i, j)) > eps)
          {
            return false;
          }
        }
      }
      return true;
    },
  };

  const ApplyToMixin = {
    mixinId: 'Hamiltonian.applyTo',
    /**
     * H|state⟩ — a genuine matrix-vector product, returned as a Hilbert
     * ket (not a Hamiltonian: the result is a vector, not an operator).
     * @param {Tensor} state - a rank-1 tensor of dimension equal to H's
     * @returns {Hilbert}
     * @throws {RangeError} if H is not square, or state is not a matching-dimension vector
     */
    applyTo(state)
    {
      if (!this.isSquare())
      {
        throw new RangeError('Hamiltonian.applyTo: H must be a square rank-2 operator, got shape ' + JSON.stringify(this.shape));
      }
      if (!state.isVector() || state.size() !== this.shape[0])
      {
        throw new RangeError(
          'Hamiltonian.applyTo: state must be a rank-1 tensor of dimension ' + this.shape[0] +
          ', got rank ' + state.rank() + ' size ' + state.size()
        );
      }
      const resultDtype = (this.dtype === Tensor.DTYPES.COMPLEX || state.dtype === Tensor.DTYPES.COMPLEX)
        ? Tensor.DTYPES.COMPLEX : Tensor.DTYPES.REAL;
      const n = this.shape[0];
      const flat = new Array(n);
      for (let i = 0; i < n; i++)
      {
        let sum = resultDtype === Tensor.DTYPES.COMPLEX ? new Complex().init(0, 0) : 0;
        for (let j = 0; j < n; j++)
        {
          sum = Tensor._add(sum, Tensor._mul(this.get(i, j), state.get(j), resultDtype), resultDtype);
        }
        flat[i] = sum;
      }
      return new Hilbert().init({ shape: [n], dtype: resultDtype }, flat);
    },
  };

  const ExpectationValueMixin = {
    mixinId: 'Hamiltonian.expectationValue',
    /**
     * ⟨state|H|state⟩ — requires state to be Hilbert-composed (needs
     * innerProduct()). Real and non-negative-definite is NOT guaranteed in
     * general, but the RESULT is always real when H is truly Hermitian —
     * see expectationValueReal() for the version that asserts this.
     * @param {Hilbert} state
     * @returns {number|Complex}
     */
    expectationValue(state)
    {
      return state.innerProduct(this.applyTo(state));
    },

    /**
     * Same as expectationValue(), but asserts the result's imaginary part
     * is negligible (the actual physical content of "H is Hermitian, so
     * every expectation value is real") and returns a plain real number.
     * @param {Hilbert} state
     * @param {number} [epsilon=1e-9]
     * @returns {number}
     * @throws {RangeError} if the imaginary part exceeds epsilon
     */
    expectationValueReal(state, epsilon)
    {
      const eps = typeof epsilon === 'number' ? epsilon : DEFAULT_EPSILON;
      const val = this.expectationValue(state);
      const im = val instanceof Complex ? val.im : 0;
      if (Math.abs(im) > eps)
      {
        throw new RangeError(
          'Hamiltonian.expectationValueReal: expectation value has non-negligible imaginary part (' +
          im + ') — this operator is likely not Hermitian'
        );
      }
      return val instanceof Complex ? val.re : val;
    },
  };

  const MultiplyMixin = {
    mixinId: 'Hamiltonian.multiply',
    /**
     * Operator composition H·other — still an operator (same shape rule as
     * ordinary matrix multiplication), so returned typed as
     * this.constructor, unlike applyTo() which produces a Hilbert ket.
     * @param {Tensor} other - a square rank-2 operator of matching dimension
     * @returns {Tensor}
     */
    multiply(other)
    {
      if (!this.isSquare() || !other.isSquare() || this.shape[0] !== other.shape[0])
      {
        throw new RangeError(
          'Hamiltonian.multiply: both operands must be square operators of matching dimension, got ' +
          JSON.stringify(this.shape) + ' and ' + JSON.stringify(other.shape)
        );
      }
      return this.contract(other, 1, 0);
    },
  };

  const CommutatorMixin = {
    mixinId: 'Hamiltonian.commutator',
    /** @param {Tensor} other @returns {Tensor} [H, other] = H·other − other·H */
    commutator(other)
    {
      return this.multiply(other).subtract(other.multiply(this));
    },
  };

  const EvolveMixin = {
    mixinId: 'Hamiltonian.evolve',
    /**
     * ONE first-order (forward Euler) step of iℏ ∂ψ/∂t = Hψ:
     *   ψ(t+dt) ≈ ψ(t) − (i·dt/ℏ)·H|ψ(t)⟩
     * An APPROXIMATION, not exact unitary evolution — ||ψ|| is only
     * approximately conserved, and the error grows with dt (use a smaller
     * dt and more steps for better accuracy, or renormalize the result).
     * Exact evolution (e^{-iHt/ℏ}, needing diagonalization) is deliberately
     * left to the chain's own Diagonal/Dense link.
     * @param {Hilbert} state
     * @param {number} dt
     * @param {number} [hbar=1]
     * @returns {Hilbert}
     */
    evolve(state, dt, hbar)
    {
      const h = typeof hbar === 'number' ? hbar : 1;
      const Hpsi = this.applyTo(state);
      const iCoeff = new Complex().init(0, -dt / h); // -i*dt/hbar
      return state.add(Hpsi.scale(iCoeff));
    },
  };

  const Hamiltonian = ExtendX.extend(
    Tensor,
    AdjointMixin, IsHermitianMixin, ApplyToMixin, ExpectationValueMixin, MultiplyMixin, CommutatorMixin, EvolveMixin
  );

  Object.defineProperty(Hamiltonian, 'name', { value: 'Hamiltonian', configurable: true });
  Hamiltonian.author = 'Will Fobbs';
  Hamiltonian.version = '1.0.0';
  Hamiltonian.description = 'A Tensor fixed to a square rank-2 self-adjoint operator on a Hilbert space, generating observables (expectation values) and dynamics (Schrödinger evolution).';
  Hamiltonian.docs = ['research/lib/chain/docs/Hamiltonian.md'];
  Hamiltonian.tests = ['research/lib/chain/tests/Hamiltonian.unit.js'];
  Hamiltonian.config_default = { order: 'ordered', dtype: Tensor.DTYPES.COMPLEX };

  // Name -> mixin lookup, so a caller can toggle a specific operation:
  //   H.disableLayer(Hamiltonian.OPERATIONS.evolve);
  Hamiltonian.OPERATIONS = Object.freeze({
    adjoint: AdjointMixin,
    isHermitian: IsHermitianMixin,
    applyTo: ApplyToMixin,
    expectationValue: ExpectationValueMixin,
    multiply: MultiplyMixin,
    commutator: CommutatorMixin,
    evolve: EvolveMixin,
  });

  // Fixed presentation accessor — a matrix's natural read-out is its
  // nested (rows-of-columns) view, not a flat buffer, matching
  // NestedTensor's choice for the same reason. Not a togglable layer.
  Object.defineProperty(Hamiltonian.prototype, 'values', {
    get() { return this.toNested(); },
    enumerable: false,
    configurable: true,
  });

  return Hamiltonian;
}));
