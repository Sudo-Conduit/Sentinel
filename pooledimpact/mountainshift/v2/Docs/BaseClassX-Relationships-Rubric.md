# BaseClassX Relationships — Summary and 20 Ranked Use Cases

**Author:** Will Fobbs
**Company:** Pooled Impact
**Date:** July 22, 2026
**Version:** 1.0

## Summary

BaseClassX and Spectral Shift Theory were not extended to model relationships after the fact — relationships are the substrate they were already built from. Login (graded, composable viewpoint access), Federation (weak-link references between BCX trees), Threads/SABX (isolation and shared-state substrate) all turn out to be relationship primitives wearing access-control clothing. This document treats relationships as the primary object and works out the mechanics that were implicit in the earlier work: connections, hops, decay, weighting, and permissions.

### Connections

A connection is an edge between two Group C entities (or between an entity and one of its own projections). It is never a bare pointer — every connection carries at minimum a **type** (personal, business, faith, genealogical, citation, interpretation, etc.), a **weight** (coupling strength — the CMS operator coefficient), and a **direction** (edges are asymmetric by default; symmetry is an achieved state, not a default one, requiring a registered backlink from both sides). A "relationship" in the colloquial sense is usually two independent connections — A's weighted, typed edge to B, and B's own, independently-maintained edge back to A — that happen to be mutually registered. This is why two parties can disagree about the nature of their own relationship: they are, structurally, two different edges.

Crucially, connections live on **projections**, not directly on the entity. A person doesn't have one relationship graph — they have N named, independently federated projections (Personal, Business, Faith, PTA, Family Tree, a bounded temporal projection like a Jazz Concert), each a separate subgraph with its own connections, weights, and rules. The core entity is the invariant; the projections are where relational structure actually lives. This is also why the same two entities can be connected in contradictory ways across two projections simultaneously (business partners in one projection, estranged family in another) without any inconsistency at the entity level — the contradiction lives between projections, not within the entity.

### Hops

A hop is a traversal from one entity (or projection) across a connection to another. Multi-hop reasoning — "who does my accountant know that I don't" — is the graph-theoretic operation the whole model exists to support, and it interacts with every other property here:

- **Weight composes across hops**, typically multiplicatively or via some decay function rather than additively — a strong link to a weakly-linked party should not read as a strong link to that party's own contacts.
- **Permission degrades with hops.** A login viewpoint granted at hop 0 (direct connection) does not automatically extend to hop 1, 2, 3 — each hop is its own federation boundary, its own login negotiation, per the Federation model already established. Practically this means "reachable" and "visible" are different questions: the graph may be traversable in principle while every hop past the first requires its own authentication, so most multi-hop queries terminate not because the graph is disconnected but because access is denied partway through.
- **Hops are where dissonance and trust erosion actually get measured** — a claim's credibility, an interpretation's fidelity, a rumor's reliability, all conventionally degrade with hop-count from the source. This gives hop-count a natural role as one input to a decay function, independent of elapsed time.

### Decay

Relationships are not static once formed; weight decays without maintenance. Two independent decay mechanisms matter here and should not be conflated:

- **Temporal decay** — weight erodes with elapsed time since last interaction (recency-weighted edges). This is the ordinary "we haven't spoken in years" case, and it's why a projection needs its own trace/history: decay has to be computed against *last activity in that projection*, not the entity's global history.
- **Hop decay** — weight erodes with graph distance regardless of elapsed time. A rumor is not more credible for having been told yesterday if it passed through ten intermediaries.

Both decay functions are directional and projection-scoped: a Family Tree projection may decay very slowly or not at all (genealogical facts don't expire), while a temporal projection (Jazz Concert) may decay to zero the moment the event ends, converting from an active edge set into an inert historical trace. Decay is therefore not one universal half-life but a property each projection type gets to define — this is exactly why the invariant-node / bounded-projection distinction from earlier matters architecturally, not just descriptively.

### Weighting

Weight is the CMS coupling coefficient made concrete: how strongly one entity's state transitions influence another's. It is directional (A's weight toward B need not equal B's weight toward A — this is the same asymmetry established for Dissonance, and it's not a coincidence: weighting and directional dissonance are the same kind of quantity, one measuring coupling strength, the other measuring divergence, both computed anchor-first). Weight is also not a single scalar in the richer cases — a business connection might carry separate weights for financial exposure, information trust, and decision influence, which is why a projection's schema, not a single edge attribute, is the right place to define what "weight" even means for that projection type.

### Permissions

Permission is login's viewpoint-composition mechanism applied per edge/projection rather than per session: how much of the far entity's internal state a given connection is allowed to see is a function of the connection's type and registered trust level, not a global property of either entity. This is why Group A (Family Office, Sovereign, UN, Financial Industry) and Group B (PTA, family tree, Periodic Table) can hold structurally identical connections (weighted, typed, directional) while differing entirely in permission ceremony — Group A projections require audit-grade login and replayable trace at every hop; Group B projections may require none at all. The formality label lives on the projection's permission policy, not on the entity or even on the connection type in the abstract.

## Rubric

10 dimensions, 10 points each, 100-point total. Adapted from the Threads/SABX/Federation/Login rubric to the relationship-graph context:

1. **Novelty**
2. **Technical Feasibility** — buildable on existing BCX/FileFsX/Terminal primitives.
3. **BCX Architectural Fit**
4. **Composability** — connections, hops, decay, weighting, permissions used together rather than one in isolation.
5. **Graph Traversal Value** — how much real multi-hop reasoning it enables.
6. **Permission/Security Value**
7. **Federation/Cross-Entity Reach**
8. **Temporal/Persistence Value** — decay and history handling.
9. **Interface-Polymorphism Ergonomics**
10. **Near-Term Implementability**

## Ranked Use Cases

| Rank | Use Case | Score |
|---|---|---|
| 1 | Person-centered multi-projection identity graph (Personal/Business/Faith/PTA/Family Tree as independent weighted subgraphs off one entity) | 93 |
| 2 | Dissonance engine: AST(text) + directional Dissonance(anchor→target) between a canonical corpus and a derivative corpus | 92 |
| 3 | Interpretation projections off an invariant text node (Bible ← 1:M Interpretations) | 90 |
| 4 | Permission-graded multi-hop traversal — viewpoint depth degrades with hop distance | 88 |
| 5 | Multi-hop trust decay — weight attenuates with graph distance, independent of elapsed time | 87 |
| 6 | Federated Group A organizational relationships (Family Office/Sovereign/UN) with audit trail + replay | 86 |
| 7 | Cross-corpus dissonance mesh: one canonical text, many secondary corpora, ranked by directional divergence | 85 |
| 8 | Weighted-edge recency decay function (temporal decay independent of hop decay) | 83 |
| 9 | Temporal projection lifecycle (Jazz Concert): bounded tree opens, closes, leaves a persisted trace | 82 |
| 10 | Directed dissonance between an organizational charter (invariant) and current practice (a projection) | 81 |
| 11 | Relationship state-transition phase space per edge (realized path + tangent set of permissible next actions) | 79 |
| 12 | Loose/no-auth relational graphs (Group B: genealogy, Periodic Table, PTA) — permission ceremony intentionally near-zero | 77 |
| 13 | Organization-as-Group-C entity: a company as one BCX node with employee/customer/regulator projections | 75 |
| 14 | Federated backlink negotiation — an asymmetric edge becomes symmetric only when both sides register reciprocal weak links | 74 |
| 15 | AI agent relationship modeling: an AI instance as a Group C node with distinct, independently-decaying projections per human/task | 72 |
| 16 | Historical corpus lineage graph tracking doctrinal drift via chained directional dissonance across centuries | 70 |
| 17 | Rules-based relationship projection with zero agency (Periodic Table–style structural/property coupling only) | 67 |
| 18 | Relationship audit replay — reconstructing a Group A federated relationship's full trace for compliance review | 64 |
| 19 | Weighted multi-projection conflict detection — same two entities linked contradictorily across two projections | 60 |
| 20 | Dissonance-driven curriculum engine — teaching via graded exposure to canonical-vs-secondary corpus divergence | 56 |

## Observation

The top 3 share a pattern: they treat one invariant or near-invariant core (a person's identity, a canonical text, scripture) as fixed and let relational richness live entirely in the projection/dissonance layer around it — the same design choice that made the Bible example work as a stress test.

## Appendix A: Scoring by Dimension

Columns: Nov = Novelty, Feas = Feasibility, Fit = BCX Fit, Comp = Composability, Hops = Graph Traversal Value, Sec = Permission/Security Value, Fed = Federation Reach, Decay = Temporal/Persistence Value, Ergo = Interface-Polymorphism Ergonomics, Impl = Near-Term Implementability.

| # | Nov | Feas | Fit | Comp | Hops | Sec | Fed | Decay | Ergo | Impl | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 9 | 9 | 10 | 10 | 9 | 9 | 8 | 9 | 10 | 10 | 93 |
| 2 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 10 | 10 | 92 |
| 3 | 9 | 9 | 10 | 10 | 9 | 7 | 6 | 10 | 10 | 10 | 90 |
| 4 | 8 | 9 | 9 | 9 | 10 | 10 | 8 | 8 | 9 | 8 | 88 |
| 5 | 7 | 9 | 9 | 8 | 10 | 8 | 8 | 10 | 9 | 9 | 87 |
| 6 | 7 | 8 | 9 | 8 | 7 | 10 | 10 | 9 | 8 | 10 | 86 |
| 7 | 8 | 8 | 9 | 9 | 9 | 5 | 9 | 9 | 9 | 10 | 85 |
| 8 | 7 | 9 | 9 | 8 | 8 | 7 | 6 | 10 | 9 | 10 | 83 |
| 9 | 9 | 9 | 9 | 8 | 7 | 6 | 5 | 10 | 9 | 10 | 82 |
| 10 | 8 | 8 | 9 | 8 | 7 | 7 | 6 | 9 | 9 | 10 | 81 |
| 11 | 7 | 9 | 9 | 8 | 8 | 7 | 5 | 8 | 8 | 10 | 79 |
| 12 | 7 | 9 | 9 | 7 | 7 | 3 | 9 | 7 | 9 | 10 | 77 |
| 13 | 7 | 8 | 9 | 7 | 6 | 7 | 6 | 7 | 8 | 10 | 75 |
| 14 | 6 | 8 | 8 | 7 | 7 | 6 | 9 | 5 | 8 | 10 | 74 |
| 15 | 8 | 7 | 8 | 8 | 6 | 6 | 6 | 6 | 7 | 10 | 72 |
| 16 | 7 | 6 | 7 | 6 | 7 | 4 | 7 | 8 | 8 | 10 | 70 |
| 17 | 6 | 8 | 7 | 6 | 6 | 2 | 8 | 6 | 8 | 10 | 67 |
| 18 | 5 | 7 | 6 | 5 | 4 | 8 | 6 | 7 | 6 | 10 | 64 |
| 19 | 6 | 6 | 6 | 7 | 5 | 4 | 4 | 5 | 7 | 10 | 60 |
| 20 | 6 | 7 | 6 | 6 | 3 | 3 | 4 | 5 | 6 | 10 | 56 |

## Appendix B: Mathematical Reasons the Bible Is Used as a Chief Use Case for the Dissonance Engine

The choice is a matter of statistical and structural convenience, not doctrine — the same engine works on the Republic, the Constitution, or any invariant corpus. The Bible happens to optimize several properties simultaneously that make it an unusually good benchmark:

1. **Temporal span → dense sampling of dissonance trajectory.** With roughly two millennia of continuous readership and derivative commentary, the corpus of Interpretations sampled against the fixed AST(Bible) anchor spans enough time to observe how directional dissonance drifts as a function of era, not just as a function of author — a longitudinal dataset almost no other text can supply at comparable density.
2. **High projection fan-out → statistical power.** The sheer number (N) of independent Interpretation projections gives any distance/divergence measure enough samples to distinguish signal (systematic doctrinal drift) from noise (individual interpretive idiosyncrasy) — small-N corpora can't support this distinction.
3. **Anchor stability isolates target-side variance.** Because the canonical text itself is fixed, any measured dissonance is guaranteed to be a property of the *target* corpus (an interpretation, a speech, an editorial) relative to a constant reference — a controlled variable that most comparative-text studies don't get, since they usually compare two independently-varying corpora.
4. **Internal genre diversity pre-validates the AST schema.** The corpus itself spans narrative, law, poetry, prophecy, and epistolary argument — the same claim/value/argument-structure AST already has to generalize across these internally before it's asked to generalize externally (to a speech, a legal document, an opinion column). Genre-robustness is tested for free, on the anchor side, before it's needed on the target side.
5. **A large pre-existing, human-annotated dissonance dataset already exists.** Centuries of concordances, commentaries, and comparative translations amount to a labeled dataset of human-assessed divergence — usable as a validation/calibration set for the Dissonance function before trusting it on unlabeled corpus pairs.
6. **Multiple translations of one source separate parsing noise from genuine semantic dissonance.** Comparing AST(translation A) to AST(translation B) of the *same* underlying text bounds how much divergence is attributable to AST-extraction/parsing artifacts versus how much is real semantic drift — a calibration step most single-translation corpora cannot offer.

## Appendix C: Relational Projections Applied to Static, Dynamic, Temporal, and Rules-Based Relationships

Projection behavior is not uniform — it depends on whether the underlying node has state transitions of its own, and if so, on what timescale.

**Static** (Bible, Constitution, a book, Periodic Table entries): the node has zero internal state transitions — it is a fixed anchor. Projections here are constructed entirely by other entities relating *to* it (Interpretations, citations, a reader's personal-library placement), so projection richness is a function only of how many outside entities choose to link in, never of the node's own activity. This is the regime where AST + directional Dissonance is the primary relational operator, because there is no dynamical history to trace — only accumulating external readings to compare against a constant.

**Dynamic** (a person, an organization, an AI agent): the node is itself a small state-transition system (a BCX dynamical instance), so its projections are living, federated subgraphs that co-evolve with the node's own trace. Decay, weighting, and permission all apply per-projection here in the fullest sense — a Business projection can gain or lose weight, gain or lose permitted viewpoint depth, and independently decay from a Faith projection on the same entity, because each projection has its own history synchronized to the node's ongoing transitions.

**Temporal** (a Jazz Concert, the Epoch 2038 committee, any event-bound gathering): projections here have an explicit lifecycle — they open, remain active for a bounded interval, and close. Decay is steep and fast by design rather than a slow half-life, and on closure the projection typically collapses from an active edge set into an inert historical trace (who attended, what was decided) rather than disappearing outright — ephemeral in *activity*, persistent in *record*. This is the regime that most requires the memory-scope distinction (ephemeral vs. persistent) established under Login, since the same projection type can legitimately go either way depending on whether anyone chooses to keep the trace.

**Rules-based** (Periodic Table, biological taxonomy, genealogical inheritance): edges are defined by structural or property rules rather than trust, login, or activity — an element's bonding relationships or a species' taxonomic placement doesn't require permission to observe and doesn't decay because no interaction is being tracked, only a standing structural fact. Permission collapses to near-zero (Group B's lower bound), and weighting reduces to whatever the rule itself defines (valence, phylogenetic distance) rather than an accumulated trust score. This regime is the useful floor case: if the same connection/weighting primitives can represent a covalent bond and a corporate boardroom relationship without a different data model, the abstraction holds across the full range the project is aiming to cover.

---

## Version History

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | July 22, 2026 | Will Fobbs | Initial document: relationship mechanics summary, rubric, 20 ranked use cases, and three appendices. |

## Confidentiality Statement

This document and its contents are the confidential and proprietary information of Pooled Impact and constitute a **Corporate Trade Secret**. This document is disclosed in confidence and is provided solely for the internal use of its intended recipient(s). No part of this document may be reproduced, distributed, transmitted, displayed, published, or otherwise disclosed to any third party, in whole or in part, in any form or by any means, without the prior written consent of Pooled Impact.

The information contained herein embodies proprietary methods, architectures, and analysis developed by Pooled Impact and/or Will Fobbs, and its unauthorized use, disclosure, or reproduction may cause serious and irreparable harm to Pooled Impact and may result in civil and/or criminal liability under applicable trade secret, unfair competition, and intellectual property laws. Receipt of this document does not convey any license or rights to the information contained within it, whether by implication, estoppel, or otherwise.

If you are not an authorized recipient of this document, you are notified that any review, dissemination, distribution, copying, or other use of this document is strictly prohibited. If you have received this document in error, please notify the sender immediately and destroy all copies in your possession.

**License:** Corporate Trade Secret — All Rights Reserved.
