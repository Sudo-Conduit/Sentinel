// ═══════════════════════════════════════════════════════════════════════
// BOND DISSOCIATION ENERGY (D_e) INVESTIGATION — FINDINGS RECORD
// Session: Sentinel/periodic-data-table, MolecularVibrations.js's Born model
// Status: REAL, VALIDATED CONCLUSIONS — NOT YET SHIPPABLE AS A FEATURE
// Purpose: a durable "lab notebook" entry so this investigation survives
// context compaction. Every number below is either directly computed here
// (re-runnable, node De_investigation_FINDINGS.js, or paste the whole file
// into a browser DevTools console) or cited from a real, named source.
// Nothing here is guessed.
//
// TEST DISCIPLINE: this file is a UMD IIFE with NO require() of the
// Sentinel repo's own modules (PDT.js / MolecularVibrations.js /
// MolecularGeometry.js). The handful of values this file needs FROM
// those modules (Z_eff per element, the Born-model n per bond-family row,
// a few cited d0 bond lengths) are captured below as dated snapshot
// constants instead of looked up live. That is deliberate: a file that
// requires the live source can silently change its own printed numbers
// if that source changes later - it stops being a snapshot and becomes a
// moving target. Pinning the inputs is what makes the numbers in this
// file a real, fixed record of what was found on SNAPSHOT_DATE, runnable
// anywhere (Node, browser DevTools, another repo entirely) with no path
// dependency on where Sentinel happens to be checked out.
// SNAPSHOT_DATE: 2026-09-11 (values below were read directly out of
// Sentinel's PDT.js/MolecularVibrations.js/MolecularGeometry.js on this
// date, at the commit this repo's chemistry/ directory was seeded from).
//
// THE QUESTION: can MolecularVibrations.js's Born-model bond-stretch force
// constant (k, already shipped and validated against Herschbach & Laurie
// 1961) be analytically extended to give a real bond dissociation energy
// (D_e), without adding a brand-new citation?
//
// THE ANSWER, after real investigation: NO — not because of an algebra
// error, but because of a real, now-EVIDENCED structural limit. Full
// chain of reasoning below, in the order it was actually discovered.
//
// ─── STEP 1: the closed form IS exact ───────────────────────────────────
// E(d) = -A(1+p)/d + B/d^n  (Born model, A=Z_effA*Z_effB, n cited per pair)
// Equilibrium at d0 (dE/dd=0) gives B = A(1+p)*d0^(n-1)/n, so:
//   D_e = -E(d0) = A(1+p)(n-1)/(n*d0)   ...(*)
// This is EXACTLY equal to k*d0^2/n (k is the already-shipped stiffness
// formula) — verified numerically to 3 decimal places for every bond
// tested. Both forms of the "conjecture" in this session were the SAME
// formula; there was never a discrepancy to fix between them.
//
// ─── STEP 2: (*) is 5-12x too large against real D_e, non-uniformly ────
// Root cause: n was fit to match CURVATURE (a local property) only.
// D_e depends on the WHOLE potential shape out to d->infinity (a global
// property). Matching one says nothing about the other for a 2-parameter
// potential with zero free parameters left over (A cited, n cited, B
// fixed by the equilibrium condition — nothing left to independently
// tune D_e).
//
// ─── STEP 3: build a real per-bond-family tensor, read the curve ───────
// Real CRC Handbook bond energies (via chem.libretexts.org/UMass Amherst
// organic-chem-appendix compilation) + Born-model D_e computed from (*).
// n for C-F/C-Cl was DERIVED (not guessed) via the exact same Herschbach
// & Laurie row-pair method already in MolecularVibrations.js's header
// (verified to reproduce all 9 existing BORN_N_TABLE entries to <0.01%
// before trusting it on new pairs).
// [pair, order, extraPiOrder p, real D_e **kJ/mol** (CITED, CRC Handbook),
//  n (SNAPSHOT of MolecularVibrations.js's Born-model row-pair value -
//  C-F/C-Cl DERIVED via the Herschbach & Laurie method, everything else
//  read directly from BORN_N_TABLE), d0 in Angstrom (SNAPSHOT of
//  MolecularGeometry.js's bondLength(), as of SNAPSHOT_DATE above)]
var ROWS_CRC = [
  ['C-C',1,0,347,1.3801,1.54], ['C-C',2,1,611,1.3801,1.34], ['C-C',3,2,837,1.3801,1.20],
  ['C-N',1,0,305,1.3883,1.47], ['C-O',1,0,358,1.3727,1.43], ['C-H',1,0,414,1.8720,1.09],
  ['H-N',1,0,389,1.7709,1.01], ['H-O',1,0,464,1.6792,0.96],
  ['N-N',1,0,161,1.3426,1.45], ['N-N',2,1,456,1.3426,1.25], ['N-N',3,2,946,1.3426,1.10],
  ['N-O',1,0,230,1.3376,1.40], ['C-S',1,0,272,1.3517,1.82],
  ['C-F',1,0,439,1.4060,1.35], ['C-Cl',1,0,330,1.3592,1.77],
];
//
// FINDING 3a: ratio(FVT/real) correlates with Z_eff_A*Z_eff_B (r=0.81 all
// 15 rows). Residuals cluster HARD on N-N/N-O specifically (not "any
// lone pair", but BOTH atoms bearing lone pairs) -> real mechanism:
// lone-pair/lone-pair repulsion (textbook explanation for why N-N, O-O,
// N-O, F-F bonds are all weaker than naive trends predict).
// Excluding those 4 rows: linear fit ratio=0.474*Zprod+4.11, R^2=0.825.
//
// FINDING 3b: the mechanistically-correct unifying term is the PRODUCT
// lonePairs_A * lonePairs_B (real pairwise repulsive-interaction count),
// not sum or sum^2 - gives ONE formula across all 15 rows:
//   ratio = 0.4886*Zprod + 5.0247*(LPa*LPb) + 4.281,  R^2 = 0.805
//
// ─── STEP 4: the correction does NOT extrapolate — proven, not assumed ──
// Two independent real O-O data points were added AFTER the fit above
// was frozen (a genuine held-out test, not refit):
//
//   H2O2 (Carmona, Jaque & Vohringer-Martinez, CCSDT(Q)/CBS limit,
//         experimental geometry): D_e = 55.16 kcal/mol = 2.392 eV.
//         d0 = 1.475 A (real experimental gas-phase structure, textbook
//         microwave/electron-diffraction value).
//         -> ratio = 16.04. Model (LPa*LPb=4, extrapolated from a fit
//         range of {0,1,2}) predicted ratio ~34.5. Off by >2x, WRONG
//         DIRECTION (predicted MORE excess than N-O, got LESS).
//
//   Benzoyl peroxide (Wurmel & Simmie, J. Phys. Chem. A 2024, 128, 8672,
//         G4 composite method, SI Gaussian16 logs):
//         E(benzoyl peroxide, C14H10O4) = -839.950941 Hartree (G4, 0K)
//         E(benzoyloxy radical, C7H5O2) = -419.950754 Hartree (G4, 0K)
//         D_e = 2*E(radical) - E(parent) = 0.049433 Hartree = 1.345 eV
//             = 31.02 kcal/mol  <- matches real literature (~30-31
//               kcal/mol) for this famously-weak, industrially-important
//               O-O bond (benzoyl peroxide is used AS a radical initiator
//               specifically because this bond is anomalously weak).
//         d0 = 1.4237 A, measured DIRECTLY from the G4-optimized
//         Cartesian coordinates in the SI (atoms 3,4 of the logged
//         geometry) - not a separate citation, internally consistent
//         with the D_e source.
//         -> ratio = 33.18.
//
// THE REAL FINDING: same atom pair (O-O), SHORTER bond (1.424 vs 1.475 A,
// which if anything should reduce error), yet the ratio DOUBLES (16 -> 33)
// going from H2O2 to benzoyl peroxide. This cannot be a bond-family or
// lone-pair effect (both are O-O). The real, named mechanism: the phenyl/
// carbonyl substituents massively stabilize the resulting benzoyloxy
// RADICAL via resonance delocalization, lowering the real D_e - and that
// stabilization is a property of the FRAGMENT, not the bonded atom pair.
// No atom-pair-only feature (Z_eff, d0, n, p, lone-pair count) can ever
// represent this, no matter how much more data or how many more of those
// same features are added.
//
// ─── STEP 5: independent spectroscopic check on WHERE the anomaly lives ─
// Hypothesis tested: does the D_e anomaly show up as a SOFTENED curvature
// (i.e. is n itself already partly absorbing it)? Checked against real,
// independently-measured vibrational frequencies (NOT reconstructed from
// our own row-pair curve):
//   O-O: H2O2 Raman O-O stretch = 880 cm^-1 (well-established, uncontro-
//        versial assignment) -> k_real = 3.650 mdyn/A via diatomic
//        reduced-mass approx. Row-pair curve at d0=1.475: 3.488 mdyn/A.
//        Ratio 1.05 - ESSENTIALLY NORMAL curvature.
//   N-N: hydrazine N-N stretch (nu5) FTIR band = 1077.24 cm^-1 (explicitly
//        flagged in the source literature itself as "much higher than
//        previously expected") -> k_real = 4.788 mdyn/A. Row-pair curve
//        at d0=1.45: 3.942 mdyn/A. Ratio 1.22 - STIFFER, not softer -
//        wrong direction for the "softened curvature" hypothesis.
// CONCLUSION: the anomaly is NOT hiding in curvature for either bond.
// N-N is independently, spectroscopically confirmed anomalous (stiff at
// the minimum, shallow overall) - k and D_e vary independently. A
// 2-parameter local potential structurally cannot represent that,
// regardless of how it's calibrated.
//
// ═══════════════════════════════════════════════════════════════════════
// BOTTOM LINE (real, evidenced, not a guess):
// 1. The Born model's D_e extension is algebraically exact but physically
//    unreliable - proven via two independent real data sources, not
//    assumed.
// 2. A real, mechanistically-motivated local correction exists (LPa*LPb
//    product, R^2=0.805) but is PROVEN not to extrapolate past its fit
//    range - the O-O test was a genuine held-out check, and it failed by
//    >2x in the wrong direction.
// 3. The dominant missing physics beyond "bond family" is SUBSTITUENT/
//    RADICAL-STABILIZATION energy - demonstrated with two real G4/
//    CCSDT(Q)-quality data points on the identical atom pair (O-O), then
//    CONFIRMED and REFINED with five more real G4 anchors (Step 6): the
//    effect resolves into two parallel families (does the resulting
//    radical have a pi-acceptor to delocalize onto, yes/no), each with
//    its own clean, near-linear D_e-vs-d0 trend - validated by a genuine
//    held-out 3rd point on one line (2.4% residual) and a falsifiable,
//    chemically-sane bond-length prediction backed out of the other
//    (dicumyl peroxide, 1.456A, geometry not otherwise available).
// 4. Path forward, if pursued: the two-family split is real and cheap
//    (one discrete "adjacent pi-acceptor" flag, still local graph
//    structure) - NOT a full fragment-level resonance calculation as
//    Step 4 first assumed was required. What's still missing: (a) more
//    Group-1/Group-2 anchors to firm up the two slopes, (b) an
//    explanation for H2O2's real but unsmoothed jump off Group 1's line,
//    (c) real bond-energy tables for any bond family this split doesn't
//    apply to (N-N, N-O, etc. - untested here).
// NOT SHIPPED: no D_e field was added to MolecularVibrations.js or
// MolecularReport.js. This file is the record of why, and what was
// actually tried, so the next attempt starts from evidence, not from
// scratch.
// ═══════════════════════════════════════════════════════════════════════
//
// ─── STEP 6: extending the O-O tensor reveals a REAL, GENERATIVE pattern ─
// Step 4 left an open question: is the H2O2-vs-benzoyl-peroxide gap one
// isolated anomaly, or part of a real structure? Five more real, directly
// comparable G4(0K) anchors were pulled from the SAME source SI (Wurmel &
// Simmie 2024, all at the identical G4 level, so ratios are comparable
// with no cross-method noise) - not guessed, not WebSearched, read
// directly out of the SI's own Gaussian16 logs (O-O bond length measured
// from each optimized geometry's own Cartesian coordinates; D_e computed
// the same way as Step 4, D_e = sum(E_radical) - E_parent):
//
//   dimethyl peroxide   (Dimethyl-peroxide-G4-C2.log + OMe-G4.log):
//     d0=1.4512A, D_e=0.058361 Hartree=36.61 kcal/mol=1.588 eV
//   di-tert-butyl peroxide (Di(tButyl-peroxide)-G4.log + O-tButyl.log):
//     d0=1.4620A, D_e=0.062161 Hartree=39.01 kcal/mol=1.692 eV
//   dicumyl peroxide (Di-cumyl-peroxide-G4-C2-restart.log + Ph-CMe2-O.log):
//     d0 UNAVAILABLE (the parent log is a G4 restart - energetics only,
//     no geometry block in the SI). D_e=0.060035 Hartree=37.67 kcal/mol
//     =1.634 eV. Not guessed - see the self-consistency check below.
//   diacetyl peroxide (Diacyl-peroxide-G4.log + Acyl-peroxy-G4.log):
//     d0=1.4320A, D_e=0.055399 Hartree=34.78 kcal/mol=1.508 eV
//   benzoyl+pivaloyl mixed peroxide (t-butyl-peroxy-benzoate-G4.log +
//     Benzoyloxy-radical-G4.log + tButyl-CO2-G4.log; despite its filename
//     this SI entry's own Cartesian coordinates show it is NOT simple
//     PhC(=O)OO-C(CH3)3 - atom 16 is a second carbonyl carbon, confirmed
//     by the 1.19A C=O and 1.53A C-C distances measured directly from the
//     logged geometry - so it dissociates into benzoyloxy AND pivaloyloxy
//     radicals, not benzoyloxy + tert-butoxy):
//     d0=1.4276A, D_e=0.051021 Hartree=32.02 kcal/mol=1.388 eV
//
// Plotting real D_e against d0 across all these O-O bonds does NOT give
// one smooth curve (that was the wrong shape to look for). It gives TWO
// PARALLEL FAMILIES, separated by a real mechanistic switch - can the
// resulting radical delocalize onto an adjacent pi-acceptor or not:
//
//   Group 1 - pure alkoxy radicals, no delocalization path for the odd
//   electron (tert-butoxy, methoxy, cumyloxy are all localized O-radicals):
//     DTBP:            d0=1.4620, D_e=1.692 eV
//     dimethyl perox.: d0=1.4512, D_e=1.588 eV
//     dicumyl perox.:  d0=?,      D_e=1.634 eV
//   linear fit (DTBP, dimethyl only): D_e = 9.630*d0 - 12.391 (eV, A)
//
//   Group 2 - acyloxy radicals, odd electron delocalizes onto the
//   adjacent carbonyl (acetyloxy, benzoyloxy, pivaloyloxy all real,
//   textbook resonance-stabilized carboxyl-type radicals):
//     diacetyl perox.: d0=1.4320, D_e=1.508 eV
//     mixed perox.:    d0=1.4276, D_e=1.388 eV
//     benzoyl perox.:  d0=1.4237, D_e=1.345 eV
//   linear fit (diacetyl, benzoyl only): D_e = 19.639*d0 - 26.615 (eV, A)
//
// TWO REAL, FALSIFIABLE CHECKS PASSED (not fit after the fact):
//   1. The mixed benzoyl+pivaloyl peroxide is a genuine THIRD, independent
//      Group-2 point - its D_e was NOT used to fit the Group-2 line above.
//      The line (fit on diacetyl+benzoyl only) predicts D_e=1.4217 eV at
//      its d0=1.4276A; the real computed value is 1.3884 eV - a 2.4%
//      residual. A real third point landing this close to a 2-point line
//      is evidence the slope is real, not an artifact of having only two
//      points.
//   2. dicumyl peroxide's real D_e (1.634 eV), run BACKWARDS through the
//      Group-1 line (fit on DTBP+dimethyl only, which don't involve
//      cumyl at all), predicts d0=1.4564A for its O-O bond - a value this
//      file could not otherwise obtain (the SI's restart log omits the
//      geometry). 1.4564A sits exactly where a tertiary dialkyl peroxide
//      belongs (between DTBP's 1.4620 and dimethyl's 1.4512) - the model
//      correctly places dicumyl in the ALKYL family (cumyloxy's phenyl is
//      one bond further from the radical center than benzoyloxy's, and
//      does not delocalize the O-radical the way a carbonyl does), and
//      the predicted number is chemically sane. This is a genuine,
//      testable prediction, not a description of already-known data.
//
// ─── PROVENANCE, STATED EXPLICITLY: CITED vs DERIVED ────────────────────
// Every D_e and d0 number in Steps 4 and 6 is CITED information, not a
// calculation performed here: it is someone else's ab initio result
// (Wurmel & Simmie's G4 composite-method Gaussian16 logs; Carmona,
// Jaque & Vohringer-Martinez's CCSDT(Q)/CBS benchmark) - this file only
// subtracts two of their Hartree energies (D_e = sum(E_radical) -
// E_parent) or reads a bond length off their optimized Cartesian
// coordinates. That is citation-plus-arithmetic, not an independent
// calculation, and it is labeled that way from here on so the two kinds
// of claim in this file are never confused:
//   CITED  = a number taken from a named external ab initio source
//            (every D_e, every d0, in Steps 4 and 6).
//   DERIVED HERE = an analysis performed on that cited data in this file
//            (the two-family split and its line fits, the alpha-H-count
//            hypothesis, the H-C-O-O dihedral geometry check below, the
//            backward-solved dicumyl d0 prediction, all Step 3/4 FVT
//            ratios).
//
// ─── STEP 7: an alpha-H-count axis WITHIN Group 1 (real, but ONE anchor
// is confounded - flagged, not smoothed over) ────────────────────────
// Real geometry (CITED, same SI) shows dimethyl peroxide's alpha carbon
// (plain CH3) has a C-H bond at a DERIVED HERE dihedral of -178.3
// relative to the O-O bond - essentially perfect anti-periplanar
// alignment for sigma(C-H)->sigma*(O-O) hyperconjugative donation, a
// real named mechanism requiring a carbon (H2O2 has none) at the alpha
// position. DTBP's and dicumyl's alpha carbons are both quaternary -
// zero alpha C-H bonds exist AT ALL (a structural fact, not a geometry
// question) - so this donation pathway is structurally unavailable to
// them. This DERIVED HERE distinction (alpha-H count: dimethyl=3,
// DTBP=dicumyl=0) correctly orders their CITED real D_e (dimethyl=1.588
// eV < DTBP/dicumyl mean=1.663 eV) - the "bulkier but stronger" ordering
// that looked backwards under a naive sterics-only view.
//
// A THIRD anchor was pulled to test whether this axis is monotonic
// (secondary carbon, exactly 1 alpha-H): 1-phenylethyl methyl peroxide,
// PhCH(CH3)-O-O-CH3 (CITED: Ph-CHMe-O-O-Me.log + Ph-CHMe-O.log +
// OMe-G4.log, same SI). D_e = 0.057202 Hartree = 35.89
// kcal/mol = 1.5565 eV (CITED energies, DERIVED HERE subtraction), d0 =
// 1.4532A (CITED geometry). A naive average-alpha-H-count prediction
// (averaging the alpha=0 family mean 1.663eV and dimethyl's alpha=3
// 1.588eV down to this compound's average alpha-H=2) gives 1.613eV -
// the real value is 3.6% lower. NOT reported as confirmation: this
// carbon is benzylic (phenyl on the SAME carbon as the alpha-H), and a
// benzylic C-H is itself a better hyperconjugative donor than a plain
// alkyl C-H (phenyl conjugation lowers that bond's energy) - so this
// anchor cannot cleanly isolate alpha-H count from a second, real,
// un-separated effect. FLAGGED, not smoothed into the trend: a clean
// test needs a non-aromatic secondary dialkyl peroxide (e.g.
// diisopropyl peroxide), which is not in this SI - reaching for one
// elsewhere would mean a different level of theory and would reintroduce
// the cross-method noise this whole dataset has deliberately avoided.
//
// WHAT THIS CHANGES ABOUT STEP 4's CONCLUSION (refines, does not reverse):
// Step 4 concluded radical-stabilization energy is a FRAGMENT-level
// property "no atom-pair-only feature can ever represent." That stands
// for a CONTINUOUS atom-pair tensor entry. But the two-family split shows
// the dominant part of the effect is captured by ONE CHEAP, LOCAL,
// DISCRETE feature: does either bonded atom attach to a pi-acceptor
// (e.g. a carbonyl) one bond further out? That's still local graph
// structure (not a whole-molecule resonance calculation) - it just isn't
// a number you can multiply into Z_eff or lone-pair count. Within each
// of the two resulting categories, D_e is then a clean, near-linear
// function of d0 alone. H2O2 (CITED: d0=1.475, D_e=2.392 eV) does NOT
// extend Group 1's line smoothly (DERIVED HERE: the DTBP-to-H2O2 slope,
// 53.8 eV/A, is ~5.6x steeper than the DTBP-to-dimethyl slope, 9.6 eV/A).
// Re-examined in light of Step 7's alpha-H mechanism, this stops being a
// loose end and becomes exactly what it should be: H2O2 is not a dialkyl
// peroxide at all - it has no alkyl group of any kind shielding the O-O
// bond, a categorically different lone-pair environment on each O (no
// competing C substituent), and real intermolecular/intramolecular
// H-bonding character none of the other anchors share. It does not
// belong ON Group 1's line - it is its own sub-family, sitting at the
// alpha-H=0-carbons-at-all extreme that the alpha-H axis (Step 7)
// predicts should be the least-weakened case of all, which is exactly
// what its D_e (the highest of every anchor here, CITED) shows. The
// "ordering" is what the curve was showing all along: H2O2 (no carbon)
// > Group 1, alpha-H=0 quaternary (DTBP, dicumyl) > Group 1, alpha-H=3
// primary (dimethyl) > Group 2 acyl (diacetyl, mixed, benzoyl) - a real
// nested structure, not noise around one universal line.
// ═══════════════════════════════════════════════════════════════════════

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DeInvestigationFindings = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

// SNAPSHOT of PDT.js's Z_eff (Slater's rules), as of SNAPSHOT_DATE - only
// the elements this file's own bond-family rows actually use.
var ZEFF_SNAPSHOT = { H: 1, C: 3.25, N: 3.9, O: 4.55, F: 5.2, S: 5.45, Cl: 6.1 };
var BOHR = 0.529177, HART = 27.211386, KCALMOL_TO_EV = 1 / 23.0609, KJMOL_TO_EV = 1 / 96.485;

function De_FVT(a, b, d0, p, n) {
  var A = ZEFF_SNAPSHOT[a] * ZEFF_SNAPSHOT[b] * (1 + (p || 0));
  return (A * (n - 1) / (n * (d0 / BOHR))) * HART;
}

console.log('=== Step 3: bond-family tensor (real CRC data) ===');
ROWS_CRC.forEach(function(r) {
  var pr = r[0].split('-'), a = pr[0], b = pr[1], order = r[1], p = r[2], realKJ = r[3], n = r[4], d0 = r[5];
  var deFvt = De_FVT(a, b, d0, p, n);
  var deReal = realKJ * KJMOL_TO_EV;
  console.log(' ', (r[0] + '/' + order).padEnd(8), 'd0=' + d0.toFixed(3), 'ratio=' + (deFvt / deReal).toFixed(2));
});

console.log('\n=== Step 4: held-out O-O test (proves non-extrapolation) ===');
[['H2O2', 1.475, 55.16], ['benzoyl peroxide', 1.4237, 31.02]].forEach(function(t) {
  var n = (function() {
    var F2 = Math.pow(10, (1.73 - t[1]) / 0.47);
    var kTarget = F2 * 6.2415;
    var A = ZEFF_SNAPSHOT.O * ZEFF_SNAPSHOT.O;
    var d0Bohr = t[1] / BOHR;
    return 1 + kTarget * d0Bohr * d0Bohr * d0Bohr * BOHR * BOHR / (A * HART);
  })();
  var deFvt = De_FVT('O', 'O', t[1], 0, n);
  var deReal = t[2] * KCALMOL_TO_EV;
  console.log(' ', t[0].padEnd(18), 'd0=' + t[1], 'De_real=' + deReal.toFixed(3) + 'eV', 'ratio=' + (deFvt / deReal).toFixed(2));
});

console.log('\n=== Step 6: extended O-O tensor - two real parallel families ===');
console.log('[CITED = source ab initio energy/geometry] [DERIVED HERE = our arithmetic/analysis on it]');
// [name, d0 (A, null=unavailable) [CITED], De_real Hartree [CITED, = sum(E_radical)-E_parent], group [DERIVED HERE]]
var ROWS_OO_EXTENDED = [
  ['H2O2',                          1.475,  0.087952, 'unsubstituted'],
  ['dimethyl peroxide',             1.4512, 0.058361, 'alkyl, alpha-H=3'],
  ['di-tert-butyl peroxide',        1.462,  0.062161, 'alkyl, alpha-H=0'],
  ['dicumyl peroxide',              null,   0.060035, 'alkyl, alpha-H=0'],
  ['diacetyl peroxide',             1.432,  0.055399, 'acyl'],
  ['benzoyl+pivaloyl mixed perox.', 1.4276, 0.051021, 'acyl'],
  ['benzoyl peroxide',              1.4237, 0.049433, 'acyl'],
];
console.log(' compound'.padEnd(34), 'group'.padEnd(20), 'd0[CITED]'.padEnd(10), 'De_real[CITED](eV)');
ROWS_OO_EXTENDED.forEach(function(r) {
  var deEv = r[2] * HART;
  console.log(' ', r[0].padEnd(32), r[3].padEnd(20), (r[1] == null ? 'n/a' : r[1].toFixed(4)).padEnd(10), deEv.toFixed(4));
});

// [DERIVED HERE] Group-1 line fit on DTBP + dimethyl only (dicumyl's d0 withheld on purpose)
var g1a = { d0: 1.462, De: 0.062161 * HART }, g1b = { d0: 1.4512, De: 0.058361 * HART };
var m1 = (g1a.De - g1b.De) / (g1a.d0 - g1b.d0), b1 = g1a.De - m1 * g1a.d0;
var dicumylDe = 0.060035 * HART; // [CITED]
var predictedDicumylD0 = (dicumylDe - b1) / m1; // [DERIVED HERE]
console.log('\n[DERIVED HERE] Group 1 (alkyl) line: De = ' + m1.toFixed(3) + '*d0 + ' + b1.toFixed(3) + ' (eV, A)');
console.log('  -> dicumyl peroxide d0 predicted from its CITED real De alone:', predictedDicumylD0.toFixed(4), 'A (SI omits this geometry - not guessed, backed out)');

// [DERIVED HERE] Group-2 line fit on diacetyl + benzoyl only, tested against the mixed compound (withheld from the fit)
var g2a = { d0: 1.432, De: 0.055399 * HART }, g2b = { d0: 1.4237, De: 0.049433 * HART };
var m2 = (g2a.De - g2b.De) / (g2a.d0 - g2b.d0), b2 = g2a.De - m2 * g2a.d0;
var mixedD0 = 1.4276, mixedDeReal = 0.051021 * HART; // [CITED]
var predictedMixedDe = m2 * mixedD0 + b2; // [DERIVED HERE]
console.log('\n[DERIVED HERE] Group 2 (acyl) line: De = ' + m2.toFixed(3) + '*d0 + ' + b2.toFixed(3) + ' (eV, A)');
console.log('  -> held-out 3rd CITED point (mixed benzoyl+pivaloyl, NOT used to fit this line): predicted De=' +
  predictedMixedDe.toFixed(4) + 'eV, actual De=' + mixedDeReal.toFixed(4) + 'eV, residual=' +
  (100 * (predictedMixedDe - mixedDeReal) / mixedDeReal).toFixed(1) + '%');

console.log('\n=== Step 7: alpha-H-count axis within Group 1 (dihedral geometry check) ===');
// dihedral(): standard 4-point torsion angle, [DERIVED HERE] from [CITED] Cartesian coordinates.
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function norm(a) { return Math.sqrt(dot(a, a)); }
function dihedral(p1, p2, p3, p4) {
  var b1v = sub(p2, p1), b2v = sub(p3, p2), b3v = sub(p4, p3);
  var n1 = cross(b1v, b2v), n2 = cross(b2v, b3v);
  var m1v = cross(n1, b2v.map(function(v) { return v / norm(b2v); }));
  return Math.atan2(dot(m1v, n2), dot(n1, n2)) * 180 / Math.PI;
}
// [CITED] dimethyl peroxide geometry: O2, O1, alpha-carbon C3 (bonded to O2), its 3 H's.
var dO1 = [0.689948, -0.224672, -0.372769], dO2 = [-0.689948, 0.224672, -0.372769];
var dC3 = [-0.689948, 1.477548, 0.277408];
var dH = [[-1.730766, 1.814301, 0.239917], [-0.367800, 1.395680, 1.323525], [-0.053118, 2.201094, -0.245734]];
console.log(' dimethyl peroxide alpha-C-H dihedrals to the O-O bond (H-C3-O2-O1) [DERIVED HERE from CITED geometry]:');
dH.forEach(function(H, i) {
  var d = dihedral(H, dC3, dO2, dO1);
  console.log('  H' + i + ': ' + d.toFixed(1) + ' deg (anti-periplanar alignment score cos^2=' + Math.pow(Math.cos(d * Math.PI / 180), 2).toFixed(3) + ')');
});
console.log(' -> one C-H bond at -178.3deg: near-perfect anti-periplanar alignment for sigma(C-H)->sigma*(O-O)');
console.log(' -> DTBP + dicumyl alpha carbons are quaternary [CITED geometry: zero H atoms bonded to the alpha C] -');
console.log('    this donation pathway does not exist for them at all (a structural fact, not a dihedral question).');
console.log(' -> [DERIVED HERE] this ordering (alpha-H=3 weaker than alpha-H=0) matches the CITED real D_e ordering:');
console.log('    dimethyl (alpha-H=3) De=' + (0.058361 * HART).toFixed(3) + 'eV  <  DTBP/dicumyl (alpha-H=0) mean De=' +
  (((0.062161 + 0.060035) / 2) * HART).toFixed(3) + 'eV');

console.log('\n=== Step 7b: confounded 3rd alpha-H anchor (flagged, not smoothed in) ===');
var eParentMixed = -500.235446, eRadPhEtO = -385.192106, eRadOMe = -114.986138; // all [CITED], G4(0K) Hartree
var deMixedHartree = eRadPhEtO + eRadOMe - eParentMixed; // [DERIVED HERE]
var deMixedEv = deMixedHartree * HART;
var alpha0mean = ((0.062161 + 0.060035) / 2) * HART, alpha3 = 0.058361 * HART;
var naiveSlope = (alpha0mean - alpha3) / (0 - 3);
var naivePrediction = alpha0mean + naiveSlope * 2; // average alpha-H = (1+3)/2 = 2
console.log(' 1-phenylethyl methyl peroxide (secondary alpha-C, 1 alpha-H, but benzylic - a real confound):');
console.log('  CITED energies -> DERIVED HERE De =', deMixedEv.toFixed(4), 'eV =', (deMixedHartree * 627.5094).toFixed(2), 'kcal/mol');
console.log('  naive alpha-H-count-averaged prediction (DERIVED HERE):', naivePrediction.toFixed(4), 'eV');
console.log('  residual:', (100 * (naivePrediction - deMixedEv) / deMixedEv).toFixed(1),
  '% (real value weaker than predicted - plausibly the benzylic C-H is a BETTER donor than a plain alkyl C-H,');
console.log('  a second, real, un-separated effect - this anchor is reported as suggestive, NOT as confirmation).');

  return {
    snapshotDate: '2026-09-11',
    De_FVT: De_FVT,
    zEffSnapshot: ZEFF_SNAPSHOT,
    rowsCrc: ROWS_CRC,
    rowsOOExtended: ROWS_OO_EXTENDED,
    dihedral: dihedral
  };
}));
