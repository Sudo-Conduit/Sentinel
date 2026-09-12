# MountainShift OS — Cleanup Roadmap & Prioritization Rubric

**Version:** 1.9.0
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

**Commit:** `c218f0f` (git.pooledimpact.com/Claude/Romans, branch
`claude/devtools-overrides-robustness-8we96z`)

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
| Memory.security.test.js | ALL 15 CHECKS PASSED |
| MemoryMapArena.test.js | ALL 12 CHECKS PASSED |
| MemoryMapFS.test.js | ALL 17 CHECKS PASSED |
| MemoryMapFS.nodeToNode.test.js | ALL 7 CHECKS PASSED |
| BIOS.nvramFastPath.test.js | ALL 8 CHECKS PASSED |
| ExtendX.stacking.test.js | ALL 12 CHECKS PASSED |
| BIOS.firstBoot.test.js | ALL 10 CHECKS PASSED |

**Total: 195/195 checks passing, 15/15 suites green.**

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

**D.1 findings (2026-09-12):** the item as originally scoped ("land
`MemoryMapFS.js`") assumed the wrong API. `MemoryMapFS.js` was a verbatim
reference implementation documenting a richer `mm_create()`/`mm_auth()`/
`mm_kvStore()` multi-mailbox API with chain-linking and bitmap allocation —
but that API was never actually compiled into this repo's `memorymap.wasm`.
Confirmed live, not assumed: `WebAssembly.Module.imports()`/`.exports()`
against the real binary show a single-flat-arena API (`getUUID`/
`getPublicKey`/`getAuthScratch`/`authenticate`/`deauthenticate`/`read`/
`write`/`getMemoryMap`/`getBase`/`slotBase`/`maxSlots`/`totalPages`/
`offsetA`/`B`/`C`/`pagesNeeded`) and a full `wasi_snapshot_preview1` import
surface (a standard `wasm32-wasi` build, not freestanding) — an md5sum
match against a copy the user separately supplied confirmed the repo's
`.wasm` is current, not stale; the richer API exists in one of ~23
historical build versions but chasing it down was explicitly declined.
`MemoryMapFS.js` was deleted (never committed) and replaced with
`MemoryMapArena.js`, a fresh wrapper written against the API the binary
actually exports, following the binding pattern demonstrated in the
user-supplied `MemoryMap-Manager.dc.html` reference: every WASM import
(WASI included) is satisfied generically from `WebAssembly.Module.imports()`
— function imports stub to `() => 0`, memory/table/global imports get real
`WebAssembly.Memory`/`Table`/`Global` instances — since none of this
module's real behavior (identity, auth, slot read/write) exercises actual
syscalls, so no real WASI polyfill is needed. `packBytes()`/`unpackBytes()`
use a length-header-first binary codec (the real byte count written as its
own slot, then 3 bytes/slot after it) rather than an in-band tail marker,
matching the already-proven-safe convention in `Installer.js`/
`FileFsBootAdapter.js` — the original `MemoryMap-Manager.dc.html`'s own
comments documented the in-band alternative as fragile (a real byte that
happens to match the marker corrupts unpacking). `Registry.js` gained
`saveToArena(arena, startSlot)`/`static loadFromArena(arena, startSlot)` as
an additive NVRAM path alongside the existing FileFsX-backed `save()`/
`load()` — not a replacement — closing the Node/Browser split every
FileFsX backend has (IDB/OPFS/Cache/localStorage are browser-only, real
`fs` needs a user gesture); a capability-gated WASM arena instantiates
identically in both runtimes. Today's arena is per-process memory only —
real cross-restart persistence is a host-layer decision about what backs
the arena's linear memory, deliberately out of scope here. Proven via
`test/MemoryMapArena.test.js` against the real `memorymap.wasm`, not
reasoning alone: init, pre-authenticate rejection, wrong/correct-key auth,
raw slot read/write, byte-packing round-trips (plain ASCII, multi-byte
UTF-8, a non-multiple-of-3-length edge case), a full `Registry` round-trip
through the arena, `loadFromArena()`'s fallback-to-default on an untouched
slot range, `saveToArena()` correctly throwing pre-authentication, and
`deauthenticate()` actually revoking write access — 12/12.

**D.1 addendum (2026-09-12): the richer `mm_*` binary was found.** After
the above was already shipped, a further historical `memorymap.wasm`
build was supplied and checked the same way — not assumed correct, live
via `WebAssembly.Module.exports()` — and this one really does export the
full `mm_*` surface `MemoryMapFS.js`'s original reference implementation
was written against: `mm_init`/`mm_create`/`mm_destroy`/`mm_rotateKeys`/
`mm_chainLink`/`mm_auth`/`mm_readSlot`/`mm_writeSlot`/`mm_status`/
`mm_kvStore`/`mm_kvLookup`/`mm_kvDelete`/`mm_chainNext`/`mm_chainFind`/
`mm_findFreeSlot`/`mm_markOccupied`/`mm_markFree`/`mm_isOccupied`, plus
GC/transaction machinery not yet wrapped. It imports only a single shared
`env.memory` — no WASI surface at all, unlike the other binary. Landed as
`memorymap-mm.wasm` (a distinct compiled module, not a replacement of the
existing `memorymap.wasm`), with `MemoryMapFS.js` authored fresh in this
session's house style against it and proven end-to-end in
`test/MemoryMapFS.test.js` before being trusted: mailbox create, wrong/
correct access-key auth, raw slot read/write (including the 20-byte
inline-blob limit), bitmap free-slot tracking, key-value store/lookup/
delete, mailbox chain link/next/find, key rotation, and destroy/
double-destroy rejection — 17/17. This is a second, independent NVRAM
path alongside `MemoryMapArena.js`, not a replacement — `Registry.js`'s
`saveToArena()`/`loadFromArena()` stay wired to `MemoryMapArena` exactly
as shipped above; nothing about that wiring changed.

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
| B.6 | Core Machine | Memory.js secured + structured + tested (latent `_backing` WeakMap-by-`this` bug, same class as B.2/B.3's) | ✅ | — | — | — | — | — | — | shipped |
| C.1 | Boot & Install | Checksum → signature upgrade (`ISO.verifyIntegrity()` / `FileFsBootAdapter` sidecar are integrity-only, not authenticity) | ⬜ | 2 | 3 | 2 | 3 | 3 | 3 | **16** |
| C.2 | Boot & Install | Registry NVRAM-as-fast-path (`BIOS.boot()` tries a persisted confirmed-entry record before the full scan) | ✅ | — | — | — | — | — | — | shipped |
| C.3 | Boot & Install | `secureBoot` Registry flag enforcement (schema default exists, never read anywhere) | ⬜ | 4 | 1 | 2 | 2 | 2 | 2 | **13** |
| C.4 | Boot & Install | First-boot vs. steady-state distinction (post-install one-time setup path) | ✅ | — | — | — | — | — | — | shipped |
| D.1 | Persistent/Shared Substrate | Land `MemoryMapArena.js` in the repo + wire Registry's NVRAM record through it (today's per-process memory) | ✅ | — | — | — | — | — | — | shipped |
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
2. ~~**B.6 — Memory.js secured/structured/tested**~~ — **done**
   (2026-09-12). Fixed the same `_backing` WeakMap-by-`this` bug class as
   `Physical`/`Kernel`, plus two `next()`-injection hazards (`attach(cpu)`,
   `alloc(..., label)`) found the same way. Scope stayed deliberately
   narrow, per direct instruction: this hardens `Memory.js` itself so it's
   *safe* to compose whenever needed, but does **not** change how Memory
   is actually used (Kernel/Physical's call patterns) — that waits for the
   Terminal 2.0 reference implementation. `test/Memory.security.test.js`,
   15/15.
3. ~~**D.1 — MemoryMapArena as Registry's NVRAM backend**~~ — **done**
   (2026-09-12). Original scope named the wrong file/API (`MemoryMapFS.js`'s
   `mm_*` multi-mailbox surface was never actually compiled into
   `memorymap.wasm`) — see the findings note above. Landed
   `MemoryMapArena.js` against the real single-arena API, plus
   `Registry.saveToArena()`/`loadFromArena()`. `test/MemoryMapArena.test.js`,
   12/12.
4. ~~**C.2 — Registry NVRAM-as-fast-path**~~ — **done** (2026-09-12).
   `BIOS.boot()` tries the last-confirmed device first (via an attached
   Registry's `confirmedBootEntry` record) through the SAME real
   `fs.findBootEntry()` verification the full scan uses — a scan-order
   optimization, not a trust shortcut. Guarded two ways: the confirmed
   device is only tried while still present in the current
   `bootDeviceOrder` (so editing boot policy overrides a stale record
   instead of being bypassed by it), and only a real, `confirmed: true`
   entry ever gets persisted (an unconfirmed raw `BootDeviceScan` hit
   never does). `test/BIOS.nvramFastPath.test.js`, 8/8, against a real
   `Registry.js` instance, not a mock.
5. **E.1 — Opaque closure factory** (23) — deliberately *after* 1-4: it
   should wrap a boot chain already audited and hardened, not one with
   known-latent gaps still underneath it. **Pre-E.1 finding (2026-09-12,
   fully resolved):** `ExtendX.extend()` called on top of an already-
   composed class silently dropped the outer layer (a real bug — the
   `Subclass` constructor hardcoded its own closed-over `Subclass` instead
   of forwarding `new.target`); fixed, and a second, related dispose()-
   chain gap found alongside it (stacked `dispose()` only ran the
   outermost layer's mixin hooks) is now fixed too — see the Changelog.
   Neither bug was triggered by any current production call site (every
   real composition passes every mixin to one `extend()` call), but E.1's
   closure factory is exactly the kind of code that could have introduced
   a stacked-composition shape, so both are closed out before E.1 lands.
6. **E.2 — Black-box test tier** (15) — strictly blocked by E.1 (F=1);
   its position here is sequencing, not priority.
7. **C.1 — Checksum → signature upgrade** (16)
8. ~~**C.4 — First-boot vs. steady-state distinction**~~ — **done**
   (2026-09-12). A successful boot with no persisted `firstBootComplete`
   Registry flag runs one-time post-install setup (minting a persistent
   `machineId`, only if one isn't already recorded) exactly once, then
   marks the Registry so later boots take the steady-state path. A
   failed boot (nothing bootable found) never marks setup complete, so
   the next real successful boot still gets to run it; a pre-existing
   `machineId` from a partial prior run is never regenerated. No Registry
   attached means every boot looks like a first boot, matching real
   hardware with no battery-backed NVRAM. `Registry.js` gained
   `firstBootComplete: false` in its default entries (bumped to 1.2.0);
   `BIOS.js` bumped to 1.2.0. `test/BIOS.firstBoot.test.js`, 10/10,
   against a real `Registry.js` instance.
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

- **1.9.0** — 2026-09-12 — C.4 (first-boot vs. steady-state distinction)
  shipped: `BIOS.boot()` now runs one-time post-install setup (minting a
  persistent `machineId`) exactly once, gated by a new `firstBootComplete`
  Registry flag, with guards for a failed first boot (never marks setup
  complete) and a partial prior run (never regenerates an existing
  `machineId`). `Registry.js` and `BIOS.js` both bumped to 1.2.0.
  `test/BIOS.firstBoot.test.js`, 10/10, against a real `Registry.js`
  instance. Re-pinned the Last-test-run section to `c218f0f` (195/195, up
  from 185/185 across 14, now 15/15 suites).
- **1.8.0** — 2026-09-12 — Pre-E.1 finding fully resolved: the stacked-
  dispose()-chain gap documented in 1.7.0 is fixed. Split the single
  conflated `ExtendX.prototype.dispose()`/`disposeAsync()` into
  `finalizeDisposeBookkeeping()` (once-only whole-instance state, safe to
  call from every stacked layer) and `runLayerDisposeHooks()`/`Async()`
  (each layer's own closed-over mixins list, deduped per mixinId instead
  of gated by one whole-instance flag) — so a stacked instance's inner
  layer's mixin hook now actually runs, and a repeat top-level `dispose()`
  call still never re-runs any hook twice. `ExtendX.js` bumped to 1.5.0
  with its own itemized version-history entry.
  `test/ExtendX.stacking.test.js` updated from documenting the known gap
  to asserting the fix, plus new async and repeat-call-idempotency checks
  (12/12, up from 10/10). Re-pinned the Last-test-run section to
  `8c87074` (185/185, up from 183/183 across 14, still 14/14 suites).
- **1.7.0** — 2026-09-12 — Pre-E.1 finding: `ExtendX.extend()` stacking
  (composing on top of an already-composed class) silently dropped the
  outer layer entirely — the `Subclass` constructor hardcoded its own
  closed-over `Subclass` into `Reflect.construct(BaseClass, args,
  Subclass)` instead of forwarding `new.target`, so a nested composed
  class's constructor never actually reached the outer class's prototype.
  Fixed; `ExtendX.js` bumped to 1.4.0. A related dispose()-chain gap
  (stacked `dispose()` only running the outermost layer's mixin hooks)
  was found alongside it and documented as a known, not-yet-fixed gap in
  `test/ExtendX.stacking.test.js` (10/10). Neither bug is triggered by any
  current production call site. Re-pinned the Last-test-run section to
  `5cda3ee` (183/183, up from 173/173 across 13, now 14/14 suites).
- **1.6.0** — 2026-09-12 — C.2 (Registry NVRAM-as-fast-path) shipped:
  `BIOS.boot()` tries the last-confirmed device first via an attached
  Registry's `confirmedBootEntry` record, through the same real
  `fs.findBootEntry()` verification the full scan uses — a scan-order
  optimization, not a trust shortcut. Guarded against both a stale record
  bypassing edited `bootDeviceOrder` policy and an unconfirmed raw
  `BootDeviceScan` hit being cached as if it were verified. `BIOS.js`
  bumped to 1.1.0 with itemized version history.
  `test/BIOS.nvramFastPath.test.js`, 8/8, against a real `Registry.js`
  instance. Re-pinned the Last-test-run section to `159c061` (173/173, up
  from 165/165 across 12, now 13/13 suites).
- **1.5.0** — 2026-09-12 — D.1 addendum: added
  `test/MemoryMapFS.nodeToNode.test.js`, proving via `worker_threads`
  (the only mechanism that actually shares live memory in Node) that
  `MemoryMapFS.js`'s shared `WebAssembly.Memory` really crosses two
  independent Node execution contexts — a mailbox created/authenticated/
  written in the main thread is immediately visible through a second,
  independent `WebAssembly.Instance` in a worker thread, a second
  `init()` against an already-live shared arena doesn't corrupt it, and
  the worker's own write is visible back in the main thread afterward.
  A separate OS process (`child_process`) does NOT share memory this way
  — that remains the documented "per-process memory only" limit, not
  something this test claims to close. 7/7 checks, stable across repeated
  runs; added to `test/run-all.js`/`test/GenerateTestReport.js`. Re-pinned
  the Last-test-run section to `dec16ea` (165/165, up from 158/158 across
  11, now 12/12 suites).
- **1.4.0** — 2026-09-12 — D.1 addendum: the historical `mm_*`-API
  `memorymap.wasm` build named in the original scope was actually found
  and confirmed live (`WebAssembly.Module.exports()`) — landed as
  `memorymap-mm.wasm` + `MemoryMapFS.js`, a second, independent NVRAM path
  alongside `MemoryMapArena.js` (not a replacement; `Registry.js` stays
  wired to `MemoryMapArena`). `test/MemoryMapFS.test.js`, 17/17, added to
  `test/run-all.js`/`test/GenerateTestReport.js`. Re-pinned the
  Last-test-run section to `18f8077` (158/158, up from 141/141 across 10,
  now 11/11 suites).
- **1.3.0** — 2026-09-12 — D.1 (`MemoryMapArena.js` landed, Registry's
  NVRAM record wired through it) shipped: marked ✅, added the findings
  note documenting the original-scope API mismatch (`MemoryMapFS.js`'s
  `mm_*` multi-mailbox surface was never actually compiled into
  `memorymap.wasm`, confirmed live via `WebAssembly.Module.imports()`/
  `.exports()`) and the resolution (a fresh `MemoryMapArena.js` against the
  real single-arena API, plus `Registry.saveToArena()`/`loadFromArena()`
  as an additive NVRAM path). `test/MemoryMapArena.test.js`, 12/12, added
  to `test/run-all.js`. Re-pinned the Last-test-run section to `825cea6`
  (141/141, up from 129/129 across 9, now 10/10 suites).
- **1.2.0** — 2026-09-12 — B.6 (Memory.js secured/structured/tested)
  shipped: marked ✅, same `_backing` WeakMap-by-`this` fix as `Physical`/
  `Kernel`, plus two `next()`-injection hazards (`attach(cpu)`,
  `alloc(..., label)`). Scope deliberately narrow per direct instruction —
  hardens the class itself, does not change how Memory is used until the
  Terminal 2.0 reference implementation lands. Re-pinned the Last-test-run
  section to `e6674af` (129/129, up from 114/114 across 8).
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
