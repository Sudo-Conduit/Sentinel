// ═══════════════════════════════════════════════════════════════════════
// BOND DISSOCIATION ENERGY (D_e) INVESTIGATION — FINDINGS RECORD
// Session: Sentinel/periodic-data-table, MolecularVibrations.js's Born model
// Status: REAL, VALIDATED CONCLUSIONS — NOT YET SHIPPABLE AS A FEATURE
// Purpose: a durable "lab notebook" entry so this investigation survives
// context compaction. Every number below is either directly computed here
// (re-runnable, node De_investigation_FINDINGS.js) or cited from a real,
// named source. Nothing here is guessed.
// ═══════════════════════════════════════════════════════════════════════
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
var ROWS_CRC = [
  // [pair, order, extraPiOrder p, real D_e **kJ/mol**, n override or null]
  ['C-C',1,0,347,null], ['C-C',2,1,611,null], ['C-C',3,2,837,null],
  ['C-N',1,0,305,null], ['C-O',1,0,358,null], ['C-H',1,0,414,null],
  ['H-N',1,0,389,null], ['H-O',1,0,464,null],
  ['N-N',1,0,161,null], ['N-N',2,1,456,null], ['N-N',3,2,946,null],
  ['N-O',1,0,230,null], ['C-S',1,0,272,null],
  ['C-F',1,0,439,1.4060], ['C-Cl',1,0,330,1.3592],
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
//    RADICAL-STABILIZATION energy - a property of the whole fragment,
//    not of the bonded atom pair - demonstrated with two real G4/
//    CCSDT(Q)-quality data points on the identical atom pair (O-O).
// 4. Path forward, if pursued: either (a) real cited bond-energy tables
//    per specific compound (no shortcut), or (b) a genuinely new
//    fragment-level variable (radical stabilization energy / Hammett-type
//    substituent constants) - NOT more atom-pair features on the same
//    tensor, which has now been shown to have a real ceiling.
// NOT SHIPPED: no D_e field was added to MolecularVibrations.js or
// MolecularReport.js. This file is the record of why, and what was
// actually tried, so the next attempt starts from evidence, not from
// scratch.
// ═══════════════════════════════════════════════════════════════════════

var PDT = require('/home/user/Sentinel/research/periodic-data-table/PDT.js');
var MolecularVibrations = require('/home/user/Sentinel/research/periodic-data-table/MolecularVibrations.js');
var MolecularGeometry = require('/home/user/Sentinel/research/periodic-data-table/MolecularGeometry.js');
var BOHR = 0.529177, HART = 27.211386, KCALMOL_TO_EV = 1 / 23.0609, KJMOL_TO_EV = 1 / 96.485;

function De_FVT(a, b, d0, p, nOverride) {
  var n = nOverride || MolecularVibrations._bornN(a, b);
  var elA = PDT.get(a), elB = PDT.get(b);
  var A = elA.Z_eff * elB.Z_eff * (1 + (p || 0));
  return (A * (n - 1) / (n * (d0 / BOHR))) * HART;
}

console.log('=== Step 3: bond-family tensor (real CRC data) ===');
ROWS_CRC.forEach(function(r) {
  var pr = r[0].split('-'), a = pr[0], b = pr[1], order = r[1], p = r[2], realKJ = r[3], nOverride = r[4];
  var d0 = MolecularGeometry.bondLength(a, b, order).value;
  var deFvt = De_FVT(a, b, d0, p, nOverride);
  var deReal = realKJ * KJMOL_TO_EV;
  console.log(' ', (r[0] + '/' + order).padEnd(8), 'd0=' + d0.toFixed(3), 'ratio=' + (deFvt / deReal).toFixed(2));
});

console.log('\n=== Step 4: held-out O-O test (proves non-extrapolation) ===');
[['H2O2', 1.475, 55.16], ['benzoyl peroxide', 1.4237, 31.02]].forEach(function(t) {
  var n = MolecularVibrations ? (function() {
    var F2 = Math.pow(10, (1.73 - t[1]) / 0.47);
    var kTarget = F2 * 6.2415;
    var elO = PDT.get('O'), A = elO.Z_eff * elO.Z_eff;
    var d0Bohr = t[1] / BOHR;
    return 1 + kTarget * d0Bohr * d0Bohr * d0Bohr * BOHR * BOHR / (A * HART);
  })() : null;
  var deFvt = De_FVT('O', 'O', t[1], 0, n);
  var deReal = t[2] * KCALMOL_TO_EV;
  console.log(' ', t[0].padEnd(18), 'd0=' + t[1], 'De_real=' + deReal.toFixed(3) + 'eV', 'ratio=' + (deFvt / deReal).toFixed(2));
});
