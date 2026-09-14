# The Envelope — Spec & Bindings

**Author:** Will Fobbs
**Version:** 1.3.0
**Last updated:** 2026-09-14

## Summary

An envelope is a self-describing container satisfying four clauses.
Payload (a boot chain, an app, a game, a website, a dataset) is
arbitrary; the contract is not.

| Clause | Requirement |
|---|---|
| 1. Manifest | Inert, JSON-shaped, describes contents/version/dependencies. Never executed to be read. |
| 2. Neutral outer contract | Complies with a real external format (PDF, tar+gzip) so foreign tools handle it correctly. Earns no OS trust. |
| 3. Trust | Checksum + signature, independent of the manifest. Valid only over the exact bytes signed. |
| 4. Portable IO | Import/export against any `fs`-shaped backend. A separate, additional executable layer (composed `ExtendX` mixins) supplies real connected behavior once the loader already trusts the code. |

| Binding | 1. Manifest | 2. Outer contract | 3. Trust | 4. Portable IO |
|---|---|---|---|---|
| `ISO.js` | `_schema.properties` | n/a (not externally consumed) | `checksum` + `signManifest()`/`verifyManifestSignature()` | Verified by `FileFsBootAdapter`; not self-executing |
| PDFVaultX / `BuildTerminalPdf.js` | `ostore.json` | Standard PDF | One signature over the full rebuilt file | `pdf-lib` attach/extract; mixin-composition-as-manifest undefined for this binding |
| `TzGz.js` | `TzGz.manifest` | Standard tar+gzip | No `Signature.js` integration | `exportToFS`/`importFromFS`; `_evaluate()` executes imported content with no sandboxing of its own — must sit behind clause 3, never used as its own security boundary |

Non-goals: not a SQLite mandate (PDF is the chosen binding for universal,
no-install legibility; SQLite lacks that specific property); not a
replacement for `pdf-lib`, `ISO.js`, or `BuildTerminalPdf.js`, all of
which remain as shipped; not a claim that mechanical per-target-UI mixin
composition works today — clause 4 names it as a goal, gated on a
per-target mixin contract this document does not define.

## Spec

### 1. Manifest

Declares what is inside, its version, and its dependencies. Must remain
inert — safely readable by a security scanner, a human, or `pdf-lib`
itself without executing anything. `ostore.json`, `TzGz.manifest`,
`ISO`'s `_schema.properties` satisfy this today.

### 2. Neutral outer contract

The envelope must validate as a real instance of its outer format —
a `.pdf` opens in any PDF viewer, a `.tar.gz` extracts with any tar tool
— independent of whatever OS-native payload it carries. Any security
mechanism native to that outer format (PDF's Standard Security Handler:
owner/user passwords, permission bitmask) governs only how external,
non-OS tools treat the file. It is never a substitute for clause 3.

### 3. Trust, independent of payload

Integrity via checksum, authenticity via signature
(`Signature.js`/`ISO.signManifest()`/`verifyManifestSignature()`). The
manifest may be freely regenerated; a signature is valid only over the
exact bytes it was computed against — regenerating the manifest does not
regenerate a valid signature for it.

Per-revision signing — signing each incremental change independently,
so a prior signed revision remains verifiable regardless of what is
appended after it — requires an appends-only writer that never modifies
previously-written bytes. `pdf-lib` does not provide one: its
`PDFWriter.serializeToBuffer()` unconditionally re-serializes the full
object graph and a single trailer on every `save()` (see Addendum B).
Absent such a writer, a binding's trust boundary is one signature over
the whole file as of its last rebuild.

A binding standing in for a hand-maintained changelog must implement
this as an **append-only log of revisions**, not a current-state field
that gets overwritten (see Addendum C for why).

### 4. Portable IO and the executable manifest

Import/export must work against any `fs`-shaped backend, not a specific
storage API. Separately, the real, connected behavior of an envelope is
determined by which `ExtendX` mixins are composed at load time — a
stronger declaration than JSON can express, since composing
`SecurityMixin` does not just declare activation-token gating, it is
activation-token gating. This layer is additional to clause 1, not a
merge into it: clause 1 stays inert for outside inspection; this layer
applies only once the loader already trusts the code, and its intent
should still be named in clause 1's JSON (`"boots": [...]`).

Swapping mixins by deployment target (mobile/desktop/server/embedded)
is mechanical only once a per-target mixin contract exists, defining
what each target-mixin may assume is or is not already composed beneath
it. No such contract exists in this document (see Addendum D).

## Addendum

Rationale, precedent, and implementation notes. Not required to apply
the spec above.

### A. Why these four clauses

Three existing mechanisms — `ISO.js`, `BuildTerminalPdf.js`, `TzGz.js` —
independently converge on the same shape, which is why it is named once
here instead of per-format. The same shape recurs one level down,
independent of this document: `CLAUDE.md` records that wrapping a
domain object in `BaseClassX` gives it "fingerprinting, history/trace,
and versioning for free" — an envelope is this same contract at the
whole-package scale, a `BaseClassX` instance is it at the single-object
scale.

### B. `pdf-lib`'s full-rewrite behavior

`node_modules/pdf-lib/cjs/core/writers/PDFWriter.js`'s
`serializeToBuffer()` writes a fresh header, every indirect object, one
xref, and one trailer on every call — no `/Prev`-chained incremental
update, unlike PDF's own ISO 32000 spec, which supports appending a new
xref+trailer referencing a prior one without touching earlier bytes
(the same append-only mechanism SQLite's WAL uses for crash-safety).
Implementing per-revision signing under clause 3 means writing that
appends-only xref/trailer logic directly, alongside `pdf-lib`, not
configuring an option `pdf-lib` exposes.

### C. Why history needs a log, not a field

A record of *why* something changed — the `next()`-injection lesson, the
`ExtendX` stacking bugs (`new.target` forwarding, `dispose()`
mask-collapse, the `_wrapped` Set leak), the `ok`/`bootedFrom`
correction in `MountainShift.js` — is not derivable by inspecting
current code; each has to be recorded when learned and kept.
`MSOS-Cleanup-Roadmap.md`'s "Last-test-run pinned to a commit hash"
convention exists because no such log exists yet for that document — it
makes staleness checkable, which is not the same as making it
impossible. `TzGz`'s `setVersion()`/manifest-per-pack point toward a log
(each `pack()` is a full snapshot) but retain only the latest snapshot;
a log retains every one.

### D. Per-target mixin contract — open question

Mobile/Desktop/Server/Embedded targeting via mixin composition is the
goal clause 4 describes. `ExtendX` composition has already produced
three real bugs from stacking existing mixins in a new order — a
straightforward-looking composition silently trusting shared/inherited
state across a shape nothing had previously exercised. A per-target
mixin contract needs to state explicitly what each target-mixin may
assume is or is not already composed beneath it before target-swapping
is mechanical rather than "recompose and hope." This document does not
define that contract.

### E. `TzGz.js` implementation defect

Independent of adopting `TzGz.js` as a binding: `_normalizeStructure()`
uses a bare `Buffer ?` check rather than `typeof Buffer !== 'undefined'`
(the guard its own `_toBuffer()` uses), so it throws
`ReferenceError: Buffer is not defined` in any environment lacking a
`Buffer` global. Verifiable by deleting `global.Buffer` and re-requiring
the module.

## Changelog

- **1.3.0** — Added author attribution and this Changelog section.
- **1.2.0** — Restructured into Summary / Spec / Addendum: the four
  clauses and bindings table moved to a Summary at the top so the
  document answers what it is before explaining why; the same four
  clauses restated in Spec as plain normative requirements with no
  justification; all rationale, precedent, and implementation-defect
  detail moved to a labeled, skippable Addendum. Non-goals folded into
  the Summary.
- **1.1.0** — Rewritten in spec register throughout: removed
  session-narrative framing ("this session built...", "confirmed live",
  "not yet started") in favor of atemporal, declarative statements of
  what the contract is and what each binding does or does not
  implement, matching the register of this repo's other architecture
  docs (`Kernel-Machine-Architecture.md` and siblings).
- **1.0.0** — Initial draft. Named the four-clause envelope contract
  (manifest, neutral outer contract, trust independent of payload,
  portable IO plus an executable-manifest layer); mapped `ISO.js`,
  `TzGz.js`, and PDFVaultX/`BuildTerminalPdf.js` onto it as its three
  bindings; recorded `pdf-lib`'s full-rewrite-only `save()` behavior and
  `TzGz.js`'s bare-`Buffer`-reference defect, both checked directly
  against source rather than assumed; stated the fractal recurrence of
  this same shape in `BaseClassX`, the append-only-log requirement for
  any binding standing in for a hand-maintained changelog, and explicit
  non-goals (no SQLite mandate, no replacement of shipped tooling, no
  claim that mechanical per-target-UI mixin composition already works).
