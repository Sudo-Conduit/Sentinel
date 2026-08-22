/**
 * @file CVCTestMatrix.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Real assertion-based tests against the classes that actually exist
 *              (TreasuryLedger, TierAllocator, CVCEngine, WorkLedger, ComputeSourceProfile,
 *              ParticipantRegistry, FunderRegistry, BondOfftakeRegistry). Each test either runs
 *              for real or is explicitly marked NOT_IMPLEMENTED with the missing mechanic named
 *              \u2014 never a fabricated pass. Several requested suite items (72-hour hold,
 *              demurrage/velocity decay, cashback/CCF match, inflation-shock routing, network
 *              partition/chain replay, Hub Credit Vault yield, BRKXI/REIT-pegged coin,
 *              tamper-proof hash chain, signature verification) have NO backing mechanic yet in
 *              TierAllocator/CVCEngine/TreasuryLedger \u2014 they're listed as gaps, not stubbed
 *              green checkmarks.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./TreasuryLedger.js', './TierAllocator.js', './CVCEngine.js', './WorkLedger.js', './ComputeSourceProfile.js', './ParticipantRegistry.js', './FunderRegistry.js', './BondOfftakeRegistry.js', './FXRateFeed.js', './RealEstatePortfolio.js', './RealEstateBridge.js', './LedgerChain.js', './SignatureVerifier.js', './Ed25519_001.js', './HubCreditVault.js'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./TreasuryLedger.js'), require('./TierAllocator.js'), require('./CVCEngine.js'), require('./WorkLedger.js'), require('./ComputeSourceProfile.js'), require('./ParticipantRegistry.js'), require('./FunderRegistry.js'), require('./BondOfftakeRegistry.js'), require('./FXRateFeed.js'), require('./RealEstatePortfolio.js'), require('./RealEstateBridge.js'), require('./LedgerChain.js'), require('./SignatureVerifier.js'), require('./Ed25519_001.js'), require('./HubCreditVault.js'));
  } else {
    root.CVCTestMatrix = factory(root.TreasuryLedger, root.TierAllocator, root.CVCEngine, root.WorkLedger, root.ComputeSourceProfile, root.ParticipantRegistry, root.FunderRegistry, root.BondOfftakeRegistry, root.FXRateFeed, root.RealEstatePortfolio, root.RealEstateBridge, root.LedgerChain, root.SignatureVerifier, root.Ed25519_001, root.HubCreditVault);
  }
}(typeof self !== 'undefined' ? self : this, function(TreasuryLedger, TierAllocator, CVCEngine, WorkLedger, ComputeSourceProfile, ParticipantRegistry, FunderRegistry, BondOfftakeRegistry, FXRateFeed, RealEstatePortfolio, RealEstateBridge, LedgerChain, SignatureVerifier, Ed25519_001, HubCreditVault) {
  'use strict';

  function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }
  function approxEqual(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

  const results = [];
  function run(suite, name, fn) {
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        return result.then(() => results.push({ suite, name, status: 'pass' })).catch(e => results.push({ suite, name, status: 'fail', error: e.message }));
      }
      results.push({ suite, name, status: 'pass' });
      return Promise.resolve();
    }
    catch (e) { results.push({ suite, name, status: 'fail', error: e.message }); return Promise.resolve(); }
  }
  function notImplemented(suite, name, missingMechanic) {
    results.push({ suite, name, status: 'not_implemented', missingMechanic });
  }

  async function runAll() {
    results.length = 0;

    // ─── A. Core Economic Tests ───────────────────────────────────────────
    run('A', '5-Tier Allocation Test', () => {
      const treasury = new TreasuryLedger({ sector: 'digital' });
      treasury.seedMock(1000);
      const engine = new CVCEngine({ sector: 'digital' }).attachTreasury(treasury);
      const allocator = engine.allocatorFor('actor1');
      allocator.mockCustodian = true; allocator.mockDafSponsor = true;
      const record = allocator.allocate(1000, { tier1: 0.30, tier2: 0.20, tier3: 0.10, tier4: 0.25, tier5: 0.15 });
      assert(approxEqual(record.tiers.tier1.amount, 300), 'tier1 should be 300');
      assert(approxEqual(record.tiers.tier2.amount, 200), 'tier2 should be 200');
      assert(approxEqual(record.tiers.tier3.amount, 100), 'tier3 should be 100');
      assert(approxEqual(record.tiers.tier4.amount, 250), 'tier4 should be 250');
      assert(approxEqual(record.tiers.tier5.amount, 150), 'tier5 should be 150');
      const total = Object.values(record.tiers).reduce((s, t) => s + t.amount, 0);
      assert(approxEqual(total, 1000), 'tier amounts must sum to the original amount with no rounding loss, got ' + total);
    });

    run('A', 'Inflation Shock Test (real: rank #1 gap, now closed)', () => {
      const fx = new FXRateFeed({ currencyCode: 'ZWL', shockThresholdPct: 50 });
      fx.reportInflation(200);
      const treasury = new TreasuryLedger({ sector: 'digital' });
      treasury.seedMock(1000);
      const engine = new CVCEngine({ sector: 'digital' }).attachTreasury(treasury);
      const allocator = engine.allocatorFor('actorZWL');
      const record = allocator.allocate(1000, { tier1: 0.5, tier2: 0.1, tier3: 0.2, tier4: 0.1, tier5: 0.1 }, fx);
      assert(record.fxShockApplied === true, 'a real >=50% inflation reading must trigger the shock override');
      assert(approxEqual(record.tiers.tier2.amount, 600), 'Tier2 (Barter) must become the primary engine (floored at 60%) under real shock');
      assert(approxEqual(record.tiers.tier1.amount + record.tiers.tier3.amount + record.tiers.tier4.amount + record.tiers.tier5.amount, 400), 'the other 4 tiers (CVC-denominated, shielded from fiat devaluation by not being fiat in the first place) must absorb exactly the remaining 40%');
    });

    notImplemented('A', '72-Hour Hold Test', 'TierAllocator has no holdUntil/eligibility-window field or loan-access gate on tier4 \u2014 status is only settled/settled_mock/pending_custodian, no time-lock exists');
    notImplemented('A', 'Velocity Engine Test (demurrage + cashback + CCF match)', 'TreasuryLedger/TierAllocator have no decay-over-time mechanic, no cashback %, no CCF match logic \u2014 none of these three mechanics exist yet');

    // ─── B. Stress & Edge-Case Scenarios ──────────────────────────────────
    run('B', 'Zero-Balance Scenario', () => {
      const treasury = new TreasuryLedger({ sector: 'digital' }); // never seeded \u2014 real zero balance
      const engine = new CVCEngine({ sector: 'digital' }).attachTreasury(treasury);
      const allocator = engine.allocatorFor('actor2');
      const record = allocator.allocate(0, { tier1: 1, tier2: 0, tier3: 0, tier4: 0, tier5: 0 });
      assert(record.tiers.tier1.amount === 0, 'zero amount should allocate to zero, not throw');
      const settleResult = engine.allocateAndSettle('actor2', 0, { tier1: 1, tier2: 0, tier3: 0, tier4: 0, tier5: 0 });
      assert(settleResult !== undefined, 'allocateAndSettle on a zero-amount record must not crash');
    });
    run('B', 'Insolvency Test (treasury cannot go negative)', () => {
      const treasury = new TreasuryLedger({ sector: 'digital' });
      treasury.seedMock(50);
      const canFund200 = treasury.canFund(200);
      assert(canFund200 === false, 'canFund must correctly reject an amount exceeding balance');
      const disburseResult = treasury.disburse(200, 'test_overdraw', {});
      assert(disburseResult.ok === false, 'disburse must refuse an overdraw, not silently go negative');
      assert(treasury.treasuryBalance === 50, 'balance must remain unchanged after a refused disbursement');
    });
    notImplemented('B', 'Inflation Shock Test (see Suite A \u2014 real mechanic now lives there via FXRateFeed)', 'moved to Suite A as a real runnable test; kept here only as a pointer so this suite\u2019s slot isn\u2019t silently dropped');
    notImplemented('B', 'Network Partition Test', 'No chain/consensus layer exists yet \u2014 CVCEngine/TreasuryLedger are in-memory BaseClassX instances with no node-to-node sync or offline-then-reconnect settlement logic');

    // ─── C. Institutional & Bridge Tests ──────────────────────────────────
    run('C', 'External Funder Seeding (proxy for Hedge Fund Yield Test\u2019s deposit leg)', () => {
      const registry = new FunderRegistry();
      FunderRegistry.seedDefaults(registry);
      const treasury = new TreasuryLedger({ sector: 'realestate' });
      const jason = registry.funders.find(f => f.name.includes('Jason'));
      const result = registry.seedFromFunder(jason.id, treasury, 100000000);
      assert(result.ok === true, 'seedFromFunder must succeed for a real registered funder');
      assert(treasury.treasuryBalance === 100000000, 'treasury balance must reflect the seeded amount exactly');
      assert(treasury.fundingEvents[treasury.fundingEvents.length - 1].ref.funderName.includes('Jason'), 'funding event must be attributed to the real funder for audit');
    });
    run('C', 'REIT/Bridge Test (real: rank #2 gap, now closed \u2014 Isle of Man/Dubai structuring path)', () => {
      const portfolio = new RealEstatePortfolio();
      RealEstatePortfolio.seedDefaults(portfolio);
      portfolio.properties = portfolio.properties.map(p => p.name.includes('ONOMO') ? { ...p, acquisitionCostUsd: 50000000 } : p);
      const bridge = new RealEstateBridge({ annualDividendYieldPct: 0.06 });
      const result = bridge.depositUsdc('investor1', 10000000, portfolio);
      assert(result.ok === true, 'a deposit within the real portfolio backing must succeed');
      assert(bridge.totalMinted() === 10000000, 'minted REIT tokens must equal the real USDC deposited (1:1 peg)');
      let threw = false;
      try { bridge.depositUsdc('investor2', 999999999, portfolio); } catch (e) { threw = true; }
      assert(threw, 'a deposit exceeding real portfolio backing must be refused, not silently over-minted');
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      bridge.holderBalances.find(h => h.holderId === 'investor1').mintedAt = oneYearAgo;
      const dividend = bridge.accruedDividend('investor1');
      assert(approxEqual(dividend, 600000, 1000), 'one real year of holding at 6% must accrue ~$600,000 dividend on a $10M position');
    });
    run('C', 'Hedge Fund Yield Test (real: rank #5 remaining gap, now closed \u2014 Hub Credit Vault)', () => {
      const treasury = new TreasuryLedger({ sector: 'digital' });
      treasury.seedMock(200000000); // real treasury capacity to back the secured yield payout
      const vault = new HubCreditVault({ annualYieldPct: 0.18 });
      const depositResult = vault.deposit('fundA', 100000000, treasury);
      assert(depositResult.ok === true, 'a real $100M deposit must succeed via the real TreasuryLedger.fund() path');
      assert(treasury.treasuryBalance === 300000000, 'treasury balance must reflect the real deposited principal added to the existing seed');
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      vault.deposits[0].depositedAt = oneYearAgo;
      const yieldOwed = vault.accruedYield('fundA');
      assert(approxEqual(yieldOwed, 18000000, 1000), 'one real year at 18% on $100M principal must accrue ~$18,000,000');
      const claim = vault.claimYield('fundA', treasury);
      assert(claim.ok === true, 'a claim within real treasury capacity must succeed');
      assert(approxEqual(treasury.treasuryBalance, 300000000 - 18000000, 1000), 'the real treasury balance must decrease by exactly the claimed secured yield');
      let threw = false;
      try { new HubCreditVault({ annualYieldPct: 0.30 }); } catch (e) { threw = true; }
      assert(threw, 'a yield rate outside the real 14-22% secured band must be rejected at construction');
    });
    run('C', 'Non-Profit Valve Test (participant registration + split, real mechanic only)', () => {
      const registry = new ParticipantRegistry();
      const ecdc = registry.addParticipant('ECDC / Hope Shelters', 'ngo_partner', 'ECDC', 'tier1');
      assert(ecdc.roleType === 'ngo_partner', 'NGO/Church partner must register with the real ngo_partner role');
      assert(approxEqual(ecdc.rewardsPct, 0.7) && approxEqual(ecdc.cashPct, 0.3), 'ngo_partner default split must be rewards-primary (0.7/0.3)');
      const split = registry.splitReward(ecdc.id, 1000);
      assert(approxEqual(split.rewardsAmount, 700) && approxEqual(split.cashAmount, 300), 'splitReward must apply the real percentages with no rounding loss');
    });
    notImplemented('C', 'Non-Profit Valve Test \u2014 0% tax / 0.5% fee BRKXI\u2192Fiat conversion', 'No BRKXI token, fiat-conversion function, or fee-routing-to-Treasury mechanic exists \u2014 ParticipantRegistry only models compensation split, not token conversion');
    run('C', 'Bond Issuance Test (proxy for REIT/Bridge Test\u2019s underlying asset leg)', () => {
      const registry = new BondOfftakeRegistry();
      const { zurich } = BondOfftakeRegistry.seedDefaults(registry);
      const bond = registry.issueBond(zurich.id, 'onomo-bulawayo', 10000000, 'AA', 6.5);
      assert(bond.rating === 'AA', 'bond rating must be recorded as issued');
      assert(registry.bondsForAsset('onomo-bulawayo').length === 1, 'bond must be retrievable by its real asset reference');
      let threw = false;
      try { registry.issueBond(zurich.id, 'onomo-bulawayo', 1000000, 'ZZZ', 5); } catch (e) { threw = true; }
      assert(threw, 'issueBond must reject an invalid rating rather than silently accept it');
    });
    notImplemented('C', 'REIT/Bridge Test (see Suite C above \u2014 real mechanic now lives there via RealEstateBridge)', 'moved up in this same Suite C as a real runnable test; kept as a pointer so nothing is silently dropped');

    // ─── D. Security & Immutability Tests ─────────────────────────────────
    run('D', 'Tamper-Proof Test (real: rank #4 remaining gap, now closed \u2014 hash-chained ledger)', () => {
      const chain = new LedgerChain({ chainName: 'treasury-events' });
      chain.append({ event: 'fund', amount: 1000, source: 'pouw_mint' });
      chain.append({ event: 'fund', amount: 500, source: 'mock_seed' });
      chain.append({ event: 'disburse', amount: 300, purpose: 'tier_settle:tier1' });
      const cleanCheck = chain.verifyChain();
      assert(cleanCheck.ok === true, 'an untampered real chain must verify clean');
      const tamperedResult = LedgerChain.simulateTamper(chain, 1, { event: 'fund', amount: 999999999, source: 'mock_seed' });
      assert(tamperedResult.ok === false, 'a directly-mutated past entry must be caught by real hash recomputation, not silently accepted');
      assert(tamperedResult.brokenAtIndex === 1, 'the reported break point must be the exact real index that was tampered with');
    });
    run('D', 'Signature Test (real: rank #3 remaining gap, now closed \u2014 real Ed25519_001 backing)', async () => {
      // Real bug: in this DC runtime (browser, Web Crypto path) _generateKey() returns an
      // unresolved Promise, not a synchronous {publicKey,privateKey} object like the Node path
      // \u2014 the previous version never awaited it, so keyResult.privateKey was undefined and
      // _sign() correctly rejected with "Missing --key". Await the real async path here.
      let keyResult = Ed25519_001._generateKey();
      if (keyResult && typeof keyResult.then === 'function') keyResult = await keyResult;
      if (keyResult.error) throw new Error('key generation failed in this environment: ' + keyResult.error);
      const message = 'transfer:1000:actorA->actorB';
      let signResult = Ed25519_001._sign({ key: keyResult.privateKey, data: message });
      if (signResult && typeof signResult.then === 'function') signResult = await signResult;
      if (signResult.error) throw new Error('signing failed: ' + signResult.error);
      const verifier = new SignatureVerifier();
      const validCheck = await verifier.verifySignedTransaction(message, signResult.signature, keyResult.publicKey);
      assert(validCheck === true, 'a real, correctly-signed message with the matching real public key must verify true');
      const forgedCheck = await verifier.verifySignedTransaction('transfer:9999999:actorA->actorB', signResult.signature, keyResult.publicKey);
      assert(forgedCheck === false, 'a tampered message against the same real signature must be rejected');
      assert(verifier.verificationLog.length === 2, 'both real verification attempts must be logged for audit');
    });

    return results;
  }

  return { runAll };
}));
