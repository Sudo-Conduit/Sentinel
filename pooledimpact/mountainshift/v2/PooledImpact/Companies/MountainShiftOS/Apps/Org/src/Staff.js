/**
 * @file Staff.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Staff/roster domain model for the nonprofit shelter app.
 *              Extends BaseClassX directly for schema, trace/replay, and
 *              $debug for free. Payroll-adjacent fields are flagged via
 *              static _sensitiveFields (not enforced here — a viewpoint/
 *              login layer reads this list to decide what a given role sees).
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.Staff = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('Staff requires BaseClassX to be loaded first');

  class Staff extends BaseClassX {
    static version = '1.0.0';
    static domain = 'org.staff';
    // Roles/finance can see everything; case workers should not — enforced by
    // whatever viewpoint layer reads this list, not by this class itself.
    static _sensitiveFields = ['payRate', 'email', 'phone', 'ssnLast4'];
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      employmentType: { type: 'string', default: 'full-time' },   // 'full-time' | 'part-time'
      roleTitle: { type: 'string', default: '' },                  // e.g. 'Shelter Monitor', 'Case Manager'
      shiftPreference: { type: 'string', default: 'either' },      // 'day' | 'night' | 'either'
      payType: { type: 'string', default: 'hourly' },              // 'hourly' | 'salary'
      payRate: { type: 'number', default: 0 },
      hireDate: { type: 'string', default: '' },
      status: { type: 'string', default: 'active' },               // 'active' | 'inactive' | 'on-leave'
      email: { type: 'string', default: '' },
      phone: { type: 'string', default: '' },
      ssnLast4: { type: 'string', default: '' },
      createdBy: { type: 'string', default: '' }   // staffId of the record's creator — FieldACL 'owner' subject
    }};

    // ─── FIELD-LEVEL ACCESS CONTROL (16-byte POSIX-style descriptor per field) ──
    static _fieldACL = {
      name: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      employmentType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE'] }),
      roleTitle: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE'] }),
      shiftPreference: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['SORTABLE'] }),
      payType: FieldACL.build({ owner: 'rw-', group: 'rw-', other: '---', flags: ['SORTABLE'] }),
      payRate: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SORTABLE', 'REQUIRED'] }),
      hireDate: FieldACL.build({ owner: 'rw-', group: 'r--', other: 'r--', flags: ['SORTABLE'] }),
      status: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED'] }),
      email: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: ['SEARCHABLE'] }),
      phone: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      ssnLast4: FieldACL.build({ owner: 'rw-', group: '---', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'org.staff',
        name: 'Staff',
        schema: {
          name: 'string', employmentType: 'string', roleTitle: 'string',
          shiftPreference: 'string', payType: 'string', payRate: 'number',
          hireDate: 'string', status: 'string', email: 'string', phone: 'string', ssnLast4: 'string', createdBy: 'string'
        }
      });
      this.name = options.name || '';
      this.employmentType = options.employmentType || 'full-time';
      this.roleTitle = options.roleTitle || '';
      this.shiftPreference = options.shiftPreference || 'either';
      this.payType = options.payType || 'hourly';
      this.payRate = options.payRate || 0;
      this.hireDate = options.hireDate || '';
      this.status = options.status || 'active';
      this.email = options.email || '';
      this.phone = options.phone || '';
      this.ssnLast4 = options.ssnLast4 || '';
      this.createdBy = options.createdBy || '';
    }

    /** Returns a copy with sensitive fields redacted — the concrete
     *  implementation of "viewpoint" for this domain object. */
    redacted() {
      const out = this.toJSON();
      Staff._sensitiveFields.forEach(f => { if (f in out) out[f] = '••••'; });
      return out;
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name, employmentType: this.employmentType, roleTitle: this.roleTitle,
        shiftPreference: this.shiftPreference, payType: this.payType, payRate: this.payRate,
        hireDate: this.hireDate, status: this.status, email: this.email, phone: this.phone, ssnLast4: this.ssnLast4, createdBy: this.createdBy
      });
    }

    static fromJSON(data) {
      return new Staff(data);
    }
  }

  return Staff;
}));
