/**
 * @file FunderRegistry.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Mock roster of external funders/capital sources for CVC simulation \u2014 real
 *              relationships (Jason's fund, Anne's fund, a UN Zambia opportunity), each entered
 *              as isMock:true since none has committed real capital into this system yet. Each
 *              funder can seed a TreasuryLedger via seedMock() once wired to a real sector.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.FunderRegistry = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('FunderRegistry requires BaseClassX to be loaded first');

  const FUNDER_TYPES = ['private_fund', 'multilateral'];

  class FunderRegistry extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        funders: { type: 'array', default: () => [] }
        // each: { id, name, contactName, funderType, focusGeography, focusThesis, isMock }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.funder_registry', name: 'FunderRegistry', ...options });
      this.funders = options.funders || [];
    }

    addFunder(name, contactName, funderType, focusGeography, focusThesis) {
      if (!FUNDER_TYPES.includes(funderType)) throw new Error('invalid funderType: ' + funderType);
      const entry = {
        id: 'f_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
        name, contactName, funderType, focusGeography, focusThesis, isMock: true
      };
      this.funders = [...this.funders, entry];
      return entry;
    }

    byGeography(geography) { return this.funders.filter(f => f.focusGeography.includes(geography)); }

    // Seeds mock capital into a treasury on this funder's behalf \u2014 the funding event is
    // tagged with the real funder name for audit, but always via TreasuryLedger.seedMock so it
    // can never be mistaken for a real committed dollar.
    seedFromFunder(funderId, treasury, amount) {
      const f = this.funders.find(x => x.id === funderId);
      if (!f) throw new Error('unknown funder: ' + funderId);
      const result = treasury.seedMock(amount);
      treasury.fundingEvents[treasury.fundingEvents.length - 1].ref = { funderId, funderName: f.name };
      return result;
    }

    static seedDefaults(registry) {
      registry.addFunder('Jason\u2019s Fund', 'Jason', 'private_fund', 'Hamara, Africa, Kyrgyzstan', 'Diversified emerging-market impact investing');
      registry.addFunder('Anne\u2019s Fund', 'Anne', 'private_fund', 'Kenya, Africa', 'Women entrepreneurs across Africa');
      registry.addFunder('UN Zambia Fund (prospective)', 'UN Zambia Program Office', 'multilateral', 'Zambia', 'UN-mandated development fund \u2014 user is a candidate fund manager');
      return registry;
    }
  }

  FunderRegistry.FUNDER_TYPES = FUNDER_TYPES;
  return FunderRegistry;
}));
