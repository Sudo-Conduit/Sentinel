# Staffing Coverage Report

**Organization:** Riverside Shelter (sample data)
**Window:** 2026-07-20 to 2026-07-21
**Generated from:** `Organization.schedulingProjection()`

## Shift Coverage

| Date | Shift Type | Staff | Post Assignment | Status |
|---|---|---|---|---|
| 2026-07-20 | Day | Sample Staff A | Front Desk | Scheduled |
| 2026-07-20 | Night | Sample Staff B | Floor Monitor | Scheduled |
| 2026-07-21 | Night | — | — | **Open (coverage gap)** |

## Coverage Gaps

**1 open shift** in this window: Night shift, 2026-07-21, unassigned.

A gap is anything with `status: 'open'` or no `staffId` — the same check (`Shift.isCoverageGap()`) that flags it here is what would drive an alert in a live scheduling UI, not a separately-maintained "gaps" list that could fall out of sync with the actual shift records.

## Shift Type Split (this window)

- Day shifts: 1
- Night shifts: 2 (1 filled, 1 open)

## Notes

- Sample data only, two-day window for illustration. A real reporting period (e.g. a full pay period or month) would run the same `schedulingProjection(dateRange)` call with a wider range — the report structure doesn't change with data volume.
- `shiftPreference` on each Staff record (day/night/either) is available but not yet factored into gap-filling suggestions — a natural next feature once this becomes an interactive scheduling UI rather than a static report.
