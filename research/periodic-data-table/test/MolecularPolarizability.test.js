// Regression suite for MolecularPolarizability.js's analyzeTransitionEnergies()
// - energies/wavelengths only, deliberately not oscillator strength (see
// that function's own header comment for why). Checked against benzene's
// real, already-established HOMO-LUMO value (255.1nm/4.86eV), cross-
// referenced elsewhere in this session's work, not invented.
var MolecularStructure = require('../MolecularStructure.js');
var MolecularPolarizability = require('../MolecularPolarizability.js');
var Aromaticity = require('../Aromaticity.js');
var Smiles = require('../Smiles.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

var parsed = Smiles.parse('c1ccccc1');
var system = Smiles.toAromaticSystem(parsed, true);
var molecule = { atoms: system.atoms, bonds: system.bonds };
var structure = MolecularStructure.analyze(molecule);
structure.aromaticity = Aromaticity.analyze(system);

var result = MolecularPolarizability.analyzeTransitionEnergies(molecule, { structureResult: structure });
check('benzene transition energies computed without error', result.applicable === true);
check('benzene has 9 occ->unocc transitions (3 occupied x 3 unoccupied pi MOs)', result.transitions.length === 9);
check('no oscillatorStrength field present (intentionally not shipped)', result.transitions.every(function(t) { return !('oscillatorStrength' in t); }));
check('benzene HOMO-LUMO transition is 4.86 eV (this codebase\'s established spectroscopic-beta value)',
  Math.abs(result.homoLumo.transitionEv - 4.86) < 0.01);
check('benzene HOMO-LUMO wavelength is 255.1 nm (matches this session\'s independently-cited benzene reference)',
  Math.abs(result.homoLumo.wavelengthNm - 255.1) < 0.1);
check('transitions are sorted ascending by energy', result.transitions.every(function(t, i) {
  return i === 0 || t.transitionEv >= result.transitions[i - 1].transitionEv;
}));

module.exports = { name: 'MolecularPolarizability.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
