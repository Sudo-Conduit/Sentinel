/**
 * @file Expense.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description A non-payroll expense line, tagged to a BudgetCategory
 *              so spend-vs-budget reporting can query across Expense and
 *              PayrollRecord uniformly (both carry budgetCategoryId).
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './FieldACL.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'), require('./SetType.js'));
  else root.Expense = factory(root.BaseClassX, root.FieldACL, root.SetType);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL, SetType) {
  'use strict';
  if (!BaseClassX) throw new Error('Expense requires BaseClassX to be loaded first');

  // A SET(...) column, matching e.g. MySQL SET('submitted','manager-approved',
  // 'finance-approved','paid','flagged-for-audit') NOT NULL — an expense can be
  // in several of these states at once, packed into one 64-bit bitmask field.
  const APPROVAL_FLAGS = ['submitted', 'manager-approved', 'finance-approved', 'paid', { label: 'flagged-for-audit', retired: true }];

  class Expense extends BaseClassX {
    static version = '1.0.0';
    static domain = 'org.expense';
    static _schema = { properties: {
      date: { type: 'string', default: '' },
      category: { type: 'string', default: '' },     // free-text label, e.g. 'Utilities', 'Food Services'
      amount: { type: 'number', default: 0 },
      vendor: { type: 'string', default: '' },
      budgetCategoryId: { type: 'string', default: '' },
      approvedBy: { type: 'string', default: '' },    // staffId of approver
      approvalFlags: { type: 'bigint', kind: 'set', options: APPROVAL_FLAGS, default: 0n },
      createdBy: { type: 'string', default: '' }
    }};

    static _fieldACL = {
      date: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED'] }),
      category: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'SEARCHABLE', 'REQUIRED'] }),
      amount: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SORTABLE', 'REQUIRED'] }),
      vendor: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT', 'SEARCHABLE'] }),
      budgetCategoryId: FieldACL.build({ owner: 'rw-', group: 'r--', other: '---', flags: [] }),
      approvedBy: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['REQUIRED'] }),
      approvalFlags: FieldACL.build({ owner: 'rw-', group: 'rw-', other: 'r--', flags: ['VISIBLE_COMPACT'] }),
      createdBy: FieldACL.build({ owner: 'r--', group: 'r--', other: '---', flags: ['IMMUTABLE_AFTER_CREATE'] })
    };

    constructor(options = {}) {
      super({
        type: 'org.expense',
        name: 'Expense',
        schema: { date: 'string', category: 'string', amount: 'number', vendor: 'string', budgetCategoryId: 'string', approvedBy: 'string', approvalFlags: 'bigint', createdBy: 'string' }
      });
      this.date = options.date || '';
      this.category = options.category || '';
      this.amount = options.amount || 0;
      this.vendor = options.vendor || '';
      this.budgetCategoryId = options.budgetCategoryId || '';
      this.approvedBy = options.approvedBy || '';
      this.approvalFlags = typeof options.approvalFlags === 'bigint' ? options.approvalFlags : 0n;
      this.createdBy = options.createdBy || '';
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        date: this.date, category: this.category, amount: this.amount,
        vendor: this.vendor, budgetCategoryId: this.budgetCategoryId, approvedBy: this.approvedBy,
        approvalFlags: this.approvalFlags.toString(), createdBy: this.createdBy
      });
    }

    static fromJSON(data) { return new Expense({ ...data, approvalFlags: data.approvalFlags != null ? BigInt(data.approvalFlags) : 0n }); }
  }

  Expense.APPROVAL_FLAGS = APPROVAL_FLAGS;
  return Expense;
}));
