/**
 * @file FlowTypeRegistry.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The node-type registry for Flow \u2014 DATA, not classes. Adding
 *              a new entity kind (say, a future 'CarbonCreditPool') means
 *              adding a row here, never writing a new hardcoded class. This
 *              is the concrete answer to "Fund, Deal, SolarSite,
 *              ComputeNodeDeployment, FuelClient, RealEstateProperty,
 *              Lender/ABF, etc." \u2014 all of them are FlowEntity instances
 *              whose entityType looks itself up here.
 *
 *              `expectedProperties` is informational only (surfaced in a
 *              future Flow UI as form-field hints / validation warnings) \u2014
 *              FlowEntity does NOT enforce it via _schema, since a
 *              properties bag legitimately varies per instance within a
 *              type too (e.g. not every RealEstateProperty needs every
 *              hint field populated).
 *
 *              `isHedgeDefault` encodes the hedge-vs-non-hedge distinction
 *              discussed for the three mini-apps: Industrial/Residential
 *              RealEstateProperty defaults to hedge=true; SolarSite,
 *              ComputeNodeDeployment, and FuelClient default to hedge=false
 *              (they are growth/yield investments, not risk offsets) \u2014 but
 *              remains overridable per-instance (e.g. raw developable solar
 *              land purchased as a land-value hedge, per the Feb\u2013Apr Flow
 *              guide's land-first framing).
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowTypeRegistry = factory();
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  const TYPES = {
    Fund: { label: 'Fund', category: 'capital', isHedgeDefault: false, expectedProperties: ['targetSizeUSD', 'vintageYear', 'strategy'] },
    Deal: { label: 'Deal', category: 'investment', isHedgeDefault: false, expectedProperties: ['name', 'fundId', 'keyMetrics'] },
    Instrument: { label: 'Instrument', category: 'capital', isHedgeDefault: false, expectedProperties: ['instrumentType', 'principalUSD', 'rate'] },
    Lender: { label: 'Lender', category: 'counterparty', isHedgeDefault: false, expectedProperties: ['name', 'facilityType', 'advanceRatePct'] },
    ABFProvider: { label: 'ABF Provider', category: 'counterparty', isHedgeDefault: false, expectedProperties: ['name', 'assetClassFocus', 'aumUSD'] },
    Advisor: { label: 'Advisor', category: 'counterparty', isHedgeDefault: false, expectedProperties: ['name', 'feeStructureType'] },
    Scenario: { label: 'Scenario', category: 'analysis', isHedgeDefault: false, expectedProperties: ['scenarioType', 'isBaseline', 'keyMetrics'] },

    RealEstateProperty: { label: 'Real Estate Property', category: 'asset', isHedgeDefault: true, expectedProperties: ['propertyType', 'purchasePriceUSD', 'annualNetRentUSD', 'geography'] },
    SolarSite: { label: 'Solar Site', category: 'asset', isHedgeDefault: false, expectedProperties: ['plantMW', 'geography', 'ppaStatus'] },
    ComputeNodeDeployment: { label: 'Compute Node Deployment', category: 'asset', isHedgeDefault: false, expectedProperties: ['solarSiteId', 'nodeAllocationPct', 'nodeCountUSD', 'workloadMix'] },
    FuelClient: { label: 'Alternative Fuel Client', category: 'asset', isHedgeDefault: false, expectedProperties: ['clientName', 'unitCount', 'litersPerUnitYear'] },
  };

  function getType(entityType) { return TYPES[entityType] || null; }
  function listTypes() { return Object.entries(TYPES).map(([key, def]) => ({ entityType: key, ...def })); }
  function listByCategory(category) { return listTypes().filter(t => t.category === category); }
  function registerType(entityType, def) { TYPES[entityType] = def; } // for future extension without editing this file's core rows

  return { TYPES, getType, listTypes, listByCategory, registerType };
}));
