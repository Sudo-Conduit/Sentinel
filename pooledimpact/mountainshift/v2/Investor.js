/**
 * @file Investor.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Equity-side capital provider \u2014 shares in upside/downside via
 *              ownership rather than a scheduled, collateral-ranked return.
 *              Generic across contexts: an LP in a Conduit fund, an insurer
 *              buying a Solar Farm equity stake, a Family Office or Sovereign
 *              Wealth Fund co-investing in a Project \u2014 same shape, different
 *              fundId. Mirrors the "Partner Data" domain in the Finance
 *              Portal Pro schema (commitments/contributions/distributions/
 *              DPI/RVPI/TVPI/MOIC), generalized beyond one fund's LPs.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.Investor = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('Investor requires BaseClassX to be loaded first');

  class Investor extends BaseClassX {
    static version = '1.0.0';
    static domain = 'finance.investor';
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      investorType: { type: 'string', default: 'fund-lp' },  // 'fund-lp' | 'insurer' | 'family-office' | 'sovereign-wealth-fund' | 'individual'
      country: { type: 'string', default: '' },
      fundId: { type: 'string', default: '' },     // which Fund/vehicle this investor sits in
      commitment: { type: 'number', default: 0 },
      contribution: { type: 'number', default: 0 },
      distribution: { type: 'number', default: 0 },
      ownershipPercent: { type: 'number', default: 0 },
      preferredReturnPercent: { type: 'number', default: 0 },   // e.g. 4% preferred return ahead of common equity
      preferredReturnTermYears: { type: 'number', default: 0 },
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      name: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      investorType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      country: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SEARCHABLE'] }),
      fundId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      commitment: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED'] }),
      contribution: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      distribution: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      ownershipPercent: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      preferredReturnPercent: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT'] }),
      preferredReturnTermYears: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'finance.investor', name: 'Investor',
        schema: { name: 'string', investorType: 'string', country: 'string', fundId: 'string', commitment: 'number', contribution: 'number', distribution: 'number', ownershipPercent: 'number', createdBy: 'string' }
      });
      this.name = options.name || '';
      this.investorType = options.investorType || 'fund-lp';
      this.country = options.country || '';
      this.fundId = options.fundId || '';
      this.commitment = options.commitment || 0;
      this.contribution = options.contribution || 0;
      this.distribution = options.distribution || 0;
      this.ownershipPercent = options.ownershipPercent || 0;
      this.preferredReturnPercent = options.preferredReturnPercent || 0;
      this.preferredReturnTermYears = options.preferredReturnTermYears || 0;
      this.createdBy = options.createdBy || '';
    }

    /** Net position: what's actually been called minus what's come back. */
    netContributed() { return this.contribution - this.distribution; }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, investorType: this.investorType, country: this.country, fundId: this.fundId,
        commitment: this.commitment, contribution: this.contribution, distribution: this.distribution,
        ownershipPercent: this.ownershipPercent, preferredReturnPercent: this.preferredReturnPercent, preferredReturnTermYears: this.preferredReturnTermYears, createdBy: this.createdBy
      });
    }

    static fromJSON(data) { return new Investor(data); }
  }

  return Investor;
}));
