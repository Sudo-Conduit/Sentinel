# Threads / SABX / Federation / Login — 20 Ranked Use Cases

**Author:** Will Fobbs
**Company:** Pooled Impact
**Date:** July 22, 2026
**Version:** 1.0

## Summary

`Worker_Threads` (Node `worker_threads` interface satisfied via iframe+Worker), `SharedArrayBufferX` (SAB/Atomics interface satisfied via pluggable memory backends), Federation (weak-link references between BaseClassX trees), and Login (graded, composable viewpoint/session access into a BaseClassX instance) are four building blocks that turn out to be one pattern at different scales: **Interface Polymorphism** — satisfying an existing contract (Node worker_threads, SAB/Atomics, POSIX/Unix, or BCX's own public API) with a structurally different implementation that a consumer can't distinguish from the canonical one.

Login is Interface Polymorphism applied *reflexively* to one object (public vs. internal viewpoint of the same BCX instance, composed from viewpoint depth × injected instruments × memory persistence). Federation applies it to *identity* across independent BCX trees (a remote peer satisfying enough of the interface, post-authentication, to be treated as local). Threads and SABX are the concrete substrate both ride on: same-origin iframes give session/peer isolation with live cross-realm object references (not copies), and SABX's adapter/backend pipeline gives login sessions and federated links a place to keep ephemeral or persistent state without ever requiring COOP/COEP.

The table below ranks 20 concrete uses of these four pieces combined, scored against a 100-point rubric across 10 dimensions.

## Rubric

10 dimensions, 10 points each, summed to a 100-point total:

1. **Novelty** — how new/differentiated the idea is versus an obvious feature.
2. **Technical Feasibility** — how directly it's buildable on the code already in the project (Worker_Threads, SharedArrayBufferX, BaseClassX, FileFsX, TopMonitor).
3. **BCX Architectural Fit** — how naturally it fits BaseClassX's existing primitives (schema, cardinality, trace, Proxy) rather than bolting on.
4. **Composability** — how well it combines multiple of the four concepts rather than using just one in isolation.
5. **Performance Impact** — expected runtime benefit (zero-copy, reduced main-thread blocking, reduced serialization).
6. **Security/Isolation Value** — how much real isolation or access control it buys (session boundaries, capability scoping).
7. **Federation/P2P Value** — how much it advances cross-tree/cross-machine reach without a central broker.
8. **Persistence Value** — how well it addresses ephemeral-vs-durable session/state memory.
9. **Interface-Polymorphism Ergonomics** — how transparent it is to a consumer (no environment conditionals in application code).
10. **Near-Term Implementability** — how soon it could land as a working `/bin` command, IDE feature, or BCX API given current priorities.

Each use case is scored 0–10 per dimension; the ranked list below reports the summed total.

## Ranked Use Cases

| Rank | Use Case | Concepts | Score |
|---|---|---|---|
| 1 | Session-as-Worker: `login()` spawns an isolated iframe-Worker holding the session's Proxy view | Login, Threads | 91 |
| 2 | SABX-backed persistent session memory (OPFS/IndexedDB backend) surviving logout | Login, SABX | 89 |
| 3 | Federated peer = cross-origin Worker; `postMessage` is the login handshake | Federation, Threads, Login | 88 |
| 4 | Adapter pipeline as login-time injected instruments (encryption/compression/replication per session) | Login, SABX | 87 |
| 5 | Cross-tree trace arbitration via `AtomicsX.compareExchange` when multiple weak-linked sessions write concurrently | Federation, SABX | 85 |
| 6 | `mnt --remote <peer>` / `login <peer-address>` Terminal command, P2P discovery over BroadcastChannel | Federation, Threads | 84 |
| 7 | Viewpoint-graded Proxy backed by SABX memory tiers (native/iframe/wasm/opfs = external→internal depth) | Login, SABX | 83 |
| 8 | Job backgrounding (`&`, `jobs`, `fg`, `bg`) implemented as real Worker lifecycle instead of simulated state | Threads | 81 |
| 9 | TopMonitor job = one Worker + one SABX buffer for live rolling metrics (zero-copy dashboard feed) | Threads, SABX | 80 |
| 10 | Federated login carrying a default instrument bundle (visualizer, dataset) requested on traversal | Federation, Login | 78 |
| 11 | `waitAsync`-driven done-flag signaling between Terminal foreground command and background Worker | Threads, SABX | 76 |
| 12 | Backlink registration = second independent weak link, enabling symmetric P2P BCX mesh | Federation | 74 |
| 13 | Session TTL/lease: SABX buffer auto-deallocated on logout timeout (ephemeral memory enforced structurally) | Login, SABX | 73 |
| 14 | Root-session vs. child-session sudo-like delegated login without re-auth, mirrored via `isMainThread` pattern | Login, Threads | 71 |
| 15 | Third-party WASM module treats a federated remote buffer as local SAB via SABX contract satisfaction | SABX, Federation | 70 |
| 16 | Multi-user collaborative Designer-mode editing: presence via per-session Worker + shared SABX buffer | Threads, SABX, Login | 68 |
| 17 | `demo lasagna`-style animation driven cross-thread via Worker + SABX instead of main-thread timer | Threads, SABX | 65 |
| 18 | Session-integrity self-test (`runTests()`-style) required before login grants internal viewpoint | Login | 61 |
| 19 | Dangling-weak-link graceful degradation UI when a federated peer's Worker terminates mid-session | Federation, Threads | 58 |
| 20 | BroadcastChannel-based bifurcation-event propagation across federated trees, decoupled from direct login | Federation, Threads | 55 |

## Appendix: Scoring by Dimension

Columns: Nov = Novelty, Feas = Technical Feasibility, Fit = BCX Architectural Fit, Comp = Composability, Perf = Performance Impact, Sec = Security/Isolation Value, Fed = Federation/P2P Value, Persist = Persistence Value, Ergo = Interface-Polymorphism Ergonomics, Impl = Near-Term Implementability. Each 0–10.

| # | Nov | Feas | Fit | Comp | Perf | Sec | Fed | Persist | Ergo | Impl | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 9 | 9 | 10 | 10 | 9 | 10 | 6 | 8 | 10 | 10 | 91 |
| 2 | 9 | 9 | 9 | 9 | 9 | 10 | 5 | 10 | 10 | 9 | 89 |
| 3 | 9 | 8 | 8 | 10 | 8 | 9 | 10 | 8 | 9 | 9 | 88 |
| 4 | 9 | 9 | 9 | 10 | 9 | 9 | 4 | 9 | 10 | 9 | 87 |
| 5 | 8 | 8 | 8 | 9 | 8 | 9 | 10 | 9 | 8 | 8 | 85 |
| 6 | 8 | 8 | 8 | 9 | 8 | 8 | 10 | 8 | 8 | 9 | 84 |
| 7 | 8 | 9 | 9 | 9 | 8 | 9 | 5 | 9 | 9 | 8 | 83 |
| 8 | 8 | 10 | 9 | 6 | 10 | 9 | 4 | 6 | 9 | 10 | 81 |
| 9 | 7 | 10 | 9 | 8 | 10 | 7 | 3 | 6 | 10 | 10 | 80 |
| 10 | 8 | 7 | 7 | 9 | 6 | 8 | 10 | 7 | 9 | 7 | 78 |
| 11 | 6 | 9 | 9 | 8 | 9 | 8 | 3 | 6 | 9 | 9 | 76 |
| 12 | 8 | 7 | 7 | 6 | 6 | 7 | 10 | 8 | 8 | 7 | 74 |
| 13 | 7 | 8 | 7 | 7 | 7 | 8 | 3 | 9 | 9 | 8 | 73 |
| 14 | 8 | 7 | 8 | 7 | 6 | 8 | 3 | 6 | 9 | 9 | 71 |
| 15 | 8 | 6 | 6 | 7 | 7 | 6 | 8 | 6 | 9 | 7 | 70 |
| 16 | 6 | 6 | 7 | 8 | 6 | 7 | 3 | 6 | 9 | 10 | 68 |
| 17 | 5 | 7 | 6 | 7 | 8 | 6 | 3 | 5 | 8 | 10 | 65 |
| 18 | 6 | 7 | 6 | 3 | 5 | 8 | 2 | 6 | 8 | 10 | 61 |
| 19 | 6 | 6 | 5 | 6 | 4 | 6 | 8 | 4 | 7 | 6 | 58 |
| 20 | 7 | 5 | 4 | 6 | 4 | 5 | 9 | 4 | 6 | 5 | 55 |

## Observation

The top 3 all collapse login, threading, and federation into a single mechanism already half-built in the project — they're the natural next prototype rather than a new subsystem.

---

## Version History

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | July 22, 2026 | Will Fobbs | Initial document: rubric, 20 ranked use cases, dimension scoring appendix. |

## Confidentiality Statement

This document and its contents are the confidential and proprietary information of Pooled Impact and constitute a **Corporate Trade Secret**. This document is disclosed in confidence and is provided solely for the internal use of its intended recipient(s). No part of this document may be reproduced, distributed, transmitted, displayed, published, or otherwise disclosed to any third party, in whole or in part, in any form or by any means, without the prior written consent of Pooled Impact.

The information contained herein embodies proprietary methods, architectures, and analysis developed by Pooled Impact and/or Will Fobbs, and its unauthorized use, disclosure, or reproduction may cause serious and irreparable harm to Pooled Impact and may result in civil and/or criminal liability under applicable trade secret, unfair competition, and intellectual property laws. Receipt of this document does not convey any license or rights to the information contained within it, whether by implication, estoppel, or otherwise.

If you are not an authorized recipient of this document, you are notified that any review, dissemination, distribution, copying, or other use of this document is strictly prohibited. If you have received this document in error, please notify the sender immediately and destroy all copies in your possession.

**License:** Corporate Trade Secret — All Rights Reserved.
