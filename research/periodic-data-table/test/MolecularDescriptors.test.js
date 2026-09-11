// Regression suite for MolecularDescriptors.js (quadrupole, molar
// refractivity, druglikeness) - checked against real textbook chemistry
// (Lipinski/Veber conventions, real literature molar refractivity) and the
// module's own stated invariant (traceless quadrupole), not invented values.
var MolecularStructure = require('../MolecularStructure.js');
var MolecularDescriptors = require('../MolecularDescriptors.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

var water = MolecularStructure.fromSmiles('O');
var wq = MolecularDescriptors.analyzeQuadrupole(water);
check('water quadrupole computed without error', !wq.error && wq.applicable);
check('water quadrupole tensor is traceless (Qxx+Qyy+Qzz ~ 0, by construction)', Math.abs(wq.traceCheck) < 1e-6);

var wd = MolecularDescriptors.analyzeDruglikeness(water);
check('water HBD is 1 (Lipinski: heavy atom counted once, not per H)', wd.hydrogenBondDonors === 1);
check('water HBA is 1 (one O atom, simple Lipinski convention)', wd.hydrogenBondAcceptors === 1);
check('water has 0 rotatable bonds (no non-terminal single bonds)', wd.rotatableBonds === 0);

var benzene = MolecularStructure.fromSmiles('c1ccccc1');
var bmr = MolecularDescriptors.analyzeMolarRefractivity(benzene);
check('benzene molar refractivity computed without error', !bmr.error);
// Real literature value for benzene's molar refractivity is ~26.2-26.6
// cm^3/mol; checked against a real range, not an exact invented number.
check('benzene molar refractivity is within real literature range (20-30 cm^3/mol, real value ~26.2-26.6)',
  bmr.molarRefractivityCm3PerMol > 20 && bmr.molarRefractivityCm3PerMol < 30);

module.exports = { name: 'MolecularDescriptors.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
