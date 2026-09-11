/**
 * @file Deal.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description A specific investment within a Fund's vintage, with a defined
 *              hold period (5-year hold, typical) \u2014 distinct from Instrument
 *              (the financing paper issued against it). One Fund (a vintage
 *              year: 2026, 2027, 2028...) holds many Deals; a Deal in turn
 *              may have one or more Instruments financing it (an equity
 *              stake, a wrapped Bond, an ABF facility).
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.Deal = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('Deal requires BaseClassX to be loaded first');

  class Deal extends BaseClassX {
    static version = '1.0.0';
    static domain = 'finance.deal';
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      fundId: { type: 'string', default: '' },
      dealType: { type: 'string', default: '' },       // e.g. 'solar-equity-buyout', 'church-refinance', 'node-abf'
      holdPeriodYears: { type: 'number', default: 5 },
      startDate: { type: 'string', default: '' },
      expectedExitDate: { type: 'string', default: '' },
      description: { type: 'string', default: '' },
      status: { type: 'string', default: 'active' },   // 'active' | 'closed' | 'lapsed' — real pipelines include deals that didn't happen
      keyMetrics: { type: 'object', default: {} },  // generic named metrics per deal type, e.g. { unleveredIRR: 14.2, equityMultiple: 3.59 } — avoids bespoke fields per deal type
      createdBy: { type: 'string', default: '' },
      advisors: { type: 'array', default: [] },
      revenueAttachments: { type: 'array', default: [] },
      scenarios: { type: 'array', default: [] },
      schedules: { type: 'array', default: [] }
    }};

    static _fieldACL = {
      name: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      fundId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      dealType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      holdPeriodYears: FieldACL.build({ owner: 'rw-', group: 'r--', other: 'r--', flags: ['VISIBLE_COMPACT', 'REQUIRED'] }),
      startDate: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      expectedExitDate: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE'] }),
      description: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: [] }),
      status: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      keyMetrics: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'finance.deal', name: options.name || 'Deal',
        schema: { name: 'string', fundId: 'string', dealType: 'string', holdPeriodYears: 'number', startDate: 'string', expectedExitDate: 'string', description: 'string', createdBy: 'string' }
      });
      this.fundId = options.fundId || '';
      this.dealType = options.dealType || '';
      this.holdPeriodYears = options.holdPeriodYears ?? 5;
      this.startDate = options.startDate || '';
      this.expectedExitDate = options.expectedExitDate || '';
      this.description = options.description || '';
      this.status = options.status || 'active';
      this.keyMetrics = options.keyMetrics || {};
      this.createdBy = options.createdBy || '';
      this.advisors = [];
      this.revenueAttachments = [];
      this.scenarios = [];
      this.schedules = [];
    }

    addAdvisor(a) { a.dealId = this.id; this.advisors = [...this.advisors, a]; return a; }
    addRevenueAttachment(r) { r.hostDealId = this.id; this.revenueAttachments = [...this.revenueAttachments, r]; return r; }
    addScenario(s) { s.dealId = this.id; this.scenarios = [...this.scenarios, s]; return s; }
    addSchedule(sch) { sch.dealId = this.id; this.schedules = [...this.schedules, sch]; return sch; }

    /** The Scenario flagged isBaseline, or null if none/multiple. */
    baselineScenario() {
      const baselines = this.scenarios.filter(s => s.isBaseline);
      return baselines.length === 1 ? baselines[0] : null;
    }

    /** Mechanical, threshold-based due-diligence flags computed straight off
     * keyMetrics \u2014 no subjective judgment, just the same numeric checks a
     * diligence team runs by hand every time: DSCR coverage, leverage,
     * completion risk. Purely computed, never separately stored, so a flag
     * can't drift from the underlying keyMetrics. */
    dueDiligenceFlags() {
      const flags = [];
      const m = this.keyMetrics || {};
      if (m.minDSCRYear1 !== undefined && m.minDSCRYear1 < 1.0) {
        flags.push({ severity: 'high', check: 'Year 1 Debt Service Coverage', detail: `Min DSCR Year 1 is ${m.minDSCRYear1}x \u2014 below 1.0x means projected Year 1 operating cash flow does not fully cover debt service; requires a funded reserve or equity cushion, not just a ramp assumption.` });
      }
      if (m.year5DSCR !== undefined && m.minDSCRYear1 !== undefined && m.year5DSCR > m.minDSCRYear1 * 1.5) {
        flags.push({ severity: 'medium', check: 'DSCR Ramp Dependency', detail: `DSCR improves from ${m.minDSCRYear1}x (Y1) to ${m.year5DSCR}x (Y5) \u2014 the investment case leans heavily on the stabilization ramp materializing as modeled.` });
      }
      if (this.dealType && /development|new-build/i.test(this.dealType + ' ' + this.description)) {
        flags.push({ severity: 'medium', check: 'Completion Risk', detail: 'New-build/development deal \u2014 unlike an existing-asset acquisition, this carries construction/completion risk until delivery.' });
      }
      if (m.equityMultiple !== undefined && m.npvAt12PercentUSD !== undefined && m.npvAt12PercentUSD <= 0) {
        flags.push({ severity: 'high', check: 'NPV', detail: `NPV at the 12% discount rate is ${m.npvAt12PercentUSD} \u2014 non-positive, meaning the deal does not clear the required return at that hurdle rate.` });
      }
      return flags;
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, fundId: this.fundId, dealType: this.dealType, holdPeriodYears: this.holdPeriodYears,
        startDate: this.startDate, expectedExitDate: this.expectedExitDate, description: this.description, status: this.status, keyMetrics: this.keyMetrics, createdBy: this.createdBy,
        advisors: this.advisors.map(a => a.toJSON ? a.toJSON() : a),
        revenueAttachments: this.revenueAttachments.map(r => r.toJSON ? r.toJSON() : r),
        scenarios: this.scenarios.map(s => s.toJSON ? s.toJSON() : s),
        schedules: this.schedules.map(sch => sch.toJSON ? sch.toJSON() : sch)
      });
    }

    static fromJSON(data, Advisor, RevenueAttachment, Scenario, Schedule) {
      const d = new Deal(data);
      (data.advisors || []).forEach(a => d.addAdvisor(Advisor ? Advisor.fromJSON(a) : a));
      (data.revenueAttachments || []).forEach(r => d.addRevenueAttachment(RevenueAttachment ? RevenueAttachment.fromJSON(r) : r));
      (data.scenarios || []).forEach(s => d.addScenario(Scenario ? Scenario.fromJSON(s) : s));
      (data.schedules || []).forEach(sch => d.addSchedule(Schedule ? Schedule.fromJSON(sch) : sch));
      return d;
    }
  }

  return Deal;
}));
