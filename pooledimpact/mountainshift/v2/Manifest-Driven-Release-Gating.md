# Manifest-Driven Release Gating — XML/XSD/XSL Surface Manifests as a Platform-Wide Control

**Author:** Will Fobbs
**Company:** Pooled Impact
**Date:** July 22, 2026
**Version:** 1.0
**Audience:** Business Analysts

## Executive Summary

Every application in the Pooled Impact portfolio — HOPE Shelters, Deal Structure (Housing/Solar), Finance Portal Pro (Fund/Family Office), GMAT, Learn, and Together App — eventually faces the same business problem: **not every user should see every feature, and not every feature should exist for every release.** Historically, this problem is solved with scattered `if (user.role === 'admin')` checks buried in application code, or with separate builds maintained per client. Both approaches are expensive, error-prone, and get harder to audit as the number of roles, releases, and clients grows.

This document describes a different approach: **a menu/surface manifest, written in XML, validated against an XSD contract, and transformed via XSL, that determines what a given release, role, or partner is even capable of rendering.** The core idea is simple and easy to state to a non-technical stakeholder: *if a feature isn't listed in the manifest handed to a release, that release's software cannot display it — not "won't," but structurally "can't."* This is not a replacement for real data security (which remains enforced deeper in the system, at the field level), but it is a meaningful, auditable, and reusable control that also happens to double as a release-management and feature-flagging tool.

The remainder of this document explains the concept in business terms, walks through a concrete example (the HOPE Shelters nonprofit application's planned release ladder), addresses what this control does and does not protect against, and lays out how the same primitive extends across the rest of the Pooled Impact product portfolio.

---

## 1. The Business Problem

Consider a typical software rollout to a client organization — for example, HOPE Shelters, a nonprofit homeless-shelter operator. The rollout is rarely "flip it on, all at once." In practice, it happens in stages:

1. The client first receives **PDF reports only** — no live application access at all.
2. Later, they're given the live **application**, but only a curated subset of reports.
3. Later still, they receive **Data Entry** capability (the ability to add/edit records, not just read reports).
4. Eventually, they receive **Designer** capability (the ability to build/customize their own reports and layouts).
5. Internally, Pooled Impact staff always have the **full** feature set, including capabilities never released externally.

A separate, parallel question arises for **Beta Partners** — external organizations piloting the software ahead of general release — who need their *own* independent tier, unrelated to the internal release ladder above.

The traditional way to implement this is to sprinkle conditional logic throughout the application: "if this user's role is X, show button Y." This works, but it has real costs that matter to the business, not just to engineering:

- **It's hard to audit.** To know what a given client can currently see, someone has to read through scattered code, not a single document.
- **It's easy to get wrong.** A missed conditional can accidentally expose an unreleased feature.
- **It couples release management to code changes.** Changing what a client sees often means a code deployment, not a configuration change.
- **It doesn't scale across products.** Each new application (Deal Structure, Finance Portal Pro, GMAT, Learn, Together App) tends to reinvent this logic independently, with no shared discipline.

## 2. The Proposed Solution, in Plain Terms

Instead of scattering "should this render?" logic throughout the application, we introduce a single **surface manifest** — a structured document that lists every navigable feature ("surface") available to a given release, role, or partner. The application's menu-rendering logic becomes very simple: **render exactly what's in the manifest, nothing more.**

Three standard, well-established document technologies do the work:

- **XML (Extensible Markup Language)** — the manifest itself. A plain, structured list of which features ("nodes") are present for a given release. Think of it as a packing list: if an item isn't on the list, it doesn't ship.
- **XSD (XML Schema Definition)** — the *contract* the manifest must satisfy. It defines what a valid entry must contain (an ID, a label, a required role, a minimum application version, etc.) and rejects a manifest that's malformed or incomplete, the same way an intake form can be rejected for missing required fields before it's ever processed.
- **XSL (Extensible Stylesheet Language)** — the *transform* that turns the raw manifest into the actual rendered menu (ordering, grouping, and labeling), and can vary by role or presentation context without touching the underlying data or the application code.

None of this requires custom, one-off logic per application. It's a general-purpose pattern that any Pooled Impact product can adopt.

## 3. Why "Absence, Not a Hidden Button"

The most important distinction in this design is the difference between:

- **Hiding** a feature (it exists in the running application, but a UI rule disables or hides it), versus
- **Omitting** a feature (it was never listed in the manifest the running release was given, so there is nothing in the menu-generation step that could produce it).

Hiding is fragile: a user with browser developer tools, or a bug in the hiding logic, can often still reach a "hidden" feature. Omission is structurally stronger: the menu-building code has no path that produces a control for a feature that isn't in its input data. This is sometimes called **security by obfuscation** — and it's an honest, appropriate label, because it is genuinely one layer among several, not the only layer. The real, non-bypassable protections (who can actually read or write a given piece of data) live deeper in the system, at the data-field level (see Section 6). The manifest's job is narrower and more modest: **it stops normal, well-intentioned users from accidentally landing on capabilities they were never meant to have**, and it makes "what does this release expose?" a document you can hand to a Business Analyst or an auditor, rather than a code-reading exercise.

## 4. Three Benefits From One Mechanism

The manifest approach is worth adopting because it solves three distinct business problems with a single piece of infrastructure, rather than three separate systems:

### 4.1 Obfuscation Security
As described above: a feature not present in the manifest cannot be rendered by the application, reducing the chance of accidental exposure and giving IT/security teams a single artifact to review per release.

### 4.2 Configuration Validation
Because the manifest is checked against an XSD contract, a manifest that's missing a required field, misconfigured, or malformed is **rejected before it ever reaches a user** — the same discipline a well-designed intake form applies to a data submission. This catches configuration mistakes early, before they become production incidents.

### 4.3 Progressive Release / Feature-Flag Gating
Because the manifest is just a document, not a code branch, **a feature can be fully built, tested, and sitting in the production codebase, while still being invisible to end users** simply because it isn't listed in their manifest. This is a powerful business capability:

- Advanced or experimental functionality can be developed in the same codebase used for production, rather than in a separate branch that has to be merged later.
- A single build can serve multiple clients or releases simultaneously, each with a different manifest, rather than requiring separate deployments per client.
- Turning a feature on for a client becomes a **configuration change** (edit and redeploy a manifest), not a **code change** (edit and redeploy the application).

## 5. Worked Example: The HOPE Shelters Release Ladder

To make this concrete, consider how HOPE Shelters' rollout (Section 1) maps onto manifest tiers:

| Tier | What the Client Receives | Manifest Content |
|---|---|---|
| 1 | PDF reports only, no live application | No application manifest applies yet — reports are generated and delivered outside the live app entirely |
| 2 | Live application, Reports only | A manifest listing a curated subset of the full report catalog (e.g., 3–5 of the ~20 general reports), and nothing else |
| 3 | + Data Entry | Tier 2's manifest, plus nodes for Staff/Shift/Expense/Grant data entry |
| 4 | + Designer | Tier 3's manifest, plus the Report Band Designer surface |
| 5 (Internal) | Everything | A full manifest exposing every surface that exists in the codebase, including anything not yet released externally |

**Beta Partners** would receive their own, independently-defined manifest — not necessarily aligned to any of the five tiers above — since a pilot partner's access needs are usually a negotiated, one-off arrangement rather than a step on the standard ladder.

The practical benefit for a Business Analyst: "What can Client X currently see?" has a one-document answer — their manifest — rather than requiring a walkthrough of application code with an engineer.

## 6. What This Does *Not* Protect Against (Important Caveats)

It would be a mistake to oversell this control, and it's important that Business Analysts and stakeholders understand its actual boundaries:

- **This is a UI-layer control, not a data-security control.** If a determined user can call the underlying data operations directly (bypassing the menu entirely — for instance, via a browser's developer console or a direct API call), the manifest does nothing to stop them. Real data protection — who can read or write a specific field of a specific record — is enforced separately, at the data layer, via field-level access control already built into the platform's domain model (each data field carries its own read/write permission and sensitivity flags, independent of what menu items exist). The manifest and the field-level controls are complementary, not substitutes for one another.
- **The manifest itself needs integrity protection.** If a manifest file can be edited by an ordinary user (for example, in browser storage, or via an unprotected file location), that user could grant themselves access to features never intended for them — the same class of risk as trusting any other client-side configuration. In production, manifests should be issued from a trusted source (server-side, or cryptographically signed) rather than editable client-side.
- **This does not replace authentication or authorization checks on the server/data side.** It complements them by keeping the UI honest about what a given release is supposed to expose, but the server-side checks remain the actual enforcement boundary for anything sensitive.

In short: **this is defense-in-depth, not a silver bullet** — exactly the framing a Business Analyst should carry into any conversation about this control with a client, auditor, or partner.

## 7. Auditability: Fingerprinting the Manifest Itself

A further refinement makes this control auditable over time. Each manifest — its XML content, its XSD contract, and its XSL transform — can be wrapped so that it automatically carries a **fingerprint** (a computed signature of its exact contents), a **version history**, and a **change trace**, the same way every other governed data object in the platform already does. In practical terms, this means:

- At any time, you can answer "has this client's manifest changed, and when?" without manually diffing files.
- You can compare the fingerprint of a **staging** manifest against a **production** manifest and immediately see whether they match as expected, or whether something drifted unexpectedly (a strong early-warning signal for a misconfiguration or an unauthorized change).
- Every manifest change is versioned, in the same way every other document in this platform already carries authorship, version history, and change notes.

This turns the manifest from "just a config file" into a governed artifact with the same auditability guarantees as the rest of the system.

## 8. A Platform-Wide Pattern, Not a One-Off

The release-tier problem described for HOPE Shelters in Section 5 is not unique to that application. The exact same shape — a navigable surface tree, gated by release tier, partner agreement, or user role — recurs across the entire current and planned Pooled Impact product portfolio:

| Product | Example of the Same Pattern |
|---|---|
| **HOPE Shelters** (nonprofit shelter management) | Reports → Data Entry → Designer release ladder (Section 5) |
| **Deal Structure** (Housing/Solar deals) | Different deal-structuring surfaces exposed to originators vs. underwriters vs. external partners |
| **Finance Portal Pro** (Fund/Family Office) | Investor-facing surfaces vs. fund-manager surfaces vs. compliance/audit surfaces |
| **GMAT** (test-prep) | Free-tier practice content vs. paid-tier full content vs. instructor/admin tooling |
| **Learn** (IXL-style adaptive learning) | Student surfaces vs. teacher surfaces vs. district-administrator surfaces |
| **Together App** (messaging/video, Signal + Zoom-like) | Consumer surfaces vs. enterprise/team-admin surfaces vs. moderation tooling |

Because every one of these products needs the same capability — a role- or tier-gated navigable surface tree — it makes business sense to build this **once**, as a shared platform component, rather than have each product team solve it independently (with the attendant risk of six different implementations, six different bugs, and six different audit stories). This is the core recommendation of this document: **treat manifest-driven release gating as shared platform infrastructure**, used identically whether the "surfaces" in question are shelter reports, deal-structuring tools, test-prep content, or messaging features.

## 9. Illustrative Manifest Structure

To ground the discussion, a simplified illustrative XML manifest for HOPE Shelters' Tier 2 (Reports Only) release might look like this conceptually:

```xml
<surfaceManifest release="hope-shelters" tier="2" minAppVersion="1.4.0">
  <node id="report-staff-expense-month" label="Comprehensive Staff Expense by Month" requiredRole="viewer"/>
  <node id="report-expense-season" label="Expenses by Season" requiredRole="viewer"/>
  <node id="report-payroll" label="Payroll Report" requiredRole="payroll-finance"/>
</surfaceManifest>
```

An XSD contract would require, at minimum, that every `<node>` carry an `id`, a `label`, and a `requiredRole`, and would reject a manifest missing any of these — catching a configuration mistake (say, a node with no label, which would render a blank, confusing menu entry) before it ever reaches a real user. An XSL transform would then take this manifest and produce the actual menu markup, potentially applying different grouping or ordering rules depending on the audience (for instance, grouping by report category for end users, or by internal owner for administrative views) — again, without touching the manifest data itself.

## 10. Recommended Next Steps

This document intentionally stops at the concept and design-rationale stage. The recommended next steps, in order, are:

1. **Draft the XSD contract** defining what a valid surface-manifest node requires (`id`, `label`, `requiredRole`, `minAppVersion`, and any additional attributes needed for grouping/ordering).
2. **Build the HOPE Shelters Tier 2 manifest** (Reports Only) as the first concrete, working example, since the application's navigation is already data-driven and ready to accept this change with minimal rework.
3. **Wrap the manifest (XML + XSD + XSL) in the platform's standard governed-object pattern** so it inherits fingerprinting, version history, and change trace automatically, per Section 7.
4. **Extend the ladder** to Tiers 3, 4, and 5, and define the independent Beta Partner tier.
5. **Generalize and document the pattern** as shared platform infrastructure, so that Deal Structure, Finance Portal Pro, GMAT, Learn, and Together App can each adopt the same mechanism rather than reinventing it.

---

## Glossary (for Non-Technical Readers)

- **Manifest** — a structured list document describing what's included in a given release or configuration (borrowed from the general software/shipping sense of a "packing list").
- **XML** — a widely-used, human-readable format for structured documents, used here to encode the manifest.
- **XSD** — a contract/rulebook that a given XML document must satisfy to be considered valid.
- **XSL** — a set of transformation rules that convert a raw XML document into a different, presentable form (here, an actual rendered menu).
- **Surface** — any distinct navigable feature or screen within an application (a report, a data-entry form, a designer tool).
- **Tier** — a named stage of feature access, typically tied to a rollout schedule or a contractual relationship with a client.
- **Fingerprint** — a computed signature summarizing the exact contents of a document, used to detect whether it has changed.
- **Defense-in-depth** — a security principle where multiple independent layers of protection are used together, so that the failure of any single layer does not by itself constitute a full compromise.

---

## Version History

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | July 22, 2026 | Will Fobbs | Initial document: business rationale, HOPE Shelters worked example, caveats, cross-portfolio applicability, and recommended next steps. |

## Confidentiality Statement

This document and its contents are the confidential and proprietary information of Pooled Impact and constitute a **Corporate Trade Secret**. This document is disclosed in confidence and is provided solely for the internal use of its intended recipient(s). No part of this document may be reproduced, distributed, transmitted, displayed, published, or otherwise disclosed to any third party, in whole or in part, in any form or by any means, without the prior written consent of Pooled Impact.

The information contained herein embodies proprietary methods, architectures, and analysis developed by Pooled Impact and/or Will Fobbs, and its unauthorized use, disclosure, or reproduction may cause serious and irreparable harm to Pooled Impact and may result in civil and/or criminal liability under applicable trade secret, unfair competition, and intellectual property laws. Receipt of this document does not convey any license or rights to the information contained within it, whether by implication, estoppel, or otherwise.

If you are not an authorized recipient of this document, you are notified that any review, dissemination, distribution, copying, or other use of this document is strictly prohibited. If you have received this document in error, please notify the sender immediately and destroy all copies in your possession.

**License:** Corporate Trade Secret — All Rights Reserved.
