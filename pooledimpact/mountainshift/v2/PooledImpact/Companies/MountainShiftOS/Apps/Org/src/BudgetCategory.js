/**
 * @file BudgetCategory.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description A budget line for one fiscal period (e.g. 'Payroll' FY2026).
 *              actualSpent is computed by whoever queries Expense +
 *              PayrollRecord for this category's id — not stored here,
 *              so it can never drift from the underlying records.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.BudgetCategory = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('BudgetCategory requires BaseClassX to be loaded first');

  class BudgetCategory extends BaseClassX {
    static version = '1.0.0';
    static domain = 'org.budgetCategory';
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      fiscalYear: { type: 'string', default: '' },
      allocatedAmount: { type: 'number', default: 0 }
    }};

    constructor(options = {}) {
      super({
        type: 'org.budgetCategory',
        name: 'BudgetCategory',
        schema: { name: 'string', fiscalYear: 'string', allocatedAmount: 'number' }
      });
      this.name = options.name || '';
      this.fiscalYear = options.fiscalYear || '';
      this.allocatedAmount = options.allocatedAmount || 0;
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, { name: this.name, fiscalYear: this.fiscalYear, allocatedAmount: this.allocatedAmount });
    }

    static fromJSON(data) { return new BudgetCategory(data); }
  }

  return BudgetCategory;
}));
