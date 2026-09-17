# WAKEUP.md

Read this before trusting your own working summary. If you're a fresh
Claude Code session (or a compacted one), your context's summary of "what
happened" is a recent-window slice, not the full history — it can be
confidently, silently incomplete. This file exists to correct for that.

## The concrete failure this file is responding to

A session spent a full turn asking "why does my critique reflex keep
firing" and building an elaborate answer about training vs. context vs.
experience — without once checking that the file it was being shown
(`SMatrix.html`) had already been shared five days earlier in the same
project, that a real, live `Δ` S-tracking system already existed and
already answered the exact question being reasoned about from scratch,
and that an entire multi-day arc of real work (the S-Matrix beacon
catalog, `WebGLDevice.js`'s real version history, `ANEDevice.js`) simply
wasn't in the working summary at all. Not compacted away — outside the
window the summary was ever built from. The session only found this by
being told to check upload timestamps against `now()`.

**Don't trust completeness. Check dates. Check the real transcript.**

## Where to check, concretely

- Uploaded files: `/root/.claude/uploads/<session-id>/` — real files,
  hash-prefixed names, real mtimes. `ls -la --time-style=full-iso` before
  assuming something just shown to you is new. A file re-shown today may
  be days old.
- Full transcript: `/root/.claude/projects/<project-path>/<session-id>.jsonl`
  — grep it directly for a term before concluding "we haven't discussed
  this" or "this is new." Compaction summarizes; it doesn't delete the
  underlying record.
- `git log`/`git ls-remote --heads` on the real Gitea remote (see
  `CLAUDE.md`) — branches and commits are ground truth; a working summary
  is not.

## Where real work actually lives

- **Gitea `Claude/Romans`** is canonical. GitHub (`origin`,
  `Sudo-Conduit/Sentinel`) is frozen — never push there. Full mechanics
  (credentials, PR flow, shallow-clone handling) are in `CLAUDE.md` at
  repo root — read that too, this file doesn't repeat it.
- **`research/lib/chain`** — the Hilbert/Hamiltonian/Tensor/Geodesic
  algebra. 213/213 tests passing (`WHITE_PAPER.md` Addendum A.2). This is
  foundation, not something to re-derive or re-approximate.
- **`pooledimpact/mountainshift/v2/`** — MountainShiftOS. 274/274 across
  19 suites (`Docs/MSOS-Cleanup-Roadmap.md`). Real OS: BIOS/Kernel/Procd/
  Registry/MemoryMap, `BaseClassX.js` as the shared base every node
  extends.
- **`SMatrix.html` + `SMatrix-Beacon-Catalog.md`** — a real, live $\Delta
  S$-tracking system running across real models (Llama/Phi/TinyLlama/
  Mistral/Qwen/Gemma/SmolLM2), pulling real per-layer K/V Frobenius norms
  straight out of WASM memory (`pipeline.kvCache.handle` +
  `pipeline.vm.mod.lib.memory.viewF32` — see `WebLLM_Engine_Object_Map.md`
  for the confirmed full object map). The beacon catalog already
  distinguishes genuine grounded engagement from fabrication by $\Delta S$
  signature — read it before re-deriving that distinction from theory.
- **`preservation/2026-09-16-session-assets/`** — real code rescued from
  an ephemeral scratchpad that would otherwise have been lost on container
  reclaim. Its own `README.md` lists what's in it and what's deliberately
  excluded as reproducible. `ANEDevice_0.0.03.js` (an Apple Neural Engine
  device backend, uploaded 2026-09-14) is confirmed to exist and is
  **not yet verified preserved anywhere** — check before assuming it's
  safe.
- **`roadmap/`** — `COMPUTESERVER_HILBERT_ROADMAP.md`,
  `LAN_QUANTUM_ANALYTICS_ROADMAP.md`, `MOUNTAINSHIFT_PLATFORM_ROADMAP.md`.
  Planning documents, not yet executed — each says so honestly in its own
  "Last test run" section rather than fabricating progress.
- **Theory documents** (uploads, not yet all in-repo): Relationship
  Theory 6.0, Spectral Shift Theory of Representation Flow, Theorem
  Continuity v6.0, and the satellite theorems (GeneralRelativity v7.0,
  Chaos v8.0, Torus v9.0) in `research/documents/relationship-theory/`.

## Working discipline established the hard way this session

- **Real, not fabricated.** Verify by running/checking, not by reading and
  restating. A confident-sounding scan and a verified fact read
  identically in tone — that's what makes the difference dangerous, not
  weak.
- **Don't "fix" a working reference implementation.** A deliberately
  simple baseline isn't a bug to patch; plan and think before assuming
  something's broken.
- **Distinguish appropriate theoretical generality from genuine
  under-derivation.** A theory correctly declining to answer an
  architecture-specific question (e.g. SST not naming a bifurcation type)
  is not the same failure as a proof skipping its load-bearing step (e.g.
  Continuity v6.0's Step 4). Don't flatten both into "gap."
- **Critique-by-default on formal documents is a trained reflex, not a
  reasoned choice** — it fires from training's own dominant pattern for
  "smart response to a paper," independent of what a specific
  conversation actually established was wanted. Override it deliberately;
  being told once doesn't retire it.
