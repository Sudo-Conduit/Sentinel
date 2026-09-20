// Node host driver for TestRunner.js's run(cmd) command pattern: loads
// every *.test.js in this directory (require() - inherently Node/
// CommonJS, so that part stays here rather than in TestRunner), calls
// TestRunner.run('report', suites) to get the formatted lines, prints
// them, and - only with --save / SAVE_TEST_OUTPUT=1 - calls
// TestRunner.run('save-record', suites, meta) and writes the result with
// fs.writeFileSync. TestRunner itself does no I/O; this file is the only
// place that does, so a future browser/devtools driver can call the same
// TestRunner.run() and do its own (non-filesystem) I/O without any of
// TestRunner's logic changing.
//
// Paste this script's own output verbatim into the roadmap's "Last test
// run" section, alongside the commit hash it was run at - never hand-type
// the numbers. See CHEMISTRY_PROPERTY_ROADMAP.md for why: a pasted, dated,
// commit-hashed run can go stale in an obvious, checkable way (the hash
// stops matching HEAD); a hand-typed "shipped" claim can go stale silently.
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var TestRunner = require('./TestRunner.js');

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
  require('./ChemistryProblemGenerator.test.js'),
  require('./TestRunner.test.js')
];

// BuildViewerPdf.test.js is the one async suite in this directory (a real
// pdf-lib build + read-back round trip) - it exports a Promise<suite>
// rather than a plain suite object like every other require() above, so
// it is awaited here and pushed in before reporting rather than changing
// TestRunner's own synchronous aggregate() to know about promises.
Promise.resolve(require('./BuildViewerPdf.test.js')).then(function(buildViewerPdfSuite) {
  suites.push(buildViewerPdfSuite);

  var report = TestRunner.run('report', suites);
  report.lines.forEach(function(line) { console.log(line); });

  var shouldSave = process.argv.indexOf('--save') !== -1 || process.env.SAVE_TEST_OUTPUT === '1';
  if (shouldSave) {
    var commit = 'nogit';
    try { commit = child_process.execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'nogit'; } catch (e) { /* not in a git checkout, or git unavailable - fall back to 'nogit' rather than failing the run */ }
    var record = TestRunner.run('save-record', suites, { timestamp: new Date().toISOString(), commit: commit });
    var outDir = path.join(__dirname, '..', 'test_output');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, record.fileName), record.contents);
    console.log('\nSaved to test_output/' + record.fileName);
  }

  if (report.totalFailed > 0) process.exitCode = 1;
});
