# Financial Portal Pro (codename) — Prior-Generation Reference: Fund System of Record + ABF Prospecting Tool

**Author:** Will Fobbs
**Company:** Pooled Impact
**Date:** July 23, 2026
**Version:** 1.0 (reference document — describes pre-existing artifacts, not new work)
**Reference artifacts:** `conduit_fund_db-16.html` (built May/June 2025), `abf-crm-6.html`

## Purpose of This Document

This document is a reference index, not a new build. It records what already existed a year before the current BaseClassX-based Finance Portal Pro model was started, so the two are legible against each other: what ideas were already present in embryonic form, what's changed, and what the current schema (`Fund`/`Deal`/`Instrument`/`Investor`/`Lender`/`Advisor`/`RevenueAttachment`) supersedes or should still learn from. Both reference files are standalone, self-contained HTML tools with their own in-browser data stores — not built on BaseClassX.

## 1. `conduit_fund_db-16.html` — Conduit Impact Capital Fund I, System of Record (v16)

A single-page fund operations tool: "Fund I · System of Record · 80/10/10," organized around a **three-Sleeve structure**:

- **Sleeve A — SPV Projects**: "Senior-Priority Royalties · Hub Entity." Each SPV carries Services (1:M, operational layers), Agreements ("Master Royalty Agreements · 72-Hour Step-In Rights" — a defined creditor/step-in remedy already modeled a year ago), and Contacts (1:M stakeholders per SPV).
- **Sleeve B — Companies**: portfolio companies, standalone or SPV-linked.
- **Sleeve C — Real Estate**: "Safety Vault · Lease / Rent / Loan Revenue."

Other pages: **Relationship Map** (SPV-centric dependency view), **Entity Links** ("Typed Relationships · Corporate Tree · Partnerships · Economic Arrangements" — a typed-edge relationship graph, predating the current Relationships Rubric's Connections model), **Tags** (cross-store taxonomy: geography/theme/sleeve/strategy), **Scenarios** (saved Bear/Base/Bull assumptions per company, version-controlled), **Import/Export** (CSV, all tables), **Settings**.

### The Dissonance Engine (already present, May/June 2025)

A dedicated page: "**Five-Plane Gap Analysis · Silences That Demand Attention · Foundation Alignment**." Filterable by plane (Legal, Moral, and others) and severity (High/Mid+), scoped to Companies and/or SPVs. A running "Dissonance" nav badge surfaces the count of high-severity flags at all times — i.e., dissonance wasn't a report you ran, it was ambient, always-visible pressure. Paired with a **Principles** page: "Moral Plane · Three Layers · Love as Source · Foundations as Constant · Conduit's Expression" — the dissonance engine measured live data against a stated, fixed moral/foundational reference, the same anchor-vs-target shape later formalized as AST + directional Dissonance in the Relationships Rubric and Spectral Shift Theory. The schema has grown substantially since — the current work generalizes this into a documented theory with hop decay, weighting, and federation — but the core instinct (measure live entities against an invariant reference, surface the gap, never let it go silent) was already operative here.

### Investment Report Generator

Produces a standalone report per SPV/Company: Return Decomposition (donut), Cash Flow Waterfall, an Equity Value Projection chart across Bear/Base/Bull scenarios over a configurable horizon, an Exit Valuation Sensitivity table, and an appendix ("Model Methodology & Limitations") explicitly describing the modeled security as **"a hybrid investment — one that combines a contractual debt obligation [with a royalty/equity component]"** — i.e., a combinatory debt + revenue-based/equity instrument was already the working mental model here, a year before `Instrument.TYPE_PREFERENCE_ORDER` (Royalty → Revenue-based → Debt → Equity, combinatory) was written into the current schema.

## 2. `abf-crm-6.html` — ABF Capital, Provider Directory

"Pooled Impact – Accelerating Human Flourishing." A prospecting CRM for **Asset-Backed Finance capital sources** — the counterparty-sourcing tool for exactly the kind of Lender relationships the current `Lender`/ABF-facility work depends on (e.g., the Node fleet facility's Ridgeline/Vantage-style ABF providers).

Structure: Company records (Category → dependent Sub-Category, e.g. "Alternative Asset Manager"; Asset Class with auto-suggested Security Type, e.g. "Corporate – Middle Market" → "Senior Secured / Unitranche"; Market Segment; AUM display + AUM numeric for sorting) and linked Contacts, with CSV import/export and a "MESH" toggle (a networking/relationship-mesh feature, present but not expanded on in the header markup reviewed).

## 3. Throughline to the Current Model

| Then (2025 tools) | Now (BaseClassX Finance Portal Pro) |
|---|---|
| Sleeve A — SPV Projects, senior-priority royalties | `Deal` + `Instrument` (royalty is the preferred, default `instrumentType`) |
| Sleeve B — Companies | Not yet modeled as a class (portfolio-company entity is a gap) |
| Sleeve C — Real Estate | `Deal` (Urban HQ, Jubilee, ONOMO, Lee Court all modeled here) |
| Master Royalty Agreements · 72-Hour Step-In Rights | Not yet represented — `Instrument`/`Deal` has no step-in/remedy field today |
| Entity Links — typed relationships, corporate tree | Relationships Rubric's Connections model (typed, weighted, directional edges) |
| Dissonance Engine — five-plane gap analysis vs. Principles | Spectral Shift Theory / Relationships Rubric's AST + directional Dissonance |
| Scenarios — Bear/Base/Bull per company | Not yet represented in the current schema — worth adding to `Deal.keyMetrics` or a dedicated scenario object |
| ABF Provider Directory (prospecting) | `Lender` class; no dedicated prospecting/CRM layer yet |

The clearest gap the older tools surface that the current model doesn't yet cover: a **Companies** (portfolio company) entity, a **step-in/remedy** concept on `Instrument` or `Deal`, and a **Scenario** (Bear/Base/Bull) object — all three were already working ideas a year ago and haven't been ported into the current BaseClassX schema yet.

## 4. Why Development on This Reference Tool Was Paused

Development on `conduit_fund_db-16.html` was deliberately paused once it became clear that Fund, Family Office, Lender, and ABF provider were not four different things requiring four different data shapes — they were **the same underlying ontology** (a capital-provider role attaching to a deal/instrument) wearing different labels. Once that was recognized, the right move was not to keep hand-building bespoke tables/pages per entity type in a standalone tool, but to design the entity schema correctly once and let every counterparty type fall out of it as data, not structure. That is the exact decision validated by the current `Investor`/`Lender` split: one generic shape, reused without modification across a multi-LP fund, an insurer pool, an ABF facility, and a bondholder syndicate (see the companion Overall Analysis document). The pause on this reference tool marks the point where the "bespoke tool per entity type" approach was consciously abandoned in favor of "one correctly-designed schema, many entity types as data."

That underlying schema was, in fact, literally a connected entity graph, not a set of independent tables — the old tool's **Entity Links** page ("Typed Relationships · Corporate Tree · Partnerships · Economic Arrangements") and **Relationship Map** page were a hand-built implementation of exactly that graph, a year before the Relationships Rubric formalized Connections (typed, weighted, directional edges between Group C entities) as the general primitive. This also reframes an open question from the current Finance Portal Pro build: earlier discussion characterized the missing structure as "tree/branching" (`Fund` → `Deal` → `Instrument` → `Investor`/`Lender`, parent-child). Given an `Investor` can sit in multiple `Fund`s, a `Lender` can back `Instrument`s across different `Deal`s, and an `Advisor` can serve multiple `Deal`s simultaneously, this is properly **graph** topology (multi-parent, typed edges) rather than **tree** topology (single-parent) — the Relationships Rubric's Connections model is the more accurate primitive to reach for here than `children`/`_parentRef`, which was designed for genuine single-parent hierarchies.

This is the actual payoff of building on BaseClassX rather than a bespoke tool: it doesn't force a choice between a relational schema and a connected graph. Every instance is simultaneously a well-typed, validated, `_schema`-enforced relational record (the `Fund`/`Deal`/`Instrument`/`Investor`/`Lender` fields built so far) **and** a graph node capable of typed, weighted, directional Connections to any other instance (the multi-parent Investor-in-several-Funds, Lender-across-several-Deals case above). The old tool had to pick one shape by hand per page; BaseClassX carries both at once on the same object.

---

## Version History

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | July 23, 2026 | Will Fobbs | Initial reference index of `conduit_fund_db-16.html` and `abf-crm-6.html` against the current Finance Portal Pro BaseClassX model. |

## Confidentiality Statement

This document and its contents are the confidential and proprietary information of Pooled Impact and constitute a **Corporate Trade Secret**. Disclosed in confidence, for internal use of its intended recipient(s) only. No part of this document may be reproduced, distributed, or disclosed to any third party without prior written consent of Pooled Impact.

**License:** Corporate Trade Secret — All Rights Reserved.
