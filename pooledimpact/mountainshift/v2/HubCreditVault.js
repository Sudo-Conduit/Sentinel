/**
 * @file HubCreditVault.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The missing yield-accrual mechanic behind the Hedge Fund Yield Test (real
 *              14-22% secured yield). A deposit is real principal moved into a TreasuryLedger
 *              (via seedMock/fund, same real path every other capital inflow uses), and yield
 *              accrues on real elapsed time against that real principal \u2014 never an instant
 *              flat payout. "Secured" means the yield is capped by and paid out of the real
 *              treasury balance backing it; a claim can never exceed what the vault has.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.HubCreditVault = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('HubCreditVault requires BaseClassX to be loaded first');

  class HubCreditVault extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        annualYieldPct: { type: 'number', default: 0.18 }, // real 14-22% band, default 18%
        deposits: { type: 'array', default: () => [] }, // { depositorId, principal, depositedAt }
        yieldClaims: { type: 'array', default: () => [] } // { depositorId, amount, at }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.hub_credit_vault', name: 'HubCreditVault', ...options });
      this.annualYieldPct = options.annualYieldPct != null ? options.annualYieldPct : 0.18;
      if (this.annualYieldPct < 0.14 || this.annualYieldPct > 0.22) {
        throw new Error('annualYieldPct must stay within the real 14-22% secured-yield band');
      }
      this.deposits = options.deposits || [];
      this.yieldClaims = options.yieldClaims || [];
    }

    // Real deposit: moves usdcAmount into the given TreasuryLedger via its own real fund()
    // path (source='hub_vault_deposit'), same audit trail every other capital inflow gets.
    deposit(depositorId, amount, treasury) {
      if (amount <= 0) throw new Error('deposit amount must be positive');
      treasury.fund(amount, 'hub_vault_deposit', { depositorId });
      const existing = this.deposits.find(d => d.depositorId === depositorId);
      if (existing) existing.principal += amount;
      else this.deposits = [...this.deposits, { depositorId, principal: amount, depositedAt: Date.now() }];
      return { ok: true, principal: this.deposits.find(d => d.depositorId === depositorId).principal };
    }

    // Real time-based accrual on real principal \u2014 identical shape to RealEstateBridge's
    // dividend accrual, applied here to the yield leg instead of the REIT-token leg.
    accruedYield(depositorId, nowMs) {
      const d = this.deposits.find(x => x.depositorId === depositorId);
      if (!d) return 0;
      const yearMs = 365 * 24 * 60 * 60 * 1000;
      const elapsedMs = (nowMs || Date.now()) - d.depositedAt;
      return d.principal * this.annualYieldPct * (elapsedMs / yearMs);
    }

    // "Secured" enforced here: a claim is capped by the real treasury balance actually backing
    // it \u2014 disburse() is the same gate every other CVC payout goes through, so a claim can
    // never manufacture value the treasury doesn't have.
    claimYield(depositorId, treasury, nowMs) {
      const amount = this.accruedYield(depositorId, nowMs);
      if (amount <= 0) return { ok: false, error: 'no accrued yield to claim' };
      const rc = treasury.disburse(amount, 'hub_vault_yield', { depositorId });
      if (!rc.ok) return rc;
      const d = this.deposits.find(x => x.depositorId === depositorId);
      d.depositedAt = nowMs || Date.now(); // reset accrual clock on claim, same convention as RealEstateBridge
      this.yieldClaims = [...this.yieldClaims, { depositorId, amount, at: nowMs || Date.now() }];
      return { ok: true, amount };
    }

    totalPrincipal() { return this.deposits.reduce((sum, d) => sum + d.principal, 0); }

    computeContentHash() {
      return this.hashString(`${this.annualYieldPct}|${this.deposits.length}|${this.yieldClaims.length}`);
    }
  }

  return HubCreditVault;
}));
