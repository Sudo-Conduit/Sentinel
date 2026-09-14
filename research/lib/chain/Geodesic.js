/**
 * @file research/lib/chain/Geodesic.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Base class for the Geodesic Protocol (see GEODESIC_PROTOCOL.md).
 *              Links exactly two SystemAdapters without merging their
 *              Systems into one shared tensor-product state space. This
 *              file is deliberately just the base — no link math, no
 *              compatibility checks. Same role Tensor.js plays for
 *              Hilbert/Hamiltonian: a plain class that later files compose
 *              via ExtendX.extend(Geodesic, FubiniStudyMixin, BuresMixin,
 *              CouplingMixin, InteractionMixin, ...), one mixin per link
 *              type, each independently toggleable per instance.
 *
 *              Kept intentionally dumb, matching SystemAdapter's own
 *              constraint: init() only stores the two adapters and checks
 *              they expose the shape this class depends on (lastState/
 *              systemId) — no shape/dtype-compatibility enforcement, no
 *              orchestration. That is left to whichever mixin actually
 *              needs it, since different link types (e.g. FubiniStudy vs.
 *              Coupling) may have different compatibility requirements,
 *              and baking one rule into the base would make it wrong for
 *              some future mixin.
 * @principle "Assume no dependencies in classes unless authorized."
 * @example const g = new Geodesic().init({ left: adapterA, right: adapterB });
 * @example g.leftState(); // adapterA.lastState(), or null before the first message arrives
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory();
  }
  else if (typeof define === 'function' && define.amd)
  {
    define([], factory);
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.Geodesic = factory();
  }
}(typeof self !== 'undefined' ? self : this, function ()
{
  'use strict';

  /** @param {*} adapter @param {string} label 'left'|'right', for the error message */
  function assertAdapterShaped(adapter, label)
  {
    if (!adapter || typeof adapter.lastState !== 'function' || typeof adapter.systemId !== 'string')
    {
      throw new TypeError('Geodesic.init: ' + label + ' must be a SystemAdapter (expose .lastState() and .systemId)');
    }
  }

  class Geodesic
  {
    static name = 'Geodesic';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Base class linking two SystemAdapters; link math lives in ExtendX mixins composed on top, not here.';
    static docs = 'research/lib/chain/GEODESIC_PROTOCOL.md';
    static tests = 'research/lib/chain/tests/Geodesic.unit.js';
    static config_default = {};

    constructor()
    {
    }

    /**
     * @param {object} endpoints
     * @param {object} endpoints.left a SystemAdapter
     * @param {object} endpoints.right a SystemAdapter
     * @returns {Geodesic} this, for chaining
     */
    init(endpoints)
    {
      const opts = endpoints || {};
      assertAdapterShaped(opts.left, 'left');
      assertAdapterShaped(opts.right, 'right');
      if (opts.left.systemId === opts.right.systemId)
      {
        throw new TypeError('Geodesic.init: left and right must be different systems, both were "' + opts.left.systemId + '"');
      }
      this.left = opts.left;
      this.right = opts.right;
      return this;
    }

    /** @returns {object|null} left.lastState(), or null before the first state message has arrived */
    leftState()
    {
      return this.left.lastState();
    }

    /** @returns {object|null} right.lastState(), or null before the first state message has arrived */
    rightState()
    {
      return this.right.lastState();
    }

    /** @returns {boolean} true once both endpoints have received at least one state message */
    isReady()
    {
      return this.leftState() !== null && this.rightState() !== null;
    }
  }

  return Geodesic;
}));
