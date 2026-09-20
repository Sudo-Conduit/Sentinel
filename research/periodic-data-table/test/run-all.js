// Runs every *.test.js in this directory and prints one aggregate report.
// Paste this script's own output verbatim into the roadmap's "Last test
// run" section, alongside the commit hash it was run at - never hand-type
// the numbers. See CHEMISTRY_PROPERTY_ROADMAP.md for why: a pasted, dated,
// commit-hashed run can go stale in an obvious, checkable way (the hash
// stops matching HEAD); a hand-typed "shipped" claim can go stale silently.
//
// --save (or SAVE_TEST_OUTPUT=1) additionally writes this exact run to
// ../test_output/<timestamp>_<commit-or-nogit>.txt, dated and commit-
// hashed the same way - a durable, checkable static record of what a
// given commit's test suite actually printed, not just what someone
// remembers pasting into a doc. Same convention as this project's other
// test_output artifacts (e.g. NTX-test-output.txt): the raw output,
// verbatim, not summarized or reformatted after the fact.
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

var suites = [
  require('./MolecularSymmetry.test.js'),
  require('./MolecularThermodynamics.test.js'),
  require('./MolecularVibrationalModes.test.js'),
  require('./MolecularDescriptors.test.js'),
  require('./Aromaticity.test.js'),
  require('./PDT.test.js'),
  require('./MolecularReactivity.test.js'),
  require('./MolecularPolarizability.test.js'),
  require('./RulesEngine.test.js'),
  require('./Stoichiometry.test.js'),
  require('./ChemistryProblemGenerator.test.js')
];

var outputLines = [];
function emit(line) { outputLines.push(line); console.log(line); }

var totalChecks = 0, totalFailed = 0, greenSuites = 0;
emit('Suite\tResult');
suites.forEach(function(s) {
  totalChecks += s.checks;
  var ok = s.failures.length === 0;
  if (ok) greenSuites++; else totalFailed += s.failures.length;
  emit(s.name + '\t' + (ok ? 'ALL ' + s.checks + ' CHECKS PASSED' : (s.checks - s.failures.length) + '/' + s.checks + ' passed. FAILED: ' + s.failures.join(', ')));
});
emit('Total: ' + (totalChecks - totalFailed) + '/' + totalChecks + ' checks passing, ' + greenSuites + '/' + suites.length + ' suites green.');

var shouldSave = process.argv.indexOf('--save') !== -1 || process.env.SAVE_TEST_OUTPUT === '1';
if (shouldSave) {
  var commit = 'nogit';
  try { commit = child_process.execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'nogit'; } catch (e) { /* not in a git checkout, or git unavailable - fall back to 'nogit' rather than failing the run */ }
  var timestamp = new Date().toISOString();
  var outDir = path.join(__dirname, '..', 'test_output');
  fs.mkdirSync(outDir, { recursive: true });
  var fileName = timestamp.replace(/[:.]/g, '-') + '_' + commit + '.txt';
  var header = [
    'research/periodic-data-table test suite',
    'Run at: ' + timestamp,
    'Commit: ' + commit,
    ''
  ];
  fs.writeFileSync(path.join(outDir, fileName), header.concat(outputLines).join('\n') + '\n');
  console.log('\nSaved to test_output/' + fileName);
}

if (totalFailed > 0) process.exitCode = 1;
