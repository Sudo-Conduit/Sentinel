// Regression suite for PDT.js's per-element magnetic_moment (spin-only
// formula, mu = sqrt(n(n+2)) for n unpaired electrons via Hund's-rule
// filling) - checked against real, standard inorganic-chemistry textbook
// values, not invented numbers.
var PDT = require('../PDT.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

var zn = PDT.get('Zn');
check('Zn (d10, closed shell) has 0 unpaired spins - real: diamagnetic', zn.unpaired_spins === 0);
check('Zn magnetic moment is 0', zn.magnetic_moment === 0);

var mn = PDT.get('Mn');
check('Mn (high-spin d5) has 5 unpaired spins', mn.unpaired_spins === 5);
check('Mn magnetic moment is the real textbook high-spin-d5 value, 5.92 BM',
  Math.abs(mn.magnetic_moment - 5.92) < 0.01);

var gd = PDT.get('Gd');
check('Gd (half-filled f7) has 7 unpaired spins', gd.unpaired_spins === 7);
check('Gd magnetic moment is the real textbook f7 value, 7.94 BM (why Gd3+ is used in MRI contrast agents)',
  Math.abs(gd.magnetic_moment - 7.94) < 0.01);

var fe = PDT.get('Fe');
check('Fe (high-spin d6) has 4 unpaired spins', fe.unpaired_spins === 4);
check('Fe magnetic moment is the real textbook high-spin-d6 value, 4.90 BM',
  Math.abs(fe.magnetic_moment - 4.90) < 0.01);

module.exports = { name: 'PDT.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
