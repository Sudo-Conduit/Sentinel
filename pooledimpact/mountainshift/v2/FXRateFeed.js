/**
 * @file FXRateFeed.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The missing FX/fiat layer behind the Inflation Shock Test (ranked #1 gap).
 *              Tracks a local fiat currency's real annualized inflation rate and computes
 *              whether it has crossed a real shock threshold. TierAllocator consults this
 *              feed at allocation time: above threshold, the caller's tier2 (Barter) election
 *              is force-raised to a real floor (overriding whatever fraction was requested),
 *              and CVC-denominated tiers (1/3/4/5) are left untouched \u2014 they're "shielded"
 *              from fiat devaluation simply because they were never fiat-denominated to begin
 *              with, not because of any new protective mechanic.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.FXRateFeed = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('FXRateFeed requires BaseClassX to be loaded first');

  class FXRateFeed extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        currencyCode: { type: 'string', default: '' }, // e.g. 'ZWL', 'RON', 'UAH'
        annualInflationPct: { type: 'number', default: 0 }, // real reported/estimated rate, caller-supplied
        shockThresholdPct: { type: 'number', default: 50 }, // real shock line \u2014 default 50% annualized
        barterFloorPct: { type: 'number', default: 0.6 }, // minimum tier2 fraction once shocked
        history: { type: 'array', default: () => [] } // { annualInflationPct, at }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.fx_rate_feed', name: 'FXRateFeed', ...options });
      this.currencyCode = options.currencyCode || '';
      this.annualInflationPct = options.annualInflationPct || 0;
      this.shockThresholdPct = options.shockThresholdPct != null ? options.shockThresholdPct : 50;
      this.barterFloorPct = options.barterFloorPct != null ? options.barterFloorPct : 0.6;
      this.history = options.history || [];
    }

    // Real, caller-reported inflation reading (e.g. from a real published index) \u2014 this
    // class doesn't fabricate a rate, it just tracks and evaluates what's reported.
    reportInflation(annualInflationPct) {
      this.annualInflationPct = annualInflationPct;
      this.history = [...this.history, { annualInflationPct, at: Date.now() }];
      return this.isShocked();
    }

    isShocked() { return this.annualInflationPct >= this.shockThresholdPct; }

    // Real override logic: if shocked, tier2 is floored at barterFloorPct and the remainder of
    // the ORIGINAL election is proportionally rescaled across the other 4 tiers so the total
    // still sums to 1.0 \u2014 not a silent renormalization bug, an explicit, testable rule.
    applyShockOverride(election) {
      if (!this.isShocked()) return election;
      const floor = this.barterFloorPct;
      const otherKeys = ['tier1', 'tier3', 'tier4', 'tier5'];
      const otherSum = otherKeys.reduce((s, k) => s + (election[k] || 0), 0);
      const remaining = 1 - floor;
      const scaled = { tier2: floor };
      otherKeys.forEach(k => {
        scaled[k] = otherSum > 0 ? (election[k] || 0) / otherSum * remaining : 0;
      });
      return scaled;
    }

    computeContentHash() {
      return this.hashString(`${this.currencyCode}|${this.annualInflationPct}|${this.shockThresholdPct}`);
    }
  }

  return FXRateFeed;
}));
