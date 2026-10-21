# Navier–Stokes: relational framework

`ns_relational.tex` is the working paper. It treats 3D Navier–Stokes smoothness as a balance between
two relationships: the flow acting on itself, and viscosity.

What it contains:

1. The exact Clay statement (Fefferman (A)–(D)).
2. Scaling, and why energy alone cannot settle the problem (supercriticality).
3. The established theorems the proof may use (Leray–Hopf, Fujita–Kato, BKM, Prodi–Serrin,
   ESS, CKN, Constantin–Fefferman).
4. The two relationships made exact: a scale-by-scale energy budget, and the local Reynolds
   number Re_N, which plays the role of the running coupling g in Yang–Mills.
5. The reduction: global smoothness follows if the dissipation wavenumber Λ(t) stays bounded
   (Cheskidov–Shvydkoy). That bound is stated as the single **open** estimate.
6. The barriers any proof of that estimate must pass (supercriticality, Tao's averaged equation,
   no gradient-flow structure for a fifth-time lift).

Every statement is tagged [Cited], [Elementary] (proof given) or [Open]. Nothing tagged [Open]
is used as a step in a proof.

Build: `pdflatex ns_relational.tex` (needs amsmath, amssymb, amsthm, geometry, hyperref).
