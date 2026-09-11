/**
 * @file Grant.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Income record — a grant or restricted/unrestricted gift.
 *              Not a priority module this round, kept minimal so budget
 *              reporting (payroll cost vs. budget) has an income side to
 *              reference without overbuilding funder-facing detail yet.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'), require('./SetType.js'));
  else root.Grant = factory(root.BaseClassX, root.FieldACL, root.SetType);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL, SetType) {
  'use strict';
  if (!BaseClassX) throw new Error('Grant requires BaseClassX to be loaded first');

  // Exclusive (single-select) SET: Active | Inactive | Blank. Blank (bitmask
  // 0n, no option chosen) is a real, intentional third state — a grant
  // whose funding status hasn't been assessed yet — not a forced default.
  const FUNDING_STATUS_OPTIONS = ['Active', 'Inactive'];

  class Grant extends BaseClassX {
    static version = '1.0.0';
    static domain = 'org.grant';
    static _schema = { properties: {
      source: { type: 'string', default: '' },
      amount: { type: 'number', default: 0 },
      receivedDate: { type: 'string', default: '' },
      restricted: { type: 'boolean', default: false },
      budgetCategoryId: { type: 'string', default: '' },
      grantPeriodStart: { type: 'string', default: '' },
      grantPeriodEnd: { type: 'string', default: '' },
      fundingStatus: { type: 'bigint', kind: 'set', exclusive: true, allowBlank: true, options: FUNDING_STATUS_OPTIONS, default: 0n },
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      source: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SEARCHABLE', 'REQUIRED'] }),
      amount: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED'] }),
      receivedDate: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED'] }),
      restricted: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      budgetCategoryId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      grantPeriodStart: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      grantPeriodEnd: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      fundingStatus: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'org.grant',
        name: 'Grant',
        schema: {
          source: 'string', amount: 'number', receivedDate: 'string', restricted: 'boolean',
          budgetCategoryId: 'string', grantPeriodStart: 'string', grantPeriodEnd: 'string', fundingStatus: 'bigint', createdBy: 'string'
        }
      });
      this.source = options.source || '';
      this.amount = options.amount || 0;
      this.receivedDate = options.receivedDate || '';
      this.restricted = !!options.restricted;
      this.budgetCategoryId = options.budgetCategoryId || '';
      this.grantPeriodStart = options.grantPeriodStart || '';
      this.grantPeriodEnd = options.grantPeriodEnd || '';
      this.fundingStatus = typeof options.fundingStatus === 'bigint' ? options.fundingStatus : 0n;
      this.createdBy = options.createdBy || '';
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        source: this.source, amount: this.amount, receivedDate: this.receivedDate, restricted: this.restricted,
        budgetCategoryId: this.budgetCategoryId, grantPeriodStart: this.grantPeriodStart, grantPeriodEnd: this.grantPeriodEnd,
        fundingStatus: this.fundingStatus.toString(), createdBy: this.createdBy
      });
    }

    static fromJSON(data) { return new Grant({ ...data, fundingStatus: data.fundingStatus != null ? BigInt(data.fundingStatus) : 0n }); }
  }

  Grant.FUNDING_STATUS_OPTIONS = FUNDING_STATUS_OPTIONS;
  return Grant;
}));
