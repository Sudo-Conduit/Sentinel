/**
 * @file BondOfftakeRegistry.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Mock Bond Offtaker Pool \u2014 institutional offtakers (e.g. Zurich Insurance,
 *              Allianz) that purchase bonds backed by equity stakes in real assets (e.g. Solar
 *              Farms). Each pool entry carries a bond rating and capacity; bonds are issued
 *              against a real underlying asset reference, not a synthetic asset id.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.BondOfftakeRegistry = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('BondOfftakeRegistry requires BaseClassX to be loaded first');

  const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B'];

  class BondOfftakeRegistry extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        offtakers: { type: 'array', default: () => [] }, // { id, name, capacityUsd, isMock }
        bonds: { type: 'array', default: () => [] } // { id, offtakerId, assetRef, faceValueUsd, rating, couponPct, isMock }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.bond_offtake_registry', name: 'BondOfftakeRegistry', ...options });
      this.offtakers = options.offtakers || [];
      this.bonds = options.bonds || [];
    }

    addOfftaker(name, capacityUsd) {
      const entry = { id: 'ot_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), name, capacityUsd, isMock: true };
      this.offtakers = [...this.offtakers, entry];
      return entry;
    }

    // assetRef should point at a real modeled asset (e.g. a SolarFeasibility project id) \u2014
    // the bond is issued against that specific equity stake, not a generic pool.
    issueBond(offtakerId, assetRef, faceValueUsd, rating, couponPct) {
      if (!RATINGS.includes(rating)) throw new Error('invalid rating: ' + rating);
      const offtaker = this.offtakers.find(o => o.id === offtakerId);
      if (!offtaker) throw new Error('unknown offtaker: ' + offtakerId);
      const bond = { id: 'bond_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), offtakerId, assetRef, faceValueUsd, rating, couponPct, isMock: true };
      this.bonds = [...this.bonds, bond];
      return bond;
    }

    poolCapacity() { return this.offtakers.reduce((sum, o) => sum + o.capacityUsd, 0); }
    bondsForAsset(assetRef) { return this.bonds.filter(b => b.assetRef === assetRef); }

    static seedDefaults(registry) {
      const zurich = registry.addOfftaker('Zurich Insurance', 250000000);
      const allianz = registry.addOfftaker('Allianz', 400000000);
      return { registry, zurich, allianz };
    }
  }

  BondOfftakeRegistry.RATINGS = RATINGS;
  return BondOfftakeRegistry;
}));
