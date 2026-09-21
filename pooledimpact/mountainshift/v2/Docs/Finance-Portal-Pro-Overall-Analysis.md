# Finance Portal Pro — Overall Subproject Analysis

**Author:** Will Fobbs
**Company:** Pooled Impact
**Date:** July 23, 2026
**Version:** 1.0

## Where This Stands

Finance Portal Pro started from a large, existing analytics-style DB schema (7 domains: Fund Management, Investment Data, Capital Activities, Partner Data, Portfolio Company Data, Valuation & Performance Metrics, Loan & Credit Data — ~25-30 tables, many 50-90+ columns). Rather than converting that schema table-by-table, the approach taken was to extract a small set of generic BaseClassX primitives and validate them against **8 real, structurally different deals** pulled from actual documents/models you provided. That validation-first approach is now essentially complete for a first pass.

## What Exists Now

**Classes** (all BaseClassX + FieldACL, same discipline as HOPE Shelters): `Fund` (root — vintage-yeared, holds Investors/Lenders/Instruments/Deals, exposes `investorProjection()`/`lenderProjection()`/`capitalStackProjection()`), `Deal` (a specific investment, hold period, `keyMetrics` generic-metrics bag, `dueDiligenceFlags()` mechanical risk checks, holds Advisors + RevenueAttachments), `Instrument` (the financing paper — royalty/revenue-based/asset-backed/bond/equity, combinatory preference order, tranche-class support with `combinedClassLimitCheck()`, guarantor + round-robin independence check), `Investor` (equity-side, incl. preferred return), `Lender` (debt-side, incl. seniority rank), `Advisor` (fee-based non-capital role — consultant/sponsor/developer/guarantor/trustee/placement-agent, with Role×Phase tracking), `RevenueAttachment` (secondary monetizable feature on a host asset, incl. perpetual-residual carve-outs).

**8 deals proven against this shape**, in `FinancePortalPro-Data-Model-Smoke-Test.html`:
1. Conduit's own multi-LP fund (classic fund shape)
2. Insurer pool buying a wrapped Bond (round-robin guarantor independence)
3. Node fleet Asset-Backed Facility (perpetual residual, debt-only stack)
4. Jubilee real estate (Advisor consulting fee, refinance-as-second-instrument, stacked revenue attachments)
5. ONOMO Allure Bulawayo — real investment-memo figures, correctly flagged the real Y1 DSCR 0.70x weakness
6. Cedar Heights — real March financial model, revenue-based core position + solar/compute revenue participation (combinatory, corrected from an initial debt mischaracterization)
7. Lee Court — a **lapsed** deal (advising-only, no capital position), proving Preferred Return + Lender seniority + Role×Phase tracking
8. JIC/NDM Trust Indenture — real document, multi-tranche (Series X/A/B/C) conduit bond program with Combined Class Limit checking

## What This Validates

- **The generic Investor/Lender split holds** across LP funds, insurer pools, ABF facilities, and bondholders — no bespoke fields needed per deal type.
- **Combinatory capital stacks are real, not theoretical** — Cedar Heights (revenue-based + participation) and the Node facility (debt + perpetual residual) both stack multiple `Instrument`/`RevenueAttachment` types on one `Deal`, matching the stated Royalty > Revenue-based > Debt > Equity preference.
- **Mechanical due diligence works on real numbers** — `dueDiligenceFlags()` correctly caught ONOMO's real Y1 DSCR shortfall from unmodified memo data.
- **The perpetual-residual carve-out pattern generalizes** — from the Node/Solar-Farm case to Cedar Heights' rooftop attachments.
- **Advisor covers real non-capital roles** — Jubilee Consulting's 3% fee, Lee Court's Sponsor/Guarantor/Developer, and JIC/NDM's Trustee/Placement Agent all fit the same class.

## Known Gaps (from the prior-take reference doc + this build)

1. **No Portfolio Company / Companies entity** — Conduit's schema and the 2025 `conduit_fund_db` tool both have one; the current model doesn't yet.
2. **No step-in/remedy rights** on `Instrument`/`Deal` — the 2025 tool's "72-Hour Step-In Rights" on Master Royalty Agreements has no home yet.
3. **No Scenario object** (Bear/Base/Bull, version-controlled) — present in the 2025 tool, absent now; would pair naturally with `Deal.keyMetrics`.
4. **No ABF/capital-source prospecting layer** — `abf-crm-6.html` proves this was already a real, separate tool; `Lender` exists as a record but there's no CRM/sourcing workflow around it yet.
5. **Dissonance Engine not yet reconnected** — the 2025 tool's five-plane gap analysis vs. a Principles/moral-plane anchor predates but conceptually matches the Relationships Rubric's AST+Dissonance model; Finance Portal Pro doesn't use it yet.
6. **People/echo relationship graph is architecturally decided (platform-level, at MountainShift.com) but not connected to Finance** — no `Person`↔`Fund`/`Deal` federation wired in yet.
7. **Tree/branching structure is a known, deliberately deferred decision** — flat ID cross-references (`fundId`, `dealId`, `instrumentId`) work today but aren't a real parent-child tree; you flagged this as worth getting right later rather than now, since Deals aren't structurally complex, just many-configured.

## Recommended Next Steps (priority order)

1. **Portfolio Company entity** — the most-referenced missing piece across both the DB schema and the 2025 tool; likely needed before Real Estate/Deal work goes much further (an owned asset needs an owning entity).
2. **Scenario object** (Bear/Base/Bull) on `Deal` — cheap to add, closes a real gap versus the 2025 tool, and dovetails with `keyMetrics`.
3. **Step-in rights field** on `Instrument` — small addition, closes another 2025-tool gap.
4. **Decide the tree/branching structure** — before more deal types accumulate more inconsistent flat-ID patterns.
5. **ABF prospecting/sourcing workflow** — reconnect `abf-crm-6.html`'s Company/Contact/Category taxonomy as an actual sourcing layer feeding `Lender` creation.

---

## Version History

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | July 23, 2026 | Will Fobbs | Initial overall analysis of the Finance Portal Pro subproject: state, validation, gaps, next steps. |

## Confidentiality Statement

This document and its contents are the confidential and proprietary information of Pooled Impact and constitute a **Corporate Trade Secret**. Disclosed in confidence, for internal use of its intended recipient(s) only. No part of this document may be reproduced, distributed, or disclosed to any third party without prior written consent of Pooled Impact.

**License:** Corporate Trade Secret — All Rights Reserved.
