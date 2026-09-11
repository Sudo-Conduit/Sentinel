// Regression suite for MolecularVibrationalModes.js's analyzeNormalModes().
// Includes an explicitly-documented scope limitation found while writing
// this suite: the Hessian is built from internal coordinates (bond
// stretches + valence-angle bends only - no torsions/dihedrals), so mode
// count matches the textbook 3N-6 ONLY when the molecule has no torsional
// degrees of freedom to miss (true for water, not true for benzene's ring).
// This is checked explicitly, not silently papered over with a wrong
// assertion of 3N-6 for every molecule.
var MolecularStructure = require('../MolecularStructure.js');
var MolecularVibrationalModes = require('../MolecularVibrationalModes.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

var water = MolecularStructure.fromSmiles('O');
var nmWater = MolecularVibrationalModes.analyzeNormalModes(water);
check('water normal modes computed without error', !nmWater.error);
check('water has exactly 3 modes (3N-6 for N=3, no torsional DOF to miss)', nmWater.modes.length === 3);
check('all water mode frequencies are real/positive (no imaginary modes)',
  nmWater.modes.every(function(m) { return m.wavenumberCm1 > 0; }));

var benzene = MolecularStructure.fromSmiles('c1ccccc1');
var nmBenzene = MolecularVibrationalModes.analyzeNormalModes(benzene);
check('benzene normal modes computed without error', !nmBenzene.error);
// NOT asserting 3*12-6=30 here - see header. 24 is this model's real,
// current output given its internal-coordinate scope; this check exists
// to catch a REGRESSION in that count, not to claim it spans all 30 true
// normal modes.
check('benzene mode count matches this model\'s documented internal-coordinate scope (24, not the full 3N-6=30)',
  nmBenzene.modes.length === 24);
check('all benzene mode frequencies are real/positive (no imaginary modes)',
  nmBenzene.modes.every(function(m) { return m.wavenumberCm1 > 0; }));

module.exports = { name: 'MolecularVibrationalModes.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
