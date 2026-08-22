/**
 * @file Shift.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description A single scheduled shift at the shelter. shiftType is
 *              deliberately just 'day'|'night' — the shelter runs two
 *              coverage windows, not a general weekly grid. status:'open'
 *              marks an unfilled shift, i.e. a coverage gap.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.Shift = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('Shift requires BaseClassX to be loaded first');

  class Shift extends BaseClassX {
    static version = '1.0.0';
    static domain = 'org.shift';
    static _schema = { properties: {
      staffId: { type: 'string', default: '' },        // '' = unassigned (coverage gap if status='open')
      date: { type: 'string', default: '' },            // 'YYYY-MM-DD'
      shiftType: { type: 'string', default: 'Day' },    // 'Day' | 'Night' — matches real schedule export's "category"
      shiftLabel: { type: 'string', default: '' },      // e.g. '2p-12a', '6:30-12a' — the actual real-world time range
      startEpoch: { type: 'number', default: 0 },
      endEpoch: { type: 'number', default: 0 },
      status: { type: 'string', default: 'scheduled' }, // 'scheduled' | 'completed' | 'missed' | 'open'
      hoursScheduled: { type: 'number', default: 8 },
      hoursActual: { type: 'number', default: 0 },
      payRateUsed: { type: 'number', default: 0 },      // for grossPay(); independent of Staff.payRate so a shift-differential rate can override it
      postAssignment: { type: 'string', default: '' },  // e.g. 'Front Desk', 'Floor Monitor'
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      staffId: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'REQUIRED'] }),
      date: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED'] }),
      shiftType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      shiftLabel: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      startEpoch: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      endEpoch: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      status: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      hoursScheduled: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['SORTABLE'] }),
      hoursActual: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      payRateUsed: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      postAssignment: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'org.shift',
        name: 'Shift',
        schema: {
          staffId: 'string', date: 'string', shiftType: 'string', shiftLabel: 'string',
          startEpoch: 'number', endEpoch: 'number', status: 'string',
          hoursScheduled: 'number', hoursActual: 'number', payRateUsed: 'number', postAssignment: 'string', createdBy: 'string'
        }
      });
      this.staffId = options.staffId || '';
      this.date = options.date || '';
      this.shiftType = options.shiftType || 'Day';
      this.shiftLabel = options.shiftLabel || '';
      this.startEpoch = options.startEpoch || 0;
      this.endEpoch = options.endEpoch || 0;
      this.status = options.status || (this.staffId ? 'scheduled' : 'open');
      this.hoursScheduled = options.hoursScheduled != null ? options.hoursScheduled : 8;
      this.hoursActual = options.hoursActual || 0;
      this.payRateUsed = options.payRateUsed || 0;
      this.postAssignment = options.postAssignment || '';
      this.createdBy = options.createdBy || '';
    }

    isCoverageGap() { return this.status === 'open' || !this.staffId; }
    // Real hours worked, derived from the actual clock-in/out epochs when present —
    // falls back to hoursScheduled for shifts entered without epochs.
    computedHours() { return this.startEpoch && this.endEpoch ? (this.endEpoch - this.startEpoch) / 3600 : this.hoursScheduled; }
    grossPay() { return this.computedHours() * this.payRateUsed; }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        staffId: this.staffId, date: this.date, shiftType: this.shiftType, shiftLabel: this.shiftLabel,
        startEpoch: this.startEpoch, endEpoch: this.endEpoch, status: this.status,
        hoursScheduled: this.hoursScheduled, hoursActual: this.hoursActual, payRateUsed: this.payRateUsed,
        postAssignment: this.postAssignment, computedHours: this.computedHours(), grossPay: this.grossPay(), createdBy: this.createdBy
      });
    }

    static fromJSON(data) { return new Shift(data); }
  }

  return Shift;
}));
