#!/usr/bin/env node
// Regenerates coverage_report.html from REAL test-file execution -- every
// cell's status is derived from an actual `node <file>` run's exit code,
// never hand-typed. Run this after adding/changing any test*.js file so
// the report never drifts from what the suite actually proves.
'use strict';
var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var V = 'verified', P = 'partial', X = 'pending', F = 'fail', N = 'na';

// Each row maps (group) -> feature -> per-language test file(s) that must
// pass for that cell to be 'verified'. A cell with no file is 'pending'
// (not built) unless explicitly marked 'na' (tabled / doesn't apply) or
// given a literal status string for things no test file can capture
// (a known live bug, a deliberately scoped subset).
var LANGS = ['js', 'c', 'java', 'php', 'python', 'ts'];

var MANIFEST = [
  { group: 'Core arithmetic & literals' },
  { name: '+  −  ×  ÷', cells: { js: ['test8_subdiv_neg.js'], c: ['test28_multilang_frontends.js'], java: ['test28_multilang_frontends.js'], php: ['test28_multilang_frontends.js'], python: ['test28_multilang_frontends.js'], ts: ['test28_multilang_frontends.js'] } },
  { name: 'exponent / squaring (x**2)', cells: { js: ['test7_precedence_pow.js'], c: ['test28_multilang_frontends.js'], java: ['test28_multilang_frontends.js'], php: ['test28_multilang_frontends.js'], python: ['test28_multilang_frontends.js'], ts: ['test28_multilang_frontends.js'] } },
  { name: 'π / math constants', cells: { js: ['test10_math_intrinsics.js'], c: ['test28_multilang_frontends.js'], java: ['test28_multilang_frontends.js'], php: ['test28_multilang_frontends.js'], python: ['test28_multilang_frontends.js'], ts: ['test28_multilang_frontends.js'] } },
  { name: 'string literals + concat', cells: { js: ['test21_strings.js', 'test22_string_ops.js'] } },
  { name: 'true / false / NaN', cells: { js: ['test4_literals.js'] } },
  { name: 'typeof', cells: { js: ['test23_typeof.js'], c: 'na', java: 'na', php: 'na', python: 'na' } },

  { group: 'Control flow' },
  { name: 'if / else / ternary', cells: { js: ['test3_control_flow.js'] } },
  { name: 'while', cells: { js: ['test3_control_flow.js', 'test25_events.js'] } },
  { name: 'for', cells: { js: ['test25_events.js'] } },
  { name: 'switch / try-catch', cells: { js: ['test14_switch_try.js'] } },

  { group: 'Data structures' },
  { name: 'fixed arrays (literal, index)', cells: { js: ['test11_arrays.js', 'test20_array_expr.js'] } },
  { name: 'array .push() (real growth)', cells: { js: ['test25_events.js'] } },
  { name: 'array .length', cells: { js: ['test25_events.js', 'test26_object_keys.js'] } },
  { name: 'objects + destructuring', cells: { js: ['test17_objects_destructuring.js'] } },
  { name: 'nullable properties / ??', cells: { js: ['test12_nullable.js'] } },
  { name: 'Object.keys()', cells: { js: ['test26_object_keys.js'] } },

  { group: 'Functions & OOP' },
  { name: 'methods, sibling calls', cells: { js: ['test19_sibling_calls.js'] } },
  { name: 'closures (captured arrow fns)', cells: { js: ['test16_closures.js'] } },
  { name: 'generators (N-state machine)', cells: { js: ['test18_generators.js'], c: 'na', java: 'na', php: 'na' } },
  { name: 'multi-class + extends', cells: { js: ['test13_multiclass.js', 'test15_extends.js'] } },
  { name: '#private fields / methods', cells: { js: ['test27_private_fields.js'], c: 'na', php: 'na', python: 'na' } },

  { group: 'Host, async & output' },
  { name: 'print (log / printf / echo)', cells: { js: ['test6_rules_engine.js'], c: ['test29_multilang_print.js'], java: ['test29_multilang_print.js'], php: ['test29_multilang_print.js'], python: ['test29_multilang_print.js'], ts: ['test29_multilang_print.js'] } },
  { name: 'setTimeout / setInterval', cells: { js: ['test24_timers.js'], c: 'na' } },
  { name: 'events (.on/.emit, dynamic call_indirect)', cells: { js: ['test25_events.js'], c: 'na' } },
  { name: 'await / async', cells: { js: 'fail:known live bug -- silently wrong, unfixed', c: 'na' } },
  { name: 'Proxy / Reflect / Atomics', cells: { js: 'pending:tabled -- needs dynamic object model' } },
];

// C's printf is a real, deliberately narrower subset of the full-arity
// idiom (see test29's rejection case) -- flagged as partial regardless of
// the file's exit code, since "passes" here proves the SCOPED shape, not
// full parity with the other five languages' print statement.
var PARTIAL_OVERRIDES = { 'print (log / printf / echo)': { c: true } };

function runTest(file) {
  try {
    var out = execFileSync(process.execPath, [file], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: /\bALL PASS\b/.test(out) || (!/FAIL/.test(out) && out.length > 0), out: out };
  } catch (err) {
    return { ok: false, out: (err.stdout || '') + (err.stderr || '') };
  }
}

function resolveCell(entry) {
  if (entry === undefined) return { status: X };
  if (entry === 'na') return { status: N };
  if (typeof entry === 'string') {
    var m = entry.match(/^(fail|pending):(.*)$/);
    if (m) return { status: m[1] === 'fail' ? F : X, note: m[2] };
    return { status: X, note: entry };
  }
  // array of test files -- ALL must pass for this cell to read verified
  var results = entry.map(function (f) { return { file: f, r: runTest(f) }; });
  var allOk = results.every(function (x) { return x.r.ok; });
  return {
    status: allOk ? V : F,
    files: entry,
    note: results.filter(function (x) { return !x.r.ok; }).map(function (x) { return x.file + ' did not pass'; }).join('; ')
  };
}

var testFileCache = {};
function cachedRunTest(file) {
  if (!(file in testFileCache)) testFileCache[file] = runTest(file);
  return testFileCache[file];
}
// swap resolveCell to use the cache so shared files (test28/29 covering
// 5 languages each) only actually execute once per generation run
function resolveCellCached(entry) {
  if (entry === undefined) return { status: X };
  if (entry === 'na') return { status: N };
  if (typeof entry === 'string') {
    var m = entry.match(/^(fail|pending):(.*)$/);
    if (m) return { status: m[1] === 'fail' ? F : X, note: m[2] };
    return { status: X, note: entry };
  }
  var results = entry.map(function (f) { return { file: f, r: cachedRunTest(f) }; });
  var allOk = results.every(function (x) { return x.r.ok; });
  return { status: allOk ? V : F, files: entry, note: allOk ? '' : results.filter(function (x) { return !x.r.ok; }).map(function (x) { return x.file; }).join(', ') + ' failed' };
}

console.log('Running the real test suite to derive coverage (this executes actual WASM)...');
var rows = MANIFEST.map(function (row) {
  if (row.group) return { group: row.group };
  var cells = LANGS.map(function (lang) {
    var resolved = resolveCellCached(row.cells[lang]);
    if (PARTIAL_OVERRIDES[row.name] && PARTIAL_OVERRIDES[row.name][lang] && resolved.status === V) {
      resolved = { status: P, files: resolved.files, note: 'deliberately scoped subset, see test29' };
    }
    return resolved;
  });
  return { name: row.name, cells: cells };
});

var filesRun = Object.keys(testFileCache);
var filesPassed = filesRun.filter(function (f) { return testFileCache[f].ok; });
console.log(filesPassed.length + ' / ' + filesRun.length + ' referenced test files passed.');
filesRun.forEach(function (f) {
  console.log((testFileCache[f].ok ? '  OK   ' : '  FAIL ') + f);
});

var commit = '';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) {}
var branch = '';
try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) {}

var summary = {
  verified: 0, partial: 0, pending: 0, fail: 0, na: 0
};
rows.forEach(function (r) {
  if (!r.cells) return;
  r.cells.forEach(function (c) {
    if (c.status === V) summary.verified++;
    else if (c.status === P) summary.partial++;
    else if (c.status === X) summary.pending++;
    else if (c.status === F) summary.fail++;
    else if (c.status === N) summary.na++;
  });
});

var data = {
  generatedAt: new Date().toISOString(),
  commit: commit, branch: branch,
  langs: LANGS,
  rows: rows,
  summary: summary,
  testFiles: filesRun.map(function (f) { return { file: f, ok: testFileCache[f].ok }; })
};

var templatePath = path.join(__dirname, 'coverage_report.template.html');
var template = fs.readFileSync(templatePath, 'utf8');
var out = template.replace('/*__COVERAGE_DATA__*/', JSON.stringify(data, null, 2));
fs.writeFileSync(path.join(__dirname, 'coverage_report.html'), out);
console.log('\nWrote coverage_report.html (' + summary.verified + ' verified, ' + summary.partial + ' partial, ' + summary.fail + ' fail, ' + summary.pending + ' pending, ' + summary.na + ' n/a)');
if (summary.fail > 0) {
  console.log('WARNING: ' + summary.fail + ' cell(s) reference a test file that did NOT pass -- see FAIL lines above.');
  process.exitCode = 1;
}
