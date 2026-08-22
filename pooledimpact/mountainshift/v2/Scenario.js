/**
 * @file Scenario.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description A named alternative assumption set attached to a Deal — e.g.
 *              ONOMO Bulawayo's "Fee Scenario A (LOI v3)" vs "Fee Scenario B
 *              (Market-rebased)", or a gearing scenario (60:40 vs 50:50).
 *              Exactly one Scenario per Deal is the baseline (isBaseline);
 *              every other Scenario is comparable against it via
 *              deltaVsBaseline() — computed, never separately stored, so a
 *              delta can't drift from the keyMetrics that produce it. Mirrors
 *              Deal.keyMetrics' shape (a flat named-metric bucket) rather
 *              than inventing bespoke fields per scenario type.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.Scenario = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('Scenario requires BaseClassX to be loaded first');

  class Scenario extends BaseClassX {
    static version = '1.0.0';
    static domain = 'finance.scenario';
    static _schema = { properties: {
      name: { type: 'string', default: '' },              // e.g. 'Fee Scenario A (LOI v3)'
      dealId: { type: 'string', default: '' },
      scenarioType: { type: 'string', default: 'combined' },  // 'fee-structure' | 'gearing' | 'combined' | 'sensitivity'
      isBaseline: { type: 'boolean', default: false },
      assumptionOverrides: { type: 'object', default: {} },   // named overrides vs the Deal's base assumptions, e.g. { loyaltyFeePercent: 2.0, gearingDebtPercent: 0.6 }
      keyMetrics: { type: 'object', default: {} },            // same generic shape as Deal.keyMetrics, computed for THIS scenario
      description: { type: 'string', default: '' },
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      name: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      dealId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      scenarioType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      isBaseline: FieldACL.build({ owner: 'rw-', group: 'r--', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      assumptionOverrides: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: [] }),
      keyMetrics: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      description: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: [] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'finance.scenario', name: options.name || 'Scenario',
        schema: { name: 'string', dealId: 'string', scenarioType: 'string', isBaseline: 'boolean', assumptionOverrides: 'object', keyMetrics: 'object', description: 'string', createdBy: 'string' }
      });
      this.dealId = options.dealId || '';
      this.scenarioType = options.scenarioType || 'combined';
      this.isBaseline = !!options.isBaseline;
      this.assumptionOverrides = options.assumptionOverrides || {};
      this.keyMetrics = options.keyMetrics || {};
      this.description = options.description || '';
      this.createdBy = options.createdBy || '';
    }

    /** Per-metric delta vs a baseline Scenario (or a plain keyMetrics-shaped
     * object, e.g. Deal.keyMetrics). Only compares keys present in both, so
     * differently-shaped scenarios don't produce spurious NaN deltas. */
    deltaVsBaseline(baseline) {
      const baseMetrics = baseline && baseline.keyMetrics ? baseline.keyMetrics : (baseline || {});
      const deltas = {};
      for (const key of Object.keys(this.keyMetrics)) {
        if (typeof this.keyMetrics[key] === 'number' && typeof baseMetrics[key] === 'number') {
          deltas[key] = this.keyMetrics[key] - baseMetrics[key];
        }
      }
      return deltas;
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, dealId: this.dealId, scenarioType: this.scenarioType, isBaseline: this.isBaseline,
        assumptionOverrides: this.assumptionOverrides, keyMetrics: this.keyMetrics, description: this.description, createdBy: this.createdBy
      });
    }

    static fromJSON(data) { return new Scenario(data); }
  }

  return Scenario;
}));
