/**
 * @file research/lib/chain/GeodesicLink.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The link-math half of the Geodesic Protocol (see
 *              GEODESIC_PROTOCOL.md) — Geodesic.js is the dumb base
 *              (endpoint validation, leftState()/rightState()/isReady()
 *              only); this file is where "mechanical" actually happens.
 *              Composed via ExtendX.extend(Geodesic, CouplingMixin,
 *              InteractionMixin, FubiniStudyMixin, BuresMixin) — that
 *              order is deliberate (composition/dispatch order, not just
 *              narrative build order) and each mixin is independently
 *              toggleable per instance, same 1:M pattern as
 *              Hilbert.OPERATIONS/Hamiltonian.OPERATIONS.
 *
 *              All four mixins read leftState()/rightState() only —
 *              none of them write back to either System or Adapter. A
 *              Geodesic observes and computes; whether/how a coupling or
 *              interaction term feeds back into a System's own evolve()
 *              is the caller's decision, explicitly out of scope here
 *              (GEODESIC_PROTOCOL.md §6). Every method returns null,
 *              rather than throwing, when either side hasn't received a
 *              state message yet — mirrors Geodesic.isReady() rather
 *              than forcing every caller to check it first.
 *
 *              - Coupling: fixed-strength scalar coupling energy,
 *                g * <left|right> — the simplest case, sesquilinear
 *                (physics <left|right> convention, matching Hilbert).
 *              - Interaction: generalizes Coupling to an arbitrary
 *                caller-supplied function of the two raw state buffers —
 *                dependency-injected, no physics assumed here at all.
 *              - FubiniStudy: the angle metric on projective Hilbert
 *                space, arccos(|<left|right>| / (||left|| ||right||)).
 *              - Bures: the pure-state Bures distance,
 *                sqrt(2 * (1 - |<left|right>| / (||left|| ||right||))) —
 *                shares the same normalized-overlap magnitude as
 *                FubiniStudy by construction, so it is computed once via
 *                a private module-level helper rather than duplicated.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const link = ExtendXGeodesicLink...(); // see tests for full wiring
 * @example link.coupling(0.5); // Complex: 0.5 * <left|right>
 * @example link.interaction((l, r) => l.length + r.length); // caller-defined
 * @example link.fubiniStudyDistance(); // radians, [0, pi/2]
 * @example link.buresDistance(); // [0, sqrt(2)]
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory(require('./Geodesic.js'), require('./ExtendX.js'), require('./Complex.js'));
  }
  else if (typeof define === 'function' && define.amd)
  {
    define(['./Geodesic', './ExtendX', './Complex'], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.GeodesicLink = factory(root.Chain.Geodesic, root.Chain.ExtendX, root.Chain.Complex);
  }
}(typeof self !== 'undefined' ? self : this, function (Geodesic, ExtendX, Complex)
{
  'use strict';

  /**
   * Sesquilinear overlap <left|right> = Sum conj(left_i) * right_i, over
   * the raw wire-format buffers (plain numbers or {re,im} plain objects —
   * Complex.from coerces either). Same convention Hilbert.innerProduct()
   * uses; duplicated here rather than depending on Hilbert, since a
   * Geodesic only ever sees serialized state, never a live Hilbert
   * instance (that decoupling is the entire point of the protocol).
   * @param {Array} leftData @param {Array} rightData @returns {Complex}
   */
  function sesquilinearOverlap(leftData, rightData)
  {
    if (leftData.length !== rightData.length)
    {
      throw new RangeError('GeodesicLink: dimension mismatch (' + leftData.length + ' vs ' + rightData.length + ')');
    }
    let sum = new Complex().init(0, 0);
    for (let i = 0; i < leftData.length; i++)
    {
      const l = Complex.from(leftData[i]).conjugate();
      const r = Complex.from(rightData[i]);
      sum = sum.add(l.multiply(r));
    }
    return sum;
  }

  /** @param {Array} data @returns {number} sqrt(Sum |v_i|^2) */
  function norm(data)
  {
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++)
    {
      const v = Complex.from(data[i]);
      sumSquares += v.re * v.re + v.im * v.im;
    }
    return Math.sqrt(sumSquares);
  }

  /**
   * |<left|right>| / (||left|| ||right||), clamped to [0,1] to absorb
   * floating-point overshoot — shared by FubiniStudy and Bures, since
   * both are functions of exactly this one quantity.
   * @param {Array} leftData @param {Array} rightData @returns {number}
   */
  function normalizedOverlapMagnitude(leftData, rightData)
  {
    const normLeft = norm(leftData);
    const normRight = norm(rightData);
    if (normLeft === 0 || normRight === 0)
    {
      throw new RangeError('GeodesicLink: distance is undefined for a zero-vector state');
    }
    const raw = sesquilinearOverlap(leftData, rightData).abs() / (normLeft * normRight);
    return Math.min(1, Math.max(0, raw));
  }

  const CouplingMixin = {
    mixinId: 'GeodesicLink.coupling',

    /**
     * @param {number} [strength=1] coupling constant g
     * @returns {Complex|null} g * <left|right>, or null if either side has no state yet
     */
    coupling(strength)
    {
      const g = typeof strength === 'number' ? strength : 1;
      if (!this.isReady())
      {
        return null;
      }
      const overlap = sesquilinearOverlap(this.leftState().data, this.rightState().data);
      return overlap.multiply(new Complex().init(g, 0));
    },
  };

  const InteractionMixin = {
    mixinId: 'GeodesicLink.interaction',

    /**
     * Generalizes coupling() to an arbitrary caller-supplied term —
     * purely mechanical dispatch, no physics assumed here.
     * @param {function(Array,Array):*} fn called as fn(leftData, rightData)
     * @returns {*|null} fn's return value, or null if either side has no state yet
     */
    interaction(fn)
    {
      if (typeof fn !== 'function')
      {
        throw new TypeError('GeodesicLink.interaction: fn must be a function');
      }
      if (!this.isReady())
      {
        return null;
      }
      return fn(this.leftState().data, this.rightState().data);
    },
  };

  const FubiniStudyMixin = {
    mixinId: 'GeodesicLink.fubiniStudyDistance',

    /** @returns {number|null} arccos(|<left|right>|/(||left|| ||right||)) in radians, [0, pi/2]; null if not ready */
    fubiniStudyDistance()
    {
      if (!this.isReady())
      {
        return null;
      }
      const cosTheta = normalizedOverlapMagnitude(this.leftState().data, this.rightState().data);
      return Math.acos(cosTheta);
    },
  };

  const BuresMixin = {
    mixinId: 'GeodesicLink.buresDistance',

    /** @returns {number|null} sqrt(2*(1-|<left|right>|/(||left|| ||right||))), [0, sqrt(2)]; null if not ready */
    buresDistance()
    {
      if (!this.isReady())
      {
        return null;
      }
      const fidelityRoot = normalizedOverlapMagnitude(this.leftState().data, this.rightState().data);
      return Math.sqrt(2 * (1 - fidelityRoot));
    },
  };

  const GeodesicLink = ExtendX.extend(Geodesic, CouplingMixin, InteractionMixin, FubiniStudyMixin, BuresMixin);

  GeodesicLink.OPERATIONS = Object.freeze({
    coupling: CouplingMixin,
    interaction: InteractionMixin,
    fubiniStudyDistance: FubiniStudyMixin,
    buresDistance: BuresMixin,
  });

  GeodesicLink.author = 'Will Fobbs';
  GeodesicLink.version = '1.0.0';
  GeodesicLink.description = 'Geodesic composed with coupling/interaction/Fubini-Study/Bures link-math mixins.';
  GeodesicLink.docs = ['research/lib/chain/GEODESIC_PROTOCOL.md'];
  GeodesicLink.tests = ['research/lib/chain/tests/GeodesicLink.unit.js'];

  return GeodesicLink;
}));
