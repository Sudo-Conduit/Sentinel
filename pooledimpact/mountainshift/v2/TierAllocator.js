/**
 * @file TierAllocator.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The CVC Model's 5-Tier Distribution System, hardened per the core-mechanics
 *              audit: Tier 4 (IRA) and Tier 5 (DAF) are software routing decisions, NOT real
 *              tax-deferred/tax-deductible status on their own — that status only exists once
 *              real value is routed through an actual IRA custodian or DAF sponsor. This class
 *              tracks whether that backing rail is configured and reports allocations honestly
 *              (pending_custodian) until it is, rather than claiming tax treatment prematurely.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.TierAllocator = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function (BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('TierAllocator requires BaseClassX to be loaded first');

  const TIER_DEFS = [
    { key: 'tier1', name: 'Consumption', taxTreatment: 'none' },
    { key: 'tier2', name: 'Barter', taxTreatment: 'none' },
    { key: 'tier3', name: 'External Bridge', taxTreatment: 'full' },
    { key: 'tier4', name: 'IRA', taxTreatment: 'deferred_pending_custodian' },
    { key: 'tier5', name: 'DAF', taxTreatment: 'deductible_pending_sponsor' }
  ];

  class TierAllocator extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        actorId: { type: 'string', default: '' },
        // Real backing rails — until these are set, tier4/tier5 allocations are recorded as
        // real balances but flagged pending_custodian/pending_sponsor, not claimed as real
        // IRA/DAF tax status. DAF partners are already lined up per Will's own onboarding.
        iraCustodianId: { type: 'string', default: '' },
        dafPartnerId: { type: 'string', default: '' },
        // Explicit, labeled simulation mode — lets tier4/5 settle for end-to-end testing
        // WITHOUT a real custodian/sponsor, but the resulting status is always 'settled_mock',
        // never 'settled', so no test run can be mistaken for a real tax-status claim.
        mockCustodian: { type: 'boolean', default: false },
        mockDafSponsor: { type: 'boolean', default: false },
        allocations: { type: 'array', default: () => [] }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.tier_allocator', name: 'TierAllocator', ...options });
      this.actorId = options.actorId || '';
      this.iraCustodianId = options.iraCustodianId || '';
      this.dafPartnerId = options.dafPartnerId || '';
      this.mockCustodian = options.mockCustodian || false;
      this.mockDafSponsor = options.mockDafSponsor || false;
      this.allocations = options.allocations || [];
    }

    // election: { tier1..tier5 } fractions summing to 1.0. fxFeed is optional \u2014 if supplied
    // and currently shocked (real inflation >= real threshold), the election is overridden per
    // FXRateFeed.applyShockOverride BEFORE tier amounts are computed, so a real inflation shock
    // actually changes routing rather than being purely advisory.
    allocate(amount, election, fxFeed) {
      const effectiveElection = (fxFeed && fxFeed.isShocked()) ? fxFeed.applyShockOverride(election) : election;
      const sum = TIER_DEFS.reduce((s, t) => s + (effectiveElection[t.key] || 0), 0);
      if (Math.abs(sum - 1.0) > 1e-6) throw new Error(`election fractions must sum to 1.0, got ${sum}`);
      const record = { actorId: this.actorId, amount, at: Date.now(), tiers: {}, fxShockApplied: !!(fxFeed && fxFeed.isShocked()) };
      TIER_DEFS.forEach(t => {
        const tierAmount = amount * (effectiveElection[t.key] || 0);
        let status = 'settled';
        if (t.key === 'tier4' && !this.iraCustodianId) status = this.mockCustodian ? 'settled_mock' : 'pending_custodian';
        if (t.key === 'tier5' && !this.dafPartnerId) status = this.mockDafSponsor ? 'settled_mock' : 'pending_sponsor';
        record.tiers[t.key] = { amount: tierAmount, taxTreatment: t.taxTreatment, status };
      });
      this.allocations = [...this.allocations, record];
      return record;
    }

    computeContentHash() {
      return this.hashString(`${this.actorId}|${this.allocations.length}|${this.iraCustodianId}|${this.dafPartnerId}`);
    }
  }

  TierAllocator.TIER_DEFS = TIER_DEFS;
  return TierAllocator;
}));
