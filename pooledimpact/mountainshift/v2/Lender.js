/**
 * @file Lender.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Debt-side capital provider \u2014 a scheduled, collateral-ranked
 *              return regardless of upside, ranked ahead of equity/Investor
 *              claims. Generic across contexts: an Asset-Backed Financier
 *              lending against the Node fleet, a bondholder in Jubilee's
 *              church-rescue bond, a bank in an Urban HQ real estate deal.
 *              Mirrors the "Loan & Credit Data" domain in the Finance Portal
 *              Pro schema (Advances/Payment Obligations/Applications),
 *              generalized beyond one loan product.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.Lender = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('Lender requires BaseClassX to be loaded first');

  class Lender extends BaseClassX {
    static version = '1.0.0';
    static domain = 'finance.lender';
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      lenderType: { type: 'string', default: 'bank' },   // 'asset-backed-financier' | 'bank' | 'bondholder'
      instrumentId: { type: 'string', default: '' },     // which Instrument this facility/note attaches to
      facilityAmount: { type: 'number', default: 0 },
      advanceRatePercent: { type: 'number', default: 0 }, // % of collateral value advanced
      outstandingBalance: { type: 'number', default: 0 },
      seniorityRank: { type: 'number', default: 1 },   // 1 = senior/first-out, higher = more subordinated
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      name: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      lenderType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      instrumentId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      facilityAmount: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED'] }),
      advanceRatePercent: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      outstandingBalance: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      seniorityRank: FieldACL.build({ owner: 'rw-', group: 'r--', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'finance.lender', name: 'Lender',
        schema: { name: 'string', lenderType: 'string', instrumentId: 'string', facilityAmount: 'number', advanceRatePercent: 'number', outstandingBalance: 'number', createdBy: 'string' }
      });
      this.name = options.name || '';
      this.lenderType = options.lenderType || 'bank';
      this.instrumentId = options.instrumentId || '';
      this.facilityAmount = options.facilityAmount || 0;
      this.advanceRatePercent = options.advanceRatePercent || 0;
      this.outstandingBalance = options.outstandingBalance || 0;
      this.seniorityRank = options.seniorityRank ?? 1;
      this.createdBy = options.createdBy || '';
    }

    availableToDraw() { return this.facilityAmount - this.outstandingBalance; }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, lenderType: this.lenderType, instrumentId: this.instrumentId,
        facilityAmount: this.facilityAmount, advanceRatePercent: this.advanceRatePercent,
        outstandingBalance: this.outstandingBalance, seniorityRank: this.seniorityRank, createdBy: this.createdBy
      });
    }

    static fromJSON(data) { return new Lender(data); }
  }

  return Lender;
}));
