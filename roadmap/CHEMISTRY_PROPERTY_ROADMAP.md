# Sentinel Chemistry Engine — Property Roadmap & Prioritization Rubric

**Version:** 1.2.0
**Last updated:** 2026-09-11

Source: the six-category punch list drafted this session (Optical,
Electronic, Thermal, Magnetic, Reactivity, Device-Level properties for
`research/periodic-data-table`). This document turns that list into a
scored, ordered backlog so items 1–6 can be worked mechanically instead
of by re-debating priority each time.

Every score in the table below is a first-pass judgment call, not a
measurement — it is meant to be revised as items are actually attempted
(the Bond Dissociation Energy row already was: see the Confidence
dimension's rationale, which exists specifically because of what BDE
turned out to teach).

## Last test run

Pasted directly from `node test/run-all.js`'s own output in the
`Sudo-Conduit/Sentinel` repo (`research/periodic-data-table/test/`,
branch `claude/entropy-chain-fix-nlrgeb`) — not hand-typed. The commit
hash is Sentinel's, not this document's own repo (this roadmap lives in
`Claude/Romans` on Gitea; the code and its tests live in Sentinel on
GitHub) — that mismatch is intentional and is exactly the point: the
hash below is what actually ran, wherever it lives, and it can go stale
in an obvious, checkable way (stops matching Sentinel's HEAD) rather
than a silent, unverifiable way. Re-run and re-paste whenever a Status
column changes or a new Category 1-6 item ships; a roadmap claiming
shipped work that the test suite doesn't back up is worse than no
roadmap. No such suite existed before this run — it did not exist prior
to v1.2.0 of this document.

Commit: `b6eb0ab` (Sudo-Conduit/Sentinel) — 2026-09-11T17:14:09+00:00

| Suite | Result |
|---|---|
| MolecularSymmetry.test.js | ALL 6 CHECKS PASSED |
| MolecularThermodynamics.test.js | ALL 6 CHECKS PASSED |
| MolecularVibrationalModes.test.js | ALL 6 CHECKS PASSED |
| MolecularDescriptors.test.js | ALL 7 CHECKS PASSED |

Total: 25/25 checks passing, 4/4 suites green.

One real finding surfaced while writing this suite, not previously
documented anywhere: `MolecularVibrationalModes.js` builds its Hessian
from internal coordinates (bond stretches + valence-angle bends only —
no torsions/dihedrals). Mode count matches the textbook 3N-6 only when
a molecule has no torsional degrees of freedom to miss — true for water
(3 modes, exact), **not** true for benzene's ring (24 modes, not the
full 30). This is checked explicitly in the suite as a documented,
expected count, not silently passed with a wrong assertion or hidden.
It does not change any row's Status in the table below, but it is
exactly the kind of gap this section exists to keep from going stale
and unstated.

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Shipped this session |
| 🔬 | Investigated this session — real findings exist, but NOT shipped as a simple formula (see linked record) |
| ⬜ | Not started |
| 🤝 | Flagged as multi-molecule / compositional — a candidate for agent-orchestrated work (molecule → pair → device), not a single-molecule formula |

## The rubric

Six dimensions, each scored 1–5 (5 = most favorable). Composite score is
the unweighted sum (max 30) — deliberately unweighted for now so the
relative ranking is easy to audit and re-weight later if one dimension
turns out to matter more than the others in practice.

| Dimension | 1 (low) | 3 (mid) | 5 (high) |
|---|---|---|---|
| **D — Have Data** | Needs a new data source or model class the codebase has no version of at all | Needs one new derived quantity, built on existing outputs | Pure arithmetic on quantities already computed elsewhere in the codebase |
| **U — Unlocks** | Isolated leaf; nothing else in this list depends on it | Feeds one other row | Feeds several other rows or is itself a named prerequisite for a whole category (e.g. device-level) |
| **P — Discipline Priority** | Niche; rarely the metric an engineer in the target discipline actually asks for | Relevant but secondary | A headline metric named directly in the discipline's own vocabulary (IP, band gap, PCE, etc.) |
| **N — Novelty** | Routine application of an existing, standard formula | Some real synthesis of existing pieces required | Would require genuinely new methodology or produce a new insight (the kind of thing worth a findings record, like the BDE investigation) |
| **R — Rarity** | Commodity; every basic cheminformatics toolkit already does this trivially | Uncommon in lightweight/browser-based tools specifically | A real differentiator — few if any comparable tools attempt this at all |
| **C — Confidence** | High risk the punch list's one-line "derived from X" undersells real missing physics (the BDE lesson: a closed-form that turns out to have zero free parameters left to independently calibrate) | Plausible but unverified | The stated derivation is genuinely direct, with no hidden multi-body or missing-data gate |

The Confidence dimension exists **because of** this session's Bond
Dissociation Energy investigation, not in the abstract: BDE's punch-list
line ("Derived from the Born model") read as a one-step formula and
turned out to be algebraically exact but physically unreliable, with the
real missing physics only surfacing after real cited data was checked
against it. Any other row whose one-liner has the same shape ("derived
from X + Y" where X and Y are both already fully determined, leaving no
free parameter) should be scored low on Confidence and treated with the
same suspicion until checked against real data — not built and trusted
on the strength of the formula alone.

## Scored backlog

| # | Category | Item | Status | D | U | P | N | R | C | **Composite** |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | Optical | Oscillator Strength (f) | ⬜ | 5 | 5 | 4 | 2 | 2 | 5 | **23** |
| 1.2 | Optical | Molar Absorptivity (ε) | ⬜ | 4 | 3 | 3 | 1 | 1 | 5 | **17** |
| 1.3 | Optical | Absorption Spectrum (UV-Vis) | ⬜ | 4 | 4 | 4 | 3 | 3 | 4 | **22** |
| 1.4 | Optical | Fluorescence / Phosphorescence | ⬜ | 2 | 3 | 3 | 4 | 4 | 2 | **18** |
| 1.5 | Optical | Stokes Shift | ⬜ | 2 | 1 | 2 | 3 | 3 | 2 | **13** |
| 2.1 | Electronic | Ionization Potential (IP) | ⬜ | 5 | 4 | 5 | 1 | 1 | 4 | **20** |
| 2.2 | Electronic | Electron Affinity (EA) | ⬜ | 5 | 4 | 5 | 1 | 1 | 4 | **20** |
| 2.3 | Electronic | Band Gap | ✅ | — | — | — | — | — | — | shipped |
| 2.4 | Electronic | Fermi Level | ⬜ | 5 | 2 | 3 | 1 | 1 | 4 | **16** |
| 2.5 | Electronic | Work Function | ⬜ | 3 | 2 | 3 | 4 | 4 | 2 | **18** |
| 2.6 | Electronic | Charge Transport Mobility (μ) | 🤝 | 2 | 4 | 5 | 5 | 5 | 2 | **23** |
| 2.7 | Electronic | Reorganization Energy (λ) | ⬜ | 3 | 4 | 4 | 3 | 3 | 3 | **20** |
| 3.1 | Thermal | Heat Capacity (Cp) | ✅ | — | — | — | — | — | — | shipped (RRHO) |
| 3.2 | Thermal | Thermal Conductivity (κ) | ⬜ | 2 | 2 | 3 | 3 | 4 | 1 | **15** |
| 3.3 | Thermal | Melting Point | 🤝 | 1 | 1 | 3 | 4 | 4 | 1 | **14** |
| 3.4 | Thermal | Debye Temperature | ⬜ | 2 | 2 | 2 | 3 | 4 | 2 | **15** |
| 3.5 | Thermal | Thermal Expansion Coefficient | ⬜ | 2 | 1 | 2 | 4 | 4 | 2 | **15** |
| 4.1 | Magnetic | Magnetic Moment | ✅ | — | — | — | — | — | — | shipped |
| 4.2 | Magnetic | Magnetic Susceptibility (χ) | ⬜ | 4 | 2 | 2 | 1 | 2 | 4 | **15** |
| 4.3 | Magnetic | Spin Density | ⬜ | 3 | 3 | 2 | 3 | 3 | 3 | **17** |
| 4.4 | Magnetic | Exchange Coupling (J) | 🤝 | 1 | 1 | 2 | 5 | 5 | 1 | **15** |
| 5.1 | Reactivity | Fukui Functions (f⁺, f⁻, f⁰) | ⬜ | 4 | 4 | 4 | 2 | 3 | 4 | **21** |
| 5.2 | Reactivity | Electrophilicity / Nucleophilicity Indices | ✅ | — | — | — | — | — | — | shipped (`Aromaticity.js` `homoLumo()`, Parr-Szentpaly-Liu electrophilicity index) |
| 5.3 | Reactivity | Bond Dissociation Energy (BDE) | 🔬 | 2 | 5 | 5 | 5 | 5 | 1 | **23** *(investigated — see note)* |
| 5.4 | Reactivity | Activation Energy (Ea) | ⬜ | 1 | 4 | 4 | 5 | 5 | 1 | **20** |
| 5.5 | Reactivity | Reaction Rate (k) | ⬜ | 1 | 1 | 3 | 3 | 3 | 1 | **12** |
| 6.1 | Device | Open-Circuit Voltage (Voc) | 🤝 | 2 | 2 | 4 | 4 | 4 | 2 | **18** |
| 6.2 | Device | Short-Circuit Current (Jsc) | 🤝 | 1 | 2 | 4 | 4 | 4 | 1 | **16** |
| 6.3 | Device | Fill Factor (FF) | 🤝 | 1 | 1 | 3 | 4 | 4 | 1 | **14** |
| 6.4 | Device | Photovoltaic Efficiency (PCE) | 🤝 | 1 | 1 | 5 | 3 | 4 | 1 | **15** |
| 6.5 | Device | Refractive Index (n, k) | ⬜ | 4 | 3 | 4 | 2 | 2 | 4 | **19** |
| 6.6 | Device | Dielectric Constant (ε) | ⬜ | 4 | 2 | 4 | 2 | 2 | 4 | **18** |

Also shipped this session, not on the original list but feeding several
rows above: vibrational normal modes ✅ (underlies 3.2/3.4/3.5), point-group
symmetry ✅ (underlies several optical/thermal selection rules), and the
multipole/molar-refractivity/druglikeness cheap wins ✅ (molar
refractivity is the adjacent piece to 6.5).

**Correction (v1.1.0):** 5.2 Electrophilicity/Nucleophilicity Indices was
scored ⬜ in v1.0.0 on the assumption it was unstarted. Checking the
actual code while scoping 1.1/1.3/5.1's real difficulty found it was
already shipped: `Aromaticity.js`'s `homoLumo()` computes the
Parr-Szentpaly-Liu electrophilicity index (`electrophilicityEv`) directly
from the same frontier-orbital energies the rubric assumed would still
need deriving. Left as a reminder that this table's Status column is
only as good as the last time someone actually checked the code, not the
punch list's original wording.

**Grounded difficulty check (v1.1.0), 1.1/1.3/5.1 specifically:** rather
than trust the first-pass D/N/C scores in the abstract, the actual code
was checked. The transition dipole matrix element `<phi_j|mu_hat|phi_i>`
Oscillator Strength (1.1) needs is *already computed* inside
`MolecularPolarizability.js`'s `analyzePiElectronic()` (it's the core
term the sum-over-states polarizability formula sums over) — 1.1 is
exposing an existing intermediate, not new work. Fukui Functions (5.1)
similarly reuses per-atom MO coefficients already produced by
`Aromaticity.js`'s Jacobi eigendecomposition, with one small but
precedented wrinkle: a degenerate HOMO/LUMO level (e.g. benzene's
degenerate e-pair) needs summing `|c|^2` over every MO in that group, and
the grouping logic to do that already exists in `fillElectrons`. Absorption
Spectrum (1.3) needs both of those plus something with **no existing
precedent anywhere in this codebase**: a linewidth/broadening model to
turn discrete stick transitions into a continuous curve — real spectral
width comes from vibronic coupling and solvent effects, entirely outside
simple Huckel theory. That is the concrete reason 1.3 is the hardest of
the three despite the lower composite (22 vs. 23) — Novelty/Confidence
already flagged it, and reading the actual code confirmed why.

## Recommended execution order

**Single-molecule ("for us") queue, by composite descending:**

1. Oscillator Strength (f) — 23
2. Absorption Spectrum (UV-Vis) — 22
3. Fukui Functions — 21
4. Ionization Potential / Electron Affinity / Reorganization Energy — 20 (tie)
5. Activation Energy (Ea) — 20, **but C=1** — treat as BDE-risk, verify against real cited data before trusting any closed form
6. Refractive Index (n, k) — 19
7. Fluorescence/Phosphorescence, Work Function, Dielectric Constant — 18
8. Molar Absorptivity, Spin Density — 17
9. Fermi Level — 16
10. Thermal Conductivity, Debye Temperature, Thermal Expansion Coefficient, Magnetic Susceptibility — 15
11. Stokes Shift — 13
12. Reaction Rate (k) — 12

**Agent/compositional (🤝) queue, by composite descending:**

1. Charge Transport Mobility (μ) — 23
2. Open-Circuit Voltage (Voc) — 18
3. Short-Circuit Current (Jsc) — 16
4. Exchange Coupling (J) / Melting Point / Photovoltaic Efficiency (PCE) — 14–15
5. Fill Factor (FF) — 14

**Bond Dissociation Energy (BDE)** is scored for comparison only — it is
not re-enterable at the top of the queue. It was investigated this
session (see `chemistry/De_investigation_FINDINGS.js`, Gitea PR #4): the
naive closed-form extension is exact but physically unreliable, and the
real payoff was a nested structure (adjacent-π-acceptor family split,
alpha-H hyperconjugation axis, H2O2 as its own sub-family) discovered by
checking real cited ab initio data rather than trusting the formula. Any
future work on BDE should extend that nested-tensor/CITED-vs-DERIVED
methodology per bond family, not restart from the one-line formula.

## Using this table

- Composite ties are real, not a tiebreak failure — when two items tie,
  prefer whichever also has a higher Confidence (C) score, since a low-C
  item can quietly cost far more than its composite suggests (BDE is the
  standing example: high composite, lowest possible confidence).
- A 🤝 item should not be attempted as a single-molecule feature. It
  needs the molecule → pair → device compositional architecture
  discussed this session (each molecule/layer computes its own
  properties; an agent or orchestration layer composes them), not a new
  per-molecule formula.
- This table should be revised after each item is actually attempted,
  the same way BDE's Confidence dimension was written retroactively from
  what was actually learned — a rubric that never updates from real
  outcomes is just an opinion with extra columns.

## Changelog

This document is meant to stand on its own, the same way
`chemistry/De_investigation_FINDINGS.js` does — versioned and dated so a
reader can tell what changed and why without diffing git history.

- **1.2.0** — 2026-09-11 — Added a "Last test run" section: built the
  first real regression test suite for the four shipped modules
  (`research/periodic-data-table/test/`, Sentinel repo, commit
  `b6eb0ab`, 25/25 checks passing) since none existed before this
  version, and pasted its verbatim output with a commit hash rather than
  restating Status by hand — a stale roadmap claim is now checkable
  (hash stops matching HEAD) instead of trusted. Surfaced one real,
  previously-undocumented finding while writing it:
  `MolecularVibrationalModes.js`'s internal-coordinate Hessian (bond
  stretches + angle bends only, no torsions) matches the textbook 3N-6
  mode count for water but not for benzene's ring (24 modes, not 30) -
  checked explicitly as documented, expected behavior rather than a
  silently-wrong assertion or a hidden gap.
- **1.1.0** — 2026-09-11 — Corrected 5.2 Electrophilicity/Nucleophilicity
  Indices from ⬜ to ✅ shipped (`Aromaticity.js`'s `homoLumo()` already
  computes it) after checking the actual code rather than trusting the
  punch list's original wording. Added a grounded difficulty comparison
  for 1.1 Oscillator Strength / 1.3 Absorption Spectrum / 5.1 Fukui
  Functions, based on reading `MolecularPolarizability.js` and
  `Aromaticity.js` directly, confirming 1.3 as the hardest of the three
  despite its lower composite score. Added this version/changelog
  footer.
- **1.0.0** — 2026-09-11 — Initial publish: six-dimension rubric (Have
  Data, Unlocks, Discipline Priority, Novelty, Rarity, Confidence),
  full scored backlog for the six-category punch list, single-molecule
  and agent/compositional execution queues.
