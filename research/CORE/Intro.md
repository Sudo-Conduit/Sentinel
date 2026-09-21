# Introduction to the CORE Series

The 31 files in this library are not 31 unrelated demos — they're
iterations on a single rendering engine and a small set of recurring
concepts, gradually relabeled and re-skinned across the series. This doc
is a map of that throughline, for reading the library conceptually rather
than file-by-file. Every claim below is drawn from what's directly in the
code; see the individual release docs for line-level detail.

## The foundational number: 9×8 = 72

[`9x8_Matrix.html`](./9x8_Matrix.md) opens the series by proving, visually,
that `72 ≡ 0 (mod 72)`: a 9×8 grid of 72 nodes, walked by a step counter
that wraps back to its white seed node at step 72. Nearly every later
release keeps some multiple-of-72 structure alive — 4 shells × 18 beacons
in release 025, 5 layers × 8 rings × N nodes in the shell-lattice engine,
"Base36 Registry Tokens" in release 026 — even as the surface theme changes
completely. Treat `9×8 = 72` and its toroidal ("wraps back to zero")
framing as the series' load-bearing constant.

## The shell-lattice engine

Starting around release 002 and stabilizing by the mid-teens, most
releases share one underlying 3D rendering approach: concentric "shells"
(rings of nodes at increasing radius), each shell holding a ring of
points positioned by spherical or toroidal coordinates, projected to 2D
and redrawn every frame via `requestAnimationFrame`. From release 017
onward this viewport becomes mouse-draggable (click + drag to rotate).
Once this engine is in place (roughly release 020 on), later releases
reuse it as-is and simply change:

- the **labels and units** (chemistry, compiler ISA, acoustic phase,
  financial risk, etc. — see below),
- the **profile data** driving colors/counts/highlighted shells,
- occasionally the **control range** (release 027's 0–720° slider is the
  one structural exception, doubling the usual 0–360° range to represent
  a geometric double-cover).

## Von Neumann shells and the Sentinel Operator

Layer/shell counts are described in Von Neumann ordinal set language in
several releases (a shell "containing" the ones before it, the way each
Von Neumann ordinal contains all smaller ordinals). A recurring "Sentinel
Operator" concept — a fixed-point / observation toggle — appears in
releases 014–016, tying back to this project's own name, "Sentinel."

## The continuity equation as connective tissue

From roughly release 016 through 029, viewport titles carry a physics
continuity equation, `∂ₜρ + ∇·j = 0` (rate of change of a density ρ plus
the divergence of its flux j equals zero — the standard statement that
"nothing is created or destroyed, only moved"). The releases reuse this
one equation as a unifying label across otherwise unrelated domains:
fluid density, chemical concentration, acoustic dissonance, linguistic
representation flow, financial liquidity. It's presented as literal
physics in each release's telemetry, but functions mostly as a recurring
visual/thematic anchor tying the "applied profiler" releases together.

## The applied-profiler run (020–029)

Ten releases in a row take the same shell-lattice engine and skin it as a
domain-specific "profiler" tool:

| Release | Domain |
|---|---|
| [020](./9x8_Torus_020.md) | Photovoltaics |
| [021](./9x8_Torus_021.md) | Chemistry studio |
| [022](./9x8_Torus_022.md) | Compiler/ISA diagnostics |
| [023](./9x8_Torus_023.md) | Acoustic dialect translation |
| [024](./9x8_Torus_024.md) | NLP/representation flow |
| [025](./9x8_Torus_025.md) | Beacon-loop stability (control theory) |
| [026](./9x8_Torus_026.md) | Compiler/ISA (fixes 025's inherited dropdown bug) |
| [027](./9x8_Torus_027.md) | Kähler holonomy / parallel transport |
| [028](./9x8_Torus_028.md) | Acoustic translation (restyled 023) |
| [029](./9x8_Torus_029.md) | Financial market risk (blank-canvas bug) |

Reading these in order makes the pattern obvious: the control wiring
(`processXManifold()`, a dropdown + slider, `try/catch`-guarded render,
`window.changeXProfile` attached globally) and the shell-lattice draw code
are nearly identical release to release, with only the labels, profile
data, and accent color genuinely changing.

## Fobbs Valence Theory (FVT)

Outside this HTML-file series but referenced by it conceptually, Will's
own named physics framework — Field Valence Theory, in
`research/periodic-data-table/FobbsValenceTable.html` — has an orbital-
bound design language that release 011 ("Fobbs Valence," per its own
per-release doc) draws its name from, the first release in the CORE
series to name a metric after the project owner directly.

## The finale: from visualization to manuscript

[Release 030](./9x8_Torus_030.md) breaks the pattern completely — no
canvas, no animation, no controls beyond a document switcher — and
instead presents four short "manuscripts" retroactively framing four
prior themes (Navier-Stokes regularity, Kähler holonomy, general
relativity, deterministic chaos) as resolutions to real open problems in
mathematics and physics. Read as the series' closing statement, it's best
understood as a narrative capstone rather than new technical content: see
[030's own doc](./9x8_Torus_030.md) for why none of the four "papers"
actually derive their claimed results.
