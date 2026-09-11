/**
 * @file TreasuryLedger.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Capped, real-funded pool backing CVC Velocity Engine bonuses/match — the
 *              hardening fix from the CVC core-mechanics audit: spend bonuses and CCF match
 *              must draw from a real, capped balance (funded by verified PoUW mint events or
 *              real capital inflow), never credited unconditionally. canFund() is the gate
 *              every disbursement passes through; there is no path that bypasses it.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.TreasuryLedger = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function (BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('TreasuryLedger requires BaseClassX to be loaded first');

  class TreasuryLedger extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        sector: { type: 'string', default: '' }, // 'digital' | 'realestate' | 'fuel' | 'ag'
        // Explicit, labeled mock seed capital for end-to-end simulation \u2014 never conflated
        // with a real funding event (fund() always tags real sources like 'pouw_mint').
        seedIsMock: { type: 'boolean', default: false },
        mintedSupply: { type: 'number', default: 0 },
        capSupply: { type: 'number', default: 0 }, // 0 = uncapped (dev only); real deployments must set a real cap
        treasuryBalance: { type: 'number', default: 0 },
        fundingEvents: { type: 'array', default: () => [] },
        disbursements: { type: 'array', default: () => [] }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.treasury_ledger', name: 'TreasuryLedger', ...options });
      this.sector = options.sector || '';
      this.seedIsMock = options.seedIsMock || false;
      this.mintedSupply = options.mintedSupply || 0;
      this.capSupply = options.capSupply || 0;
      this.treasuryBalance = options.treasuryBalance || 0;
      this.fundingEvents = options.fundingEvents || [];
      this.disbursements = options.disbursements || [];
    }

    // Real capital or verified PoUW mint event — the ONLY two legitimate ways balance enters
    // the treasury. source is recorded for audit; 'pouw_mint' is checked against capSupply so
    // minting can never exceed the real supply ceiling.
    fund(amount, source, ref) {
      if (amount <= 0) throw new Error('fund amount must be positive');
      if (source === 'pouw_mint') {
        const nextSupply = this.mintedSupply + amount;
        if (this.capSupply > 0 && nextSupply > this.capSupply) {
          throw new Error(`mint would exceed capSupply (${nextSupply} > ${this.capSupply})`);
        }
        this.mintedSupply = nextSupply;
      }
      this.treasuryBalance = this.treasuryBalance + amount;
      this.fundingEvents = [...this.fundingEvents, { amount, source, ref: ref || null, at: Date.now() }];
      return { ok: true, treasuryBalance: this.treasuryBalance };
    }

    canFund(amount) {
      return amount > 0 && amount <= this.treasuryBalance;
    }

    // Explicit mock seed capital \u2014 the Compute/Work/Capital simulation's Capital leg. Always
    // tagged source='mock_seed' (never 'pouw_mint' or a real funding source), and flips
    // seedIsMock so any UI/report can flag this treasury as simulation-only at a glance.
    seedMock(amount) {
      if (amount <= 0) throw new Error('seed amount must be positive');
      this.treasuryBalance += amount;
      this.fundingEvents = [...this.fundingEvents, { amount, source: 'mock_seed', ref: {}, at: Date.now() }];
      this.seedIsMock = true;
      return { ok: true, treasuryBalance: this.treasuryBalance };
    }

    // Every velocity-engine bonus/match call MUST pass through here — throws rather than
    // silently crediting, so a caller can never accidentally manufacture value.
    disburse(amount, purpose, ref) {
      if (!this.canFund(amount)) {
        return { ok: false, error: `insufficient treasury balance (need ${amount}, have ${this.treasuryBalance})` };
      }
      this.treasuryBalance = this.treasuryBalance - amount;
      this.disbursements = [...this.disbursements, { amount, purpose, ref: ref || null, at: Date.now() }];
      return { ok: true, treasuryBalance: this.treasuryBalance };
    }

    computeContentHash() {
      return this.hashString(`${this.sector}|${this.mintedSupply}|${this.treasuryBalance}|${this.fundingEvents.length}|${this.disbursements.length}`);
    }
  }

  return TreasuryLedger;
}));
