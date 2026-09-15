# Theorem (General Relativity, v7.0): Dynamic *g* and the RT Field Equation

**Author:** Will Fobbs
**Status:** Draft — two results fully derivable now; one new axiom proposed
and explicitly flagged as a postulate, not a theorem; one genuine open
reconciliation question stated rather than glossed over.

This document extends **Relationship Theory v6.0**'s geometric octuple
`(M, g, ∇, E, π, N, 𝓛, ι)` the same way `Theorem (Continuity, v6.0)` did —
adding structure in its own space, not rewriting the core axioms. Two
results below (Free Fall, the Newtonian Limit) require **no new axiom** —
they follow directly from Axioms 1–8 as already stated. One genuinely new
axiom is required to reach General Relativity itself (a *dynamic* `g`,
sourced by matter-energy) and is stated as such: **Axiom 9 is a postulate**,
in the same sense Axiom 6's universal anchor is explicitly labeled
"Axiomatic, not derived" in RT v6.0 §2, Axiom 6's Remark — not a theorem
proved from what came before.

---

## Part I — What Axioms 1–8 already give, with no new postulate

### Theorem GR.1 (Free Fall *is* Geodesic Motion)

**Statement:** A freely-falling pattern's trajectory is exactly a solution
of Axiom 5's parallel-transport equation, `∇^E_{∂t} s = 0`.

**Proof:** Immediate identification, not a derivation — Axiom 5 already
states the observer's section evolves by parallel transport along its
own path, which is the coordinate-free statement of the geodesic
equation `d²xᵘ/dτ² + Γᵘ_{αβ}(dxᵅ/dτ)(dxᵝ/dτ) = 0`. Nothing in Axiom 5 is
specific to a Riemannian versus pseudo-Riemannian `g`; the equation reads
identically either way. Free fall was never outside RT's core axioms —
it is what Axiom 5 already says, read in the domain where "pattern" means
"a test particle's worldline."

### Theorem GR.2 (The Newtonian Limit is a Weak-Field Reduction)

**Statement:** In the regime `g_{μν} ≈ η_{μν} + h_{μν}` (a small
perturbation `h` off the flat Minkowski metric `η`, `|h_{μν}| ≪ 1`) and
non-relativistic velocities (`dxⁱ/dτ ≪ dt/dτ`), Axiom 5's geodesic
equation reduces to Newton's second law under gravity, `d²xⁱ/dt² =
-∂Φ/∂xⁱ`, with `g_{00} ≈ -(1 + 2Φ/c²)`.

**Proof sketch:** Substitute the weak-field metric into the geodesic
equation, keep only first order in `h` and lowest order in `v/c`; the
spatial Christoffel symbol `Γⁱ_{00}` reduces to `½∂ⁱh_{00}`, giving
`d²xⁱ/dτ² ≈ -½∂ⁱh_{00}(dt/dτ)²`; identifying `h_{00} = -2Φ/c²` recovers
`d²xⁱ/dt² = -∂ⁱΦ`. (Full expansion, including the `Γⁱ_{0j}`/`Γⁱ_{jk}`
terms that vanish at this order, is standard and omitted here — this is
a reduction of Theorem GR.1, not new content.)

**Remark:** This is the same relationship RT v6.0 §5.1 already states for
quantum mechanics — "an application, not the core." Newtonian gravity is
likewise a *reduction* under a stated approximation regime, not a
fourth axiom sitting beside Axioms 1–8.

---

## Part II — What requires a new axiom

### Signature generalization (required, not optional)

Axiom 1 (RT v6.0 §2) specifies `(M,g,∇)` as a **Riemannian** manifold —
`g` positive-definite. General Relativity's spacetime is
**pseudo-Riemannian (Lorentzian)**: signature `(-,+,+,+)`. This is not a
relabeling. It has a direct, load-bearing consequence for **Axiom 7**:

```
D(t) = d_g(Ψ(t), N)
```

assumes `d_g` is a non-negative real-valued distance. Under Lorentzian
signature, the interval `ds² = g_{μν}dxᵘdxᵛ` between two points can be
**negative** (timelike-separated), **zero** (null/lightlike-separated),
or **positive** (spacelike-separated) — there is no single non-negative
real number playing `d_g`'s role uniformly. `D(t)` as stated in Axiom 7
does not carry over to a Lorentzian `(M,g)` without a genuine
generalization: at minimum, splitting into a **proper-time** observable
(along timelike separations) and a **proper-distance** observable (along
spacelike separations), with null separation as the boundary case where
neither is defined. This document does not resolve that split fully; it
is named here because Axiom 9 below cannot be stated cleanly without
first acknowledging it.

### Axiom 9 (Dynamic Metric — RT Field Equation) — **postulate, not derived**

**Statement:** `g` is not fixed background structure for a system, as
Axiom 1 currently states it. Instead, `g`'s curvature is sourced by a
tensor `Θ_{μν}` built from the observer section `s(t)` and its shift
field `ΔS(t)`:

```
G_{μν}[g] = κ · Θ_{μν}[s, ΔS]
```

where `G_{μν} = R_{μν} - ½R g_{μν}` is the Einstein tensor (built from
`g`'s own Ricci curvature via `∇`, exactly as in standard GR), and `κ` is
a coupling constant playing the role `8πG/c⁴` plays in the standard
Einstein Field Equations.

**Candidate construction for `Θ_{μν}`, offered as a proposal, not a
proof:** the canonical energy-momentum tensor for a section-valued field
(the standard field-theory construction for a sigma-model-like object,
which `s: ℝ → E` structurally resembles):

```
Θ_{μν} = g(∂_μ s, ∂_ν s) - ½ g_{μν} · g(∂_α s, ∂^α s)
```

**This is explicitly labeled Axiomatic/Conjectural, in RT v6.0's own
sense (§10.1's claims table), not Derived.** Nothing in Axioms 1–8 forces
this particular `Θ_{μν}`; it is the standard, principled choice by
analogy to field theory, offered because it is the natural bilinear
construction from objects RT already has (`s`, its derivative), not
because it has been shown to follow from anything already proven.

### Open reconciliation question (stated, not resolved here)

**This is a genuine, unresolved tension, not a detail to smooth over.**
RT's own `Theorem (Continuity, v6.0)` already derives a real conservation
law, `∂_tρ + ∇_μ·j = 0`, from:

```
ρ(t) = ⟨s(t), s(t)⟩_g          j = -g⁻¹(ΔS(t), s(t))^♯
```

`ρ` and `j` are built from `s` **and** `ΔS` together (a probability-density/
current form — structurally the same shape as `|ψ|²` and the quantum
probability current, not a classical kinetic stress-energy tensor). The
`Θ_{μν}` proposed above for Axiom 9 is built from `∂s` **alone** (a
classical kinetic-energy form). **These are not obviously the same
object.** Whether `Θ_{00}` (Axiom 9's time-time component) reduces to
`ρ` under any natural projection, whether Axiom 9's `Θ_{μν}` needs to be
replaced by something built the same way Continuity's `ρ`/`j` were built,
or whether both are legitimate but *different* source constructions
appropriate to different regimes — is not resolved in this document.
Self-consistency of Axiom 9 requires `∇^μΘ_{μν} = 0` (the Bianchi
identity `∇^μG_{μν} ≡ 0` forces this); whether that reduces to, is
implied by, or merely resembles Continuity's own `∂_tρ + ∇_μ·j = 0` is
this document's central open question, named honestly rather than
asserted away.

---

## Status summary (RT v6.0 §10.1 convention)

| Claim | Status |
|---|---|
| Free fall = Axiom 5's geodesic equation | **Theorem** (GR.1), no new axiom |
| Newtonian limit = weak-field reduction of GR.1 | **Theorem** (GR.2), no new axiom |
| `(M,g,∇)` must generalize to Lorentzian signature for GR | **Structural requirement**, established |
| `D(t)` (Axiom 7) needs a proper-time/proper-distance split under Lorentzian signature | **Open**, named but not resolved here |
| `G_{μν}[g] = κΘ_{μν}[s,ΔS]` (Axiom 9) | **Axiomatic / postulated**, not derived |
| The specific kinetic-form `Θ_{μν}` proposed | **Conjectural** — one principled candidate, not proven necessary |
| Reconciliation of Axiom 9's `Θ_{μν}` with Continuity's `(ρ,j)` | **Open** — the central unresolved question of this document |

## Open Questions (RT v6.0 §9 convention)

| Question | Status |
|---|---|
| **GR.1.** Does `Θ_{μν}` (kinetic form) reduce to Continuity's `(ρ,j)` under any natural projection, or are they genuinely different constructions? | Open |
| **GR.2.** What determines `κ`, and does it relate to any quantity already fixed elsewhere in RT? | Open |
| **GR.3.** Does Axiom 9's self-consistency (`∇^μΘ_{μν}=0`) actually hold for the proposed `Θ_{μν}`, or does it force a different construction? | Open |
| **GR.4.** How does Axiom 7's `D(t)` split under Lorentzian signature — is a single generalized observable possible, or are proper-time and proper-distance genuinely separate primitives from here on? | Open |

---

**Next:** Chaos (v8.0) — a refinement of Axiom 4/Theorem 4.2, not a new
manifold structure, expected to be the lighter of the two remaining
documents. The Torus-Infinity capstone follows both, and is expected to
draw on Axiom 8 (time as a reflexive pattern) and whatever GR.4 above
resolves to, for the "time is relative" half of its unification claim.
