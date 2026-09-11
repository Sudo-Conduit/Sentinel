/**
 * @file RevenueAttachment.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description A secondary, monetizable feature attached to a Deal's
 *              physical asset \u2014 generalizes the Node-on-Solar-Farm pattern
 *              (compute Nodes on 20% of panels) to any host asset: solar
 *              panels on a multi-family roof, modular units added to a
 *              real estate deal, etc. Each attachment has its own per-unit
 *              economics and can carry its own perpetual-residual claim,
 *              independent of who owns/sells the host asset \u2014 same
 *              carve-out logic as the Node residual.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.RevenueAttachment = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('RevenueAttachment requires BaseClassX to be loaded first');

  class RevenueAttachment extends BaseClassX {
    static version = '1.0.0';
    static domain = 'finance.revenueAttachment';
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      attachmentType: { type: 'string', default: '' },   // 'solar-rooftop' | 'modular-units' | 'compute-node'
      hostDealId: { type: 'string', default: '' },
      unitCost: { type: 'number', default: 0 },
      unitCount: { type: 'number', default: 0 },
      monthlyRevenuePerUnit: { type: 'number', default: 0 },
      isPerpetualResidual: { type: 'boolean', default: false },  // survives a future sale of the host asset, same as the Node residual
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      name: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      attachmentType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      hostDealId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      unitCost: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      unitCount: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      monthlyRevenuePerUnit: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      isPerpetualResidual: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT'] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'finance.revenueAttachment', name: options.name || 'Revenue Attachment',
        schema: { name: 'string', attachmentType: 'string', hostDealId: 'string', unitCost: 'number', unitCount: 'number', monthlyRevenuePerUnit: 'number', isPerpetualResidual: 'boolean', createdBy: 'string' }
      });
      this.attachmentType = options.attachmentType || '';
      this.hostDealId = options.hostDealId || '';
      this.unitCost = options.unitCost || 0;
      this.unitCount = options.unitCount || 0;
      this.monthlyRevenuePerUnit = options.monthlyRevenuePerUnit || 0;
      this.isPerpetualResidual = !!options.isPerpetualResidual;
      this.createdBy = options.createdBy || '';
    }

    totalCapex() { return this.unitCost * this.unitCount; }
    monthlyRevenue() { return this.monthlyRevenuePerUnit * this.unitCount; }
    annualRevenue() { return this.monthlyRevenue() * 12; }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, attachmentType: this.attachmentType, hostDealId: this.hostDealId, unitCost: this.unitCost,
        unitCount: this.unitCount, monthlyRevenuePerUnit: this.monthlyRevenuePerUnit, isPerpetualResidual: this.isPerpetualResidual,
        createdBy: this.createdBy, totalCapex: this.totalCapex(), annualRevenue: this.annualRevenue()
      });
    }

    static fromJSON(data) { return new RevenueAttachment(data); }
  }

  return RevenueAttachment;
}));
