# Theorem (Torus, v9.0): Reflexive Time as a Compact Embedding — Infinity Realized as Periodicity

**Author:** Will Fobbs
**Status:** Draft — capstone of the GR/Chaos pair. One new axiom proposed
and explicitly flagged as a postulate; one theorem needing no new axiom
(quantum phase already lives on a circle); one proposed, explicitly
NOT-certified resolution to GR v7.0's open Question GR.4; one structural
observation connecting relativistic time dilation to number-theoretic
commensurability; one concrete tie to Chaos v8.0's own open question
C.1; and a closing philosophical payoff (why a closed loop, not an
unbounded line, is the right shape for "infinity") that is the reason
this document exists.

This document draws together the two open threads RT v6.0 and
`Theorem_GeneralRelativity_v7.0.md` both left standing, as planned when
GR and Chaos were written: **Axiom 8** (time as a reflexive pattern,
`T(t) = ι(t)`) for its "quantum time" half, and **Question GR.4** (how
`D(t)` should split once `g` goes Lorentzian) for its "time is relative"
half. Neither is merely restated here — both get a concrete, testable
proposal, each honestly labeled by how certain it is.

The formal apparatus is not invented for this document. It is
`research/lib/chain/Torus.js`, already implemented and tested in this
repository: `wrap(t)` (t mod 1, so `t=0` and `t=1` are the identical
point), `gcd(p,q)`/`componentCount(p,q)` (whether two periodic
dimensions cohere into one connected structure or split into disjoint
cycles), `circDist`/`shortestDir` (circular, not linear, distance). This
document is RT's theory catching up to code that was already correct.

---

## Part I — Why a torus, restated precisely

Axiom 8 (RT v6.0 §2) asserts `T(t) = ι(t)`: time is not an external
parameter RT's objects merely move through, but a pattern in `M` in its
own right, reflexively embedded. Axiom 8 says THAT such a `ι` exists. It
says nothing about the SHAPE of `ι`'s image — nothing rules out `ι: ℝ →
M` landing on an unbounded, non-self-intersecting curve (an ordinary
timeline), and nothing in Axioms 1–8 forces it to close up on itself
either. This document's central move is choosing the second option, as
a new, explicit postulate — not derived, in the same sense Axiom 6's
universal anchor and Axiom 9's dynamic `g` were postulated rather than
proved.

---

## Part II — Axiom 11: Reflexive Time is Compactly Periodic

**Statement:** `ι`'s image is not required to be all of `ℝ`. It factors
through a compact, periodic structure: a **torus** `𝕋(p,q) = S¹_p ×
S¹_q`, via

```
ι(t) = ( wrap(t / T_p), wrap(t / T_q) )
```

for two characteristic periods `T_p`, `T_q` (identified with concrete
physical quantities in Parts III–IV below), where `wrap(x) = x mod 1`
is exactly `Torus.js`'s own `wrap()` — `t=0` and `t=1` are the same
point on each circle, not two points that happen to have equal
coordinates.

**Honesty note:** this is NOT forced by Axiom 8. Axiom 8 is silent on
compactness; an unbounded-line `ι` satisfies it equally well. Axiom 11
is offered because a compact `ι` is what makes the rest of this document
possible (quantum phase, recurrence, and the GR.4 proposal below all
need a periodic, not linear, time-image) — the same status Axiom 9's
`Θ_μν` and Axiom 10's `ΔS ≠ 0` have: motivated, principled, not proved
from what came before.

**Why `p` and `q` specifically, not a single circle:** one periodic
dimension is not enough to carry both of Part III's and Part IV's
claims independently — quantum phase and relativistic proper time are
different physical quantities with, in general, unrelated periods, and
collapsing them onto one circle would force a relationship between them
Axioms 1–9 give no reason to assume. Two independent circles, exactly
`Torus.js`'s own `(p,q)` structure, keeps them free to vary
independently while still living in one compact object.

---

## Part III — Theorem Torus.1: Quantum Phase *is* the `p`-circle (no new axiom)

**Statement:** For a normalized Hilbert-space pattern (`Hilbert.js`'s
`normalize()`-produced state, `‖ψ‖_g = 1`), the phase degree of freedom
`ψ → e^{iθ}ψ` already has `θ ∈ U(1) ≅ S¹` — a circle — as a matter of
standard quantum mechanics, before this document adds anything.

**Proof:** Immediate identification, not new content, exactly the
pattern GR.1 (free fall = Axiom 5's geodesic equation) and GR.2
(Newtonian limit) used: `U(1)` phase invariance of a normalized state is
textbook QM, not a claim this document is introducing. Identifying this
pre-existing circle with Axiom 11's `p`-circle (`T_p` := one full `2π`
phase revolution) costs nothing beyond the identification itself.

**What this resolves:** "explains Quantum's view of time" (the user's
own framing motivating this document) is not a metaphor under Axiom 11
— quantum recurrence and phase periodicity were ALREADY circular; Axiom
11 just gives RT's own reflexive-time object the same shape quantum
phase already has, instead of forcing an artificial mismatch between a
linear `ι` and a circular phase.

---

## Part IV — Theorem/Proposal Torus.2: Proper Time as the `q`-circle (a proposed, NOT certified, resolution to GR.4)

Recall **Question GR.4** (`Theorem_GeneralRelativity_v7.0.md`, Part II):
under Lorentzian signature, `D(t) = d_g(Ψ(t), N)` (Axiom 7) breaks,
because `d_g` is no longer a single non-negative real — intervals can be
timelike, spacelike, or null. GR v7.0 named this problem and explicitly
left it open, "a proper-time/proper-distance split... not resolved in
this document."

**Proposal:** don't force `D(t)` back into being one scalar. Let it
factor through Axiom 11's compact structure instead, the same way
quantum phase already does. For a timelike worldline, proper time
```
τ(t) = ∫ √(−g_{μν} dx^μ dx^ν)
```
is already well-defined (it is the standard GR proper-time integral,
using exactly the Lorentzian `g` Axiom 9 introduced). Wrapping `τ` by a
chosen reference period `T_q` (one tick of a reference clock — any
physical periodic process, e.g. a fixed atomic transition) gives the
`q`-circle coordinate: `wrap(τ(t) / T_q)`.

**Status — explicitly proposed, not certified:** this is offered as ONE
candidate resolution, not a proof that it is THE resolution. It
resolves the **timelike** half of GR.4's split cleanly (proper time was
always well-defined; this just gives it a periodic coordinate instead of
leaving Axiom 7's `D(t)` broken). It does **not** address the
**spacelike** half at all — proper DISTANCE along a spacelike separation
gets no treatment here, and GR.4 remains genuinely open for that case.
Labeling this a full resolution of GR.4 would overclaim; it resolves the
half this document's own apparatus (compact, periodic `ι`) is suited to.

---

## Part V — Theorem/Observation Torus.3: Commensurability *is* the geometric content of time dilation

`Torus.js`'s `componentCount(p,q) = gcd(p,q)` already encodes a real
structural fact: two independent periodic dimensions either combine into
**one** connected `p·q`-point structure (`gcd=1`, coprime) or split into
`gcd(p,q)` **disjoint**, shorter cycles.

**Observation:** two observers with independently evolving proper times
(Part IV) generally have UNRELATED reference periods `T_q`, `T_q'` — for
two clocks under different, independent accelerations, nothing in GR
forces their periods into a rational ratio. In `Torus.js`'s own terms,
this is the generic, high-`gcd`-unlikely case: their joint trajectory
does not close into a short, frequently-recurring cycle. It behaves like
the `gcd=1` case — a single long structure that must be traversed in
full before the two clocks' `wrap()`ped phases coincide again.

**Interpretation, offered as structural, not as a new proven theorem:**
this is a plausible geometric restatement of why reuniting two
clocks/twins after independent proper-time histories (the twin paradox)
requires a SPECIFICALLY ENGINEERED shared endpoint (a chosen, common
worldline reunion), rather than something that "just happens" from
generic dynamics — commensurate (`gcd>1`, rationally-related) periods
recur on their own; incommensurate ones structurally do not, and must be
brought back together deliberately. This is offered as an
interpretation the Torus apparatus makes available, not as a new proof
of anything GR does not already establish through the standard
proper-time integral.

---

## Part VI — Connection to Chaos v8.0's Open Question C.1

Two independent periodic dimensions whose ratio sits near — but not
exactly at — a rational value is **classical circle-map territory**:
Arnold tongues, mode-locking, the same well-studied setting where
quasi-periodic (bounded, non-repeating, non-chaotic) motion borders
periodic motion, and where the Lyapunov exponent `λ` introduced in
`Theorem_Chaos_v8.0.md` Part IV naturally sits near `0` — exactly the
`λ ≈ 0` intermittency case Chaos v8.0's Open Question C.1 asks about.

**Conjecture, stated to be checked, not asserted:** if RT v6.0's
unresolved `ρ(t)` "plateau-resume" pattern (the same empirical finding
Chaos v8.0 Part V already targets) reflects near-rational
commensurability between whatever two periodic processes underlie a
given Beacon Loop trace, then "plateau" phases correspond to
near-mode-locked (low `gcd`-like, short-cycle) regions and "resume"
phases correspond to escaping one. This is the SAME falsifiable check
Chaos v8.0 C.1 already proposes (estimate `λ` from a `runBeaconLoop`
trace), now with a candidate geometric explanation for WHY `λ` might
sit near zero when it does — not a new empirical claim, and not yet
checked against data by this document either.

---

## Part VII — "Empty ≡ Infinity": the actual payoff

`Torus.js`'s own worked example states it plainly: `Torus.wrap(1.25) //
0.25 — t=0 and t=1 are the same point (empty === infinity)`. This is
the reason this document exists, restated formally: under Axiom 11,
**infinite continuation of time is not represented by an unbounded
object** (an ever-extending line, needing unboundedly more "room" to
keep going) — **it is represented by structural return.** Continuing
`ι` forward forever costs nothing beyond what the torus already is; no
new capacity is consumed by more time passing, because "further" and
"around again" are the same motion once the image is compact.

This reframes Axiom 6's universal anchor `N` and Theorem 4.6's Lyapunov
function `V(p) = d_g(p, 𝓛)` in genuinely new terms. On a compact phase
space, a form of Poincaré recurrence applies in a way it structurally
cannot on `ℝ`: bounded orbits in bounded regions must return arbitrarily
close to earlier states infinitely often. A pattern's approach to the
Lasagna set `𝓛` becomes, under Axiom 11, a **recurrence** question — how
often and how closely a trajectory returns near `𝓛` — not merely an
asymptotic `t → ∞` one. **This is named as a genuinely new open
question (T.5 below), not resolved here** — RT v6.0's existing apparatus
was built without compactness in mind, and working out what Poincaré
recurrence actually implies for `V(p)` and `𝓛` is real, unfinished work.

---

## Status summary (RT v6.0 §10.1 convention)

| Claim | Status |
|---|---|
| `ι`'s image is compact/periodic, `𝕋(p,q)` (Axiom 11) | **Axiomatic / postulated**, not derived from Axiom 8 |
| Quantum phase = the `p`-circle (Torus.1) | **Theorem**, no new axiom — standard QM `U(1)` phase, just identified |
| Proper time = the `q`-circle, resolving GR.4's timelike half (Torus.2) | **Proposed**, explicitly not certified; spacelike half of GR.4 untouched |
| Commensurability ↔ time-dilation resynchronization (Torus.3) | **Structural observation / interpretation**, not a new proof |
| `λ≈0` / plateau-resume ↔ near-rational commensurability (Part VI) | **Conjectural**, ties to Chaos v8.0's C.1, not checked against data here |
| Infinity realized as periodicity, not extent (Part VII) | **Interpretive payoff** — the actual point of Axiom 11 |
| `V(p)`/`𝓛` under Poincaré recurrence | **Open** — named, not worked out |

## Open Questions (RT v6.0 §9 convention)

| Question | Status |
|---|---|
| **T.1.** Is there a principled way to fix `T_p`, `T_q` (the two reference periods), or are they genuinely observer/system-relative choices, the same way Chaos v8.0's `Φ_t^{(p)}` split was left relative (C.2)? | Open |
| **T.2.** Does Theorem Torus.2 actually resolve GR.4's timelike half rigorously, or does the Lorentzian proper-time integral itself need boundary conditions this document has not stated? | Open |
| **T.3.** What is the spacelike analogue — does a proper-DISTANCE circle exist, or is spacelike separation structurally not periodic in the way timelike separation is? (GR.4's other half, still fully open) | Open |
| **T.4.** Does estimating commensurability (a rational-approximation / continued-fraction analysis) of two independently-derived periods from real Beacon Loop data actually correlate with `λ`'s sign/magnitude, as Part VI conjectures? | Open — checkable against the same data Chaos v8.0 C.1 targets |
| **T.5.** What does Poincaré recurrence on a compact `𝕋(p,q)` actually imply for Theorem 4.6's `V(p) = d_g(p,𝓛)` and the Lasagna set `𝓛`? | Open — named in Part VII, not worked out |

---

**Closing note — this is the capstone, not a pointer to a next
document.** GR (v7.0), Chaos (v8.0), and Torus (v9.0) were planned
together as one arc; what remains open across all three (GR.1–GR.4,
C.1–C.3, T.1–T.5) is now consolidated in one place rather than scattered
across three separate "Next" sections. Several of these open items are
now concretely checkable against data this project already has
(`runBeaconLoop`'s `ρ(t)` trace) — the natural next PRACTICAL step is
running those checks, not drafting a fourth document.
