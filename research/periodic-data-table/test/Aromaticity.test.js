// Regression suite for Aromaticity.js's homoLumo() - covers Band Gap
// (gapEv) and the Parr-Szentpaly-Liu Electrophilicity/Nucleophilicity
// index (electrophilicityEv), checked against this codebase's own
// previously-established, cross-referenced benzene values (opticalGapNm
// 255.1nm for benzene is independently cited elsewhere in this session's
// work), not invented numbers.
var Aromaticity = require('../Aromaticity.js');
var Smiles = require('../Smiles.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

var benzene = Aromaticity.analyze(Smiles.toAromaticSystem(Smiles.parse('c1ccccc1'), true));
check('benzene analyzed without error', !benzene.error);
check('benzene has 6 pi electrons (real Huckel count)', benzene.piElectrons === 6);
check('benzene is closed-shell, not open-shell (real: benzene has no degenerate half-filled HOMO)',
  benzene.homoLumo.homoOpenShell === false);
check('benzene HOMO-LUMO gap is 4.86 eV (this codebase\'s established spectroscopic-beta value)',
  Math.abs(benzene.homoLumo.gapEv - 4.86) < 0.01);
check('benzene optical gap is 255.1 nm (matches this session\'s independently-cited benzene reference)',
  Math.abs(benzene.homoLumo.opticalGapNm - 255.1) < 0.1);
check('benzene electrophilicity index is positive and finite (Parr-Szentpaly-Liu omega = chi^2/(2*eta))',
  benzene.homoLumo.electrophilicityEv > 0 && isFinite(benzene.homoLumo.electrophilicityEv));
check('benzene hardness is positive (Parr-Pearson eta = (LUMO-HOMO)/2)', benzene.homoLumo.hardnessEv > 0);

module.exports = { name: 'Aromaticity.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
