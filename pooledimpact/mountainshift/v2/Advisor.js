/**
 * @file Advisor.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description A service-fee-earning party attached to a Deal \u2014 capital is
 *              neither contributed (Investor) nor lent (Lender); Advisor
 *              earns a fee (typically % of deal size) for setting the deal
 *              up: modeling it, introducing banks/architects, placement,
 *              etc. Generic across contexts \u2014 Jubilee's Consulting arm on a
 *              real estate deal is the concrete first case (3% for deal
 *              setup, financial modeling, bank + architect introductions).
 *              feeStructureType generalizes beyond flat-percent-of-basis:
 *              'flat_amount' for a one-off fixed fee (e.g. ONOMO Bulawayo's
 *              TSA/POTSA), 'tiered' for a step schedule against a supplied
 *              metric (e.g. Aleph's incentive fee, tiered on AGOP margin),
 *              'formula' as a documented-but-not-yet-computable placeholder
 *              when the basis isn't a simple percent or tier (kept honest
 *              rather than faked as a flat percent).
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.Advisor = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('Advisor requires BaseClassX to be loaded first');

  class Advisor extends BaseClassX {
    static version = '1.0.0';
    static domain = 'finance.advisor';
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      feeType: { type: 'string', default: 'consulting' },   // 'consulting' | 'placement' | 'legal' | 'brand' | 'marketing' | 'loyalty' | 'reservation' | 'management' | 'incentive-management' | 'technical-services'
      feeStructureType: { type: 'string', default: 'flat_percent' },  // 'flat_percent' | 'flat_amount' | 'tiered' | 'formula'
      feePercent: { type: 'number', default: 0 },           // used when feeStructureType = 'flat_percent'
      dealSizeBasis: { type: 'number', default: 0 },        // the deal-size/revenue figure feePercent is computed against
      flatAmount: { type: 'number', default: 0 },           // used when feeStructureType = 'flat_amount' — a fixed one-off fee (e.g. TSA, POTSA)
      currency: { type: 'string', default: 'USD' },
      tiers: { type: 'array', default: [] },                // used when feeStructureType = 'tiered' — [{ thresholdLow, thresholdHigh, percent }]
      tierBasisDescription: { type: 'string', default: '' },  // e.g. 'AGOP margin %'
      formulaDescription: { type: 'string', default: '' },    // used when feeStructureType = 'formula'
      servicesProvided: { type: 'array', default: [] },     // e.g. ['deal-setup','financial-modeling','bank-introduction','architect-introduction']
      role: { type: 'string', default: 'consultant' },        // 'consultant' | 'sponsor' | 'developer' | 'guarantor' | 'trustee' | 'placement-agent' | 'issuer' | 'brand-licensor' | 'operator'
      activePhases: { type: 'array', default: [] },           // subset of ['ACQ','PRE','CON','OPS']
      dealId: { type: 'string', default: '' },
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      name: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      feeType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      feeStructureType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      feePercent: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT'] }),
      dealSizeBasis: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      flatAmount: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['VISIBLE_COMPACT'] }),
      currency: FieldACL.build({ owner: 'rw-', group: 'r--', other: 'r--', flags: [] }),
      tiers: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: [] }),
      tierBasisDescription: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: [] }),
      formulaDescription: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: [] }),
      servicesProvided: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      role: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      activePhases: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      dealId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'finance.advisor', name: options.name || 'Advisor',
        schema: { name: 'string', feeType: 'string', feePercent: 'number', dealSizeBasis: 'number', servicesProvided: 'array', dealId: 'string', createdBy: 'string' }
      });
      this.feeType = options.feeType || 'consulting';
      this.feeStructureType = options.feeStructureType || 'flat_percent';
      this.feePercent = options.feePercent || 0;
      this.dealSizeBasis = options.dealSizeBasis || 0;
      this.flatAmount = options.flatAmount || 0;
      this.currency = options.currency || 'USD';
      this.tiers = options.tiers || [];
      this.tierBasisDescription = options.tierBasisDescription || '';
      this.formulaDescription = options.formulaDescription || '';
      this.servicesProvided = options.servicesProvided || [];
      this.role = options.role || 'consultant';
      this.activePhases = options.activePhases || [];
      this.dealId = options.dealId || '';
      this.createdBy = options.createdBy || '';
    }

    /** Generalized fee computation across all four structure types.
     * `tieredMetricValue` is required only for feeStructureType='tiered'
     * (e.g. the AGOP margin % to match against `tiers`). Returns null for
     * 'formula' — deliberately not faked as a flat percent, since the real
     * basis isn't computable yet without a formula engine. */
    feeAmount(tieredMetricValue) {
      switch (this.feeStructureType) {
        case 'flat_amount': return this.flatAmount;
        case 'tiered': {
          if (tieredMetricValue === undefined || !this.tiers.length) return null;
          const tier = this.tiers.find(t => tieredMetricValue >= t.thresholdLow && (t.thresholdHigh === undefined || tieredMetricValue < t.thresholdHigh));
          return tier ? this.dealSizeBasis * (tier.percent / 100) : null;
        }
        case 'formula': return null;
        case 'flat_percent':
        default: return this.dealSizeBasis * (this.feePercent / 100);
      }
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, feeType: this.feeType, feeStructureType: this.feeStructureType, feePercent: this.feePercent, dealSizeBasis: this.dealSizeBasis,
        flatAmount: this.flatAmount, currency: this.currency, tiers: this.tiers, tierBasisDescription: this.tierBasisDescription, formulaDescription: this.formulaDescription,
        servicesProvided: this.servicesProvided, role: this.role, activePhases: this.activePhases, dealId: this.dealId, createdBy: this.createdBy, feeAmount: this.feeAmount()
      });
    }

    static fromJSON(data) { return new Advisor(data); }
  }

  return Advisor;
}));
