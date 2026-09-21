# CORE Changelog

A release-by-release log of the 31 reference implementations, in series
order. Each entry names the release's own title and the main thing that
changed or was introduced relative to the release(s) before it. See each
release's own `.md` for full detail.

- **[`9x8_Matrix`](./9x8_Matrix.md)** — Modular Congruence Matrix.
  Series opener: establishes the `9×8 = 72` grid and `72 ≡ 0 (mod 72)`
  toroidal step-counter that the rest of the series builds on.
- **[001](./9x8_Torus_001.md)** — Toroidal Matrix Dashboard: 9x8 Tensor
  Bridge. First "dashboard"-style release; extends the base matrix concept
  toward a tensor framing.
- **[002](./9x8_Torus_002.md)** — Toroidal Topology Wave Signal Dashboard.
  Introduces a wave-signal viewport and the continuous
  `requestAnimationFrame` animation loop pattern used by nearly every
  later release.
- **[003](./9x8_Torus_003.md)** — Modular Space: 8x9 Torus Traversal
  Engine.
- **[004](./9x8_Torus_004.md)** — Dynamical Metric Engine: Non-Euclidean π
  Space. Introduces dynamic/non-Euclidean π distortion; first appearance
  of the CSS-custom-property canvas quirk (assigning a CSS variable string
  directly to `ctx.fillStyle`/`strokeStyle` is silently ignored).
- **[005](./9x8_Torus_005.md)** — Geometric Phase Transition Dashboard:
  Visualizing Dynamic Pi.
- **[006](./9x8_Torus_006.md)** — 3D Sliced Quantum Circle: QBit Internal
  Architecture. First 3D shell/sphere-style viewport in the series.
- **[007](./9x8_Torus_007.md)** — Refined 3D Quantum Circle: Von Neumann
  Nested Architecture. Introduces Von Neumann ordinal set language for
  describing nested shell layers.
- **[008](./9x8_Torus_008.md)** — High-Contrast Quantum Circle: Von Neumann
  Nested Architecture. Visual refinement of 007.
- **[009](./9x8_Torus_009.md)** — VNNT Quantum Orbital Analytical Suite.
  "VNNT" (Von Neumann Nested Topology) becomes a recurring title prefix
  from here on.
- **[010](./9x8_Torus_010.md)** — VNNT Hyper Web Fractal Topology
  Simulator.
- **[011](./9x8_Torus_011.md)** — Fobbs Valence Topological Analyzer.
  First release to name a metric directly after the project owner
  (Fobbs); ties conceptually to the standalone Fobbs Valence Table (FVT)
  app.
- **[012](./9x8_Torus_012.md)** — Dynamic Slater Metric Quantum Engine.
  Introduces Slater-radius/effective-nuclear-charge chemistry framing.
- **[013](./9x8_Torus_013.md)** — Dynamic Slater Quantum Engine:
  Triple-Window Suite. Expands to a 3-viewport layout.
- **[014](./9x8_Torus_014.md)** — Base 0 Sentinel Information Suite.
  Introduces the "Sentinel Operator" fixed-point/observation toggle
  concept (ties to the project's own name, "Sentinel").
- **[015](./9x8_Torus_015.md)** — VNNT Double-Slit Serialization Suite.
  Continues the Sentinel toggle theme with a double-slit framing; last
  release with the CSS-custom-property canvas quirk before it goes quiet
  until release 021.
- **[016](./9x8_Torus_016.md)** — VNNT High-Visibility Continuity
  Laboratory (v6.0). Introduces the `∂ₜρ + ∇·j = 0` continuity-equation
  framing used as connective tissue through release 029; "v6.0" versioning
  begins here.
- **[017](./9x8_Torus_017.md)** — VNNT Navier-Stokes Continuity Lab
  [v6.0]. First explicit Navier-Stokes framing; introduces mouse
  drag-to-rotate interaction on the 3D viewport, continued through most
  later releases.
- **[018](./9x8_Torus_018.md)** — Navier-Stokes First Principles
  Laboratory [v6.0].
- **[019](./9x8_Torus_019.md)** — Navier-Stokes Vortex Core Simulator
  [v6.0]. Closes out the dedicated Navier-Stokes run before the series
  pivots to applied-domain skins.
- **[020](./9x8_Torus_020.md)** — Fe-Based Photovoltaic Absorption
  Profiler [v6.0]. First "applied profiler" skin over the now-stable
  shell-lattice engine (domain: photovoltaics).
- **[021](./9x8_Torus_021.md)** — VNNT Stoichiometric Balance Studio
  [Educational Module]. Chemistry-education skin; introduces the
  `try/catch`-guarded render function pattern continued through 022–027;
  CSS-custom-property quirk reappears here.
- **[022](./9x8_Torus_022.md)** — FRAC Relational Compiler Profiler
  [v6.0]. Compiler/ISA-diagnostics skin.
- **[023](./9x8_Torus_023.md)** — Acoustic Equity Manifold Station
  [v6.0-Deterministic]. Acoustic dialect-translation skin; first flat 2D
  (non-3D-projected) concentric-ring viewport in the series.
- **[024](./9x8_Torus_024.md)** — GeoNLP Linguistic Manifest Studio
  [v6.0]. Reframes 023's structure in NLP/representation-learning terms;
  harmless dead-code typo (`e.mousemove`) noted but has no visible effect.
- **[025](./9x8_Torus_025.md)** — VNNT Beacon Loop Presentation Suite
  [Lab 25]. Introduces the "Principled Anchor N" concept (later reused in
  release 030's relativity manuscript); **bug**: Anchor Profile dropdown
  reads the wrong element id (`reactionSelect` instead of `anchorSelect`)
  and is functionally inert.
- **[026](./9x8_Torus_026.md)** — ASTa Compilation Regularity Studio
  [Lab 26 - Fixed]. Explicit bug-fix release for 025's dropdown-wiring
  bug (correctly reads `frontendSelect`); connects the series' compiler-
  themed labels to this project's real multi-language RegX.js frontends.
- **[027](./9x8_Torus_027.md)** — Kähler Manifold Holonomy Tracker
  [Lab 27 - Hardened]. First release with a genuine 0–720° (4π
  double-cover) control range, rather than the usual 0–360°.
- **[028](./9x8_Torus_028.md)** — Deterministic Acoustic Equity Filter
  Studio [Lab 28]. Restyled near-duplicate of release 023; **bug**:
  inline LaTeX telemetry labels (`\(D(t)\)`) render as raw unrendered
  source, since no MathJax/KaTeX script is loaded.
- **[029](./9x8_Torus_029.md)** — Financial Market Relational Matrix
  Engine [Lab 29]. Financial risk/liquidity skin; **bug**: profile data
  objects are missing a `points` field, so the 3D lattice's node-generation
  loop never executes and Window 3 renders completely blank — the first
  release whose 3D viewport produces no visible output. Also affected by
  the unrendered-LaTeX issue from 028, plus a `var(--green-neon)` string
  passed directly to canvas `strokeStyle`/`fillStyle` (silently ignored,
  same root cause as the CSS-custom-property quirk).
- **[030](./9x8_Torus_030.md)** — VNNT Unified Field Manuscript Library
  [Lab 30 - Hardened]. Series finale, badged "LAB ARCHIVE COMPLETE:
  30/30." Departs entirely from the canvas/animation format used by every
  prior release; presents four static LaTeX-styled "manuscripts"
  retroactively framing releases' themes (Navier-Stokes regularity,
  Kähler holonomy, general relativity, deterministic chaos) as resolutions
  to real open problems, authored to "Will Fobbs III, Pooled Impact."

## Documentation library

- **2026-09-20** — Created one helper `.md` per release (31 total,
  `9x8_Matrix.md` + `9x8_Torus_001.md`–`030.md`), each with a Playwright
  screenshot in `img/<release-name>/`, plus this Changelog, [`Roadmap.md`](./Roadmap.md),
  [`ReadMe.md`](./ReadMe.md), and [`Intro.md`](./Intro.md).
