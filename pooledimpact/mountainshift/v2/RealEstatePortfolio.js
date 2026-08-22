/**
 * @file RealEstatePortfolio.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The Real Estate ("R") leg of CIFER, managed under a Fund conduit (Conduit
 *              Impact Capital). Properties are typed Hedge (real estate acquisition, capital
 *              preservation) or Non-Hedge (Boutique Hotels, Christian School buildouts \u2014
 *              operating/impact assets). ONOMO is modeled as one property among many, not a
 *              special case \u2014 same shape as every other property in the portfolio.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.RealEstatePortfolio = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('RealEstatePortfolio requires BaseClassX to be loaded first');

  const PROPERTY_TYPES = ['hedge_acquisition', 'boutique_hotel', 'christian_school'];

  class RealEstatePortfolio extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        fundConduitName: { type: 'string', default: 'Conduit Impact Capital' },
        properties: { type: 'array', default: () => [] }
        // each: { id, name, propertyType, isHedge, geography, acquisitionCostUsd, isMock }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.real_estate_portfolio', name: 'RealEstatePortfolio', ...options });
      this.fundConduitName = options.fundConduitName || 'Conduit Impact Capital';
      this.properties = options.properties || [];
    }

    addProperty(name, propertyType, geography, acquisitionCostUsd) {
      if (!PROPERTY_TYPES.includes(propertyType)) throw new Error('invalid propertyType: ' + propertyType);
      const entry = {
        id: 're_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
        name, propertyType, isHedge: propertyType === 'hedge_acquisition',
        geography, acquisitionCostUsd, isMock: true
      };
      this.properties = [...this.properties, entry];
      return entry;
    }

    hedgeProperties() { return this.properties.filter(p => p.isHedge); }
    nonHedgeProperties() { return this.properties.filter(p => !p.isHedge); }
    totalAcquisitionCost() { return this.properties.reduce((sum, p) => sum + p.acquisitionCostUsd, 0); }

    static seedDefaults(portfolio) {
      // ONOMO is one property among many here \u2014 same addProperty() call, same shape, no
      // special-cased "the real deal" branch.
      portfolio.addProperty('ONOMO Allure Bulawayo', 'boutique_hotel', 'Bulawayo, Zimbabwe', 0);
      portfolio.addProperty('Boutique Hotel \u2014 TBD Site B', 'boutique_hotel', 'Africa (TBD)', 0);
      portfolio.addProperty('Christian School Buildout \u2014 Phase 1', 'christian_school', 'Africa (TBD)', 0);
      portfolio.addProperty('Hedge Acquisition \u2014 US Industrial', 'hedge_acquisition', 'US', 0);
      return portfolio;
    }
  }

  RealEstatePortfolio.PROPERTY_TYPES = PROPERTY_TYPES;
  return RealEstatePortfolio;
}));
