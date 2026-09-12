# MountainShift OS — Cleanup Roadmap & Prioritization Rubric

**Version:** 1.1.0
**Last updated:** 2026-09-12

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

## Last test run

Pasted directly from `node test/run-all.js`'s own output, not hand-typed
— the point of this section is that it can go stale in an obvious,
checkable way (the pinned commit stops matching that repo's HEAD) rather
than a silent, unverifiable way. Re-run and re-paste whenever a Category
A/B item lands; a roadmap claiming shipped work that the test suite
doesn't back up is worse than no roadmap.

The commit below is pinned to whichever remote is canonical for this code
*right now*, not assumed. Gitea (`git.pooledimpact.com/Claude/Romans`) is
the sole active remote as of this pin — GitHub (`github.com/Sudo-Conduit/
Sentinel`) is frozen/deprecated per `CLAUDE.md` and receives no further
pushes; it may still hold an old copy of this commit today, but do not
expect it to stay current and do not push there.

**Commit:** `09c76bf` (git.pooledimpact.com/Claude/Romans, branch
`claude/devtools-overrides-robustness-8we96z`) — 2026-09-12T01:02:12Z

| Suite | Result |
|---|---|
| CPU.security.test.js | ALL 15 CHECKS PASSED |
| Physical.security.test.js | ALL 15 CHECKS PASSED |
| PreMixed.hazard.test.js | ALL 9 CHECKS PASSED |
| StructureMixin.test.js | ALL 23 CHECKS PASSED |
| Kernel.security.test.js | ALL 15 CHECKS PASSED |
| BIOS.security.test.js | ALL 12 CHECKS PASSED |
| FullBootChain.lifecycle.test.js | ALL 16 CHECKS PASSED |
| NextInjection.audit.test.js | ALL 9 CHECKS PASSED |

**Total: 114/114 checks passing, 8/8 suites green.**

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

**A.4 findings (2026-09-12), the same "check before trusting the punch
list" discipline the chemistry roadmap used on its own 1.1/1.3/5.1 rows:**
five of the six audited files are clean, each for a different *structural*
reason, not luck — proven in `test/NextInjection.audit.test.js`, not just
asserted: `Environment.js` has no instance methods at all; `ISO.js`'s
instance methods originally took zero arguments; `Installer.js` (a static
method) and `BootDeviceScan.js` (a plain object, not even a constructor)
are never reachable through ExtendX's dispatcher regardless of
composition; `FileFsBootAdapter.js`'s one method has no optional trailing
parameter for `next()` to land in. `Registry.js`'s `set(key, value)` has
one real, currently-unreachable gap (grepped — never called with fewer
than 2 args anywhere in this codebase): omitting `value` under composition
silently stores the injected `next()` function instead of `undefined`.
Unlike every other instance of this hazard, it is **not fixable** with a
`typeof`-guard, because a Registry value's legitimate type is
unconstrained (unlike a `label` string or a `quantum` number) — documented
in `Registry.js` as a known limitation instead of a false fix.

The audit also surfaced a **second, more general bug than A.4 set out to
find**: `ISO.js`'s constructor called `this.computeChecksum()` on itself,
the exact self-call-before-arming shape `CPU.js`'s `#registerInstructions()`
already fixed once — so the same `#private`-method fix was applied here
too, and immediately broke a *different* way: `verifyIntegrity()` (a
normal dispatched method) also called `this.#computeChecksum()`, and once
`this` is ExtendX's frame Proxy (true for any call after construction),
private-field/method brand checks do not forward through a Proxy at all —
confirmed live via the engine's own `Receiver must be an instance of class
ISO` TypeError, not a defect in this project's code. **`#private` methods
only ever solve "called from the raw, un-proxied constructor"; they do
not generalize to "called from any other composed method's body."** The
actual fix was a plain closure-scoped function (`computeChecksumOf(manifest,
hashFn)`) with no `this` and therefore no class brand for any Proxy layer
to reject — works identically from the constructor or from a dispatched
method. `CPU.js`'s own `#registerInstructions()` was re-checked against
this exact failure mode and confirmed safe: it is called only from its
own constructor, never from any other method, so it never hits a frame
Proxy `this`. This second finding is now folded into the Confidence
dimension's own lesson above, not tracked as a separate row: any future
`#private`-method fix for a construction-order hazard needs the same
"is this ever called from another dispatched method too?" check before
being trusted.

## Scored backlog

| # | Category | Item | Status | F | U | O | N | R | C | **Composite** |
|---|---|---|---|---|---|---|---|---|---|---|
| A.1 | Composition & Dispatch | SecurityMixin (activation-token gating via ExtendX) | ✅ | — | — | — | — | — | — | shipped |
| A.2 | Composition & Dispatch | StructureMixin graph mode (explicit + inferred parent/child/sibling) | ✅ | — | — | — | — | — | — | shipped |
| A.3 | Composition & Dispatch | StructureMixin relational mode + `getConnectedGraph()` (real BFS, not one-hop) | ✅ | — | — | — | — | — | — | shipped |
| A.4 | Composition & Dispatch | `next()`-injection systemic audit (Environment/Registry/ISO/Installer/BootDeviceScan/FileFsBootAdapter) | ✅ | — | — | — | — | — | — | shipped |
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

1. ~~**A.4 — `next()`-injection systemic audit**~~ — **done** (2026-09-12).
   Found and fixed one real gap (`ISO.js`'s constructor self-call, plus a
   second, more general bug the fix itself exposed — see the findings
   note above); documented one real, currently-unreachable gap
   (`Registry.set()`) that isn't cleanly fixable. Five of six audited
   files were already clean. `test/NextInjection.audit.test.js`, 9/9.
2. **B.6 — Memory.js secured/structured/tested** (15) — the last core
   machine component with a proven-pattern latent bug still open. Close
   it before the boot chain it's part of gets wrapped in E.1's closure,
   not after — same closure-visibility reasoning A.4 above was done for.
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

- **1.1.0** — 2026-09-12 — A.4 (`next()`-injection systemic audit) shipped:
  marked ✅, added the findings note (five of six files clean, `Registry.set()`
  documented as a currently-unreachable, not-cleanly-fixable gap) and a
  second finding the audit surfaced beyond its own scope (`ISO.js`'s
  constructor self-call, and why `#private`-method fixes for that shape
  don't generalize to methods called from other composed methods —
  `CPU.js`'s own fix re-checked and confirmed safe). Re-pinned the
  Last-test-run section to the commit that actually shipped this
  (114/114, 8/8 suites, up from 105/105 across 7).
- **1.0.0** — 2026-09-11 — Initial publish: six-dimension rubric
  (Foundation Ready, Unlocks, OS Priority, Novelty, Rarity, Confidence),
  full scored backlog across five categories (Composition & Dispatch,
  Core Machine, Boot & Install, Persistent/Shared Substrate, Outer
  Closure/Runtime), single-subsystem and compositional execution queues
  with explicit dependency/sequencing overrides.
