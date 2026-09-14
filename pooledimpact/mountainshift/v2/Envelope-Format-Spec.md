# The Envelope — Spec & Bindings

## Motivation

`ISO.js` (boot-device checksum/signature), `Terminal.pdf`/
`BuildTerminalPdf.js` (a PDF that is a self-contained OS image), and
`TzGz.js` (a tar/gz packer for classes and files) are three unrelated-
looking mechanisms that reduce to the same contract in three different
byte layouts. The specific payload — a boot chain, an app, a game, a
website, a dataset — is arbitrary. What is structural, and worth naming
once instead of re-deriving per format, is the **envelope**: a
self-describing container that separates *what is inside* from *the
contract it presents to whatever is reading it*.

This document names that contract and maps `ISO.js`, `BuildTerminalPdf.js`
(PDFVaultX), and `TzGz.js` onto it as its three bindings. It does not
replace any of them — `ISO.js`, `BuildTerminalPdf.js`, and `pdf-lib`
remain exactly as shipped. This is an organizing reference future
bindings are expected to stay consistent with, not a rewrite mandate.

## The contract

Four clauses. A binding satisfies the envelope contract to the extent it
implements each of these. Partial implementation is normal and is stated
per binding in the table below — a clause a binding does not implement
is a property of that binding, not an error in this document.

### 1. Manifest — inert, externally inspectable

A declaration of what is inside, its version, and its dependencies,
readable by something that never executes a single byte of the payload —
a security scanner, a human, `pdf-lib` itself. Bindings:
`ostore.json` (PDFVaultX), `TzGz.manifest` (name/version/description/
entries/dependencies), `ISO`'s own `_schema.properties`. This layer is
JSON-shaped (or equivalently inert) by requirement — see clause 4 for the
executable manifest layer, which is additional, not a replacement.

### 2. Neutral outer contract

Compliance with a real, independently specified external format so
foreign tools handle the envelope correctly — a PDF viewer, a tar
extractor, `crypto.subtle`'s own key-format expectations. This is
explicitly **not** a security boundary. PDF's Standard Security Handler
(owner/user passwords, permission bitmask — the Adobe spec) belongs
here: it governs how external, non-OS tools treat the file and earns no
trust from the OS's own boot/install chain. The OS's trust decision is
entirely clause 3.

### 3. Trust layer, independent of payload

Checksum for integrity, signature for authenticity
(`Signature.js`/`ISO.signManifest()`/`verifyManifestSignature()`).
Independent of clause 1's manifest: the manifest can be freely
regenerated (`BuildTerminalPdf.js` rebuilds from source rather than
patching bytes), but a signature is valid only over the exact bytes it
was computed against.

A further mechanism belongs here: PDF's own **incremental update**
(ISO 32000) appends a new xref+trailer at the end of a file with `/Prev`
pointing at the previous revision, leaving every earlier byte untouched
— the same append-only revision chain SQLite's WAL uses for the same
reason (crash-safety there; here, a place to append new state without
touching what came before). Under this mechanism each revision of an
envelope can carry its own signature, and a prior signed revision stays
verifiable indefinitely: an append cannot alter bytes it appends after.

`pdf-lib`, the library `BuildTerminalPdf.js` depends on, does not
implement incremental update. `PDFWriter.serializeToBuffer()`
unconditionally re-serializes the header, every indirect object, one
fresh xref, and one fresh trailer on every `save()` call (source:
`node_modules/pdf-lib/cjs/core/writers/PDFWriter.js`) — a full rewrite,
with no `/Prev` chain. Per-revision incremental signing therefore
requires an appends-only xref/trailer writer alongside `pdf-lib`, not a
`pdf-lib` configuration option. Absent that writer, a `.pdf` envelope's
trust boundary is one signature over the whole file as of its last
rebuild.

### 4. Portable, backend-agnostic IO — and the executable-manifest layer

Import/export against any `fs`-shaped backend: `TzGz.exportToFS()`/
`importFromFS()` against `MemoryFS` or real `fs`; `BuildTerminalPdf.js`'s
attach loop; `ISO`/`Installer`'s install path. This is also where the
second, executable half of the manifest lives: the set of `ExtendX`
mixins composed at load time is a stronger declaration of what an
envelope does than JSON can express, because composing `SecurityMixin`
does not merely declare activation-token gating — it is activation-token
gating. This layer is kept separate from clause 1, not merged into it:
clause 1 stays inert so the envelope can be inspected from outside
without executing anything; this layer applies once the OS's own loader
already trusts the code it is about to run, and its intent should still
be declared in clause 1's JSON (`"boots": [...]`) even though its effect
belongs here.

A per-target mixin contract — the rules a `MobileUIMixin`/
`DesktopUIMixin`/`ServerMixin`/`EmbeddedMixin` must follow about what it
may assume is or is not already composed beneath it — is a prerequisite
for swapping mixins by target being mechanical rather than "recompose
and hope." Without that contract, mixin swapping carries the same risk
class as `ExtendX`'s stacking hazards (constructor `new.target`
forwarding, `dispose()` mask-collapse, the `_wrapped` Set leak): a
straightforward-looking composition silently trusting shared state
across a shape no caller exercises.

## Fractal recurrence

The same shape — manifest + trust + portable IO — exists one level down
already, independent of this document: `CLAUDE.md` records that wrapping
a domain object in `BaseClassX` gives it "fingerprinting, history/trace,
and versioning for free." An envelope is this same contract at the
whole-package scale; a `BaseClassX` instance is it at the single-object
scale. This document names a pattern already load-bearing in this
codebase at a different scale, rather than introducing a new one.

## History as an append-only log, not an overwritten field

A single source of truth for what is inside right now (clause 1) is a
different requirement from a record of why it changed — the
`next()`-injection lesson, the `ExtendX` stacking bugs, the
`ok`/`bootedFrom` correction in `MountainShift.js` are not derivable by
inspecting current code; each has to be recorded at the time it is
learned and kept. An envelope binding that stands in for a hand-
maintained changelog needs an **append-only log of revisions**, not a
"current state" table that gets overwritten — `MSOS-Cleanup-Roadmap.md`'s
own "Last-test-run pinned to a commit hash" convention is a workaround
for the absence of such a log, not an instance of one. `TzGz`'s
`setVersion()`/manifest-per-pack point toward this (each `pack()` is a
full snapshot) but retain only the latest snapshot; a log retains every
one.

## Bindings

| Clause | ISO.js (boot device) | PDFVaultX / `BuildTerminalPdf.js` | TzGz.js |
|---|---|---|---|
| 1. Manifest | `_schema.properties` | `ostore.json` | `TzGz.manifest` |
| 2. Neutral contract | Not externally consumed | Standard PDF, any viewer | Standard tar+gzip, any extractor |
| 3. Trust | `checksum` + `signManifest()`/`verifyManifestSignature()` | One signature over the full rebuilt file; per-revision incremental signing requires the writer described in clause 3 | No `Signature.js` integration |
| 4. Portable IO / executable manifest | Verified by `FileFsBootAdapter`; not self-executing | `pdf-lib` attach/extract; mixin-composition-as-manifest is undefined for this binding | `exportToFS`/`importFromFS` against any `fs`-shaped backend; `_evaluate()` runs imported content via `new Function()`/`vm.runInNewContext` with no sandboxing of its own — this must sit behind clause 3's trust check, never used as its own security boundary |

`TzGz.js` carries one correctness defect independent of this contract:
`_normalizeStructure()`'s bare `Buffer ?` checks (as opposed to
`typeof Buffer !== 'undefined'`, the guard its own `_toBuffer()` uses)
throw `ReferenceError: Buffer is not defined` in any environment lacking
a `Buffer` global. This is a property of the file, verifiable by
deleting `global.Buffer` and re-requiring the module, independent of
whether `TzGz.js` is adopted as a binding under this spec.

## Non-goals

- This is not a mandate to use SQLite anywhere in this codebase. SQLite
  is referenced only as an illustration of clauses 3/4 (one file,
  versioned, queryable); the binding chosen for universal external
  legibility is PDF, specifically because it renders on any device with
  no install, which a bare `.sqlite` file does not.
- This does not replace `pdf-lib`, `ISO.js`, or `BuildTerminalPdf.js`.
  Each remains exactly as shipped; this document states what each does
  and does not do, so any binding — or any PDF-incremental-update writer
  — has a contract to match rather than a blank page.
- This does not claim mechanical per-target UI via mixins works. It is
  the goal clause 4's mixin layer describes, blocked on a per-target
  mixin contract that this document does not define.
