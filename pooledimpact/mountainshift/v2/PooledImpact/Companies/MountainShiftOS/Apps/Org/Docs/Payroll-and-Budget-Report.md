# Payroll & Budget Report

**Organization:** Riverside Shelter (sample data)
**Fiscal Year:** 2026
**Generated from:** `Organization.budgetProjection()` / `Organization.payrollProjection()`

## Payroll Summary — Pay Period 2026-07-01 to 2026-07-15

| Staff | Regular Hrs | OT Hrs | Total Earnings | Net Pay | Employer Liability | Total Cost to Org |
|---|---|---|---|---|---|---|
| Sample Staff A | 80 | 2 | $1,992.00 | $1,576.95 | $152.38 | $2,144.38 |
| Sample Staff B | 60 | 0 | $1,140.00 | $1,005.48 | $87.21 | $1,227.21 |
| **Total** | **140** | **2** | **$3,132.00** | **$2,582.43** | **$239.59** | **$3,371.59** |

Total cost to the organization ($3,371.59) is 7.6% above total net pay ($2,582.43) — the gap is taxes withheld plus the employer's own FICA match, neither of which is optional and both of which belong in a "true cost of payroll" figure, not just net pay.

## Budget vs. Actual — FY2026

| Category | Allocated | Actual Spend | Remaining | Grant Income |
|---|---|---|---|---|
| Payroll | $420,000.00 | $3,371.59 | $416,628.41 | $50,000.00 |
| Operations | $90,000.00 | $3,200.00 | $86,800.00 | $0.00 |

The Payroll category is tracking well under allocation at this point in the period — expected, since this reflects a single pay period rather than the full fiscal year. The $50,000 County Housing Fund grant is restricted and tagged to Payroll, meaning it should be reconciled against payroll spend specifically, not treated as general operating income.

## Notes

- All dollar figures are computed live from `earnings[]`, `taxes{}`, `deductions{}`, and `employerLiability{}` on each `PayrollRecord` — nothing here is a separately-maintained number that could drift from the underlying records.
- Sample data only. Once real payroll/budget data is loaded through this model, this report regenerates unchanged — the report is a fixed query against the projections, not something rewritten per organization.
