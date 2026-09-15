# MountainShift OS — Cleanup Roadmap & Prioritization Rubric

**Version:** 1.16.0
**Last updated:** 2026-09-15

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
roadmap's Category C items close gaps in),
`Threads-SABX-Federation-Login-Rubric.md` (Federation as weak-link
references between BaseClassX trees — the conceptual ancestor of this
doc's Category D 'network' boot work), and `Envelope-Format-Spec.md`
(the manifest/trust/portable-IO contract `ISO.js`, `TzGz.js`, and
PDFVaultX/`BuildTerminalPdf.js` all turn out to be bindings of — F.1's
conceptual ancestor, same relationship Threads-SABX has to Category D).

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

**Commit:** `0ae90cd` (git.pooledimpact.com/Claude/Romans, branch
`claude/wasm-shell-experimental` — a merge commit bringing `main`'s
unrelated `research/lib/chain/` changes in clean, zero conflicts,
on top of this branch's own Category G work below; the prior pin
(`f499535`, branch `claude/devtools-overrides-robustness-8we96z`) is
this same account's own prior session, not a different author's work
— see this section's own note on that below.)

| Suite | Result |
|---|---|
| CPU.security.test.js | ALL 15 CHECKS PASSED |
| Physical.security.test.js | ALL 15 CHECKS PASSED |
| PreMixed.hazard.test.js | ALL 9 CHECKS PASSED |
| StructureMixin.test.js | ALL 23 CHECKS PASSED |
| Kernel.security.test.js | ALL 15 CHECKS PASSED |
| BIOS.security.test.js | ALL 12 CHECKS PASSED |
| FullBootChain.lifecycle.test.js | ALL 16 CHECKS PASSED |
| NextInjection.audit.test.js | ALL 12 CHECKS PASSED |
| Memory.security.test.js | ALL 15 CHECKS PASSED |
| MemoryMapArena.test.js | ALL 12 CHECKS PASSED |
| MemoryMapFS.test.js | ALL 17 CHECKS PASSED |
| MemoryMapFS.nodeToNode.test.js | ALL 7 CHECKS PASSED |
| BIOS.nvramFastPath.test.js | ALL 8 CHECKS PASSED |
| ExtendX.stacking.test.js | ALL 16 CHECKS PASSED |
| BIOS.firstBoot.test.js | ALL 10 CHECKS PASSED |
| MountainShift.opaque.test.js | ALL 27 CHECKS PASSED |
| WeightedGraphMixin.test.js | ALL 20 CHECKS PASSED |
| Signature.test.js | ALL 17 CHECKS PASSED |
| BuildTerminalPdf.test.js | ALL 8 CHECKS PASSED |
| DocMeta.test.js | ALL 11 CHECKS PASSED |
| PreflightMixin.test.js | ALL 12 CHECKS PASSED |
| Shell.opaque.test.js | ALL 10 CHECKS PASSED |
| KernelVisibilityMixin.test.js | ALL 4 CHECKS PASSED |
| Shell.wasm.test.js | ALL PASS (demo-output suite by design — see its own header — no numeric check() count; exit 0, every command's real output matched) |
| Curl.wasm.test.js | ALL PASS |
| Spawn.wasm.test.js | ALL PASS |
| Top.wasm.test.js | ALL PASS |
| JobControl.test.js | ALL PASS |

**Total: 311/311 numbered checks passing across 23 check()/report()
suites, plus 5 assert()-style suites (Shell.wasm/Curl.wasm/Spawn.wasm/
Top.wasm/JobControl — Category G's WASM command-engine tier, which
uses Node's own `assert` + `ALL PASS`/thrown-`AssertionError` instead
of this doc's usual `check()`/`report()` harness; both conventions
exist in this repo today and `test/run-all.js` treats them identically
via exit code) — 28/28 suites green.**

**DocMeta.test.js note:** already present and passing on this branch
before today's session touched anything (`git log` shows it landed in
a prior commit); it simply was not yet reflected in this table's
pinned snapshot. Folded in here rather than opened as a separate
finding, since nothing about it needed fixing — this table itself was
just stale.

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
| C.1 | Boot & Install | Checksum → signature upgrade (`ISO.verifyIntegrity()` / `FileFsBootAdapter` sidecar are integrity-only, not authenticity) | ✅ | — | — | — | — | — | — | shipped |
| C.2 | Boot & Install | Registry NVRAM-as-fast-path (`BIOS.boot()` tries a persisted confirmed-entry record before the full scan) | ✅ | — | — | — | — | — | — | shipped |
| C.3 | Boot & Install | `secureBoot` Registry flag enforcement (schema default exists, never read anywhere) | ⬜ | 4 | 1 | 2 | 2 | 2 | 2 | **13** |
| C.4 | Boot & Install | First-boot vs. steady-state distinction (post-install one-time setup path) | ✅ | — | — | — | — | — | — | shipped |
| D.1 | Persistent/Shared Substrate | Land `MemoryMapArena.js` in the repo + wire Registry's NVRAM record through it (today's per-process memory) | ✅ | — | — | — | — | — | — | shipped |
| D.2 | Persistent/Shared Substrate | `'network'` boot device adapter via WebRTC federation (the never-implemented 3rd `bootDeviceOrder` slot) | 🤝 | 1 | 3 | 4 | 5 | 5 | 1 | **19** |
| D.3 | Persistent/Shared Substrate | Node-native WebRTC parity layer (blocks D.2/D.4 entirely) | 🤝 | 1 | 4 | 3 | 3 | 4 | 2 | **17** |
| D.4 | Persistent/Shared Substrate | Transport abstraction beyond WebRTC ("many different types of transports") | 🤝 | 1 | 1 | 1 | 2 | 2 | 3 | **10** |
| E.1 | Outer Closure / Runtime | Opaque closure factory (`MountainShift()`, full-trap Proxy exposing only `run()`) | ✅ | — | — | — | — | — | — | shipped |
| E.2 | Outer Closure / Runtime | Black-box (`run()`-only) integrated test tier | ⬜ | 1 | 2 | 4 | 2 | 2 | 4 | **15** |
| E.3 | Outer Closure / Runtime | DevTools Local Overrides loader (reflection/`CodeComposer`, `CPU.js` ES6 rewrite) | ✅ | — | — | — | — | — | — | shipped |
| F.1 | Reference Artifact Verification | `Terminal.pdf` reference test: real end-to-end OS load, in a real browser, off the actual shipped artifact — not just `BuildTerminalPdf.test.js`'s build/read-back byte check | ⬜ | 3 | 4 | 5 | 3 | 4 | 4 | **23** |
| G.1 | Shell/WASM Command Engine | Zero-import WASM command substrate (`shell.wasm`/`ls.wasm`/`curl.wasm`/`node.wasm`/`php.wasm`/`top.wasm`, fixed-offset request/response blob protocol modeled on `memorymap.wasm`'s own convention) | ✅ | — | — | — | — | — | — | shipped |
| G.2 | Shell/WASM Command Engine | `ShellHost.js` pipeline splitter (Native vs. command-module routing decided in JS before any WASM call, stdin threaded across groups) | ✅ | — | — | — | — | — | — | shipped |
| G.3 | Shell/WASM Command Engine | `curl.wasm` SOCKET delegation (real TCP/TLS opened by the host, HTTP request/response built and parsed entirely in C; `--cookie`/`-b` header support) | ✅ | — | — | — | — | — | — | shipped |
| G.4 | Shell/WASM Command Engine | `node.wasm`/`php.wasm` SPAWN delegation (host-enforced program whitelist, real `child_process`) | ✅ | — | — | — | — | — | — | shipped |
| G.5 | Shell/WASM Command Engine | `JobTable.js`/`ProcessTable.js` job control (`ps`/`jobs`/`fg`/`bg`/`kill`, unifying stateful WASM tick-jobs and real spawned processes under one pid space) | ✅ | — | — | — | — | — | — | shipped |
| G.6 | Shell/WASM Command Engine | `Shell.js` — opaque, `ExtendX`-composable factory over the engine (`MountainShift.js`'s own factory shape, scoped down: no full-trap Proxy layer, no `BaseClassX`, matching `CPU.js`'s "runtime engine, not schema-tracked state" precedent) | ✅ | — | — | — | — | — | — | shipped |
| G.7 | Shell/WASM Command Engine | `PreflightMixin.js` — generalized before/after wrapper mixin factory, formalizing the shape `SecurityMixin.js` already used once | ✅ | — | — | — | — | — | — | shipped |
| G.8 | Shell/WASM Command Engine | `KernelVisibilityMixin.js` — mirrors a Shell background-job start into a real Kernel's `fork()` for unified `ps` listing (listing only, pid spaces deliberately not unified — see G.9) | ✅ | — | — | — | — | — | — | shipped |
| G.9 | Shell/WASM Command Engine | Pid-space unification between Shell's `ProcessTable` and Kernel's process table (real bidirectional `kill()` forwarding, not just listing) | ⬜ | 3 | 3 | 3 | 3 | 4 | 2 | **18** |
| G.10 | Shell/WASM Command Engine | Automatic cross-call cookie jar for `curl.wasm` (session state threaded like `cwd` already is, vs. today's explicit `--cookie` only) | ⬜ | 4 | 2 | 2 | 2 | 1 | 4 | **15** |

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
5. ~~**E.1 — Opaque closure factory**~~ — **done** (2026-09-12).
   `MountainShift.js` composes and boots the already-hardened chain
   (Registry → BIOS → Kernel → Physical → CPU, each with SecurityMixin +
   graph-mode StructureMixin, wired exactly per
   `test/FullBootChain.lifecycle.test.js`) entirely inside the factory
   function's closure, returning an object exposing ONLY `run()` — every
   internal instance lives only as a closure variable (the real opacity
   mechanism), wrapped in a full-trap Proxy over a frozen, null-prototype
   target as deliberate defense-in-depth. `test/MountainShift.opaque.test.js`
   is the first test in this codebase to prove the boot chain works
   WITHOUT `require()`-ing BIOS/Kernel/CPU internals — through the same
   single entry point a real caller would use — 17/17: full introspection
   surface (`Object.keys`/`Reflect.ownKeys`/prototype/`instanceof`/
   `JSON.stringify` all show nothing but `run`), strict-mode tamper
   resistance, a real armed/secured Kernel captured via a test-only
   `onBoot` hook proving the boot is genuine (never reachable through the
   returned object itself), `run()` idempotency, and independence between
   separate calls. **Pre-E.1 finding (2026-09-12, three rounds, all
   resolved before E.1 landed):** `ExtendX.extend()` called on top of an
   already-composed class turned out to hide THREE separate stacking
   bugs, found and fixed one at a time — (1) the `Subclass` constructor
   hardcoded its own closed-over `Subclass` instead of forwarding
   `new.target`, silently dropping the outer layer's prototype entirely;
   (2) stacked `dispose()` only ran the outermost layer's mixin hooks,
   since every layer's wrapper called one conflated method reading the
   outermost class's `_rawMixins`; (3) `installWrappers()`'s `_wrapped`
   Set leaked from the inner layer to the outer via the static prototype
   chain, so an outer mixin sharing a method name with an inner one never
   got its own dispatcher installed — confirmed security-relevant: an
   outer SecurityMixin's guard on a shared method name never actually
   enforced, while `mixins()`/`activeMixins()` still reported it as
   active. See the Changelog for each. None was triggered by any current
   production call site, and `MountainShift.js` itself does not stack
   `extend()` calls (one secured class family per class, composed once,
   matching every other real composition in this codebase) — the audit
   was precautionary, not blocking, but worth doing given E.1 was exactly
   the kind of new code that could have introduced the shape. The
   repeated pattern here — a straightforward-looking helper silently
   trusting inherited/shared state across a shape nobody had exercised
   yet — is folded into this roadmap's Confidence-dimension lesson,
   alongside the original `next()`-injection one.
6. **E.2 — Black-box test tier** (15) — was strictly blocked by E.1
   (F=1); now unblocked. `test/MountainShift.opaque.test.js` already
   covers the opacity/tamper-resistance surface through `run()` alone —
   E.2 would extend that same run()-only discipline into a dedicated,
   ongoing black-box tier for future functional scenarios (multi-process
   fork/tick/kill through `run()` alone, once `run()`'s own surface grows
   past a bare boolean), formalizing the two-tier convention
   test/helpers.js's header comment already anticipates.
7. ~~**C.1 — Checksum → signature upgrade**~~ — **done** (2026-09-14).
   New `Signature.js`: real ECDSA (P-256/SHA-256) sign/verify via the
   standard Web Crypto API (`crypto.subtle`) -- confirmed live that
   Node 22's global `crypto` already is a real, spec-compliant
   implementation, so no hand-rolled crypto and no external dependency.
   Wired in as a strictly additive authenticity layer: `ISO.js` gains
   `signManifest()`/`verifyManifestSignature()` alongside the untouched
   `checksum`/`verifyIntegrity()`; `Installer.js`'s `options.privateKey`
   additionally writes a real `.sig` sidecar alongside the existing
   `.sha` hash sidecar; `FileFsBootAdapter.js`'s `options.publicKey`
   additionally requires a genuine verified signature before confirming
   a boot hit. Zero behavior change for any caller who never supplies a
   key. Proven live in `test/Signature.test.js` (17/17): the actual gap
   closed is that a hash alone can be trivially forged by anyone who
   tampers with content, while a real signature cannot be forged without
   the private key -- both the "old check is fooled" and "new check
   rejects the same tampering" halves confirmed directly, not assumed.
   `test/NextInjection.audit.test.js` gained 3 checks (12/12, up from
   9/9): ISO's two new one-argument methods DO have a next()-injection
   slot when a caller omits the required key, unlike its original
   zero-arg methods -- confirmed safe by a different mechanism than this
   codebase's usual typeof-guard trick, since `crypto.subtle` itself
   throws a clear TypeError on an invalid key rather than silently
   signing/verifying against garbage.
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
10. **F.1 — `Terminal.pdf` reference test** (23, the highest composite of
    any unshipped row on this table) — recipe already proven live this
    session, ad hoc, not yet formalized as a standing test: headless
    Chromium (Playwright) served the real `Terminal.pdf`'s extracted
    `entry.html`/dependencies, booted through `MountainShift()`, and a
    live `ps` at the rendered prompt returned the exact two processes
    `_bootKernel()` forks. Scored high on O (this is literally the
    "full circle" artifact-level proof this session's own C.1 request
    asked for) and C (the hard part — Chromium not honoring
    `HTTPS_PROXY` unlike `curl`, and the proxy relay separately closing
    Chromium's own CONNECT tunnel to `unpkg.com` mid-exchange, worked
    around via `page.route()` interception through Node's own
    proxy-aware `fetch()` — is already solved and documented in the
    1.14.1 changelog entry, not a remaining unknown). What F.1 actually
    is: promote that ad hoc script into `test/Terminal.e2e.test.js` (or
    similar) — extract `Terminal.pdf`'s real embedded attachments via
    `pdf-lib` (not the on-disk source files `BuildTerminalPdf.test.js`
    already covers, so a regression in the PDF-embedding step itself
    would be caught too), serve them, drive the boot through Playwright,
    and assert on a real command's real output — so "does the actual
    shipped artifact still boot" is a standing, automated regression
    check instead of a one-off manual proof that ages the moment the
    next dependency changes.
11. **G.9 — Pid-space unification (Shell ↔ Kernel)** (18) — after F.1:
    `KernelVisibilityMixin.js` already gives unified `ps` LISTING; this
    closes the gap it deliberately left open (kill() only ever hits one
    side today). Scored C=2 on purpose — reconciling a real async
    process's lifecycle (a spawned `node`/`php`, or a WASM tick-job) with
    Kernel's simulated round-robin CPU scheduler's own pid semantics is
    exactly the kind of "sounds like one feature, is actually several
    subsystems agreeing on a shape" risk this table's Confidence lesson
    warns about — do not attempt as a quick patch to either
    `ProcessTable.js` or `Kernel.js` alone.
12. **G.10 — Automatic `curl.wasm` cookie jar** (15) — lower priority
    than its Foundation-Ready score alone suggests (R=1: this is
    commodity behavior, every HTTP client has one) and gated behind
    real need — today's explicit `--cookie`/`-b` already covers the
    Gitea-API-with-Basic-auth case this engine exists for; build this
    only once a real caller actually needs session-cookie continuity
    across separate `curl` invocations, not speculatively.

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

- **1.16.0** — 2026-09-15 — Added **Category G (Shell/WASM Command
  Engine)**: a separate branch's work (`claude/wasm-shell-experimental`,
  PR #22), same account, first tracked in this roadmap here. G.1–G.8
  shipped: the zero-import WASM command substrate (`shell.wasm`/
  `ls.wasm`/`curl.wasm`/`node.wasm`/`php.wasm`/`top.wasm`, the same
  fixed-offset request/response blob shape `memorymap.wasm` already
  established), `ShellHost.js`'s JS-side pipeline splitter, `curl.wasm`'s
  real-socket SOCKET delegation (HTTP built/parsed entirely in C, host
  only ever moves raw bytes) plus `--cookie`/`-b`, `node.wasm`/`php.wasm`'s
  real-`child_process` SPAWN delegation behind a host-enforced whitelist,
  `JobTable.js`/`ProcessTable.js` job control (`ps`/`jobs`/`fg`/`bg`/
  `kill`, both a WASM tick-job and a real spawned process under one pid
  space), `Shell.js` (an opaque `ExtendX`-composable factory over that
  engine, `MountainShift.js`'s own shape scoped down — no full-trap
  Proxy, no `BaseClassX`, matching `CPU.js`'s "runtime engine, not
  domain state" precedent), `PreflightMixin.js` (generalizing
  `SecurityMixin.js`'s own before-calling-`this.super()` shape into a
  reusable `{before, after}` factory), and `KernelVisibilityMixin.js`
  (mirrors a Shell background-job start into a real Kernel's `fork()`
  for unified `ps` listing, pid-space unification deliberately deferred
  as G.9). G.9 (pid-space unification, real bidirectional `kill()`) and
  G.10 (automatic cross-call cookie jar) scored and queued, not shipped.
  **A real Confidence-dimension finding, caught by applying this
  roadmap's own lesson rather than assuming new code was safe by
  analogy:** `PreflightMixin.js`'s `ctx.args` was found to leak
  ExtendX's dispatcher-injected `next()` callback as a trailing element
  — the exact same hazard shape that once corrupted `Kernel.fork()`'s
  `ppid`/`memBytes` and `StructureMixin.linkTo`'s `label` — confirmed
  live (`ctx.args` was `['hello', [Function: next]]`, not `['hello']`)
  before fixing it generically via the wrapped method's declared arity
  (`Function.prototype.length`), with the same documented limit those
  earlier fixes have: it can't rescue a caller OMITTING a real trailing
  argument, only a next() genuinely appended beyond what was passed.
  `test/PreflightMixin.test.js` grew from 11 to 12 checks proving the
  fix. Also: this branch was found to be stale against `main` (an
  unrelated `research/lib/chain/` change) and merged clean, zero
  conflicts, confirmed directly (`git merge --no-commit --no-ff`, byte-
  identical `ExtendX.js`/`SecurityMixin.js` on both sides) rather than
  assumed from the branch names alone. `test/run-all.js` gained 8 new
  entries (`PreflightMixin.test.js`, `Shell.opaque.test.js`,
  `KernelVisibilityMixin.test.js`, `Shell.wasm.test.js`,
  `Curl.wasm.test.js`, `Spawn.wasm.test.js`, `Top.wasm.test.js`,
  `JobControl.test.js`) and `DocMeta.test.js` (already present,
  previously just missing from this table's stale snapshot) was folded
  into the published count too. Re-pinned the Last-test-run section to
  `0ae90cd` on `claude/wasm-shell-experimental` (311/311 numbered checks
  across 23 suites, plus 5 green assert()-style suites — 28/28 suites
  total, up from 19/19).
- **1.15.1** — 2026-09-14 — Added `Envelope-Format-Spec.md`: the
  manifest/trust/portable-IO contract underneath F.1, written up as its
  own doc rather than folded into this table, since it's prior art
  spanning three artifacts (`ISO.js`, `TzGz.js`, PDFVaultX) rather than
  a single scored backlog item. Doc-only, no code. Confirms live (not
  assumed) that `pdf-lib`'s writer always fully rewrites the PDF on
  `save()` — no incremental-update `/Prev` chain support — and that
  `TzGz.js`'s `_normalizeStructure()` has a real bare-`Buffer`-reference
  bug that throws in any environment without a `Buffer` global, checked
  by deleting `global.Buffer` and re-requiring the module fresh. Cross-
  referenced from this doc's "Related prior art" list, same relationship
  `Threads-SABX-Federation-Login-Rubric.md` has to Category D.
- **1.15.0** — 2026-09-14 — Added **F.1** (new category: Reference
  Artifact Verification) to the Scored backlog: formalize the
  `Terminal.pdf` end-to-end browser boot proof done ad hoc in 1.14.1
  into a standing, automated test — extract the real shipped PDF's
  embedded attachments (not the on-disk source files
  `BuildTerminalPdf.test.js` already covers), serve them, drive a real
  headless-browser boot via Playwright, assert on a real command's
  real output. Composite **23** — the highest of any unshipped row on
  this table, scored high on O (this is the literal "full circle"
  artifact-level proof this session's own C.1 request asked for) and C
  (the hard part, the Chromium/proxy workaround, is already solved and
  documented, not a remaining unknown). No re-pin of Last-test-run —
  no code shipped this entry, backlog/doc only.
- **1.14.1** — 2026-09-14 — Closed the browser-verification gap 1.14.0
  disclosed as unresolved: `unpkg.com` turned out to be reachable from
  this sandbox after all (confirmed via `curl`) — the earlier
  `net::ERR_CONNECTION_RESET` was Chromium's own network stack not
  honoring `HTTPS_PROXY` (unlike `curl`, which reads it automatically),
  compounded by the proxy relay independently closing Chromium's
  CONNECT tunnel to `unpkg.com` mid-exchange. Worked around by routing
  that one external fetch through Node's own proxy-aware `fetch()` via
  Playwright's `page.route()` interception instead of fighting
  Chromium's tunnel. With that in place, `Terminal.entry.html` was
  confirmed booting for real in headless Chromium — the DC-runtime UI
  rendered, and running `ps` at the live prompt returned exactly the
  two real processes the new `MountainShift()`-wired `_bootKernel()`
  forks (`1 root kernel.js`, `2 root bsh`). See the 1.14.0 entry below,
  now updated in place to record this as confirmed rather than
  disclosed-as-unverified.
- **1.14.0** — 2026-09-14 — Wired `MountainShift()` (E.1's opaque
  closure factory) into the Terminal's actual boot path, and rebuilt
  `Terminal.pdf` from current repo source — "full circle" on the C.1
  test request: prove the hardening via a real, freshly-built artifact,
  not just unit tests. Three pieces:
  - `MountainShift.js` → v1.1.0: `run()` now resolves a small, frozen
    capability object (`fork`/`kill`/`tick`/`ps`/`getMemory`/`cores`/
    `bootedFrom`/`ok`) bound over the real secured Kernel, instead of a
    bare boolean — the exact minimal surface the Terminal needs,
    determined by grepping `PosixCommands.js`/`Procd.js`'s actual
    `system.kernel.*`/`_attachedKernel.*` call sites rather than
    guessed. Caught and fixed a real bug before it shipped: an early
    draft gated `ok` on `bootedFrom !== 'none'`, which would have
    reported failure on the Terminal's own real deployment shape (no
    fs/iso configured) even though `BIOS.boot()` always hands back a
    fully working Kernel regardless of `bootedFrom` — confirmed live by
    tracing the actual call path. `ok` now means "`run()` got a kernel
    back"; a genuine failure inside `boot()` still propagates as an
    ordinary rejected promise, matching this codebase's error-handling
    convention everywhere else. `test/MountainShift.opaque.test.js`
    grew from 17 to 27 checks covering the capability object's exact
    shape, frozen tamper-resistance, real fork/ps/kill/tick dispatch
    through the actual Kernel, repeat-call identity/idempotency, the
    corrected nothing-bootable-is-not-a-failure behavior, and the
    genuine-failure-rejects-run() case.
  - `Terminal.entry.html` rewritten: `_bootKernel()` now calls
    `MountainShift({...}).run()` and drives Procd/the shell off the
    returned capability object, instead of touching BIOS/Kernel
    internals directly — the Terminal gets the real secured/armed boot
    chain, not just the hardened library files sitting alongside old
    unsecured boot logic. `<helmet>` script order updated to load
    `ExtendX.js`/`SecurityMixin.js`/`StructureMixin.js`/`Registry.js`/
    `MountainShift.js` alongside the existing dependencies.
  - `BuildTerminalPdf.js` (new): reverse-engineered the prior
    Terminal.pdf's format via direct binary forensics on its raw bytes
    (its own `/Producer` metadata plus its `/Names/EmbeddedFiles` +
    `/AF` catalog structure) — it is a standard `pdf-lib`
    file-attachment container, not a custom format. This script
    re-derives that same container from current repo source on every
    run, so `Terminal.pdf` is always exactly what `Terminal.entry.html`
    and its dependency list say it is. `test/BuildTerminalPdf.test.js`
    (8/8) proves this via a real build-and-read-back round trip:
    every embedded file inflated and compared byte-for-byte against
    its source on disk, plus a scratch-copy check proving the build
    reads live content, not a stale cache.
  - **Known limitation, disclosed rather than silently skipped (see
    the 1.14.1 entry above — resolved the same day, this entry is left
    exactly as originally written for the historical record):** full
    browser-rendered verification of the DC-runtime-compiled Terminal
    UI (does it actually boot and accept commands in a live browser)
    was not achievable in this sandbox — `support.js` (pre-existing,
    unmodified this round) fetches React from `unpkg.com` at runtime,
    and this sandbox's network policy does not reach that host; no
    vendored local copy of React exists anywhere in this repo to
    substitute. What WAS verified: all Node-level `MountainShift.js`/
    `Kernel.js` boot-chain logic (274/274 across 19 suites), a
    byte-for-byte-verified rebuild of the actual shipped PDF, and
    manual review of the `entry.html` diff confirming it only touches
    the six real call sites grepped from `PosixCommands.js`/
    `Procd.js`. Re-pinned the Last-test-run section to `f499535`
    (274/274, up from 256/256 across 18, now 19/19 suites).
- **1.13.0** — 2026-09-14 — C.1 (checksum → signature upgrade) shipped:
  new `Signature.js` (real ECDSA P-256/SHA-256 via `crypto.subtle`, no
  hand-rolled crypto, no external dependency) wired in as a strictly
  additive authenticity layer over `ISO.js`'s existing checksum,
  `Installer.js`'s existing `.sha` sidecar, and `FileFsBootAdapter.js`'s
  existing hash check — zero behavior change for any caller who never
  supplies a key. Proven live in `test/Signature.test.js` (17/17) that a
  forged hash defeats the old check but not the new one. Also audited (3
  new checks in `test/NextInjection.audit.test.js`, 12/12): ISO's two new
  one-argument methods are safe against the next()-injection hazard by a
  different mechanism than usual — `crypto.subtle` itself rejects an
  invalid key with a clear TypeError. Re-pinned the Last-test-run section
  to `83e9279` (256/256, up from 236/236 across 17, now 18/18 suites).
- **1.12.0** — 2026-09-13 — Added `WeightedGraphMixin.js` (outside the
  A-E backlog, a direct addition): weighted (number or a
  `(source, target) => number` function, resolved lazily) and directed/
  undirected graph edges, plus `walk()` — bounded, decision-driven
  multi-hop traversal with a seeded-PRNG (mulberry32) default pick, an
  optional `decide()` callback for custom or fan-out routing, `onVisit`,
  `avoidRevisit`, and parallel/sequential concurrency — a sibling to
  `StructureMixin`'s relational mode, not a modification of it. Supplied
  already matching this codebase's Allman/docblock/static-metadata house
  style; only header paths and the UMD browser-global branch were
  adjusted to this project's actual flat layout. Audited for the
  next()-injection hazard on `linkTo()`/`walk()`'s optional trailing
  `options` (the recurring shape from A.4's systemic audit) and confirmed
  ACCIDENTALLY SAFE, the same way `Registry.save()`'s omitted options
  already is — every downstream field read is guarded by a
  `typeof`/`===`/`in` check, so the injected `next()` callback landing in
  the options slot still resolves to the same safe defaults.
  `test/WeightedGraphMixin.test.js`, 20/20 (a promise-passed-to-check()
  mistake in the first draft was caught and fixed before committing, per
  this project's own documented convention). Re-pinned the Last-test-run
  section to `91547c0` (236/236, up from 216/216 across 16, now 17/17
  suites).
- **1.11.0** — 2026-09-12 — E.1 (opaque closure factory) shipped:
  `MountainShift.js` composes and boots the already-hardened chain
  (Registry/BIOS/Kernel/Physical/CPU, each secured + graph-structured,
  wired exactly per `test/FullBootChain.lifecycle.test.js`) entirely
  inside its own closure, returning an object exposing ONLY `run()` — a
  full-trap Proxy over a frozen, null-prototype target as defense-in-depth
  on top of the real opacity mechanism (a plain closure variable is
  fundamentally unreachable from outside). `test/MountainShift.opaque.test.js`
  is this codebase's first test to prove the boot chain works without
  `require()`-ing internals — 17/17: introspection-surface proof, strict-
  mode tamper resistance, a genuine boot verified via a test-only `onBoot`
  hook never reachable through the returned object, `run()` idempotency,
  and call independence. Re-pinned the Last-test-run section to `6a0b4fb`
  (216/216, up from 199/199 across 15, now 16/16 suites).
- **1.10.0** — 2026-09-12 — Third ExtendX stacking bug found and fixed
  (pre-E.1): `installWrappers()`'s `Subclass._wrapped || (Subclass._wrapped
  = new Set())` did not check for an OWN property, so a stacked Outer's
  `_wrapped` lookup silently resolved up the static prototype chain
  (`Object.setPrototypeOf(Subclass, BaseClass)`) to Inner's already-
  populated Set. Any method name Inner already wrapped was then treated
  as "already installed" for Outer too, so Outer never got its own
  dispatcher for that name — confirmed security-relevant: an outer
  SecurityMixin's guard on a shared method name never actually enforced,
  reaching the inner, unguarded implementation directly, while
  `mixins()`/`activeMixins()` still reported it as active (those read
  `_rawMixins`/`_resolvePipeline`, never `_wrapped`). Fixed by checking
  `Object.prototype.hasOwnProperty.call(Subclass, '_wrapped')` instead of
  bare truthiness. `ExtendX.js` bumped to 1.6.0 with its own itemized
  version-history entry. `test/ExtendX.stacking.test.js` gained four
  checks (16/16, up from 12/12). Re-pinned the Last-test-run section to
  `d2f3aa7` (199/199, up from 195/195 across 15, still 15/15 suites).
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
