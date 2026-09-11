// Regression suite for MolecularSymmetry.js's detectPointGroup(), checked
// against real, well-known textbook point groups for canonical molecules -
// not against invented expected values.
var MolecularStructure = require('../MolecularStructure.js');
var MolecularSymmetry = require('../MolecularSymmetry.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

var water = MolecularStructure.fromSmiles('O');
var waterPG = MolecularSymmetry.detectPointGroup(water);
check('water is C2v (real textbook point group)', waterPG.pointGroup === 'C2v');
check('water has no error', !waterPG.error);

var methane = MolecularStructure.fromSmiles('C');
var methanePG = MolecularSymmetry.detectPointGroup(methane);
check('methane is Td (real textbook point group)', methanePG.pointGroup === 'Td');

var benzene = MolecularStructure.fromSmiles('c1ccccc1');
var benzenePG = MolecularSymmetry.detectPointGroup(benzene);
check('benzene is D6h (real textbook point group)', benzenePG.pointGroup === 'D6h');
check('benzene has an inversion center (real: D6h has one)', benzenePG.elementsFound.inversion === true);
check('benzene has sigma_h (real: D6h has one)', benzenePG.elementsFound.sigmaH === true);

module.exports = { name: 'MolecularSymmetry.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
