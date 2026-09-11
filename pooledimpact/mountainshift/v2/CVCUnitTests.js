/**
 * @file CVCUnitTests.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Per-class unit tests (not end-to-end scenarios \u2014 see CVCTestMatrix.js for
 *              those). Each test exercises one method on one class in isolation.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./TreasuryLedger.js', './TierAllocator.js', './WorkLedger.js', './ComputeSourceProfile.js', './ParticipantRegistry.js', './FunderRegistry.js', './BondOfftakeRegistry.js', './RealEstatePortfolio.js', './FXRateFeed.js'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./TreasuryLedger.js'), require('./TierAllocator.js'), require('./WorkLedger.js'), require('./ComputeSourceProfile.js'), require('./ParticipantRegistry.js'), require('./FunderRegistry.js'), require('./BondOfftakeRegistry.js'), require('./RealEstatePortfolio.js'), require('./FXRateFeed.js'));
  } else {
    root.CVCUnitTests = factory(root.TreasuryLedger, root.TierAllocator, root.WorkLedger, root.ComputeSourceProfile, root.ParticipantRegistry, root.FunderRegistry, root.BondOfftakeRegistry, root.RealEstatePortfolio, root.FXRateFeed);
  }
}(typeof self !== 'undefined' ? self : this, function(TreasuryLedger, TierAllocator, WorkLedger, ComputeSourceProfile, ParticipantRegistry, FunderRegistry, BondOfftakeRegistry, RealEstatePortfolio, FXRateFeed) {
  'use strict';
  function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }
  function approxEqual(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

  function runAll() {
    const results = [];
    function run(cls, name, fn) {
      try { fn(); results.push({ cls, name, status: 'pass' }); }
      catch (e) { results.push({ cls, name, status: 'fail', error: e.message }); }
    }

    run('TreasuryLedger', 'seedMock increases balance and tags source', () => {
      const t = new TreasuryLedger({ sector: 'digital' });
      t.seedMock(500);
      assert(t.treasuryBalance === 500, 'balance must equal seeded amount');
      assert(t.seedIsMock === true, 'seedIsMock must flip true');
      assert(t.fundingEvents[0].source === 'mock_seed', 'funding event source must be mock_seed');
    });
    run('TreasuryLedger', 'seedMock rejects non-positive amount', () => {
      const t = new TreasuryLedger({ sector: 'digital' });
      let threw = false;
      try { t.seedMock(0); } catch (e) { threw = true; }
      assert(threw, 'seedMock(0) must throw');
    });
    run('TreasuryLedger', 'fund(pouw_mint) respects capSupply when set', () => {
      const t = new TreasuryLedger({ sector: 'digital', capSupply: 100 });
      t.fund(60, 'pouw_mint', {});
      let threw = false;
      try { t.fund(60, 'pouw_mint', {}); } catch (e) { threw = true; }
      assert(threw, 'a second mint exceeding capSupply must be rejected');
    });
    run('TreasuryLedger', 'disburse refuses amount exceeding balance', () => {
      const t = new TreasuryLedger({ sector: 'digital' });
      t.seedMock(10);
      const r = t.disburse(20, 'test', {});
      assert(r.ok === false, 'disburse must fail, not overdraw');
    });

    run('TierAllocator', 'allocate rejects fractions not summing to 1.0', () => {
      const a = new TierAllocator({ actorId: 'x' });
      let threw = false;
      try { a.allocate(100, { tier1: 0.5, tier2: 0.2, tier3: 0, tier4: 0, tier5: 0 }); } catch (e) { threw = true; }
      assert(threw, 'election summing to 0.7 must be rejected');
    });
    run('TierAllocator', 'tier4 pending_custodian without a real custodian, settled_mock with mockCustodian', () => {
      const a = new TierAllocator({ actorId: 'x' });
      const r1 = a.allocate(100, { tier1: 0, tier2: 0, tier3: 0, tier4: 1, tier5: 0 });
      assert(r1.tiers.tier4.status === 'pending_custodian', 'no custodian configured must be pending_custodian');
      a.mockCustodian = true;
      const r2 = a.allocate(100, { tier1: 0, tier2: 0, tier3: 0, tier4: 1, tier5: 0 });
      assert(r2.tiers.tier4.status === 'settled_mock', 'mockCustodian=true must produce settled_mock, never settled');
    });

    run('WorkLedger', 'logTask clamps qualityScore into [0,1]', () => {
      const w = new WorkLedger({ actorId: 'x' });
      const e = w.logTask('task1', 5, 1.5, 1);
      assert(e.qualityScore === 1, 'qualityScore above 1 must clamp to 1');
    });
    run('WorkLedger', 'totalUnits sums all logged tasks', () => {
      const w = new WorkLedger({ actorId: 'x' });
      w.logTask('a', 3, 1, 1); w.logTask('b', 7, 1, 1);
      assert(w.totalUnits() === 10, 'totalUnits must sum real logged units');
    });

    run('ComputeSourceProfile', 'computeYield applies derate correctly', () => {
      const c = new ComputeSourceProfile({ sourceType: 'solar', unitCount: 10, gflopsPerUnit: 67, derate: 0.5 });
      assert(approxEqual(c.computeYield(), 335), 'computeYield must equal unitCount*gflopsPerUnit*derate');
    });
    run('ComputeSourceProfile', 'isValidSourceType rejects unknown type', () => {
      assert(ComputeSourceProfile.isValidSourceType('quantum') === false, 'unknown source type must be invalid');
      assert(ComputeSourceProfile.isValidSourceType('solar') === true, 'solar must be valid');
    });

    run('ParticipantRegistry', 'addParticipant applies correct default split by role', () => {
      const r = new ParticipantRegistry();
      const internal = r.addParticipant('Alice', 'internal_team', 'MSOS', 'tier1');
      const vendor = r.addParticipant('Acme Corp', 'vendor', 'Acme', 'tier1');
      assert(approxEqual(internal.rewardsPct, 0.7), 'internal_team default rewardsPct must be 0.7');
      assert(approxEqual(vendor.rewardsPct, 0.2), 'vendor default rewardsPct must be 0.2');
    });
    run('ParticipantRegistry', 'addParticipant rejects invalid roleType', () => {
      const r = new ParticipantRegistry();
      let threw = false;
      try { r.addParticipant('X', 'alien', 'Y', 'tier1'); } catch (e) { threw = true; }
      assert(threw, 'invalid roleType must throw');
    });

    run('FunderRegistry', 'seedDefaults registers exactly the 3 named funders', () => {
      const r = new FunderRegistry();
      FunderRegistry.seedDefaults(r);
      assert(r.funders.length === 3, 'seedDefaults must register exactly 3 funders');
      assert(r.funders.some(f => f.name.includes('Jason')), 'Jason\u2019s Fund must be present');
      assert(r.funders.some(f => f.name.includes('Anne')), 'Anne\u2019s Fund must be present');
      assert(r.funders.some(f => f.funderType === 'multilateral'), 'UN fund must be typed multilateral');
    });

    run('BondOfftakeRegistry', 'issueBond rejects invalid rating', () => {
      const r = new BondOfftakeRegistry();
      const { zurich } = BondOfftakeRegistry.seedDefaults(r);
      let threw = false;
      try { r.issueBond(zurich.id, 'asset1', 1000, 'XYZ', 5); } catch (e) { threw = true; }
      assert(threw, 'invalid rating must be rejected');
    });
    run('BondOfftakeRegistry', 'poolCapacity sums all offtaker capacity', () => {
      const r = new BondOfftakeRegistry();
      BondOfftakeRegistry.seedDefaults(r);
      assert(r.poolCapacity() === 650000000, 'pool capacity must equal Zurich+Allianz capacity sum');
    });

    run('RealEstatePortfolio', 'seedDefaults marks ONOMO as boutique_hotel, non-hedge', () => {
      const p = new RealEstatePortfolio();
      RealEstatePortfolio.seedDefaults(p);
      const onomo = p.properties.find(x => x.name.includes('ONOMO'));
      assert(onomo.propertyType === 'boutique_hotel', 'ONOMO must be typed boutique_hotel');
      assert(onomo.isHedge === false, 'ONOMO must not be flagged as a hedge property');
      assert(p.hedgeProperties().length === 1, 'exactly one seeded property should be a hedge acquisition');
    });

    run('TierAllocator', 'FXRateFeed shock override floors tier2 and rescales the rest', () => {
      const a = new TierAllocator({ actorId: 'x' });
      const fx = new FXRateFeed({ currencyCode: 'ZWL', shockThresholdPct: 50 });
      fx.reportInflation(200); // real 200% shock, matches the ranked #1 test scenario
      const record = a.allocate(1000, { tier1: 0.5, tier2: 0.1, tier3: 0.2, tier4: 0.1, tier5: 0.1 }, fx);
      assert(record.fxShockApplied === true, 'record must flag that a real shock override was applied');
      assert(approxEqual(record.tiers.tier2.amount, 600), 'tier2 (Barter) must be floored at 60% of amount under shock');
      const total = Object.values(record.tiers).reduce((s, t) => s + t.amount, 0);
      assert(approxEqual(total, 1000), 'shocked allocation must still sum to the original amount exactly');
    });
    run('TierAllocator', 'FXRateFeed below threshold leaves election untouched', () => {
      const a = new TierAllocator({ actorId: 'x' });
      const fx = new FXRateFeed({ currencyCode: 'USD', shockThresholdPct: 50 });
      fx.reportInflation(3); // real, unremarkable inflation
      const record = a.allocate(1000, { tier1: 0.5, tier2: 0.1, tier3: 0.2, tier4: 0.1, tier5: 0.1 }, fx);
      assert(record.fxShockApplied === false, 'non-shock inflation must not trigger override');
      assert(approxEqual(record.tiers.tier2.amount, 100), 'tier2 must remain at the caller\u2019s original 10% election');
    });

    return results;
  }

  return { runAll };
}));
