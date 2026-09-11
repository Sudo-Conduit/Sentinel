// Runs every *.test.js in this directory and prints one aggregate report.
// Paste this script's own output verbatim into the roadmap's "Last test
// run" section, alongside the commit hash it was run at - never hand-type
// the numbers. See CHEMISTRY_PROPERTY_ROADMAP.md for why: a pasted, dated,
// commit-hashed run can go stale in an obvious, checkable way (the hash
// stops matching HEAD); a hand-typed "shipped" claim can go stale silently.
var suites = [
  require('./MolecularSymmetry.test.js'),
  require('./MolecularThermodynamics.test.js'),
  require('./MolecularVibrationalModes.test.js'),
  require('./MolecularDescriptors.test.js')
];

var totalChecks = 0, totalFailed = 0, greenSuites = 0;
console.log('Suite\tResult');
suites.forEach(function(s) {
  totalChecks += s.checks;
  var ok = s.failures.length === 0;
  if (ok) greenSuites++; else totalFailed += s.failures.length;
  console.log(s.name + '\t' + (ok ? 'ALL ' + s.checks + ' CHECKS PASSED' : (s.checks - s.failures.length) + '/' + s.checks + ' passed. FAILED: ' + s.failures.join(', ')));
});
console.log('Total: ' + (totalChecks - totalFailed) + '/' + totalChecks + ' checks passing, ' + greenSuites + '/' + suites.length + ' suites green.');
if (totalFailed > 0) process.exitCode = 1;
