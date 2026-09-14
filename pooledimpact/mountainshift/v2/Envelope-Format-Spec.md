# The Envelope — Spec & Bindings

## Motivation

This session built three things that look unrelated — `ISO.js` (boot-device
checksum/signature), `Terminal.pdf`/`BuildTerminalPdf.js` (a PDF that's
actually a self-contained OS image), and `TzGz.js` (a tar/gz packer for
classes and files) — and found, by tracing them against each other rather
than assuming, that they're the same contract wearing three different
byte layouts. The specific payload (a boot chain, an app, a game, a
website, a dataset) is arbitrary. What's structural, and worth naming
once instead of re-deriving per format, is the **envelope**: a
self-describing container that separates *what's inside* from *the
contract it presents to whatever's reading it*.

This document names that contract, states which of it is already proven
(shipped, tested, verified live) versus still open, and maps the three
existing artifacts onto it as its first bindings. It does not propose
replacing anything currently shipped — `ISO.js`, `BuildTerminalPdf.js`,
and `pdf-lib` all stay exactly as they are. This is an organizing lens
for future bindings to stay consistent with, not a rewrite mandate.

## The contract

Four clauses. A binding (PDFVaultX, TzGz, ISO, or a future one) satisfies
the envelope contract to the extent it implements each of these —
partial implementation is fine and already the current state (see
Bindings below), but should be named as partial, not assumed complete.

### 1. Manifest — inert, externally inspectable

A declaration of what's inside, its version, and its dependencies,
readable by something that will never execute a single byte of the
payload — a security scanner, a human, `pdf-lib` itself. Today:
`ostore.json` (PDFVaultX), `TzGz.manifest` (name/version/description/
entries/dependencies), `ISO`'s own `_schema.properties`. This layer must
stay JSON-shaped (or equivalently inert) — see clause 4 for why executable
manifests are a *different*, additional layer, not a replacement for this
one.

### 2. Neutral outer contract

Compliance with some real, independently-specified external format so
foreign tools don't choke on the envelope — a PDF viewer, a tar
extractor, `crypto.subtle`'s own key-format expectations. This is
deliberately **not** a security boundary. PDF's Standard Security
Handler (owner/user passwords, permission bitmask — the actual Adobe
spec) belongs here: it governs how *external, non-OS* tools treat the
file, and earns zero trust from the OS's own boot/install chain. The
OS's trust decision is entirely clause 3's job.

### 3. Trust layer, independent of payload

Checksum for integrity, signature for authenticity (`Signature.js`/
`ISO.signManifest()`/`verifyManifestSignature()`, C.1, shipped) — proven
live in `test/Signature.test.js` that a forged hash defeats
integrity-only checking but not a real signature. Independent of clause
1's manifest: the manifest can be freely regenerated (that's the whole
point of `BuildTerminalPdf.js` rebuilding from source instead of
patching bytes), but a *signature* is only ever valid over the exact
bytes it was computed against.

A related, still-open piece: PDF's own **incremental update** mechanism
(ISO 32000) appends a new xref+trailer at the end of a file with
`/Prev` pointing at the previous revision, leaving every earlier byte
untouched — the same append-only-revision-chain idea SQLite's WAL uses
for the same reason (crash-safety there, "append where the power
happens" here). This would let each revision of an app carry its own
signature, with a prior signed revision permanently safe from
invalidation by a later append, since incremental update cannot touch
bytes it doesn't append after.

**Confirmed live, not assumed:** `pdf-lib` (the library
`BuildTerminalPdf.js` depends on) does not implement this.
`PDFWriter.serializeToBuffer()` unconditionally re-serializes the
header, every indirect object, one fresh xref, and one fresh trailer on
every `save()` — a full rewrite, no `/Prev` chain, checked directly
against `node_modules/pdf-lib/cjs/core/writers/PDFWriter.js`. Using
incremental updates for real per-revision signing would mean hand-
writing an appends-only xref/trailer writer alongside `pdf-lib`, not a
`pdf-lib` feature to turn on. Not started. Until it is, each `.pdf`
envelope's trust boundary is "one signature over the whole file as of
the last full rebuild," which is what's actually shipped today and is
not weaker than what existed before this document — just not yet the
sharper per-revision version described above.

### 4. Portable, backend-agnostic IO — and the executable-manifest layer

Import/export against any `fs`-shaped backend: `TzGz.exportToFS()`/
`importFromFS()` against `MemoryFS` or real `fs`; `BuildTerminalPdf.js`'s
attach loop; `ISO`/`Installer`'s existing install path. This is also
where the *second*, executable half of the manifest lives: which
`ExtendX` mixins get composed at load time is a stronger declaration of
"what this envelope actually does" than JSON can express, because
composing `SecurityMixin` doesn't just declare activation-token gating,
it *is* activation-token gating. Deliberately kept as a second, separate
layer from clause 1, not a merge: clause 1 stays inert so the outside
world can inspect an envelope without running anything; this layer only
matters once the OS's own loader is already trusted to execute code, and
should be *declared* in clause 1's JSON (`"boots": [...]`) even though
its real effect only happens here.

**Not yet built:** a defined per-target mixin contract (what a
`MobileUIMixin`/`DesktopUIMixin`/`ServerMixin`/`EmbeddedMixin` may assume
is or isn't already composed beneath it). Without it, swapping mixins
for a new target is "recompose and hope," which is exactly the shape of
the three real `ExtendX` stacking bugs found earlier this session
(`Subclass`/`new.target` forwarding, `dispose()` mask-collapse, the
`_wrapped` Set leak) — composition hiding a gap until actually run, the
whole reason this roadmap's Confidence dimension exists. "Mechanical
per-target UI" is the goal this clause aims at, not the current state.

## Fractal recurrence

The same shape — manifest + trust + portable IO — already exists one
level down, and this repo's own `CLAUDE.md` names it independent of this
document: wrapping a domain object in `BaseClassX` gives it
"fingerprinting, history/trace, and versioning for free." An envelope is
this same contract at the whole-package scale; a `BaseClassX` instance is
it at the single-object scale. Nothing here invents a new pattern —
it names one already load-bearing in this codebase at a different zoom
level, and states it once so a future binding doesn't have to
rediscover it.

## History as an append-only log, not an overwritten field

A single source of truth for "what's inside right now" (satisfied by
clause 1) is not the same requirement as a record of *why* it changed —
the `next()`-injection lesson, the three `ExtendX` stacking bugs, the
`ok`/`bootedFrom` bug caught before shipping — none of that is derivable
by inspecting current code; it has to be recorded once, at the time, and
kept. Any envelope binding that wants to replace a hand-maintained
changelog (this roadmap's own "Last-test-run pinned to a commit hash, so
staleness is at least checkable" convention is itself an admission of
this problem, not a fix for it) needs an **append-only log of revisions**
as part of the envelope, not a "current state" table that gets
overwritten. `TzGz`'s `setVersion()`/manifest-per-pack already point this
direction (each `pack()` is a full snapshot); a real log would keep every
prior snapshot, not just the latest.

## Bindings

| Clause | ISO.js (boot device) | PDFVaultX / `BuildTerminalPdf.js` | TzGz.js |
|---|---|---|---|
| 1. Manifest | `_schema.properties` | `ostore.json` | `TzGz.manifest` |
| 2. Neutral contract | n/a (not externally consumed) | Standard PDF, any viewer | Standard tar+gzip, any extractor |
| 3. Trust | `checksum` + `signManifest()`/`verifyManifestSignature()` — **shipped, tested (C.1)** | One signature over the full rebuilt file — **shipped**; per-revision incremental signing — **not started** | None yet — no `Signature.js` integration |
| 4. Portable IO / executable manifest | N/A — verified by `FileFsBootAdapter`, not self-executing | `pdf-lib` attach/extract — **shipped**; mixin-composition-as-manifest — **not started** | `exportToFS`/`importFromFS` against any `fs`-shaped backend — **shipped**; `_evaluate()` runs imported content via `new Function()`/`vm.runInNewContext` with **zero sandboxing of its own** — must sit behind clause 3's trust check before anything trusts it, never used as its own security boundary |

`TzGz.js` also has one confirmed, unrelated correctness bug independent
of this spec: `_normalizeStructure()`'s bare `Buffer ?` checks (not
`typeof Buffer !== 'undefined'`, unlike its own `_toBuffer()`) throw
`ReferenceError: Buffer is not defined` in any environment without a
`Buffer` global — confirmed live by deleting `global.Buffer` and
re-requiring the module fresh, not assumed from reading. Worth fixing
before `TzGz` is trusted as a binding regardless of this document.

## Explicit non-goals

- Not a mandate to use SQLite anywhere in this codebase. SQLite came up
  as the sharpest illustration of clause 3/4 (one file, versioned,
  queryable) — the actual chosen binding for the universal-legibility
  half of the contract is PDF, specifically because it's renderable by
  any device with zero install, which a bare `.sqlite` file is not.
- Not a replacement for `pdf-lib`, `ISO.js`, or `BuildTerminalPdf.js`.
  Every one of them stays exactly as shipped; this document names what
  they already do and what they don't yet, so a future binding (or a
  future PDF-incremental-update writer, if that gets built) has a
  contract to match instead of being designed from nothing.
- Not a claim that "mechanical per-target UI via mixins" already works.
  It's named here as the goal clause 4's mixin layer aims at, blocked on
  a per-target mixin contract that does not exist yet.
