/**
 * @file Fund.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Root aggregator for the Finance Portal Pro model \u2014 same role
 *              Organization played for HOPE Shelters. A Fund/vehicle/facility
 *              owns collections of Investor, Lender, and Instrument, and
 *              exposes projections (computed, never separately stored) the
 *              same way Organization.payrollProjection()/budgetProjection()
 *              do \u2014 so aggregate numbers can never drift from the records
 *              that produce them.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.Fund = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('Fund requires BaseClassX to be loaded first');

  class Fund extends BaseClassX {
    static version = '1.0.0';
    static domain = 'finance.fund';
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      entityTypeName: { type: 'string', default: 'Fund' },  // 'Fund' | 'SPV' | 'Facility'
      vintageDate: { type: 'string', default: '' },
      fundSize: { type: 'number', default: 0 },
      reportingCurrency: { type: 'string', default: 'USD' },
      investors: { type: 'array', default: [] },
      lenders: { type: 'array', default: [] },
      instruments: { type: 'array', default: [] },
      deals: { type: 'array', default: [] }
    }};

    constructor(options = {}) {
      super({ type: 'finance.fund', name: options.name || 'Fund', schema: { name: 'string', entityTypeName: 'string', vintageDate: 'string', fundSize: 'number', reportingCurrency: 'string' } });
      this.entityTypeName = options.entityTypeName || 'Fund';
      this.vintageDate = options.vintageDate || '';
      this.fundSize = options.fundSize || 0;
      this.reportingCurrency = options.reportingCurrency || 'USD';
      this.investors = [];
      this.lenders = [];
      this.instruments = [];
      this.deals = [];
    }

    addInvestor(i) { i.fundId = this.id; this.investors = [...this.investors, i]; return i; }
    addLender(l) { this.lenders = [...this.lenders, l]; return l; }
    addInstrument(i) { i.fundId = this.id; this.instruments = [...this.instruments, i]; return i; }
    addDeal(d) { d.fundId = this.id; this.deals = [...this.deals, d]; return d; }

    // ─── GENERIC CRUD (same collection-name-generic shape as Organization) ──
    getCollection(name) { return this[name] || []; }
    addToCollection(name, item) { this[name] = [...(this[name] || []), item]; return item; }
    removeFromCollection(name, id) { this[name] = (this[name] || []).filter(x => x.id !== id); }
    updateInCollection(name, id, patch) {
      const item = (this[name] || []).find(x => x.id === id);
      if (!item) return null;
      Object.keys(patch).forEach(k => { item[k] = patch[k]; });
      return item;
    }

    // ─── PROJECTIONS ──────────────────────────────────────────────
    investorProjection() {
      const investors = this.investors;
      const totalCommitment = investors.reduce((s, i) => s + (i.commitment || 0), 0);
      const totalContribution = investors.reduce((s, i) => s + (i.contribution || 0), 0);
      const totalDistribution = investors.reduce((s, i) => s + (i.distribution || 0), 0);
      return { investors, totalCommitment, totalContribution, totalDistribution, netContributed: totalContribution - totalDistribution };
    }
    lenderProjection() {
      const lenders = this.lenders;
      const totalFacility = lenders.reduce((s, l) => s + (l.facilityAmount || 0), 0);
      const totalOutstanding = lenders.reduce((s, l) => s + (l.outstandingBalance || 0), 0);
      return { lenders, totalFacility, totalOutstanding, totalAvailable: totalFacility - totalOutstanding };
    }
    capitalStackProjection() {
      const inv = this.investorProjection(), len = this.lenderProjection();
      return { totalEquity: inv.totalCommitment, totalDebt: len.totalFacility, totalCapital: inv.totalCommitment + len.totalFacility,
        debtToCapitalPercent: (inv.totalCommitment + len.totalFacility) ? (len.totalFacility / (inv.totalCommitment + len.totalFacility) * 100) : 0 };
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, entityTypeName: this.entityTypeName, vintageDate: this.vintageDate, fundSize: this.fundSize,
        reportingCurrency: this.reportingCurrency,
        investors: this.investors.map(i => i.toJSON ? i.toJSON() : i),
        lenders: this.lenders.map(l => l.toJSON ? l.toJSON() : l),
        instruments: this.instruments.map(i => i.toJSON ? i.toJSON() : i),
        deals: this.deals.map(d => d.toJSON ? d.toJSON() : d)
      });
    }

    static fromJSON(data, Investor, Lender, Instrument, Deal) {
      const f = new Fund(data);
      (data.investors || []).forEach(i => f.addInvestor(Investor.fromJSON(i)));
      (data.lenders || []).forEach(l => f.addLender(Lender.fromJSON(l)));
      (data.instruments || []).forEach(i => f.addInstrument(Instrument.fromJSON(i)));
      (data.deals || []).forEach(d => f.addDeal(Deal ? Deal.fromJSON(d) : d));
      return f;
    }
  }

  return Fund;
}));
