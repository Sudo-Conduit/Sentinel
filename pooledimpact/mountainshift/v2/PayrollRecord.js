/**
 * @file PayrollRecord.js
 * @author Will Fobbs
 * @version 2.0.0
 * @description Reshaped to match a real payroll register export (biweekly,
 *              multi-earning-type, itemized tax/deduction/employer-liability
 *              lines, multiple paychecks per reporting range) rather than
 *              a simplified regular/overtime-hours guess.
 *
 *              Key correction from v1: gross/net pay are report-computed
 *              totals in the source data (totalEarnings, netPay), not
 *              re-derivable from a single hours*rate — a person can have
 *              many named Earning lines (Regular at one rate, Regular at a
 *              second rate after a raise mid-period, Overtime at 1.5x,
 *              etc.), so earnings is a flexible array, not fixed fields.
 *              Tax withholding and voluntary deductions are itemized and
 *              kept separate (they answer different questions — what the
 *              government/court requires vs. what the employee elected).
 *              employerLiability (FICA match) is tracked separately because
 *              it's real payroll cost to the org that never touches net pay
 *              at all — required for accurate budget-vs-actual reporting.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.PayrollRecord = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('PayrollRecord requires BaseClassX to be loaded first');

  class PayrollRecord extends BaseClassX {
    static version = '2.0.0';
    static domain = 'org.payroll';
    static _sensitiveFields = ['earnings', 'totalEarnings', 'taxes', 'deductions', 'netPay', 'employerLiability', 'payments'];
    static _schema = { properties: {
      staffId: { type: 'string', default: '' },
      department: { type: 'string', default: '' },        // e.g. '10 - AS -- SCoordination'
      payFrequency: { type: 'string', default: 'Biweekly' },
      periodStart: { type: 'string', default: '' },
      periodEnd: { type: 'string', default: '' },
      earnings: { type: 'array', default: [] },            // [{ type:'Regular'|'Overtime'|..., hours, rate, amount }]
      totalHours: { type: 'number', default: 0 },
      totalEarnings: { type: 'number', default: 0 },
      taxes: { type: 'object', default: {} },              // { fedSocSec, fedMedcare, stateSIT, cityLIT, fedFIT, total }
      deductions: { type: 'object', default: {} },         // { childSupport, wageAssignment, medicalPreTax, misc, total }
      netPay: { type: 'number', default: 0 },
      employerLiability: { type: 'object', default: {} },  // { fedSocSecER, fedMedcareER, total } — real org cost, not employee's
      payments: { type: 'array', default: [] },            // [{ method, checkDate, transactionId, amount }] — one per actual paycheck
      budgetCategoryId: { type: 'string', default: 'payroll' }
    }};

    constructor(options = {}) {
      super({
        type: 'org.payroll',
        name: 'PayrollRecord',
        schema: {
          staffId: 'string', department: 'string', payFrequency: 'string', periodStart: 'string', periodEnd: 'string',
          earnings: 'array', totalHours: 'number', totalEarnings: 'number', taxes: 'object', deductions: 'object',
          netPay: 'number', employerLiability: 'object', payments: 'array', budgetCategoryId: 'string'
        }
      });
      this.staffId = options.staffId || '';
      this.department = options.department || '';
      this.payFrequency = options.payFrequency || 'Biweekly';
      this.periodStart = options.periodStart || '';
      this.periodEnd = options.periodEnd || '';
      this.earnings = options.earnings || [];
      this.totalHours = options.totalHours || 0;
      this.totalEarnings = options.totalEarnings || 0;
      this.taxes = options.taxes || {};
      this.deductions = options.deductions || {};
      this.netPay = options.netPay || 0;
      this.employerLiability = options.employerLiability || {};
      this.payments = options.payments || [];
      this.budgetCategoryId = options.budgetCategoryId || 'payroll';
    }

    totalTaxes() { return this.taxes.total != null ? this.taxes.total : Object.values(this.taxes).reduce((s, v) => typeof v === 'number' ? s + v : s, 0); }
    totalDeductions() { return this.deductions.total != null ? this.deductions.total : Object.values(this.deductions).reduce((s, v) => typeof v === 'number' ? s + v : s, 0); }
    totalEmployerLiability() { return this.employerLiability.total != null ? this.employerLiability.total : Object.values(this.employerLiability).reduce((s, v) => typeof v === 'number' ? s + v : s, 0); }
    /** True cost to the organization for this record — gross earnings plus the employer's own FICA match. Never equals net pay. */
    totalCostToOrg() { return this.totalEarnings + this.totalEmployerLiability(); }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        staffId: this.staffId, department: this.department, payFrequency: this.payFrequency,
        periodStart: this.periodStart, periodEnd: this.periodEnd, earnings: this.earnings,
        totalHours: this.totalHours, totalEarnings: this.totalEarnings, taxes: this.taxes,
        deductions: this.deductions, netPay: this.netPay, employerLiability: this.employerLiability,
        payments: this.payments, budgetCategoryId: this.budgetCategoryId,
        totalTaxes: this.totalTaxes(), totalDeductions: this.totalDeductions(),
        totalEmployerLiability: this.totalEmployerLiability(), totalCostToOrg: this.totalCostToOrg()
      });
    }

    static fromJSON(data) { return new PayrollRecord(data); }
  }

  return PayrollRecord;
}));
