/**
 * @file Organization.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The Group C root entity — the shelter nonprofit itself.
 *              Holds Staff/Shift/PayrollRecord/Expense/Grant/BudgetCategory
 *              collections and exposes named PROJECTIONS over them
 *              (Scheduling, Payroll, Budget) per the relational-projection
 *              model: one entity, several independently-queryable views,
 *              rather than one master query that has to know everything.
 *
 *              Role-based viewpoints (admin / payroll-finance / case-worker)
 *              are implemented as thin wrappers around these projections —
 *              see roleView(). This class does not enforce access control
 *              itself; it exposes the data each viewpoint needs redacted
 *              or not, and the caller (Terminal/UI login layer) decides
 *              which viewpoint a given session gets.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./BaseClassX.js', './Staff.js', './Shift.js', './PayrollRecord.js', './Expense.js', './Grant.js', './BudgetCategory.js'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./BaseClassX.js'), require('./Staff.js'), require('./Shift.js'), require('./PayrollRecord.js'), require('./Expense.js'), require('./Grant.js'), require('./BudgetCategory.js'));
  } else {
    root.Organization = factory(root.BaseClassX, root.Staff, root.Shift, root.PayrollRecord, root.Expense, root.Grant, root.BudgetCategory);
  }
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, Staff, Shift, PayrollRecord, Expense, Grant, BudgetCategory) {
  'use strict';
  if (!BaseClassX) throw new Error('Organization requires BaseClassX to be loaded first');

  class Organization extends BaseClassX {
    static version = '1.0.0';
    static domain = 'org.organization';
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      staff: { type: 'array', default: [] },
      shifts: { type: 'array', default: [] },
      payrollRecords: { type: 'array', default: [] },
      expenses: { type: 'array', default: [] },
      grants: { type: 'array', default: [] },
      budgetCategories: { type: 'array', default: [] }
    }};

    constructor(options = {}) {
      super({
        type: 'org.organization',
        name: 'Organization',
        schema: {
          name: 'string', staff: 'array', shifts: 'array', payrollRecords: 'array',
          expenses: 'array', grants: 'array', budgetCategories: 'array'
        }
      });
      this.name = options.name || '';
      this.staff = options.staff || [];
      this.shifts = options.shifts || [];
      this.payrollRecords = options.payrollRecords || [];
      this.expenses = options.expenses || [];
      this.grants = options.grants || [];
      this.budgetCategories = options.budgetCategories || [];
    }

    addStaff(staff) { this.staff = [...this.staff, staff]; return staff; }
    addShift(shift) { this.shifts = [...this.shifts, shift]; return shift; }
    addPayrollRecord(rec) { this.payrollRecords = [...this.payrollRecords, rec]; return rec; }
    addExpense(exp) { this.expenses = [...this.expenses, exp]; return exp; }
    addGrant(g) { this.grants = [...this.grants, g]; return g; }
    addBudgetCategory(bc) { this.budgetCategories = [...this.budgetCategories, bc]; return bc; }

    // ─── GENERIC CRUD (schema-driven, collection-name generic) ────
    // Not hardcoded per entity type: any collection field on Organization
    // (staff, shifts, payrollRecords, expenses, grants, budgetCategories)
    // can be read/added/updated/removed through these three, so a UI (or
    // future entity) needs no bespoke removeX/updateX method to be added
    // here first.
    getCollection(name) { return this[name] || []; }
    addToCollection(name, item) { this[name] = [...(this[name] || []), item]; return item; }
    removeFromCollection(name, id) { this[name] = (this[name] || []).filter(x => x.id !== id); }
    updateInCollection(name, id, patch) {
      const item = (this[name] || []).find(x => x.id === id);
      if (!item) return null;
      Object.keys(patch).forEach(k => { item[k] = patch[k]; });
      return item;
    }

    // ─── PROJECTIONS ──────────────────────────────────────────────
    schedulingProjection(dateRange) {
      let shifts = this.shifts;
      if (dateRange) shifts = shifts.filter(s => s.date >= dateRange.start && s.date <= dateRange.end);
      return {
        shifts,
        coverageGaps: shifts.filter(s => s.isCoverageGap ? s.isCoverageGap() : (s.status === 'open')),
        dayShiftCount: shifts.filter(s => s.shiftType === 'day').length,
        nightShiftCount: shifts.filter(s => s.shiftType === 'night').length
      };
    }

    payrollProjection(payPeriod) {
      let records = this.payrollRecords;
      if (payPeriod) records = records.filter(r => r.periodStart === payPeriod.start && r.periodEnd === payPeriod.end);
      const totalGross = records.reduce((sum, r) => sum + (r.totalEarnings || 0), 0);
      const totalNet = records.reduce((sum, r) => sum + (r.netPay || 0), 0);
      const totalOrgCost = records.reduce((sum, r) => sum + (r.totalCostToOrg ? r.totalCostToOrg() : (r.totalEarnings || 0)), 0);
      return { records, totalGross, totalNet, totalOrgCost };
    }

    budgetProjection(fiscalYear) {
      const categories = this.budgetCategories.filter(bc => !fiscalYear || bc.fiscalYear === fiscalYear);
      return categories.map(bc => {
        const spentExpenses = this.expenses.filter(e => e.budgetCategoryId === bc.id).reduce((s, e) => s + e.amount, 0);
        const spentPayroll = this.payrollRecords.filter(r => r.budgetCategoryId === bc.id).reduce((s, r) => s + (r.totalCostToOrg ? r.totalCostToOrg() : (r.totalEarnings || 0)), 0);
        const income = this.grants.filter(g => g.budgetCategoryId === bc.id).reduce((s, g) => s + g.amount, 0);
        const actualSpent = spentExpenses + spentPayroll;
        return { category: bc.name, allocated: bc.allocatedAmount, actualSpent, remaining: bc.allocatedAmount - actualSpent, income };
      });
    }

    // ─── ROLE VIEWPOINTS ──────────────────────────────────────────
    // Same object, three presentations — the graded-viewpoint pattern
    // applied to a real domain instead of a session.
    roleView(role) {
      if (role === 'admin') {
        return { staff: this.staff, scheduling: this.schedulingProjection(), payroll: this.payrollProjection(), budget: this.budgetProjection() };
      }
      if (role === 'payroll-finance') {
        return { payroll: this.payrollProjection(), budget: this.budgetProjection(), staff: this.staff.map(s => s.redacted ? s.redacted() : s) };
      }
      if (role === 'case-worker') {
        return { scheduling: this.schedulingProjection(), staff: this.staff.map(s => s.redacted ? s.redacted() : s) };
      }
      return { error: 'unknown role: ' + role };
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        name: this.name,
        staff: this.staff.map(s => s.toJSON ? s.toJSON() : s),
        shifts: this.shifts.map(s => s.toJSON ? s.toJSON() : s),
        payrollRecords: this.payrollRecords.map(r => r.toJSON ? r.toJSON() : r),
        expenses: this.expenses.map(e => e.toJSON ? e.toJSON() : e),
        grants: this.grants.map(g => g.toJSON ? g.toJSON() : g),
        budgetCategories: this.budgetCategories.map(b => b.toJSON ? b.toJSON() : b)
      });
    }

    static fromJSON(data) {
      const org = new Organization({ name: data.name });
      (data.staff || []).forEach(s => org.addStaff(Staff.fromJSON(s)));
      (data.shifts || []).forEach(s => org.addShift(Shift.fromJSON(s)));
      (data.payrollRecords || []).forEach(r => org.addPayrollRecord(PayrollRecord.fromJSON(r)));
      (data.expenses || []).forEach(e => org.addExpense(Expense.fromJSON(e)));
      (data.grants || []).forEach(g => org.addGrant(Grant.fromJSON(g)));
      (data.budgetCategories || []).forEach(b => org.addBudgetCategory(BudgetCategory.fromJSON(b)));
      return org;
    }
  }

  return Organization;
}));
