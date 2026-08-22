/**
 * @file ComputeSourceProfile.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The "Compute" leg of the Compute/Work/Capital simulation, split into the same
 *              three real compute-source types Node Economics already models (PNode=Solar,
 *              BNode=Server, CNode=User Machine). Each profile is a configurable mock stress-
 *              test knob \u2014 no real hardware telemetry required \u2014 producing a computeYield()
 *              in GFlops-equivalent units that CVCEngine.recordWork consumes as real work units,
 *              so Node Economics' node types and CVC's PoUW ledger share one source of truth
 *              instead of two parallel node-type enums.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.ComputeSourceProfile = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('ComputeSourceProfile requires BaseClassX to be loaded first');

  // Matches Node Economics' three real node types exactly \u2014 not a new taxonomy.
  const SOURCE_TYPES = ['solar', 'server', 'usermachine']; // PNode, BNode, CNode

  class ComputeSourceProfile extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        sourceType: { type: 'string', default: 'server' }, // 'solar' | 'server' | 'usermachine'
        label: { type: 'string', default: '' },
        unitCount: { type: 'number', default: 1 },
        gflopsPerUnit: { type: 'number', default: 0 },
        // Real-world derate per source type \u2014 the same distinction Node Economics draws:
        // Solar (PNode) derates for weather/thermal/seasonality, Server (BNode) derates for
        // active-cooling overhead, User Machine (CNode) derates for idle-window availability.
        derate: { type: 'number', default: 0.85 },
        isMock: { type: 'boolean', default: true }
      }
    };

    static isValidSourceType(t) { return SOURCE_TYPES.includes(t); }

    // Total real GFlops-equivalent capacity this profile represents \u2014 fed to CVCEngine.recordWork
    // as `units` (with qualityScore/complexityMultiplier supplied by the caller per real
    // attestation, not fabricated here).
    computeYield() {
      return this.unitCount * this.gflopsPerUnit * this.derate;
    }
  }

  ComputeSourceProfile.SOURCE_TYPES = SOURCE_TYPES;
  return ComputeSourceProfile;
}));
