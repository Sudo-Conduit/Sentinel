// Regression suite for MolecularReactivity.js's atom-condensed Fukui
// functions (f+, f-, f0) - checked against real structural/symmetry
// invariants a correct Huckel-MO-based implementation must satisfy, not
// invented numbers: benzene's D6h symmetry forces all 6 ring carbons to be
// IDENTICAL, and f+/f- are each a normalized one-electron density change,
// so summed over every pi-system atom they must equal exactly 1 - see
// MolecularReactivity.js's file header for why (degenerate-MO averaging,
// not summing, is what makes that hold for benzene's degenerate HOMO/LUMO).
var MolecularStructure = require('../MolecularStructure.js');
var MolecularReactivity = require('../MolecularReactivity.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

var benzene = MolecularStructure.fromSmiles('c1ccccc1');
var bz = MolecularReactivity.analyzeFukuiFunctions(benzene);
check('benzene Fukui functions computed without error', bz.applicable === true);
check('benzene has the real doubly-degenerate HOMO (e-symmetry pair)', bz.homoDegeneracy === 2);
check('benzene has the real doubly-degenerate LUMO (e-symmetry pair)', bz.lumoDegeneracy === 2);
check('benzene f+ sums to exactly 1 across the 6 ring atoms (normalized one-electron density)', bz.sumFPlus === 1);
check('benzene f- sums to exactly 1 across the 6 ring atoms', bz.sumFMinus === 1);
check('benzene has 6 per-atom entries', bz.perAtom.length === 6);
var f0 = bz.perAtom[0].fPlus;
check('benzene: D6h symmetry forces ALL 6 ring carbons to identical f+ (real structural invariant, not a fit)',
  bz.perAtom.every(function(a) { return Math.abs(a.fPlus - f0) < 1e-6; }));
check('benzene: identical f+ implies identical f- too (fully symmetric ring)',
  bz.perAtom.every(function(a) { return Math.abs(a.fMinus - f0) < 1e-6; }));
check('benzene per-atom f+ is the real 1/6 (0.1667) by symmetry', Math.abs(f0 - 1/6) < 1e-4);
check('benzene f0 = (f+ + f-)/2 for every atom', bz.perAtom.every(function(a) { return Math.abs(a.fZero - (a.fPlus + a.fMinus) / 2) < 1e-6; }));

// Pyridine (N replacing one CH) breaks benzene's symmetry down to C2v -
// a real, checkable structural prediction: positions ortho (C2/C6) and
// meta (C3/C5) to N must each come out pairwise equal, and the pi-system N
// lone pair is NOT part of this ring's pi system (pyridine-type N
// contributes only its p-electron, same as the carbons - see
// Aromaticity.js's role documentation), so nothing here assumes N behaves
// like the lone-pair-donating pyrrole-type N.
var pyridine = MolecularStructure.fromSmiles('n1ccccc1');
var py = MolecularReactivity.analyzeFukuiFunctions(pyridine);
check('pyridine Fukui functions computed without error', py.applicable === true);
check('pyridine has a real non-degenerate HOMO (no symmetry-forced degeneracy left once N breaks D6h)', py.homoDegeneracy === 1);
check('pyridine has a real non-degenerate LUMO', py.lumoDegeneracy === 1);
check('pyridine f+ still sums to exactly 1 (normalization holds for a non-degenerate case too)', py.sumFPlus === 1);
check('pyridine f- still sums to exactly 1', py.sumFMinus === 1);
// atomIndex 0 = N, 1/5 = ortho carbons (C2/C6), 2/4 = meta carbons (C3/C5), 3 = para carbon (C4)
check('pyridine: C2v symmetry forces the two ortho carbons (C2, C6) to identical f+',
  Math.abs(py.perAtom[1].fPlus - py.perAtom[5].fPlus) < 1e-6);
check('pyridine: C2v symmetry forces the two meta carbons (C3, C5) to identical f+',
  Math.abs(py.perAtom[2].fPlus - py.perAtom[4].fPlus) < 1e-6);
check('pyridine: real, known LUMO nodal pattern - nucleophilic addition favors C4 (para) and C2/C6 (ortho) over C3/C5 (meta), matching textbook pyridine reactivity (e.g. organolithium addition at C2)',
  py.perAtom[3].fPlus > py.perAtom[1].fPlus && py.perAtom[1].fPlus > py.perAtom[2].fPlus);
check('pyridine: not uniform like benzene - the heteroatom genuinely breaks the symmetry this implementation must track',
  Math.abs(py.perAtom[0].fPlus - py.perAtom[3].fPlus) > 1e-3);

var ethanol = MolecularStructure.fromSmiles('CCO');
var eth = MolecularReactivity.analyzeFukuiFunctions(ethanol);
check('ethanol (no conjugated pi-system) correctly reports not applicable rather than a fabricated value',
  eth.applicable === false);

module.exports = { name: 'MolecularReactivity.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
