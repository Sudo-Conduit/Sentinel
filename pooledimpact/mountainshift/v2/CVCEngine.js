/**
 * @file CVCEngine.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Proof-of-Useful-Work reward engine — the CVC Model's compute-anchored value
 *              creation, wired to real BaseClassX (computeContentHash() as the real state
 *              root, real trace/fingerprint/history as the real audit ledger) instead of the
 *              spec's parallel pseudocode smart-contract scheme. Composes TreasuryLedger
 *              (capped, real-funded minting) and TierAllocator (honest tier routing).
 *              One instance per CIFER sector (digital/realestate/fuel/ag), per Will's ordering.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './TreasuryLedger.js', './TierAllocator.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./TreasuryLedger.js'), require('./TierAllocator.js'));
  else root.CVCEngine = factory(root.BaseClassX, root.TreasuryLedger, root.TierAllocator);
}(typeof self !== 'undefined' ? self : this, function (BaseClassX, TreasuryLedger, TierAllocator) {
  'use strict';
  if (!BaseClassX) throw new Error('CVCEngine requires BaseClassX to be loaded first');

  class CVCEngine extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        sector: { type: 'string', default: '' }, // 'digital' | 'realestate' | 'fuel' | 'ag'
        baseRewardRate: { type: 'number', default: 1 }, // CVC per work unit (alpha)
        workLog: { type: 'array', default: () => [] }
      }
    };

    // treasury/allocators are real runtime handles (WeakMap-style convention), not schema
    // fields — they hold references to other BaseClassX instances, not plain data.
    _treasury = null;
    _allocators = new Map(); // actorId -> TierAllocator

    constructor(options = {}) {
      super({ type: 'cvc.engine', name: 'CVCEngine', ...options });
      this.sector = options.sector || '';
      this.baseRewardRate = options.baseRewardRate || 1;
      this.workLog = options.workLog || [];
    }

    attachTreasury(treasury) { this._treasury = treasury; return this; }
    // Feeds a WorkLedger's logged tasks straight into recordWork \u2014 the real Compute\u2192Work\u2192
    // Capital chain: Work (real completed tasks) \u2192 recordWork mints real Compute-tagged
    // ('pouw_mint') rewards into the Capital leg (TreasuryLedger), no synthetic task/reward
    // generator anywhere in the path.
    recordWorkFromLedger(actorId, workLedger) {
      return workLedger.completedTasks.map(t => this.recordWork(actorId, t.units, t.qualityScore, t.complexityMultiplier));
    }
    allocatorFor(actorId) {
      if (!this._allocators.has(actorId)) this._allocators.set(actorId, new TierAllocator({ actorId }));
      return this._allocators.get(actorId);
    }

    // Real work verification is the caller's responsibility (compute-cycle proof, PNode/BNode/
    // CNode attestation, etc.) — this records the verified result and mints a gated reward.
    // R = units * qualityScore(0-1) * complexityMultiplier, per the audited PoUW formula.
    recordWork(actorId, units, qualityScore, complexityMultiplier) {
      if (!this._treasury) throw new Error('recordWork requires attachTreasury() first');
      const reward = units * this.baseRewardRate * Math.max(0, Math.min(1, qualityScore)) * (complexityMultiplier || 1);
      const fundResult = this._treasury.fund(reward, 'pouw_mint', { actorId, units, qualityScore, complexityMultiplier });
      this.workLog = [...this.workLog, { actorId, units, qualityScore, complexityMultiplier, reward, at: Date.now() }];
      return { reward, treasury: fundResult };
    }

    // Routes a reward through the actor's TierAllocator, then disburses the tier1/2/3 (settled,
    // non-custodial) portions out of Treasury for real spend — tier4/5 stay as tracked balances
    // pending real custodian/sponsor wiring, never silently spent.
    allocateAndSettle(actorId, amount, election) {
      const allocator = this.allocatorFor(actorId);
      const record = allocator.allocate(amount, election);
      Object.keys(record.tiers).forEach(key => {
        const tier = record.tiers[key];
        if ((tier.status === 'settled' || tier.status === 'settled_mock') && tier.amount > 0) {
          const rc = this._treasury.disburse(tier.amount, `tier_settle:${key}`, { actorId });
          tier.settled = rc.ok;
        }
      });
      return record;
    }

    computeContentHash() {
      return this.hashString(`${this.sector}|${this.workLog.length}|${this._allocators.size}`);
    }
  }

  return CVCEngine;
}));
