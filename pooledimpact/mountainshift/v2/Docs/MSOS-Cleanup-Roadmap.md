# MountainShift OS — Cleanup Roadmap & Prioritization Rubric

**Version:** 1.0.0
**Last updated:** 2026-09-11

Source: the DevTools Local Overrides hardening pass that opened this
thread — reflection-based override composition, `CPU.js` rewritten to a
real ES6 class, `SecurityMixin`/`StructureMixin` built and applied to
CPU/Physical/Kernel/BIOS with full life-cycle testing, the install/boot
pipeline audit (ISO/Installer/BootDeviceScan/FileFsBootAdapter/Registry),
and the NVRAM/federation design discussion (`MemoryMapFS`/`memorymap.wasm`,
WebRTC transport). All of it is one cleanup effort: DevTools Overrides
only matters because it tags `os.mountainshift.com` plus a file and has to
load with zero user interaction, offline — which means everything it
loads has to actually be *correct*, not just present. This document turns
that into a scored, ordered backlog, following the same six-dimension
rubric format as the sister Sentinel Chemistry Engine property roadmap,
so priority isn't re-debated from scratch each session.

Related prior art already in this repo, not superseded by this doc:
`BaseClassX-Relationships-Rubric.md` (the OS core itself),
`Kernel-Machine-Architecture.md` (the boot sequence steps 1-8 this
roadmap's Category C items close gaps in), and
`Threads-SABX-Federation-Login-Rubric.md` (Federation as weak-link
references between BaseClassX trees — the conceptual ancestor of this
doc's Category D 'network' boot work).

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Shipped this session |
| 🔬 | Investigated this session — real understanding reached, but NOT shipped as code (see linked discussion/record) |
| ⬜ | Not started |
| 🤝 | Flagged as multi-subsystem / compositional — needs several pieces built together (transport + discovery + protocol), not a single-file fix |

## The rubric

Six dimensions, each scored 1–5 (5 = most favorable). Composite score is
the unweighted sum (max 30) — deliberately unweighted, same reasoning as
the chemistry rubric: keep the ranking easy to audit and re-weight later
if one dimension turns out to matter more in practice.

| Dimension | 1 (low) | 3 (mid) | 5 (high) |
|---|---|---|---|
| **F — Foundation Ready** | Needs a mechanism/primitive the codebase has no version of at all | Needs one new piece, built on existing proven primitives | Pure application of a pattern already proven elsewhere in this codebase |
| **U — Unlocks** | Isolated leaf; nothing else in this list depends on it | Feeds one other row | Feeds several other rows or is itself a named prerequisite for a whole category |
| **O — OS Priority** | Niche; not something the boot/security/install story actually needs | Relevant but secondary | A headline property this session named directly (offline, zero-interaction load, "the closure only has run()", "the only real solution for both is custom") |
| **N — Novelty** | Routine application of an already-proven fix/pattern | Some real synthesis of existing pieces required | Would require genuinely new methodology this codebase has no precedent for |
| **R — Rarity** | Commodity; any OS-shaped project does this | Uncommon in a lightweight/browser-and-Node-parity toy OS specifically | A real differentiator — few if any comparable projects attempt this |
| **C — Confidence** | High risk the one-line description undersells real hidden complexity (see the *next()-injection* lesson below) | Plausible but unverified | The described fix/feature is genuinely direct, with no hidden multi-part gap |

The Confidence dimension exists **because of** this session's own
recurring lesson, not in the abstract: three separate times — the
`label`/`next` collision in `StructureMixin.linkTo`/`unlinkFrom`,
`Kernel.fork()`/`tick()`'s `ppid`/`memBytes`/`quantum` truthy-fallback
corruption, and `BIOS.boot()`'s `iso` truthy-check crash — a one-line
"compose this class with `SecurityMixin`/`StructureMixin`" description
turned out to hide a real correctness gap that only surfaced once the
class was actually run under full life-cycle testing, not reasoned about
from the code alone. Every one of them had the exact same shape: an
optional trailing parameter, checked with `||` or `=== undefined`,
silently receiving ExtendX's dispatcher-injected `next()` callback
instead. Any row below whose one-liner is "just apply the established
mixin pattern to X" should be scored low on Confidence and distrusted
until actually run — not assumed safe by analogy to CPU/Physical/Kernel/
BIOS's prior successes.

## Scored backlog

| # | Category | Item | Status | F | U | O | N | R | C | **Composite** |
|---|---|---|---|---|---|---|---|---|---|---|
| A.1 | Composition & Dispatch | SecurityMixin (activation-token gating via ExtendX) | ✅ | — | — | — | — | — | — | shipped |
| A.2 | Composition & Dispatch | StructureMixin graph mode (explicit + inferred parent/child/sibling) | ✅ | — | — | — | — | — | — | shipped |
| A.3 | Composition & Dispatch | StructureMixin relational mode + `getConnectedGraph()` (real BFS, not one-hop) | ✅ | — | — | — | — | — | — | shipped |
| A.4 | Composition & Dispatch | `next()`-injection systemic audit (Environment/Registry/ISO/Installer/BootDeviceScan/FileFsBootAdapter) | ⬜ | 5 | 4 | 3 | 1 | 1 | 3 | **17** |
| B.1 | Core Machine | CPU secured + tested | ✅ | — | — | — | — | — | — | shipped |
| B.2 | Core Machine | Physical secured + tested (`cpuFactory` leak fix) | ✅ | — | — | — | — | — | — | shipped |
| B.3 | Core Machine | Kernel secured + tested (`_host` fix, `fork`/`tick` hazard fix) | ✅ | — | — | — | — | — | — | shipped |
| B.4 | Core Machine | BIOS secured + tested (`kernelFactory` leak fix, `iso` hazard fix, explicit `addChild`) | ✅ | — | — | — | — | — | — | shipped |
| B.5 | Core Machine | Full boot-chain life-cycle integration test (CPU→Physical→Kernel→BIOS) | ✅ | — | — | — | — | — | — | shipped |
| B.6 | Core Machine | Memory.js secured + structured + tested (latent `_backing` WeakMap-by-`this` bug, same class as B.2/B.3's) | ⬜ | 5 | 3 | 3 | 1 | 1 | 2 | **15** |
| C.1 | Boot & Install | Checksum → signature upgrade (`ISO.verifyIntegrity()` / `FileFsBootAdapter` sidecar are integrity-only, not authenticity) | ⬜ | 2 | 3 | 2 | 3 | 3 | 3 | **16** |
| C.2 | Boot & Install | Registry NVRAM-as-fast-path (`BIOS.boot()` tries a persisted confirmed-entry record before the full scan) | ⬜ | 3 | 4 | 4 | 2 | 2 | 4 | **19** |
| C.3 | Boot & Install | `secureBoot` Registry flag enforcement (schema default exists, never read anywhere) | ⬜ | 4 | 1 | 2 | 2 | 2 | 2 | **13** |
| C.4 | Boot & Install | First-boot vs. steady-state distinction (post-install one-time setup path) | ⬜ | 3 | 2 | 2 | 2 | 2 | 4 | **15** |
| D.1 | Persistent/Shared Substrate | Land `MemoryMapFS.js` in the repo + wire Registry's NVRAM record through it (today's per-process memory) | 🔬 | 2 | 5 | 5 | 4 | 5 | 3 | **24** |
| D.2 | Persistent/Shared Substrate | `'network'` boot device adapter via WebRTC federation (the never-implemented 3rd `bootDeviceOrder` slot) | 🤝 | 1 | 3 | 4 | 5 | 5 | 1 | **19** |
| D.3 | Persistent/Shared Substrate | Node-native WebRTC parity layer (blocks D.2/D.4 entirely) | 🤝 | 1 | 4 | 3 | 3 | 4 | 2 | **17** |
| D.4 | Persistent/Shared Substrate | Transport abstraction beyond WebRTC ("many different types of transports") | 🤝 | 1 | 1 | 1 | 2 | 2 | 3 | **10** |
| E.1 | Outer Closure / Runtime | Opaque closure factory (`MountainShift()`, full-trap Proxy exposing only `run()`) | ⬜ | 4 | 5 | 5 | 3 | 3 | 3 | **23** |
| E.2 | Outer Closure / Runtime | Black-box (`run()`-only) integrated test tier | ⬜ | 1 | 2 | 4 | 2 | 2 | 4 | **15** |
| E.3 | Outer Closure / Runtime | DevTools Local Overrides loader (reflection/`CodeComposer`, `CPU.js` ES6 rewrite) | ✅ | — | — | — | — | — | — | shipped |

## Recommended execution order

**Single-subsystem ("harden what exists") queue, by composite descending,
with sequencing overrides noted where raw ranking would be wrong:**

1. **A.4 — `next()`-injection systemic audit** (17) — done **before** E.1
   despite its middle-of-the-table composite: once the opaque closure
   exists, white-box `require()` access to poke at these classes
   individually is gone by design (the project's own two-tier test rule).
   A hazard hiding in Registry/ISO/Installer/BootDeviceScan/
   FileFsBootAdapter is far cheaper to find now than after E.1 ships.
2. **B.6 — Memory.js secured/structured/tested** (15) — same reasoning as
   #1: the last core machine component with a proven-pattern latent bug
   still open. Close it before the boot chain it's part of gets wrapped
   in E.1's closure, not after.
3. **D.1 — MemoryMapFS as Registry's NVRAM backend** (24) — highest raw
   composite, independent of the E.1 sequencing concern above.
4. **C.2 — Registry NVRAM-as-fast-path** (19) — natural follow-on to D.1;
   "write once, read first" needs a backend worth writing to.
5. **E.1 — Opaque closure factory** (23) — deliberately *after* 1-4: it
   should wrap a boot chain already audited and hardened, not one with
   known-latent gaps still underneath it.
6. **E.2 — Black-box test tier** (15) — strictly blocked by E.1 (F=1);
   its position here is sequencing, not priority.
7. **C.1 — Checksum → signature upgrade** (16)
8. **C.4 — First-boot vs. steady-state distinction** (15)
9. **C.3 — `secureBoot` flag enforcement** (13) — deliberately after C.1:
   enforcing a flag with no real signature behind it is the same
   "dead config gains false teeth" risk the Confidence dimension warns
   about.

**Compositional (🤝) queue, by composite descending, with a hard
dependency override:**

1. **D.3 — Node-native WebRTC parity** (17) — goes first despite the
   lower composite than D.2: D.2 cannot exist without it.
2. **D.2 — `'network'` boot device via WebRTC** (19, but **C=1**) — the
   single highest-risk row on this entire table. "Federated boot" reads
   as one feature and is actually peer discovery + transport + a trust
   model + conflict resolution + Node/Browser parity bundled into one
   bullet point — textbook shape of the Confidence-dimension lesson.
   Prototype and verify against a real two-peer exchange before trusting
   the "PXE-boot analog" framing as load-bearing.
3. **D.4 — Transport abstraction** (10) — last; derivative of D.2, not
   independently useful until D.2 has a working shape to generalize from.

## Using this table

- Composite ties are real, not a tiebreak failure — prefer whichever tied
  item also has the higher Confidence (C) score, since a low-C item can
  quietly cost far more than its composite suggests (D.2 is this table's
  standing example: high composite, lowest possible confidence).
- A 🤝 item should not be attempted as a single-file fix. It needs the
  multi-subsystem work discussed this session (transport + discovery +
  protocol, Node and Browser symmetrically), not a patch to one class.
- Raw composite ranking assumes independence between rows; it does not.
  Where a real dependency or a closure-visibility deadline (E.1) exists,
  the execution order above overrides the raw number — exactly like this
  table's own C.3-after-C.1 and E.2-after-E.1 notes.
- This table should be revised after each item is actually attempted, the
  same way the Confidence dimension above was written from what the
  `next()`-injection hazard actually taught, not guessed in the abstract.

## Changelog

- **1.0.0** — 2026-09-11 — Initial publish: six-dimension rubric
  (Foundation Ready, Unlocks, OS Priority, Novelty, Rarity, Confidence),
  full scored backlog across five categories (Composition & Dispatch,
  Core Machine, Boot & Install, Persistent/Shared Substrate, Outer
  Closure/Runtime), single-subsystem and compositional execution queues
  with explicit dependency/sequencing overrides.
