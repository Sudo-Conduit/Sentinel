# Data → Quantum → Geometry → Math.ext — Roadmap & Prioritization Rubric

**Version:** 1.5.0
**Last updated:** 2026-09-15

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

**Commit:** `3a4e093` (git.pooledimpact.com/Claude/Romans, branch
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
| SecurityMixin (mixinId-collision regression) | 5/5 |
| WeightedGraphMixin (edges + `walk()`) | 21/21 |
| SystemAdapter | 16/16 |
| Geodesic | 5/5 |
| GeodesicLink | 13/13 |
| Torus | 15/15 |
| MathPrecision | 16/16 |
| MathExt | 7/7 |
| Vector | 14/14 |
| Polynomial | 13/13 |
| KnotVector | 19/19 |
| BSpline | 9/9 |
| Bezier | 12/12 |
| NURBS | 12/12 |

**Total: 335/335 checks passing, 23/23 suites green.**

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
- **`GeoJS._computeBasis`'s off-by-one degree bug** (`pooledimpact/mountainshift/apps/GeoAPI.js`,
  found via H.3's own required cross-validation, not gone looking for)
  — a `GeoJS` configured with `degree: 3` ("cubic, minimum for C²" per
  its own docblock) actually evaluates a **degree-2** basis: its
  recursion loop (`for (p = 2; p <= k; p++)`, starting from a degree-0
  base case) performs `k-1` degree raises, not `k`. Confirmed live
  (not just read) — `BSpline.unit.js`'s GeoAPI cross-validation suite
  requires the real file and shows its `degree: 3` output matches
  `BSpline.basisAll(t, 2, ...)` exactly and does *not* match
  `BSpline.basisAll(t, 3, ...)` at interior parameter values. Left
  unfixed here deliberately — `GeoAPI.js` is a different project's file
  outside `research/lib/chain/`'s scope; this is recorded as a finding
  for whoever owns that file to act on, not something this branch
  silently patched.

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
| H.1 | Math Extension Host | `Polynomial` — shared coefficients+degree primitive under Bezier/B-spline | ✅ | — | — | — | — | — | — | shipped |
| H.2 | Math Extension Host | `KnotVector` — validated (monotonic, length-contract) data layer under B-spline/NURBS | ✅ | — | — | — | — | — | — | shipped |
| H.3 | Math Extension Host | `BSpline` — Cox-de Boor `basis`/`basisDerivative`, cross-validated against GeoJS's and Beacon's independent implementations | ✅ | — | — | — | — | — | — | shipped |
| H.4 | Math Extension Host | `Bezier` — Bernstein basis, control-point blending via `Vector.linearCombination` | ✅ | — | — | — | — | — | — | shipped |
| H.5 | Math Extension Host | `NURBS` — rational weighting over `BSpline`'s basis | ✅ | — | — | — | — | — | — | shipped |

## Recommended execution order

1. ~~**H.1 — `Polynomial`** (20)~~ — **shipped.** Both `Bezier`'s Bernstein
   basis and each `BSpline` knot-span are genuine polynomials, so this
   was the real shared foundation, not a nice-to-have abstraction.
2. ~~**H.2 — `KnotVector`** (20, tied)~~ — **shipped.** Validated
   (monotonic, length-contract) knot data ahead of any basis-function
   math touching it, matching the `Data → Tensor` discipline (canonical,
   validated structure before the algorithm that assumes it holds).
   `MODE.OPEN` default (monotonic + length contract only), explicit
   `MODE.CLAMPED` opt-in (endpoint multiplicity = degree+1), plus
   `uniform()`/`clamped()` canonical generators for each mode.
3. ~~**H.3 — `BSpline`** (18)~~ — **shipped.** Depended on both H.1 and
   H.2. Cross-validation against GeoJS's iterative Cox-de Boor and
   Beacon's recursive one (both already in this repo's reference
   material) found a real, previously-unnoticed off-by-one degree bug in
   `GeoJS._computeBasis` — see the Confidence-dimension lessons above.
   Implemented as the plain textbook recursive `basis`/`basisDerivative`
   (matching Beacon's shape exactly), not the more efficient
   `findSpan`-localized algorithm — deliberately, per this chain's own
   "stay direct over prematurely optimized" convention.
4. ~~**H.4 — `Bezier`** (17)~~ — **shipped.** Depended on H.1 only; no
   `KnotVector` involved (no knots in a plain Bezier curve). Two
   independent evaluators (De Casteljau, the direct Bernstein sum)
   cross-validated against each other, plus `bernstein` vs
   `bernsteinViaPolynomial` (direct binomial formula vs H.1's
   `Polynomial.evaluate` on the expanded coefficients) as a second,
   basis-function-level cross-check.
5. ~~**H.5 — `NURBS`** (15)~~ — **shipped. Backlog complete** (H.1–H.5,
   all five items). Strictly on top of H.3 — every `R_{i,p}` and its
   derivative go through `BSpline.basisAll`/`basisDerivative` directly,
   no independent basis-function construction. Verified against the
   classic exact-circular-arc construction (Piegl & Tiller §7.3): a true
   circle is fundamentally a rational curve, not a polynomial one, so
   tracing one exactly (radius=1 at every `t`, checked directly) is the
   concrete reason NURBS exists over plain `BSpline` at all — plus the
   structural check that uniform weights make `NURBS.evaluate` reduce
   exactly to `BSpline.evaluate` on the same control points/knots.

## Using this table

- Composite ties (H.1/H.2) are real, not a tiebreak failure — H.2 is
  sequenced first anyway because of the `Data → Tensor` precedent, not
  because of score.
- Raw composite ranking assumes independence between rows; it does not.
  H.5 strictly requires H.3 regardless of any future re-scoring.
- This table should be revised after each item is actually attempted,
  the same way the Confidence dimension above was written from what
  this chain's own bugs actually taught, not guessed in the abstract.

## Supplemental Addendum: Math Theory & Formulas Study Guide

**Purpose:** a fast, applied on-ramp — not a substitute for `WHITE_PAPER.md`,
which has the full derivations and rigor. This addendum exists so a
junior engineer (or anyone picking this chain up cold) can read one
formula, one code pointer, and one paragraph of "why this and not
something simpler" per concept, in the same category order (A–H) as the
backlog above, before diving into the white paper's full treatment. Each
entry has the same shape on purpose — **Formula → Code → Why** — so this
pattern can be lifted into another roadmap's own Supplemental Addendum
without redesigning it each time.

### B — Tensor Core

- **Structure/data separation.** `Tensor` never mixes "what shape is
  this" with "what's actually in it" — `init(R1, R2)`, `R1` = shape/dtype/order
  (data-free), `R2` = the payload. **Code:** `Tensor.js:init`. **Why:** the
  same `R1` can be filled by a flat array, a nested array, or a `Data`
  instance with a field-extraction rule, and the resulting tensor is
  identical either way — the structure was never coupled to one input shape.
- **Contraction.** `Σ` over one shared axis: contracting rank-`p` `A` with
  rank-`q` `B` along matching dimensions gives rank-`(p-1)+(q-1)`; two
  rank-1 tensors contract to a rank-0 scalar (the ordinary dot product).
  **Code:** `Tensor.js:contract`. **Why:** this one operation generalizes
  matrix multiplication, the dot product, and outer-product reduction —
  three "different" operations in most libraries are one formula here.
- **Deterministic size bound.** Dense storage needs `Π nᵢ` elements
  (`8` bytes/element real, `16` complex); this is knowable *before*
  materializing anything. **Code:** `Tensor.estimateDenseSizeMB` (static —
  callable with just a hypothetical shape). **Why:** a 2GB guard that
  only fires *after* you've already allocated the tensor is too late to help.

### D — Quantum Layer

- **Sesquilinear inner product.** `⟨ψ,φ⟩ = Σᵢ conj(ψᵢ)·φᵢ` — conjugate-linear
  in the first argument, linear in the second (physics convention).
  **Code:** `Hilbert.js:InnerProductMixin.innerProduct`. **Why:** this is
  *not* the same as `Tensor.contract()` on two vectors — contraction has
  no conjugation, so it would silently give the wrong answer for any
  complex-dtype state. That distinction is the entire reason `Hilbert`
  is its own link in the chain rather than "contract on a vector."
- **Self-adjointness.** `H = H†`, where `(H†)ᵢⱼ = conj(Hⱼᵢ)`. **Code:**
  `Hamiltonian.js:AdjointMixin`/`IsHermitianMixin`. **Why:** Hermitian
  operators are exactly the ones whose expectation values `⟨ψ|H|ψ⟩` are
  guaranteed real — the mathematical property that lets `H` represent a
  physical observable at all.
- **First-order evolution step.** `|ψ(t+dt)⟩ ≈ |ψ(t)⟩ − i(dt/ħ)H|ψ(t)⟩`.
  **Code:** `Hamiltonian.js:EvolveMixin.evolve`. **Why (read carefully):**
  this is a forward-Euler discretization, *not* the exact `e^{-iHt/ħ}`
  unitary evolution — it's only approximately norm-preserving, with error
  vanishing as `dt→0`. `WHITE_PAPER.md` §3.5 has the full rigor note on
  exactly why this distinction matters and must never be glossed over.

### F — Geometric Substrate

- **Coprimality via the Chinese Remainder Theorem.** `gcd(p,q)=1` implies
  `ℤ/p × ℤ/q ≅ ℤ/pq` — a single connected `p·q`-point structure, not
  `gcd(p,q)` disjoint ones. **Code:** `Torus.componentCount` (literally `gcd`).
  **Why:** this is *why* `9×8` (coprime) gives one 72-point diagonal
  strip, while e.g. `4×6` (`gcd=2`) splits into two disjoint 12-point cycles
  — a property you can check before building anything on top of a given `(p,q)`.
- **The empty≡infinity seam.** `wrap(t) = t mod 1`, so `wrap(0) === wrap(1)`.
  **Code:** `Torus.wrap`. **Why:** folding a line `[0,1]` into a circle
  means gluing its two ends into one point — this is that gluing,
  concretely, not a metaphor.

### G — Math Extension Host

- **IEEE-754-style float layout.** Any `(signBit=1, expBits, manBits)`
  format's max finite magnitude is `(2 − 2⁻ᵗ)·2^maxExp` for a real Inf-bearing
  format — but not for OCP's finite/"FN" formats (`F8_E4M3`), which reserve
  one bit pattern for their single NaN encoding and so saturate lower
  than the naive formula predicts (448, not 480). **Code:**
  `MathPrecision.js:quantizeFloat`. **Why:** this is the one place in this
  chain where "the formula" and "the actual documented constant" diverge,
  and the divergence itself is the thing worth understanding, not just the number.
- **Control-point blending.** `Σᵢ weightsᵢ · pointsᵢ` — the one operation
  Bezier/B-spline/NURBS all actually need underneath them. **Code:**
  `Vector.linearCombination`. **Why:** verified directly against an
  independently hand-computed quadratic Bezier point, not just internal
  self-consistency — see `Vector.unit.js`.

### H — Curve Substrate

- **Horner's method (Polynomial).** `evaluate([c₀,c₁,...,cₙ], t) =
  c₀ + t(c₁ + t(c₂ + ... ))` — fewer multiplications than the naive
  `Σᵢ cᵢtⁱ`, and the numerically standard choice. **Code:**
  `Polynomial.js:evaluate`. **Why:** both `Bezier`'s Bernstein basis and
  each `BSpline` knot-span are genuine polynomials in `t` (see below) —
  this is the one evaluation routine they'll both actually call.
- **The knot-vector length contract.** `m+1 = n+p+2` — a degree-`p`
  curve with `n+1` control points needs exactly `n+p+2` knots (Piegl &
  Tiller, "The NURBS Book", eq. 2.1). **Code:**
  `KnotVector.js:expectedLength`. **Why:** this is checked *before* any
  basis function ever reads the knot vector, matching `Data → Tensor`'s
  own "validate the structure, then trust it" discipline — a `BSpline`
  built on a malformed knot vector would fail silently or wrong, far
  from where the actual mistake was made.
- **Clamped (interpolating) knot vectors.** First/last knot value
  repeated with multiplicity exactly `degree+1`. **Code:**
  `KnotVector.js:clamped`. **Why:** this is what makes a B-spline curve
  pass through its first and last control points — without it, a
  "clamped-looking" curve is actually just a curve that happens not to
  touch its own endpoint, a much easier mistake to make than it sounds.
- **Cox-de Boor recursion (B-spline).** `Nᵢ,ₚ(t) = [(t-tᵢ)/(tᵢ₊ₚ-tᵢ)]·Nᵢ,ₚ₋₁(t)
  + [(tᵢ₊ₚ₊₁-t)/(tᵢ₊ₚ₊₁-tᵢ₊₁)]·Nᵢ₊₁,ₚ₋₁(t)`, from the base case `Nᵢ,₀(t) = 1`
  if `t` falls in knot span `i`, else `0`. **Code:**
  `BSpline.js:basis`. **Why it's a polynomial too:** on any single knot
  span, it's a genuine polynomial of degree `p` — a *different*
  polynomial per span, stitched together with `C^{p-1}` continuity at
  simple knots. **Why the plain recursive form, not the more efficient
  `findSpan`-localized algorithm (Piegl & Tiller Algorithm A2.2):**
  matches `Vector`/`Torus`'s own "stay direct over prematurely
  optimized" precedent, and it's what made the term-for-term
  cross-validation against `Anomalies_Test017.js`'s private
  `_bsplineBasis` closure possible — same recursion shape, same
  variable names even.
- **Curve evaluation via control-point blending.** `C(t) = Σᵢ Nᵢ,ₚ(t)·Pᵢ`.
  **Code:** `BSpline.js:evaluate`, which validates the knot vector first
  (`KnotVector.validate`) and then calls straight into `Vector.linearCombination`
  — no reimplementation, exactly the reuse the G addendum entry above predicted.
- **Bernstein basis (Bezier).** `Bᵢ,ₙ(t) = C(n,i)·tⁱ·(1−t)^(n−i)` — an
  explicit polynomial of degree `n`. **Code:** `Bezier.js:bernstein` (the
  direct formula) and `Bezier.js:bernsteinViaPolynomial` (the SAME
  function via `Polynomial.evaluate` on the expanded coefficients,
  cross-validated against the direct one in `Bezier.unit.js`). **Why
  it's a polynomial, concretely, not just claimed:** expand the binomial
  and every term is a plain power of `t` — `bernsteinCoefficients`
  produces that expansion explicitly, checked against hand-expanded
  degree-2 cases.
- **De Casteljau's algorithm.** Repeated linear interpolation between
  consecutive control points, one round per degree. **Code:**
  `Bezier.js:deCasteljau`. **Why kept alongside the direct Bernstein
  sum, not instead of it:** De Casteljau is numerically stable at high
  degree in a way the direct formula (large binomial coefficients
  multiplying vanishingly small powers) is not — agreement between the
  two in `Bezier.unit.js` is a real correctness check on both, not two
  copies of the same computation.
- **NURBS rational weighting.** `R_{i,p}(t) = wᵢ·Nᵢ,ₚ(t) / Σⱼ wⱼ·Nⱼ,ₚ(t)`
  — a ratio of two weighted B-spline basis combinations, not a
  polynomial itself (the numerator and denominator both are, but the
  quotient generally isn't). **Code:** `NURBS.js:rationalBasisAll`,
  built directly on `BSpline.basisAll`, no independent basis-function
  construction. **Why NURBS at all, concretely:** a true circular arc is
  fundamentally a rational curve — no plain (polynomial) B-spline can
  trace one exactly at any degree. The classic three-control-point,
  weights-`(1, 1/√2, 1)` quarter-circle construction (Piegl & Tiller
  §7.3) does, checked directly (`‖C(t)‖=1` for every `t`) in
  `NURBS.unit.js`, not left as a textbook claim.

**The H backlog (H.1–H.5) is now complete** — `Polynomial` → `KnotVector`
→ `BSpline` → `Bezier` → `NURBS`, each building on exactly what
ROADMAP.md's own dependency notes said it would and nothing more.

## Changelog

- **1.5.0** — 2026-09-15 — Shipped **H.5 `NURBS`**, completing the H
  backlog (H.1–H.5, all five items). `rationalBasisAll` (`R_{i,p} =
  wᵢNᵢ,ₚ / Σⱼ wⱼNⱼ,ₚ`), `evaluate`, and `derivative` (quotient rule on
  the weighted numerator/denominator, both built from
  `BSpline.basisAll`/`basisDerivative` directly — no independent
  basis-function construction, matching the roadmap's own "additional
  rational weighting... not an independent construction" framing).
  Verified against the classic exact-circular-arc construction (Piegl &
  Tiller §7.3, three control points, weights `(1, 1/√2, 1)`) tracing
  `‖C(t)‖=1` at every `t` — the concrete, checked reason NURBS exists
  over plain `BSpline` at all, since a true circle is a rational curve
  no polynomial B-spline can represent exactly. A second, structural
  check needing no external reference: uniform weights make
  `NURBS.evaluate` reduce exactly to `BSpline.evaluate` on the same
  control points/knots. Test suite grew from 323/323 (22 suites) to
  335/335 (23 suites).
- **1.4.0** — 2026-09-15 — Shipped **H.4 `Bezier`**: `bernstein`/`bernsteinAll`
  (direct binomial formula), `bernsteinCoefficients` (the basis
  function's own expanded Polynomial coefficient array),
  `bernsteinViaPolynomial` (the SAME basis function via
  `Polynomial.evaluate` on that expansion — real reuse of H.1, not
  decorative), `deCasteljau`/`evaluate` (numerically stable), and
  `evaluateBernstein` (the direct control-point-blend, via
  `Vector.linearCombination`). Two independent cross-validations, in
  the same spirit as H.3's: De Casteljau vs the direct Bernstein sum
  for curve evaluation, and the direct binomial formula vs
  Polynomial-based evaluation for the basis function itself — genuinely
  different computations agreeing, not the same one run twice. Depends
  on H.1 only; H.2 (`KnotVector`) never enters, since a plain Bezier
  curve has no knot vector. `derivative` reuses `deCasteljau` on the
  standard hodograph control points rather than a separate
  Bernstein-derivative formula. H.5 (`NURBS`) is next — last item in
  this backlog, strictly after H.3. Test suite grew from 311/311 (21
  suites) to 323/323 (22 suites).
- **1.3.0** — 2026-09-15 — Shipped **H.3 `BSpline`**: `basis`/`basisDerivative`
  (plain recursive Cox-de Boor, deliberately not the `findSpan`-localized
  algorithm — see the Category H addendum), `basisAll`, `evaluate`, and
  `derivative`, built directly on `KnotVector.validate` (H.2) and
  `Vector.linearCombination` (G) rather than reimplementing either.
  **Cross-validated against two independent implementations already in
  this repository, as scored**: `Anomalies_Test017.js`'s private
  recursive `_bsplineBasis`/`_bsplineDerivative` (reproduced verbatim in
  the test file, since they're unexported closures) match term for term;
  `GeoAPI.js`'s `GeoJS._computeBasis` (required live, not reproduced)
  does **not** match at its own configured degree — cross-validating it
  found a real, previously-undocumented off-by-one bug (a `degree: 3`
  `GeoJS` actually evaluates a degree-2 basis), recorded in the
  Confidence-dimension lessons above and left unfixed here deliberately,
  since `GeoAPI.js` sits outside `research/lib/chain/`'s scope. The
  original H.3 row also flagged "explicitly WASM-bound" as a property to
  watch for; no WASM tooling exists anywhere in this chain yet and
  building one was out of scope for "ship the basis functions" — noted
  here rather than silently dropped. Test suite grew from 302/302 (20
  suites) to 311/311 (21 suites).
- **1.2.0** — 2026-09-15 — Shipped **H.1 `Polynomial`** and **H.2
  `KnotVector`**, closing out the tied-score pair at the top of the H
  backlog. `Polynomial`: `evaluate` (Horner's method), `derivative`,
  `integral`, `degree`, `add`, `scale` — zero dependency, ascending
  coefficient convention. `KnotVector`: `MODE.OPEN`/`MODE.CLAMPED` static
  enum, `isMonotonic`/`multiplicityAt`/`expectedLength`/`validate`
  (fail-fast, matching `Vector.assertSameLength`'s convention), and
  `uniform()`/`clamped()` canonical generators. Both registered through
  `Math.init`. Test suite grew from 265/265 (17 suites) to 302/302 (30
  suites, including the SecurityMixin mixinId-collision regression suite
  added on this branch). H.3 (`BSpline`) is next — the first item that
  actually depends on both of these.
- **1.1.0** — 2026-09-14 — Added the Supplemental Addendum (Math Theory
  & Formulas Study Guide): a fast, formula-first on-ramp for a junior
  engineer, one entry per load-bearing concept (Formula → Code → Why),
  in the same A–H category order as the backlog, deliberately not a
  substitute for `WHITE_PAPER.md`'s full rigor. Designed as a reusable
  section shape for other roadmaps (this session's MSOS roadmap
  included), not a one-off.
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
