/**
 * @file ParticipantRegistry.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Mock roster of real-world participants (vendors, partners, internal team) in
 *              the Rewards/Tier program \u2014 each entry is an Actor with a tier assignment and a
 *              compensation split (rewardsPct vs cashPct, summing to 1). Internal team members
 *              default to rewards-primary; external vendors/partners default to cash-primary,
 *              both overridable per participant. This is the roster CVCEngine.recordWork /
 *              TierAllocator settle against \u2014 not a separate simulated org chart.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.ParticipantRegistry = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('ParticipantRegistry requires BaseClassX to be loaded first');

  const ROLE_TYPES = ['internal_team', 'vendor', 'partner', 'ngo_partner'];

  class ParticipantRegistry extends BaseClassX {
    static version = '1.0.0';
    static _schema = {
      properties: {
        participants: { type: 'array', default: () => [] }
        // each: { id, name, roleType, companyName, tierKey, rewardsPct, cashPct, isMock }
      }
    };

    constructor(options = {}) {
      super({ type: 'cvc.participant_registry', name: 'ParticipantRegistry', ...options });
      this.participants = options.participants || [];
    }

    static defaultSplitFor(roleType) {
      // Internal team: rewards-primary (per user's stated comp model). Vendors/partners:
      // cash-primary by default. NGO/Church partners (e.g. ECDC/Hope Shelters, Africa
      // multi-state, Romania/Ukraine networks): rewards-primary too \u2014 their real value-add is
      // distribution/impact reach, which the Rewards program is designed to compensate, not a
      // cash-invoiced service relationship like a vendor.
      if (roleType === 'internal_team' || roleType === 'ngo_partner') return { rewardsPct: 0.7, cashPct: 0.3 };
      return { rewardsPct: 0.2, cashPct: 0.8 };
    }

    addParticipant(name, roleType, companyName, tierKey, overrideSplit, geography) {
      if (!ROLE_TYPES.includes(roleType)) throw new Error('invalid roleType: ' + roleType);
      const split = overrideSplit || ParticipantRegistry.defaultSplitFor(roleType);
      const entry = {
        id: 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
        name, roleType, companyName: companyName || '', tierKey: tierKey || 'tier1',
        geography: geography || '', // e.g. 'US-MI', 'Africa-multistate', 'Romania', 'Ukraine'
        rewardsPct: split.rewardsPct, cashPct: split.cashPct, isMock: true
      };
      this.participants = [...this.participants, entry];
      return entry;
    }

    byRole(roleType) { return this.participants.filter(p => p.roleType === roleType); }
    byGeography(geography) { return this.participants.filter(p => p.geography === geography); }

    // Splits a settled reward amount for one participant into their rewards/cash portions \u2014
    // the actual compensation-model application, not a display-only percentage.
    splitReward(participantId, amount) {
      const p = this.participants.find(x => x.id === participantId);
      if (!p) throw new Error('unknown participant: ' + participantId);
      return { rewardsAmount: amount * p.rewardsPct, cashAmount: amount * p.cashPct };
    }
  }

  ParticipantRegistry.ROLE_TYPES = ROLE_TYPES;
  return ParticipantRegistry;
}));
