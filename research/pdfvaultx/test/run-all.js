// Node host driver, same shape as research/periodic-data-table/test/run-all.js:
// require()s every *.test.js in this directory, prints its results. No
// TestRunner.js in this small a directory (one suite) - kept plain.
var suites = [
  require('./BuildPDFVaultXReader.test.js')
];

var totalChecks = 0, totalFailed = 0;
suites.forEach(function(s) {
  totalChecks += s.checks;
  var ok = s.failures.length === 0;
  if (!ok) totalFailed += s.failures.length;
  console.log(s.name + '\t' + (ok ? 'ALL ' + s.checks + ' CHECKS PASSED' : (s.checks - s.failures.length) + '/' + s.checks + ' passed. FAILED: ' + s.failures.join(', ')));
});
console.log('Total: ' + (totalChecks - totalFailed) + '/' + totalChecks + ' checks passing, ' + (suites.length - (totalFailed > 0 ? 1 : 0)) + '/' + suites.length + ' suites green.');

if (totalFailed > 0) process.exitCode = 1;
