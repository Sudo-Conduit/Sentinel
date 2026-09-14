# Geodesic Protocol — Spec v0.1 (pre-implementation)

**Status:** design only. No code should be written against this until it is
agreed. The goal of writing it down first is to fix the interface and wire
format so the actual link math (Fubini-Study, Bures, coupling, interaction)
drops in as a mechanical mixin afterward, without forcing a refactor of the
transport or the adapter boundary.

## 1. Problem statement

`Data -> Tensor -> Hilbert -> Hamiltonian` produces one **System**: a
self-contained state (`Hilbert`) evolving under its own operator
(`Hamiltonian.evolve()`). Two systems built this way have no shared
structure — different shape, different dtype, possibly different
process, different machine. A **Geodesic** links two systems so they can
be dynamically approximated against each other (distance, interpolation,
coupling) without merging them into one joint tensor-product Hilbert
space. Forcing a shared space is the thing being avoided — that's the
"three concepts that already exist" this design is deliberately not doing.

Federation implies the two systems may not even share a process. The link
therefore has to work across a process boundary by default, and happen to
also work in-process. **stdin/stdout/stderr** is the transport: it has
zero novel infrastructure, works identically over a pipe, a subprocess, or
ssh, and cleanly separates data from diagnostics.

## 2. Roles

- **System** — an existing `Hilbert`/`Hamiltonian` instance (or chain up
  to either). Unmodified by this spec.
- **SystemAdapter** — wraps one System. Owns serialization
  (System state -> wire message) and deserialization (wire message ->
  consumable state), and owns the stream I/O. This is the *adapter*
  pattern piece: it's the only thing that knows both the System's native
  shape/dtype and the wire format.
- **Geodesic** — consumes two SystemAdapters (or two raw message streams)
  and computes the link. Built via `ExtendX.extend(Geodesic, ...)` with
  one mixin per link type (`FubiniStudyMixin`, `BuresMixin`,
  `CouplingMixin`, `InteractionMixin`, ...), each independently
  toggleable per instance — same 1:M pattern as `Hilbert.OPERATIONS`.
  This is the *composition* pattern piece.
- **Transport** — stdout/stdin/stderr, or any injected duplex stream with
  the same contract (see §6). This is the *webhook* pattern piece: state
  changes are **pushed** as they occur, one line per step, not polled.

## 3. Stream contract

| Stream | Carries | Format |
|---|---|---|
| stdout | System state, one message per line | NDJSON (§4) |
| stdin  | System state received from a linked System | NDJSON (§4) |
| stderr | Diagnostics only — never protocol data | plain text or NDJSON `{level, message, systemId, ts}` |

Rules:
- stdout carries **only** valid protocol messages. Nothing else is ever
  written there (no logging, no debug prints).
- A line on stdout is exactly one JSON object, newline-terminated,
  no embedded newlines. NDJSON, not a JSON array — so a reader can
  process line-by-line without buffering the whole stream.
- stderr is diagnostic-only and MUST NOT be parsed for protocol state by
  any conformant reader. A Geodesic that needs a System's health does so
  via an explicit `control` message on stdout (§4.4), not by scraping
  stderr.

## 4. Wire format (NDJSON messages)

Every message has a common envelope:

```json
{ "v": 1, "type": "meta|state|control|error", "systemId": "<string>", "seq": <int>, "ts": <epoch-ms> }
```

- `v` — protocol version (integer, this spec is `1`). A reader MUST
  refuse (error to stderr, not crash) a message with an unknown major
  version rather than guess.
- `systemId` — stable per-System identifier, set once at handshake, unchanged for the stream's lifetime.
- `seq` — monotonically increasing per System, starting at 0. Used to
  detect drops/reordering; a Geodesic reading out of a pipe (FIFO,
  ordered) will see it strictly increasing, but the field exists so
  a lossier transport can still be validated against this same schema.
- `ts` — producer-side timestamp, informational only (never used for
  ordering — `seq` is authoritative).

### 4.1 `meta` (handshake, exactly one, first message on the stream)

```json
{ "v": 1, "type": "meta", "systemId": "sys-a", "seq": 0, "ts": 0,
  "shape": [2], "dtype": "complex", "kind": "Hilbert" }
```

`shape`/`dtype` mirror `Tensor`'s own (`Tensor.DTYPES`). `kind` names the
chain class at the wire boundary (`"Hilbert"` or `"Hamiltonian"`) so a
Geodesic can refuse an incompatible pairing (e.g. a `FubiniStudyMixin`
requires two `Hilbert`-kind streams, not `Hamiltonian`) before it ever
touches a `state` message.

A reader MUST receive and validate `meta` before processing any `state`
message on that stream. A `state` message arriving first is a protocol
error (§4.4).

### 4.2 `state` (one per evolved step)

```json
{ "v": 1, "type": "state", "systemId": "sys-a", "seq": 14, "ts": 1234,
  "step": 14, "data": [{"re":0.707,"im":0}, {"re":0,"im":0.707}] }
```

`data` is the flat buffer in the same encoding `Tensor.toFlat().data`
already produces — a real number, or `{re,im}` for complex dtype — so a
`SystemAdapter` serializes with `system.toFlat()` directly, no new
encoding. `step` is the System's own evolution step counter (distinct
from `seq`, the transport's own counter — they usually match 1:1, but
`step` is the one with physical meaning).

### 4.3 `control`

```json
{ "v": 1, "type": "control", "systemId": "sys-a", "seq": 99, "ts": 5678, "action": "eof" }
```

`action` is one of `"eof"` (graceful, no more `state` messages will
follow — distinct from the stream simply closing, so a reader can tell
graceful shutdown from a crash) or `"ping"`/`"pong"` (liveness, optional).

### 4.4 `error`

Protocol-level errors (bad handshake order, unknown `v`, malformed
message) are reported as a `control`-adjacent message written to
**stderr**, not stdout:

```json
{ "level": "error", "systemId": "sys-a", "ts": 1234, "message": "state received before meta" }
```

A malformed line on stdout itself (not valid JSON, or valid JSON missing
`v`/`type`) is logged to stderr and the line is dropped — it MUST NOT
crash the reader or desynchronize `seq` tracking for subsequent lines.

## 5. Synchronization policy

Two Systems evolve independently and are not assumed to step in lockstep.
A Geodesic reading two adapters therefore uses **latest-wins**: on each of
its own ticks, it reads the most recently received `state` from each
adapter (buffered by the adapter as "last seen", not queued) — not a
blocking join on both streams advancing together. This matches "dynamically
approximated," not "synchronized." A link mixin that genuinely needs
paired steps (rare) can opt into a buffered/blocking mode explicitly; that
is a mixin-level decision, not a transport-level one.

## 6. JS interface (signatures only — no logic yet)

```js
// SystemAdapter.js
class SystemAdapter {
  constructor() {}
  init(system, { systemId, writable, readable }) { /* writable/readable default to process.stdout/stdin, but MUST be injectable for testing and for in-process (non-subprocess) linking */ return this; }
  emitState()      { /* writes one `state` line for system's current values */ }
  emitMeta()        { /* writes the one `meta` line; called once by init() or explicitly */ }
  emitEof()         { /* writes `control` eof */ }
  onMessage(fn)      { /* fn(message) per parsed line from `readable`; the push/webhook hook */ }
  lastState()        { /* most recently received `state` message, or null */ }
}

// Geodesic.js — base class, ExtendX-composed
class Geodesic {
  constructor() {}
  init({ left, right }) { /* left/right: SystemAdapter instances */ return this; }
}
// ExtendX.extend(Geodesic, FubiniStudyMixin, BuresMixin, CouplingMixin, InteractionMixin)
// each mixin reads left.lastState()/right.lastState() and (for Coupling/
// Interaction, which write back) calls left.emitState()/right.emitState()
// equivalents — exact method TBD when that mixin is built, since it's
// "mechanical" per the earlier discussion and out of scope for this spec.
```

Explicitly out of scope for `SystemAdapter`/`Geodesic` themselves (left to
mixins, built later, one at a time):
- The actual distance/interpolation/coupling formulas.
- Whether/how a coupling term feeds back into a System's own `evolve()`.
- Process spawning/management (this spec covers the stream contract a
  System's stdout/stdin must satisfy, not how the two processes are
  launched or supervised).

## 7. Open questions (need an answer before implementation starts)

1. Does `emitState()` fire on **every** `evolve()` step automatically
   (System calls it), or is it pulled on demand by the adapter polling
   the System? (Leaning: pushed by the System/caller after each `evolve()`
   call — keeps `SystemAdapter` passive and dependency-injected, no
   internal timer/loop of its own, consistent with the rest of the chain.)
2. Complex-dtype `data` reuses `{re,im}` — confirm that's acceptable on
   the wire rather than e.g. a packed `[re,im]` tuple (object form chosen
   here for direct compatibility with `Complex`'s own shape and
   `Tensor.toFlat()`'s existing output, no conversion step needed).
3. `kind` in `meta` is currently just `"Hilbert"`/`"Hamiltonian"` — do we
   need shape/dtype-compatibility rules enforced by `Geodesic.init()`
   itself (reject mismatched pairs eagerly), or left to each mixin to
   check (since `FubiniStudyMixin` and `CouplingMixin` may have different
   compatibility requirements)?
