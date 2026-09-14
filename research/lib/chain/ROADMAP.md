# Data → Quantum → Geometry → Math.ext — Roadmap & Prioritization Rubric

**Version:** 1.0.0
**Last updated:** 2026-09-14

Source: the full `research/lib/chain/` buildout — `Data → Tensor → Hilbert →
Hamiltonian` (a finite-dimensional Hilbert-space algebra), the `ExtendX`
mixin composition engine it's built from, the Geodesic Protocol
(`SystemAdapter`/`Geodesic`/`GeodesicLink`, federated linking of
independently-built systems without merging them into a shared state
space), `Torus` (a stateless projection of any unity-normalized system onto
a coprime `p×q` grid), and `Math.ext`/`Math.init` (a plugin host on the
real global `Math`, with `Vector` as its first registered group). This
document follows the same six-dimension rubric format, live pinned
test-run section, and itemized changelog as the sister MountainShift OS
Cleanup Roadmap (`pooledimpact/mountainshift/v2/Docs/MSOS-Cleanup-Roadmap.md`),
so priority isn't re-debated from scratch each session — and so a
consumer of this chain (another session building chemistry functionality
on top of it) can trust what's actually shipped and tested without
re-deriving it.

Full mathematical theory and code correspondence: `WHITE_PAPER.md`. This
document is the *backlog and process record* half; the white paper is
the *theory* half.

## Last test run

Pasted directly from `node research/lib/chain/tests/run-all.js`'s own
output, not hand-typed — the point of this section is that it can go
stale in an obvious, checkable way (the pinned commit stops matching
this repo's HEAD) rather than a silent, unverifiable way. Re-run and
re-paste whenever a shipped item changes.

**Commit:** `4aa7669` (git.pooledimpact.com/Claude/Romans, branch
`claude/repo-connection-ns90c5`)

| Suite | Result |
|---|---|
| Data | 16/16 |
| Complex | 14/14 |
| Tensor (R1/R2 resolution, get/set, nesting, iteration, arithmetic, outer/contraction, reshape/transpose, classification, complex dtype, size estimates) | 62/62 |
| Hilbert | 20/20 |
| Hamiltonian | 20/20 |
| FlatTensor | 7/7 |
| NestedTensor | 8/8 |
| ExtendX integration (Structure/Security over Tensor) | 5/5 |
| StructureMixin (relational/both modes) | 6/6 |
| WeightedGraphMixin (edges + `walk()`) | 21/21 |
| SystemAdapter | 16/16 |
| Geodesic | 5/5 |
| GeodesicLink | 13/13 |
| Torus | 15/15 |
| MathPrecision | 16/16 |
| MathExt | 7/7 |
| Vector | 14/14 |

**Total: 265/265 checks passing, 17/17 suites green.**

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Shipped, tested, on the branch this doc is pinned to |
| ⬜ | Not started |
| 🔬 | Designed/discussed in depth but not yet built as code |
| 🤝 | Multi-piece — needs several files built together, not a single-file fix |

## The rubric

Six dimensions, each scored 1–5 (5 = most favorable). Composite score is
the unweighted sum (max 30) — deliberately unweighted, so the ranking
stays easy to audit and can be re-weighted later if one dimension turns
out to matter more in practice.

| Dimension | 1 (low) | 3 (mid) | 5 (high) |
|---|---|---|---|
| **F — Foundation Ready** | Needs a mechanism this chain has no version of at all | Needs one new piece, built on existing proven primitives | Pure application of a pattern already proven elsewhere in this chain |
| **U — Unlocks** | Isolated leaf; nothing else in this list depends on it | Feeds one other row | Feeds several other rows or is a named prerequisite for a whole category |
| **P — Chain Priority** | Niche; not something the stated purity/federation/geometry story actually needs | Relevant but secondary | A headline property this chain was explicitly built around (purity of math over application semantics, federated linking without a shared state space, deterministic size bounds before materializing anything) |
| **N — Novelty** | Routine application of an already-proven fix/pattern | Some real synthesis of existing pieces required | Would require genuinely new methodology this chain has no precedent for |
| **R — Rarity** | Commodity; any numeric library does this | Uncommon in a dependency-free, UMD, mixin-composed chain specifically | A real differentiator — few if any comparable projects attempt this |
| **C — Confidence** | High risk the one-line description undersells real hidden complexity (see the lessons below) | Plausible but unverified | The described fix/feature is genuinely direct, with no hidden multi-part gap |

The Confidence dimension exists **because of** this chain's own recurring
lessons, not in the abstract:

- **The `ExtendX` injected-trailing-`next`-argument hazard** — `Hilbert.isNormalized`/`isOrthogonalTo`
  and `Hamiltonian.isHermitian`/`expectationValueReal`/`evolve` all needed
  `typeof param === 'number'` instead of `=== undefined`, because
  `ExtendX`'s dispatcher always appends its own continuation as a
  trailing argument to every call. This is the *same* underlying
  mechanism the sister MSOS roadmap's own `next()`-injection audit found
  independently, over the same `ExtendX` engine, in a completely
  different codebase — strong independent confirmation that "just
  compose this mixin" one-liners need this checked every time, not
  assumed safe by analogy to a prior success.
- **`ExtendX.tokenFor()`'s leading-zero cache-token collision** (v1.5.0 →
  v1.5.1) — triggered by an *unrelated* addition (`GeodesicLink`'s four
  new mixinIds shifting an existing class's mixin to the highest bit
  position), not a local bug in the code that broke. A one-line "add a
  new mixin" hid a global, cross-class side effect that only surfaced
  once isolated and traced.
- **Silent `NaN` in `Tensor._extractScalar`, the `add`/`subtract` dtype-promotion
  gap, and order-dependent nested-array ordering** — each was a
  plausible-looking arithmetic helper that quietly did the wrong thing
  on an input shape nobody had exercised yet.
- **`MathPrecision`'s missing `F64` case** — a real gap (explicit `Math.fround(x,
  'f64')` threw instead of being a no-op) that testing alone never
  surfaced; it took directly asking "what does explicit F64 do" to find it.

Any row below whose one-liner is "just extend/compose the established
pattern" should be scored low on Confidence and distrusted until
actually run — not assumed safe by analogy to prior successes in this
same chain.

**Process discipline, tracked separately from the six technical
dimensions above (these are governance lessons, not code-correctness
ones):** a commit landed on the wrong branch once (`Torus.js` committed
to `claude/fukui-functions` instead of `claude/repo-connection-ns90c5`,
caught before pushing, cherry-picked to the correct branch) — a reminder
to check `git branch --show-current` before committing after any branch
switch mid-session. Separately, a merge conflict resolution on a
different branch (`claude/fukui-functions`) pulled in unrelated history
from `main` without asking first; corrected by explicit instruction to
strip all periodic-data-table content from that branch entirely. Neither
is a rubric dimension — they're recorded here as the same "living spec"
discipline applied to process, not just code.

## Scored backlog

| # | Category | Item | Status | F | U | P | N | R | C | **Composite** |
|---|---|---|---|---|---|---|---|---|---|---|
| A.1 | Data Foundation | `Data.js` — canonical rows/bits from 7 source encodings | ✅ | — | — | — | — | — | — | shipped |
| A.2 | Data Foundation | `Complex.js` — minimal complex value type, non-mutating | ✅ | — | — | — | — | — | — | shipped |
| B.1 | Tensor Core | `Tensor.js` — R1/R2 contract, arithmetic, contraction, classification, deterministic size estimates | ✅ | — | — | — | — | — | — | shipped |
| B.2 | Tensor Core | `FlatTensor.js` / `NestedTensor.js` — formula mixins over flat vs. genuinely-recursive nested data | ✅ | — | — | — | — | — | — | shipped |
| C.1 | Composition Substrate | `ExtendX.js` v1.5.1 — mixin composition, per-instance toggling, stacking fixes, `tokenFor()` collision fix | ✅ | — | — | — | — | — | — | shipped |
| C.2 | Composition Substrate | `StructureMixin.js` — graph/relational/both modes | ✅ | — | — | — | — | — | — | shipped |
| C.3 | Composition Substrate | `SecurityMixin.js` — activation-token-gated dispatch, locked against toggling | ✅ | — | — | — | — | — | — | shipped |
| C.4 | Composition Substrate | `WeightedGraphMixin.js` — weighted/directed edges + bounded decision-driven `walk()` | ✅ | — | — | — | — | — | — | shipped |
| D.1 | Quantum Layer | `Hilbert.js` — sesquilinear inner-product structure over rank-1 Tensor | ✅ | — | — | — | — | — | — | shipped |
| D.2 | Quantum Layer | `Hamiltonian.js` — self-adjoint operators, observables, first-order evolution step | ✅ | — | — | — | — | — | — | shipped |
| E.1 | Geodesic Protocol | `SystemAdapter.js` — NDJSON stdin/stdout/stderr wire adapter, zero normalization | ✅ | — | — | — | — | — | — | shipped |
| E.2 | Geodesic Protocol | `Geodesic.js` — dumb base linking two adapters, no link math | ✅ | — | — | — | — | — | — | shipped |
| E.3 | Geodesic Protocol | `GeodesicLink.js` — Coupling→Interaction→FubiniStudy→Bures, in composition order | ✅ | — | — | — | — | — | — | shipped |
| F.1 | Geometric Substrate | `Torus.js` — stateless `(p,q)` projection, `componentCount`=gcd, zero normalization | ✅ | — | — | — | — | — | — | shipped |
| G.1 | Math Extension Host | `MathPrecision.js` — `Math.fround(x, type)`, F16/F8_E4M3/F8_E5M2/F4_E2M1/F64 | ✅ | — | — | — | — | — | — | shipped |
| G.2 | Math Extension Host | `MathExt.js` — `Math.ext`/`Math.init`, `ExtendX.override()`-style collision policy | ✅ | — | — | — | — | — | — | shipped |
| G.3 | Math Extension Host | `Vector.js` — plain linear algebra, zero dependency, `round()` leveraging `MathPrecision` | ✅ | — | — | — | — | — | — | shipped |
| H.1 | Math Extension Host (next) | `Polynomial` — shared coefficients+degree primitive under Bezier/B-spline | ⬜ | 3 | 5 | 4 | 2 | 3 | 3 | **20** |
| H.2 | Math Extension Host (next) | `KnotVector` — validated (monotonic, length-contract) data layer under B-spline/NURBS | ⬜ | 3 | 4 | 4 | 2 | 4 | 3 | **20** |
| H.3 | Math Extension Host (next) | `BSpline` — Cox-de Boor `basis`/`basisDerivative`, cross-validated against GeoJS's and Beacon's independent implementations | ⬜ | 2 | 3 | 5 | 2 | 4 | 2 | **18** |
| H.4 | Math Extension Host (next) | `Bezier` — Bernstein basis, control-point blending via `Vector.linearCombination` | ⬜ | 4 | 2 | 4 | 1 | 2 | 4 | **17** |
| H.5 | Math Extension Host (next) | `NURBS` — rational weighting over `BSpline`'s basis | ⬜ | 2 | 1 | 3 | 3 | 4 | 2 | **15** |

## Recommended execution order

1. **H.1 — `Polynomial`** (20) — first: both `Bezier`'s Bernstein basis and
   each `BSpline` knot-span are genuine polynomials, so this is the real
   shared foundation, not a nice-to-have abstraction.
2. **H.2 — `KnotVector`** (20, tied) — before any basis-function math
   touches a knot vector at all, matching the `Data → Tensor` discipline
   (canonical, validated structure before the algorithm that assumes it
   holds). Default `OPEN`, explicit `CLAMPED` opt-in, static enum.
3. **H.3 — `BSpline`** (18) — depends on both H.1 and H.2; the one
   explicitly WASM-bound item, and the one with a real, independent
   cross-validation opportunity (GeoJS's iterative Cox-de Boor vs.
   Beacon's recursive one, both already in this repo's reference
   material).
4. **H.4 — `Bezier`** (17) — depends on H.1 only; could move ahead of H.3
   if `BSpline`'s cross-validation work stalls, since Bezier doesn't need
   `KnotVector` at all (no knots in a plain Bezier curve).
5. **H.5 — `NURBS`** (15) — strictly after H.3; it's additional rational
   weighting on top of `BSpline`'s basis, not an independent construction.

## Using this table

- Composite ties (H.1/H.2) are real, not a tiebreak failure — H.2 is
  sequenced first anyway because of the `Data → Tensor` precedent, not
  because of score.
- Raw composite ranking assumes independence between rows; it does not.
  H.5 strictly requires H.3 regardless of any future re-scoring.
- This table should be revised after each item is actually attempted,
  the same way the Confidence dimension above was written from what
  this chain's own bugs actually taught, not guessed in the abstract.

## Changelog

- **1.0.0** — 2026-09-14 — Initial publish, covering the full chain
  through `Vector.round()`/`PRECISION.F64`. 265/265 across 17 suites.
  Categories A–G (Data Foundation through Math Extension Host) fully
  shipped; Category H (`Polynomial`/`KnotVector`/`BSpline`/`Bezier`/`NURBS`)
  scored and sequenced but not yet started. Key findings folded into the
  Confidence dimension: the `ExtendX` injected-`next`-argument hazard
  (independently confirmed against the sister MSOS roadmap's own finding
  over the same engine), the `tokenFor()` leading-zero collision (found
  via an unrelated `GeodesicLink` addition), the `Tensor` dtype-promotion
  and silent-`NaN` gaps, and the `MathPrecision` `F64` gap. Two process
  lessons recorded separately: a commit landing on the wrong branch
  (caught before push, cherry-picked), and a merge on a different branch
  pulling in unrelated history without asking first (corrected by
  explicit instruction).
