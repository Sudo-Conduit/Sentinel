/**
 * @file Schedule.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description A named, period-indexed metric time-series attached to a Deal
 *              and (optionally) a Scenario — e.g. ONOMO Bulawayo's 10-year
 *              NOI/Debt-Service/DSCR/Tax/FCF table, or a stabilization ramp
 *              (occupancy by year). Generic named-metrics-per-point rather
 *              than fixed columns, so one entity serves any schedule shape
 *              (annual debt service, monthly ramp, a sensitivity grid row)
 *              without a bespoke class per case.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.Schedule = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('Schedule requires BaseClassX to be loaded first');

  class Schedule extends BaseClassX {
    static version = '1.0.0';
    static domain = 'finance.schedule';
    static _schema = { properties: {
      name: { type: 'string', default: '' },             // e.g. 'Debt Service & Return Metrics — Scenario A 60:40'
      dealId: { type: 'string', default: '' },
      scenarioId: { type: 'string', default: '' },        // '' = the Deal's baseline, not a named Scenario
      periodType: { type: 'string', default: 'annual' },  // 'annual' | 'quarterly' | 'monthly'
      startPeriod: { type: 'number', default: 1 },
      // Each point: { period: 1, metrics: { noi: 705191, debtService: 1185232, dscr: 0.595, tax: 0, fcf: -480041 } }
      // — named metrics per point, not fixed columns, so the same shape
      // holds an occupancy ramp, a debt schedule, or a sensitivity row.
      points: { type: 'array', default: [] },
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      name: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      dealId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      scenarioId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      periodType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      startPeriod: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      points: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'finance.schedule', name: options.name || 'Schedule',
        schema: { name: 'string', dealId: 'string', scenarioId: 'string', periodType: 'string', startPeriod: 'number', points: 'array', createdBy: 'string' }
      });
      this.dealId = options.dealId || '';
      this.scenarioId = options.scenarioId || '';
      this.periodType = options.periodType || 'annual';
      this.startPeriod = options.startPeriod ?? 1;
      this.points = options.points || [];
      this.createdBy = options.createdBy || '';
    }

    addPoint(period, metrics) { this.points = [...this.points, { period, metrics: metrics || {} }]; return this; }

    /** A single metric's value at one period, or undefined if not present. */
    valueAt(period, metric) {
      const p = this.points.find(pt => pt.period === period);
      return p ? p.metrics[metric] : undefined;
    }

    /** The full named-metric series as [{period, value}], skipping points that lack it. */
    series(metric) {
      return this.points
        .filter(p => p.metrics[metric] !== undefined)
        .map(p => ({ period: p.period, value: p.metrics[metric] }));
    }

    /** The point (period + value) where a metric is at its minimum — e.g.
     * min DSCR and the year it occurs, without a separately stored figure
     * that could drift from the schedule itself. */
    minMetric(metric) {
      const s = this.series(metric);
      if (!s.length) return null;
      return s.reduce((min, p) => (p.value < min.value ? p : min), s[0]);
    }

    maxMetric(metric) {
      const s = this.series(metric);
      if (!s.length) return null;
      return s.reduce((max, p) => (p.value > max.value ? p : max), s[0]);
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, dealId: this.dealId, scenarioId: this.scenarioId, periodType: this.periodType,
        startPeriod: this.startPeriod, points: this.points, createdBy: this.createdBy
      });
    }

    static fromJSON(data) { return new Schedule(data); }
  }

  return Schedule;
}));
