# TTY Overview

**Author:** Will Fobbs
**Company:** Pooled Impact
**Date:** July 22, 2026
**Version:** 1.0

## Interface Polymorphism

Interface Polymorphism is the organizing principle behind every layer of this system: satisfy an existing, well-understood contract with a structurally different implementation, such that a consumer of that contract cannot tell — and does not need to tell — which implementation it's actually talking to. This is a stronger claim than "polyfill." A polyfill fakes a missing spec feature until the real one shows up. Interface Polymorphism treats the alternate implementation as a legitimate peer of the canonical one, permanently, not a stand-in.

The pattern recurs at every scale already built:

- **Memory:** `SharedArrayBufferX` satisfies the `SharedArrayBuffer`/`Atomics` interface via pluggable backends (native, same-origin iframe, WASM, OPFS, IndexedDB) with no COOP/COEP requirement. Any consumer — `DataView`, a `TypedArray` constructor, a third-party WASM module — accepts it because it satisfies the contract, not because it recognizes the backend.
- **Concurrency:** `Worker_Threads` satisfies Node's `worker_threads` API (`Worker`, `parentPort`, `postMessage`) via a same-origin iframe instead of a real OS thread.
- **Filesystem:** `FileFsX` satisfies Node's `fs` contract over an in-memory or persisted backend instead of a real disk.
- **Operating system:** the Terminal satisfies the POSIX/Unix command and session contract (`ls`, `cat`, `chmod`, `login`, job control) over a substrate that is not a real Unix kernel.
- **Identity:** BaseClassX's login mechanism satisfies "the object" as an interface — public and internal viewpoints are two Interface-Polymorphic presentations of the same instance, selected by session rather than by which code is asking.

TTY is the next instance of the same move: a terminal device, historically a physical serial line with a controlling process, a foreground/background job model, and signal delivery, satisfied here by a software abstraction with no physical line at all. Nothing above the TTY layer — commands, job control, session logic — needs to know that.

## Session, Auth, State Transitions, and Relationships

These four are not separate subsystems; they are one mechanism viewed from four angles, and TTY sits at the point where all four become concrete.

**Session** is the login-created scope: an identity, a viewpoint composition (depth × injected instruments × memory persistence), and a lifetime. A session is what `login`/`whoami`/`who`/`w`/`last` already expose and record.

**Auth** is the gate a session must pass to acquire or change viewpoint — graded, not binary. Real POSIX auth (uid/gid, `chmod`/`chown` permission bits) is the coarse three-tier version of this graded viewpoint, applied to filesystem nodes; the same graded logic applies to BCX objects generally, projection by projection.

**State transitions** are what a session, or any BaseClassX instance, actually does over time: a realized path (trace) plus a tangent set of currently-permitted next transitions. A session's login/logout/backgrounding/foregrounding are themselves state transitions on the session object, exactly the same primitive as a BCX instance's own dynamical behavior — a session is a small dynamical system, not just a token.

**Relationships** are what connect sessions, users, jobs, and devices to each other — weighted, typed, directional, and permissioned exactly as established for BaseClassX Relationships generally. A TTY's controlling relationship to a session, a session's ownership relationship to its jobs, and a job's membership in a process group are all instances of the same connection/weight/permission primitive, just scoped to the OS layer instead of the human-relationship layer.

TTY is the point where these four converge into something addressable: a TTY is a named, permissioned connection between a session and a device, and everything that happens on it (a command running, a job moving to background, a signal being delivered) is a state transition on that connection.

## Procd, TTY, Foreground and Background, Commands

**Procd** (the proposed successor name to TopMonitor, after OpenWrt's process/service supervisor) is the process-lifecycle authority: it registers jobs, schedules their tick/render cycle, and is the sole owner of foreground/background/suspended state. It does not care whether a job is a `ps`-visible shell command, a live monitoring panel, or a demo animation — one job model covers all of them, another instance of Interface Polymorphism (job-as-interface, regardless of what's actually running).

**TTY** is the device abstraction a session attaches to. Historically a serial line with a controlling terminal; here, a named connection through which a session's foreground job receives input and produces output. A session can, in principle, hold more than one TTY (multiple terminal windows), and a TTY has exactly one controlling session at a time — the same asymmetric-connection shape as federation's weak links, just scoped tightly (one-to-one at any instant, reassignable).

**Foreground and background** are job-control states procd already tracks: exactly one job per TTY may be foreground (owns the shared input/output surface) at a time; every other job on that TTY is background, still ticking on schedule but not rendering to the surface. `fg <id>` and `bg <id>` are state transitions on the job, arbitrated by procd, not by the job itself — matching the "no BCX object mutates its own login-granted viewpoint" rule from the Login primitive.

**Commands** (`ps` foremost) are read operations over procd's job table, formatted for the session's current viewpoint. `ps` lists jobs with id, name, and state (foreground/background/suspended); `jobs` is the session-scoped view of the same table; `fg`/`bg`/`kill` are the mutating counterparts. None of these commands need to know whether the job they're addressing is a real subprocess or a same-origin iframe Worker — they operate purely against procd's interface, which is the point.

## Appendix: 10 Use Cases for Stateless TTY Alongside Dynamic TTY

Stateless TTY carries no session/identity continuity across invocations — each command is self-contained and reproducible, the ephemeral-memory extreme of the Login memory axis. Dynamic TTY is the persistent-session case already built. Both are legitimate, and most real systems need both simultaneously:

1. **CI/CD job runners** — each pipeline step executes in a fresh stateless TTY (no carryover, byte-for-byte reproducible), while a developer's live debug session stays dynamic.
2. **Kiosk/public demo terminals** — a walk-up stateless TTY resets to clean state per visitor; an admin's configuration session runs dynamic in parallel.
3. **Webhook/API-triggered one-shot commands** — a single external trigger executes in a stateless TTY with no session to leak or hijack, versus a human operator's dynamic monitoring session.
4. **Federated peer execution** — a remote peer's command runs in a stateless TTY per call, since a federated weak link shouldn't hold an open persistent session across a trust boundary; the local operator's own TTY stays dynamic.
5. **Scheduled/cron-style batch jobs** — each scheduled run is stateless by design (no memory of the prior run avoids drift bugs), while procd's live dashboard is continuously dynamic.
6. **Anonymous/guest read-only access** — stateless TTY for public docs/file browsing with no login ceremony (Group B's lower bound), dynamic TTY reserved for authenticated contributors with write access.
7. **Rescue/recovery mode** — a minimal stateless TTY available when session state itself is corrupted or the filesystem won't mount, independent of the normal dynamic login shell.
8. **Reproducible bug reports** — a user reproduces an issue in a stateless TTY (guaranteed clean-state, exactly replayable) to compare against their normal dynamic session where accumulated state might be the actual cause.
9. **Grading/sandbox execution** — each student submission runs in a disposable stateless TTY; the instructor's live-monitoring session is dynamic and persists across all of them.
10. **Load/fuzz testing harnesses** — many parallel stateless TTYs validate command idempotency at scale, reporting up to one dynamic supervisory session aggregating results.

---

## Version History

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | July 22, 2026 | Will Fobbs | Initial document: Interface Polymorphism, Session/Auth/State-Transition/Relationship convergence, Procd/TTY/job-control model, and stateless-vs-dynamic TTY appendix. |

## Confidentiality Statement

This document and its contents are the confidential and proprietary information of Pooled Impact and constitute a **Corporate Trade Secret**. This document is disclosed in confidence and is provided solely for the internal use of its intended recipient(s). No part of this document may be reproduced, distributed, transmitted, displayed, published, or otherwise disclosed to any third party, in whole or in part, in any form or by any means, without the prior written consent of Pooled Impact.

The information contained herein embodies proprietary methods, architectures, and analysis developed by Pooled Impact and/or Will Fobbs, and its unauthorized use, disclosure, or reproduction may cause serious and irreparable harm to Pooled Impact and may result in civil and/or criminal liability under applicable trade secret, unfair competition, and intellectual property laws. Receipt of this document does not convey any license or rights to the information contained within it, whether by implication, estoppel, or otherwise.

If you are not an authorized recipient of this document, you are notified that any review, dissemination, distribution, copying, or other use of this document is strictly prohibited. If you have received this document in error, please notify the sender immediately and destroy all copies in your possession.

**License:** Corporate Trade Secret — All Rights Reserved.
