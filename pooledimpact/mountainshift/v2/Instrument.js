/**
 * @file Instrument.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The thing being financed or held \u2014 an equity stake (Solar
 *              Farm), an asset-backed facility (Node fleet), a bond (Jubilee
 *              church-rescue note). Lenders attach to an Instrument by
 *              instrumentId; an Instrument optionally belongs to a Fund
 *              (fundId) that holds/issued it. Kept deliberately generic \u2014
 *              instrumentType + collateralDescription carry the specifics
 *              rather than a subclass per deal type, since we're still
 *              validating whether this shape holds across real deals.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.Instrument = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('Instrument requires BaseClassX to be loaded first');

  class Instrument extends BaseClassX {
    static version = '1.0.0';
    static domain = 'finance.instrument';
    // Preference rank, lower = more preferred. We don't invest in equity
    // first \u2014 Royalty and Revenue-based structures are sought before Debt,
    // and Equity is the last resort. Instruments are combinatory: a Deal's
    // capital stack can mix several of these rather than picking just one.
    static TYPE_PREFERENCE_ORDER = ['royalty', 'revenue_based', 'asset_backed_facility', 'bond', 'equity_stake'];
    static preferenceRank(instrumentType) {
      const idx = Instrument.TYPE_PREFERENCE_ORDER.indexOf(instrumentType);
      return idx === -1 ? Instrument.TYPE_PREFERENCE_ORDER.length : idx;
    }
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      // Capital-stack preference order, most to least preferred: Royalty >
      // Revenue-based > Debt > Equity \u2014 equity is the last resort, not the
      // default. Combinatory: a single Deal can carry several Instrument rows
      // of different types stacked together (e.g. a royalty carve-out alongside
      // a revenue-based note), rather than picking exactly one.
      instrumentType: { type: 'string', default: 'royalty' },  // 'royalty' | 'revenue_based' | 'asset_backed_facility' | 'bond' | 'equity_stake'
      fundId: { type: 'string', default: '' },
      collateralDescription: { type: 'string', default: '' },
      faceValue: { type: 'number', default: 0 },
      currency: { type: 'string', default: 'USD' },
      originationDate: { type: 'string', default: '' },
      maturityDate: { type: 'string', default: '' },     // blank + isPerpetual=true for a perpetual residual (e.g. the Node residual)
      isPerpetual: { type: 'boolean', default: false },
      status: { type: 'string', default: 'active' },     // 'active' | 'refinanced' | 'sold' | 'retired'
      dealId: { type: 'string', default: '' },
      trancheClass: { type: 'string', default: '' },       // 'X' | 'A' | 'B' | 'C' — multi-class/tranche bond programs (e.g. a Trust Indenture with Class Limits per tranche)
      classLimitUSD: { type: 'number', default: 0 },       // max aggregate principal for this Instrument's tranche class
      guarantorInvestorId: { type: 'string', default: '' },   // the Insured party wrapping this Bond — must NOT be an Investor in the same vintage Fund (round-robin rule)
      guarantorName: { type: 'string', default: '' },
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      name: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      instrumentType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      fundId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      collateralDescription: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      faceValue: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED'] }),
      currency: FieldACL.build({ owner: 'rw-', group: 'r--', other: 'r--', flags: [] }),
      originationDate: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      maturityDate: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      isPerpetual: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT'] }),
      status: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      dealId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      trancheClass: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      classLimitUSD: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT'] }),
      guarantorInvestorId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      guarantorName: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'finance.instrument', name: 'Instrument',
        schema: { name: 'string', instrumentType: 'string', fundId: 'string', collateralDescription: 'string', faceValue: 'number', currency: 'string', originationDate: 'string', maturityDate: 'string', isPerpetual: 'boolean', status: 'string', dealId: 'string', guarantorInvestorId: 'string', guarantorName: 'string', createdBy: 'string' }
      });
      this.name = options.name || '';
      this.instrumentType = options.instrumentType || 'royalty';
      this.fundId = options.fundId || '';
      this.collateralDescription = options.collateralDescription || '';
      this.faceValue = options.faceValue || 0;
      this.currency = options.currency || 'USD';
      this.originationDate = options.originationDate || '';
      this.maturityDate = options.maturityDate || '';
      this.isPerpetual = !!options.isPerpetual;
      this.status = options.status || 'active';
      this.dealId = options.dealId || '';
      this.trancheClass = options.trancheClass || '';
      this.classLimitUSD = options.classLimitUSD || 0;
      this.guarantorInvestorId = options.guarantorInvestorId || '';
      this.guarantorName = options.guarantorName || '';
      this.createdBy = options.createdBy || '';
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, instrumentType: this.instrumentType, fundId: this.fundId,
        collateralDescription: this.collateralDescription, faceValue: this.faceValue, currency: this.currency,
        originationDate: this.originationDate, maturityDate: this.maturityDate, isPerpetual: this.isPerpetual,
        status: this.status, dealId: this.dealId, trancheClass: this.trancheClass, classLimitUSD: this.classLimitUSD, guarantorInvestorId: this.guarantorInvestorId, guarantorName: this.guarantorName, createdBy: this.createdBy
      });
    }

    /** Mechanical check for a Trust Indenture-style "Combined Class Limit" —
     * e.g. Combined Class Limit X/A caps the aggregate principal of Series X +
     * Series A tranches together, separate from each tranche's own individual
     * Class Limit. Purely computed from the Instruments passed in — never a
     * separately stored number that could drift as tranches are issued. */
    static combinedClassLimitCheck(instruments, classes, maxUSD) {
      const totalUSD = instruments.filter(i => classes.includes(i.trancheClass)).reduce((s, i) => s + (i.faceValue || 0), 0);
      return { classes, totalUSD, maxUSD, ok: totalUSD <= maxUSD, headroomUSD: maxUSD - totalUSD };
    }

    /** Round-robin rule: whoever insures/wraps this Bond must NOT already be an
     * Investor in the same vintage Fund the underlying Deal sits in — an
     * insurer can't wrap risk it's also directly exposed to as equity in the
     * same vintage. Returns { ok, reason }. */
    static validateGuarantorIndependence(guarantorInvestor, sameVintageFund) {
      const alreadyInvested = sameVintageFund.investors.some(i => i.name === guarantorInvestor.name);
      if (alreadyInvested) return { ok: false, reason: `${guarantorInvestor.name} already holds an Investor position in ${sameVintageFund.name} — cannot also guarantor-wrap a Bond in this vintage.` };
      return { ok: true, reason: '' };
    }

    static fromJSON(data) { return new Instrument(data); }
  }

  return Instrument;
}));
