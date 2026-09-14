# A Composable Finite-Dimensional Hilbert-Space Algebra with Federated Geodesic Linking

### Mathematical Theory and Reference Implementation

**Author:** Will Fobbs
**Created:** 2026-09-14T02:48:54Z (UTC)
**Repository:** `Claude/Romans` (Gitea, canonical) / `Sudo-Conduit/Sentinel` (GitHub, frozen mirror)
**Reference commit:** `ca8ba9118a8bc65c02486d5f0ea386aabedd99ee`
**Scope of this document:** `research/lib/chain/` — `Data.js`, `Complex.js`, `Tensor.js`, `Hilbert.js`, `Hamiltonian.js`, `FlatTensor.js`, `NestedTensor.js`, `ExtendX.js`, `SystemAdapter.js`, `Geodesic.js`, `GeodesicLink.js`, and `GEODESIC_PROTOCOL.md`.

---

## Abstract

This paper presents a composable, dependency-injected class chain implementing a finite-dimensional Hilbert-space algebra — from raw data normalization through tensor structure, sesquilinear inner-product spaces, self-adjoint operator dynamics, and a wire protocol for federated linking of independently-instantiated systems. Each mathematical layer corresponds to exactly one composable unit of the implementation, and each unit is independently testable and independently toggleable at runtime via a bitmask-based mixin composition engine (`ExtendX`). The paper states the mathematical definitions governing each layer, the exact algorithm implementing each definition, and the correspondence between the two. An addendum documents the testing methodology, the full test inventory (213 cases across 12 suites), and one verified defect found and corrected in the composition engine during this work, presented as a worked case study in specification-driven verification.

---

## 1. Introduction

A recurring difficulty in software that models physical or mathematical structure is the tendency for the code's own architecture to obscure the theory it implements — a `Matrix` class with a `multiply` method reveals nothing about whether that multiplication is meant to represent a linear operator, a coordinate transformation, or an ad hoc numeric convenience. The chain documented here takes the opposite approach: each class corresponds to exactly one mathematical structure, is composed from independently-authored capability units (mixins) via a runtime composition engine rather than class inheritance, and carries no behavior beyond what its stated mathematical definition requires.

The chain has two parts. The first (Sections 3–4) is a linear sequence of increasingly specialized structures — a set of raw data, a tensor over that data, a Hilbert space fixing the tensor to rank 1 with an inner product, and a self-adjoint operator (Hamiltonian) over that Hilbert space generating both observables and dynamics. The second (Section 5) departs from that linear sequence: rather than extending a single system indefinitely, it defines a protocol — the Geodesic Protocol — for linking two independently-constructed systems without merging them into one shared state space, using a transport (`stdin`/`stdout`/`stderr`) old enough to have been stable since before either system existed.

---

## 2. Notation and Conventions

Scalars are drawn from either the real field ℝ or the complex field ℂ, selected per-instance by a `dtype` tag (`Tensor.DTYPES.REAL` / `Tensor.DTYPES.COMPLEX`); no structure in this chain assumes one over the other except where stated. A complex scalar is written `z = a + bi`, with conjugate `z̄ = a − bi` and modulus `|z| = √(a² + b²)`.

A rank-`r` tensor over a field 𝔽 with shape `(n₁, …, n_r)` is an element of `𝔽^(n₁×⋯×n_r)`, addressed by a multi-index `(i₁, …, i_r)`. Rank 0 is a scalar, rank 1 a vector, rank 2 a matrix.

The inner product convention throughout is the physics convention (conjugate-linear in the first argument, linear in the second):

```
⟨ψ, φ⟩ = Σᵢ conj(ψᵢ) · φᵢ
```

This is *sesquilinear*, not bilinear — it differs from the plain symmetric contraction `Σᵢ ψᵢ φᵢ` whenever the dtype is complex, and the two must not be conflated (Section 3.4).

Code is referenced as `file.js:functionOrMethod`. Every source file cited here carries the same static metadata convention: `name`, `author`, `version`, `description`, `docs`, `tests`, `config_default`, checkable directly on the exported class or module.

---

## 3. The Composable Chain: Theory and Implementation

### 3.1 Data Normalization Layer — `Data.js`

**Theory.** Before any algebraic structure can be imposed, raw data must be reduced to one of two canonical forms: a sequence of rows (each row a flat record of scalar fields) or a sequence of bits. The layer recognizes seven source encodings — `json-array`, `json-map`, `delimited`, `db-table`, `bitmap`, `unicode`, `ascii` — and normalizes each to one of these two forms without loss.

The bit-level encodings deserve separate justification. A code point under a fixed-width encoding (UTF-8, UTF-16, UTF-32, or 7-bit ASCII) is *already* a bitmap: the glyph "w" in ASCII is the bit sequence `1110111`, and that bit sequence is simultaneously (a) a 1-dimensional array of 7 elements and, under a different grouping of the same bits, (b) a rank-2 nested structure. Treating character data as a bitmap source makes bit-level structure and compression ratio (UTF-32's fixed 32-bit width versus UTF-8's variable width for the same code point) directly observable as tensor shape, rather than requiring a separate representation.

**Implementation.** `Data.js:init(source, opts)` dispatches on `opts.type` (one of `Data.SOURCE_TYPES`) and returns `this` with a canonical `rows` or `bits` field populated. ASCII normalization strictly rejects any code point above `0x7F` — 7-bit ASCII is not a truncation of a wider encoding, and silently accepting an 8-bit byte as if it were 7-bit ASCII would misrepresent the bit-level claim being made. UTF-8/16/32 encoders are self-contained (no `TextEncoder` dependency), consistent with the chain-wide "no internal `require()`" convention (Section 4).

### 3.2 Tensor: Structure (R1) and Data (R2) — `Tensor.js`

**Theory.** A tensor is fully specified by two independent pieces of information: its *structural specification* — shape, axis order, storage dtype, and (if the data source is row-based) the rule for extracting a scalar field from a row — and the *data* filling that structure. These are logically separable: the same rank-2, 3×3, real-dtype specification can be filled by a flat array, a nested array, or a `Data` instance with a field-extraction rule, and the resulting tensor is identical in every case once resolved.

**Implementation.** This separation is literal in the constructor contract: `init(R1, R2)`, where `R1 = {shape, order, layout, dtype, field}` is data-free and `R2` is one of a `Data` instance, a flat array, or a nested array, auto-detected and normalized by `Tensor._resolveR2` to one canonical flat buffer plus row-major strides. `R1.order` (`ORDERED` / `UNORDERED` / `CUSTOM`) governs whether — and how — rows are sorted before indexing; `_applyOrder` applies this to the *outer axis* uniformly whether `R2` arrives flat or nested, so a `CUSTOM` or `UNORDERED` order cannot be silently dropped depending on which shape `R2` happens to take.

### 3.3 Elementwise Algebra, Contraction, and Storage-Size Bounds

**Theory.** Given two rank-`r` tensors `A, B` of identical shape and a field 𝔽, elementwise addition and subtraction are defined componentwise: `(A ± B)ᵢ = Aᵢ ± Bᵢ`. If either operand has complex dtype, the result is complex — a real-dtype value is embedded in ℂ as `a + 0i` before the operation, never coerced the other way. The *outer product* of a rank-`p` tensor `A` and rank-`q` tensor `B` is the rank-`(p+q)` tensor with `(A ⊗ B)_{i,j} = A_i · B_j`. *Contraction* along a chosen axis pair generalizes matrix multiplication: contracting `A` along axis `a` with `B` along axis `b` (requiring `shape(A)[a] = shape(B)[b]`) sums over that shared dimension, producing a tensor of rank `(p − 1) + (q − 1)`; contracting two rank-1 tensors along their only axis collapses to a rank-0 scalar (the ordinary — not sesquilinear — dot product, `Σᵢ AᵢBᵢ`).

Dense storage of a rank-`r` tensor requires `Π nᵢ` elements; a diagonal (square, rank-2) matrix requires only `min(n₁,n₂)`. For real dtype an element occupies 8 bytes, for complex dtype 16 (one `Complex` instance, two IEEE-754 doubles). Because the element count is a pure function of `(shape, dtype)`, the memory footprint of a hypothetical tensor is knowable *before* it is materialized.

**Implementation.** `add`/`subtract` (`Tensor.js:541–558`) compute a promoted `resultDtype` rather than assuming `this.dtype`, correcting an early defect (Section 6, Addendum A) where a real-minus-complex subtraction silently produced `NaN`. `outer`/`contract` (`Tensor.js:420–538`) implement the general definitions above for arbitrary rank, not merely the rank-1/rank-2 special cases. `Tensor.estimateDenseSizeMB(shape, dtype, maxMB = 2048)` is a **static** method — callable with only a hypothetical shape, no instance required — implementing the size bound above as a pre-flight guard; it throws `RangeError` above `maxMB`, and `maxMB = Infinity` bypasses the guard for a caller that has already accepted the cost. An *instance* method `denseSizeMB()` delegates to the same static computation with `maxMB = Infinity`, so introspecting an already-materialized tensor's size can never itself throw.

### 3.4 Hilbert: Sesquilinear Inner-Product Structure — `Hilbert.js`

**Theory.** A Hilbert space is a vector space equipped with an inner product `⟨·,·⟩` satisfying conjugate symmetry (`⟨ψ,φ⟩ = conj(⟨φ,ψ⟩)`), linearity in the second argument, and positive-definiteness (`⟨ψ,ψ⟩ ≥ 0`, equality iff `ψ = 0`), complete under the induced norm `‖ψ‖ = √⟨ψ,ψ⟩`. In finite dimension, completeness is automatic (every Cauchy sequence in a finite-dimensional normed space converges), so it imposes no additional implementation requirement beyond the inner product itself.

From the inner product, several derived notions follow directly: normalization (`ψ/‖ψ‖`, defined only for `ψ ≠ 0`), orthogonality (`⟨ψ,φ⟩ = 0`), distance (`‖ψ − φ‖`), and projection onto a basis vector `e` (`(⟨e,ψ⟩ / ⟨e,e⟩) · e` — note the `⟨e,e⟩` denominator, which is exactly what makes the formula invariant to rescaling `e`).

**Implementation.** `Hilbert.js` is a `Tensor` fixed to rank 1, composed via `ExtendX.extend(Tensor, InnerProductMixin, NormMixin, NormalizeMixin, IsNormalizedMixin, IsOrthogonalMixin, DistanceMixin, ProjectOntoMixin)` — one mixin per operation, each independently toggleable per instance (Section 4). The inner product itself (`InnerProductMixin.innerProduct`) is deliberately **not** implemented via `Tensor.contract()`: contraction has no notion of conjugation, and would silently compute the wrong (symmetric, non-sesquilinear) value for any complex-dtype vector. `conjugate()` is the identity on real dtype, so every derived operation is dtype-agnostic without special-casing.

### 3.5 Hamiltonian: Self-Adjoint Operators and Approximate Unitary Dynamics — `Hamiltonian.js`

**Theory.** A linear operator `H` on a finite-dimensional Hilbert space is represented, once a basis is fixed, by a square matrix. `H` is *self-adjoint* (Hermitian) iff `H = H†`, where `(H†)_{ij} = conj(H_{ji})`. A Hermitian operator plays two roles: it defines an *observable*, whose expectation value in state `ψ` is `⟨ψ|H|ψ⟩` (real-valued precisely because `H` is Hermitian), and it *generates dynamics* via the Schrödinger equation:

```
iħ d|ψ⟩/dt = H|ψ⟩
```

The commutator `[A,B] = AB − BA` measures the failure of two operators to commute; for the Pauli matrices `σₓ, σᵧ, σ_z`, the identity `[σₓ,σᵧ] = 2iσ_z` is a standard closed-form check of any implementation claiming to compute both matrix multiplication and Hermitian conjugation correctly, since it exercises both against a known, non-trivial answer.

**Rigor note on `evolve()`.** This implementation does **not** integrate the Schrödinger equation exactly (which for time-independent `H` has the closed form `|ψ(t)⟩ = e^{-iHt/ħ}|ψ(0)⟩`, a unitary — and hence exactly norm-preserving — evolution). It instead implements a single **first-order forward-Euler step**:

```
|ψ(t+dt)⟩ ≈ |ψ(t)⟩ − i(dt/ħ) H|ψ(t)⟩
```

obtained by discretizing the derivative directly. This is an `O(dt²)` local truncation of the true evolution and is **not exactly unitary** — norm is only *approximately* conserved, with the error vanishing as `dt → 0`. The test suite (Addendum A) verifies this claim precisely as stated (`‖evolved‖ − 1 < 0.01` for `dt = 0.001`), not exact unitarity, and this document makes the same claim: `evolve()` is a numerical stepping primitive, not a solver for the exact time-evolution operator.

**Implementation.** `Hamiltonian.js` is `Tensor` fixed to a square operator, composed via `ExtendX.extend(Tensor, AdjointMixin, IsHermitianMixin, ApplyToMixin, ExpectationValueMixin, MultiplyMixin, CommutatorMixin, EvolveMixin)`. `applyTo(state)` returns a `Hilbert` instance (not a `Hamiltonian`) — the result of an operator acting on a state is a state, a different mathematical object from the operator itself, and the implementation's return type reflects that distinction rather than erasing it. `multiply(other)` implements operator composition via `this.contract(other, 1, 0)`; `commutator(other)` is `this.multiply(other).subtract(other.multiply(this))`, verified in the test suite against the `[σₓ,σᵧ] = 2iσ_z` identity by direct hand computation, not merely by internal self-consistency.

---

## 4. Composition Architecture: The ExtendX Mixin Algebra

Every specialized class above (`Hilbert`, `Hamiltonian`, `FlatTensor`, `NestedTensor`) is built from a common base (`Tensor`) by composing independently-authored capability units — *mixins* — via `ExtendX.extend(BaseClass, ...mixins)`, rather than by subclassing (`extends`). Each mixin declares a stable string `mixinId`, used for two purposes: deterministic bit-position assignment (a mixin's position in the alphabetically-sorted set of every `mixinId` ever registered, recomputed on every `extend()` call via `reindex()`) and per-instance runtime toggling (`instance.disableLayer(mixin)` / `enableLayer(mixin)`, gated by that bit). A mixin may declare `locked: true` to opt out of toggling permanently and unconditionally (used by `SecurityMixin`, where "can this be turned off at runtime" is categorically the wrong question to expose).

This composition model treats each mathematical operation (inner product, norm, adjoint, evolution, …) as an independently addressable unit of behavior: a caller may disable `Hilbert`'s `norm` operation on one instance without affecting any other instance of the same class, a property the test suite verifies directly for every composed class (Addendum A).

---

## 5. The Geodesic Protocol: Federated System Linking

### 5.1 Motivation and Non-Goals

Sections 3–4 describe a single System: one `Hilbert` state evolving under one `Hamiltonian`. Two independently constructed Systems — potentially of different shape, different dtype, different process, or different machine — have no shared structure by default. The Geodesic Protocol links two Systems for the purpose of dynamic approximation (a coupling energy, an interaction term, a distance on the state manifold) **without** merging them into one joint tensor-product Hilbert space — the latter being the conventional approach this design deliberately avoids, since it requires both Systems to agree on structure before they can be related at all.

### 5.2 Wire Protocol

Full specification: `GEODESIC_PROTOCOL.md`. In summary, the transport is `stdin`/`stdout`/`stderr` — chosen for having zero novel infrastructure and identical behavior over a pipe, a subprocess, or a network connection via `ssh`. The wire format is NDJSON (one JSON object per line): a `meta` message (handshake: shape, dtype, kind) exactly once at stream start, a `state` message per evolution step (`data` reusing `Tensor.toFlat().data`'s own encoding verbatim — a real number or a `{re, im}` object — with **zero transformation**, since introducing wire-specific repacking logic into the adapter would violate the separation of concerns this design maintains throughout), and a `control` message for explicit graceful termination (`action: "eof"`, distinct from the stream simply closing, which is indistinguishable from a crash). Malformed input is reported to `stderr` and dropped; `stderr` carries diagnostics only and is never parsed as protocol data by a conformant reader.

### 5.3 SystemAdapter and Geodesic: Separation of Concerns

**`SystemAdapter.js`** owns exactly two responsibilities: serializing a System's current state to the wire format, and parsing the wire format back into messages. It performs no compatibility checking, no orchestration of *when* a System evolves, and no dtype branching beyond what `Tensor.toFlat()` already provides. `emitState()` is called once per evolution step by whichever code drives that loop — the adapter never reaches into a System to trigger a step itself.

**`Geodesic.js`** is the corresponding base on the linking side: `init({left, right})` validates that both arguments are adapter-shaped (`.lastState()`, `.systemId`) and distinct systems, then exposes `leftState()`/`rightState()`/`isReady()` as thin delegation only. No link mathematics lives here — by design, matching the same separation-of-concerns principle applied to `SystemAdapter`: an adapter, or a base linking class, that accretes domain logic stops being reusable as either.

### 5.4 Link-Math Mixins: Coupling, Interaction, Fubini–Study, Bures

`GeodesicLink.js` composes `Geodesic` with four mixins — `ExtendX.extend(Geodesic, CouplingMixin, InteractionMixin, FubiniStudyMixin, BuresMixin)`, in that order (both a build order and, since `ExtendX`'s dispatch order depends on argument order, a composition-relevant one). All four are **read-only observers**: none writes back to either `SystemAdapter` or the underlying System. Whether or how a computed coupling or interaction term feeds back into a System's own `evolve()` is a decision left entirely to the caller — explicitly out of scope for this layer (`GEODESIC_PROTOCOL.md`, §6).

**Coupling.** The simplest link: a fixed-strength scalar coupling energy,

```
E_coupling(g) = g · ⟨ψ_left, ψ_right⟩
```

using the same sesquilinear convention as Section 2/3.4. Implemented once as a shared helper (`sesquilinearOverlap`) rather than depending on `Hilbert` directly, since a `Geodesic` only ever observes serialized wire state, never a live `Hilbert` instance — that decoupling from the System's own class is the entire point of the protocol.

**Interaction.** A strict generalization of Coupling: an arbitrary caller-supplied function of the two raw state buffers, `interaction(fn) = fn(leftData, rightData)`. No physics is assumed at this layer at all; Coupling is the special case `fn = (l, r) → g·⟨l,r⟩`.

**Fubini–Study distance.** The natural angle metric on projective Hilbert space (complex projective space `ℂPⁿ⁻¹`, the space of physical states up to a global phase and normalization):

```
d_FS(ψ, φ) = arccos( |⟨ψ, φ⟩| / (‖ψ‖ · ‖φ‖) )
```

taking values in `[0, π/2]`. Identical (up to scale and phase) states have distance `0`; orthogonal states have distance `π/2` — both verified directly in the test suite, along with scale-invariance (an unnormalized state and its normalized form yield the same distance to a fixed reference, as the formula's own normalization denominator guarantees).

**Bures distance.** For pure states, the Bures metric reduces to a function of the same normalized-overlap magnitude used by Fubini–Study:

```
d_B(ψ, φ) = √( 2 · (1 − |⟨ψ, φ⟩| / (‖ψ‖ · ‖φ‖)) )
```

taking values in `[0, √2]`. Because both distances are functions of one shared quantity, the implementation computes that quantity (`normalizedOverlapMagnitude`) exactly once and derives both metrics from it, rather than duplicating the overlap/norm computation per mixin.

Both distance mixins clamp the normalized overlap magnitude to `[0, 1]` before applying `arccos`/the square root, absorbing floating-point overshoot that would otherwise occasionally push a numerically-should-be-`1.0` value fractionally above `1.0` and produce `NaN`; both throw `RangeError` for a zero-vector state, for which no distance is defined.

---

## 6. Correspondence Table (Theory → Code)

| Mathematical object | Definition | Implementation |
|---|---|---|
| Data normalization | canonical rows / bit sequence | `Data.js:init` |
| Tensor structure/data separation | `(R1, R2)` | `Tensor.js:init` |
| Elementwise `±`, dtype promotion | `(A±B)ᵢ = Aᵢ±Bᵢ` | `Tensor.js:add/subtract` |
| Outer product | `(A⊗B)_{i,j} = AᵢBⱼ` | `Tensor.js:outer` |
| Contraction | `Σ` over a shared axis | `Tensor.js:contract` |
| Dense/diagonal size bound | `Π nᵢ` / `min(n₁,n₂)` elements | `Tensor.estimateDenseSizeMB` |
| Sesquilinear inner product | `⟨ψ,φ⟩ = Σ conj(ψᵢ)φᵢ` | `Hilbert.js:InnerProductMixin.innerProduct` |
| Norm / normalization | `‖ψ‖ = √⟨ψ,ψ⟩`, `ψ/‖ψ‖` | `Hilbert.js:NormMixin/NormalizeMixin` |
| Projection | `(⟨e,ψ⟩/⟨e,e⟩)e` | `Hilbert.js:ProjectOntoMixin` |
| Hermitian adjoint | `(H†)ᵢⱼ = conj(Hⱼᵢ)` | `Hamiltonian.js:AdjointMixin` |
| Self-adjointness | `H = H†` | `Hamiltonian.js:IsHermitianMixin` |
| Expectation value | `⟨ψ\|H\|ψ⟩` | `Hamiltonian.js:ExpectationValueMixin` |
| Operator composition | matrix product | `Hamiltonian.js:MultiplyMixin` |
| Commutator | `[A,B] = AB−BA` | `Hamiltonian.js:CommutatorMixin` |
| First-order evolution step | `\|ψ(t+dt)⟩ ≈ \|ψ(t)⟩ − i(dt/ħ)H\|ψ(t)⟩` | `Hamiltonian.js:EvolveMixin.evolve` |
| Wire state message | `Tensor.toFlat().data` verbatim | `SystemAdapter.js:emitState` |
| Coupling energy | `g·⟨ψ_left,ψ_right⟩` | `GeodesicLink.js:CouplingMixin` |
| Arbitrary interaction term | `fn(leftData, rightData)` | `GeodesicLink.js:InteractionMixin` |
| Fubini–Study distance | `arccos(\|⟨ψ,φ⟩\|/(‖ψ‖‖φ‖))` | `GeodesicLink.js:FubiniStudyMixin` |
| Bures distance (pure states) | `√(2(1−\|⟨ψ,φ⟩\|/(‖ψ‖‖φ‖)))` | `GeodesicLink.js:BuresMixin` |

---

## Addendum A: Testing Methodology and Results

### A.1 Methodology

Testing is performed by a dependency-free harness (`tests/TestRunner.js`) implementing `suite()`/`test()`/`run()` with no external test framework, consistent with the chain-wide "no dependency without authorization" principle; assertions are drawn from Node's built-in `assert` module. `run()` is `async` and `await`s each test body, so a failing asynchronous test (necessary for `WeightedGraphMixin.walk()`'s promise-based traversal) cannot silently register as passed — an actual defect in an earlier, non-`async` version of the runner, corrected during this work.

Every test file is independently runnable (`node <File>.unit.js`) and is also aggregated by `tests/run-all.js`. Tests are written to verify mathematical claims against **independently computed** correct answers (e.g., the Pauli commutator identity `[σₓ,σᵧ]=2iσ_z`, computed by hand and checked against the implementation's output) rather than merely asserting internal self-consistency. Where a defect was discovered specifically because a test's *own* expected value was miscalculated (not the code under test), that is recorded as such, distinctly from a genuine implementation defect.

### A.2 Test Inventory

| Suite | File | Cases |
|---|---|---|
| Data | `Data.unit.js` | 16 |
| Complex | `Complex.unit.js` | 14 |
| Tensor | `Tensor.unit.js` | 62 |
| Hilbert | `Hilbert.unit.js` | 20 |
| Hamiltonian | `Hamiltonian.unit.js` | 20 |
| FlatTensor | `FlatTensor.unit.js` | 7 |
| NestedTensor | `NestedTensor.unit.js` | 8 |
| ExtendX integration (Structure/Security) | `ExtendXIntegration.unit.js` | 11 |
| WeightedGraphMixin | `WeightedGraphMixin.unit.js` | 21 |
| SystemAdapter | `SystemAdapter.unit.js` | 16 |
| Geodesic | `Geodesic.unit.js` | 5 |
| GeodesicLink | `GeodesicLink.unit.js` | 13 |
| **Total** | `run-all.js` | **213** |

All 213 cases pass as of the reference commit, confirmed stable across repeated runs.

### A.3 Notable Defects Found and Corrected During Development

The following were discovered via this test suite (not merely fixed and asserted, but the failing case reproduced first, root-caused, and re-verified) and are recorded here as part of the testing record rather than omitted from it:

1. **`Tensor.add`/`subtract` dtype promotion.** Used `this.dtype` alone rather than a promoted result dtype (unlike `outer`/`contract`, which already computed one correctly), so a real-minus-complex subtraction silently produced `NaN`. Corrected to promote to complex dtype whenever either operand is complex.
2. **Silent `NaN` in scalar field extraction.** `Tensor._extractScalar`'s object-plus-field-name branch had no numeric validity check; a non-numeric field value passed through as `NaN` rather than raising an error. Corrected to `throw TypeError`, matching the behavior already present on a sibling code path.
3. **Order-dependent nested-array ordering.** `UNORDERED`/`CUSTOM` row ordering was applied only when `R2` arrived as a flat array, silently ignored when `R2` arrived nested. Corrected so ordering is applied to the outer axis uniformly regardless of `R2`'s shape.
4. **The `ExtendX` injected-trailing-argument hazard.** `ExtendX`'s dispatcher appends its own continuation callback as a trailing argument to every dispatched call, so a naive `param === undefined` default-value check on any mixin method's optional trailing parameter is unsound — the caller's *omitted* argument is never actually `undefined` at the point the method body observes it. Affected and corrected: `Hilbert.isNormalized`/`isOrthogonalTo`, `Hamiltonian.isHermitian`/`expectationValueReal`/`evolve`. The correct guard, applied consistently across all five, is a `typeof param === 'number'` (or appropriate type) check rather than an `undefined` comparison.
5. **`ExtendX.tokenFor()` leading-zero cache-token collision** *(v1.5.0 → v1.5.1)*. `tokenFor()` reverses a mask's bit array before parsing it as a binary literal via `BigInt`. `disableLayer()` always leaves the just-disabled bit as the array's highest-index element, which becomes the *first* character of that literal after reversal — and a leading zero in a binary literal is numerically invisible to `BigInt` (`BigInt('0b0111') === BigInt('0b111')`). Consequently, disabling the mixin currently occupying the highest bit position on a given instance produced a cache token **identical** to the all-enabled configuration, and since both the pipeline cache and the per-method dispatch cache are keyed by this token, a stale all-enabled dispatch chain was silently served for a genuinely-disabled configuration. The defect was latent from the token scheme's introduction but was masked in every prior configuration of this codebase, becoming observable only once a later `extend()` call's global, alphabetical bit reindexing happened to land an *existing* class's mixin at the new highest bit position — reproduced deterministically once isolated, independent of which classes or mixins were involved. Corrected by prefixing a sentinel `'1'` before the reversed bit string, fixing the literal's length in place so a leading (highest-index) `0` contributes to the numeric value as an internal digit rather than vanishing.

---

## Addendum B: Provenance and Attribution

| Field | Value |
|---|---|
| Author | Will Fobbs |
| Document created | 2026-09-14T02:48:54Z (UTC) |
| Reference commit | `ca8ba9118a8bc65c02486d5f0ea386aabedd99ee` |
| Repository (canonical) | `git.pooledimpact.com/Claude/Romans` |
| Repository (frozen mirror) | `github.com/Sudo-Conduit/Sentinel` |
| Branch | `claude/repo-connection-ns90c5` |
| `ExtendX` engine version | 1.5.1 (Wilbert Fobbs III, Pooled Impact) |

This document describes the state of the codebase as of the reference commit above; subsequent commits on the same branch may extend or supersede claims made here without this document being retroactively edited to match — a later revision of this document, if produced, records its own timestamp and reference commit rather than overwriting this one's.
