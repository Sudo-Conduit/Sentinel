// Regression suite for TestRunner.js - the pure report/save-record
// formatting behind run-all.js's --save flag. Checked in isolation with
// synthetic suite data (not the real *.test.js files) since TestRunner
// itself takes already-computed {name, checks, failures} in and must do
// no I/O of its own - these checks would catch it if it ever grew a
// console.log or fs call.
var TestRunner = require('./TestRunner.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

var allGreen = [
  { name: 'A.test.js', checks: 3, failures: [] },
  { name: 'B.test.js', checks: 5, failures: [] }
];
var oneRed = [
  { name: 'A.test.js', checks: 3, failures: [] },
  { name: 'C.test.js', checks: 4, failures: ['check 2', 'check 4'] }
];

// --- aggregate() ---
var aggAllGreen = TestRunner.aggregate(allGreen);
check('aggregate() sums checks across suites correctly', aggAllGreen.totalChecks === 8);
check('aggregate() reports 0 failed when every suite is green', aggAllGreen.totalFailed === 0);
check('aggregate() reports every suite green when all are', aggAllGreen.greenSuites === 2);
check('aggregate() sets ok=true when nothing failed', aggAllGreen.ok === true);
check('aggregate() first line is the header', aggAllGreen.lines[0] === 'Suite\tResult');
check('aggregate() last line is the Total summary with real numbers', aggAllGreen.lines[aggAllGreen.lines.length - 1] === 'Total: 8/8 checks passing, 2/2 suites green.');

var aggOneRed = TestRunner.aggregate(oneRed);
check('aggregate() subtracts failed checks from the passing total', aggOneRed.totalChecks - aggOneRed.totalFailed === 5);
check('aggregate() counts exactly the 2 failures from the red suite', aggOneRed.totalFailed === 2);
check('aggregate() counts only the green suite as green', aggOneRed.greenSuites === 1);
check('aggregate() sets ok=false when a suite failed', aggOneRed.ok === false);
check('aggregate() names the specific failed checks in the line', aggOneRed.lines.some(function(l) { return l.indexOf('check 2') !== -1 && l.indexOf('check 4') !== -1; }));

// --- formatSaveRecord() ---
var meta = { timestamp: '2026-09-20T10:00:00.000Z', commit: 'abc1234' };
var record = TestRunner.formatSaveRecord(aggAllGreen, meta);
check('formatSaveRecord() builds a filename from the sanitized timestamp and commit', record.fileName === '2026-09-20T10-00-00-000Z_abc1234.txt');
check('formatSaveRecord() contents include the commit hash', record.contents.indexOf('Commit: abc1234') !== -1);
check('formatSaveRecord() contents include the real Total line, not a placeholder', record.contents.indexOf('Total: 8/8 checks passing, 2/2 suites green.') !== -1);

// --- run(cmd) command-pattern surface ---
check('run("report", suites) matches aggregate(suites) directly', JSON.stringify(TestRunner.run('report', allGreen)) === JSON.stringify(TestRunner.aggregate(allGreen)));
check('run("save-record", suites, meta) matches formatSaveRecord(aggregate(suites), meta) directly',
  JSON.stringify(TestRunner.run('save-record', allGreen, meta)) === JSON.stringify(TestRunner.formatSaveRecord(TestRunner.aggregate(allGreen), meta)));
check('run("save-record", suites) without meta reports an error rather than throwing', !!TestRunner.run('save-record', allGreen).error);
check('run("not-a-command", suites) reports an error', !!TestRunner.run('not-a-command', allGreen).error);
check('run(cmd, notAnArray) reports an error rather than throwing', !!TestRunner.run('report', 'not an array').error);

module.exports = { name: 'TestRunner.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
