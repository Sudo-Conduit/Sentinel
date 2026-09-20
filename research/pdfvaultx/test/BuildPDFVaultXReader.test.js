// Regression suite for BuildPDFVaultXReader.js's assembly logic: pure file
// substitution (template + vendored pdf.js library/worker sources ->
// PDFVaultXReader.html), so this is checked directly in Node with no
// browser needed. The actual "does it decrypt and run a real PDFVaultX
// PDF" behavior was verified headlessly against real containers (including
// a pikepdf-encrypted one, wrong-password-rejected then correct-password-
// unlocked) - that needs a real browser + pdf.js's Worker/Blob APIs, which
// this directory's test suite deliberately does not depend on (no browser
// automation dependency is committed here), so it isn't re-asserted by
// this file - see the PR description for that verification.
var fs = require('fs');
var path = require('path');
var BuildPDFVaultXReader = require('../BuildPDFVaultXReader.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

check('template, library, and worker source files all exist on disk', ['PDFVaultXReader.template.html', 'pdfjs.min.js', 'pdfjs.worker.min.js'].every(function(f) {
  return fs.existsSync(path.join(__dirname, '..', f));
}));

check('vendored worker source has no literal "</script" sequence (would break its inert wrapper)', fs.readFileSync(path.join(__dirname, '..', 'pdfjs.worker.min.js'), 'utf8').indexOf('</script') === -1);

var result = BuildPDFVaultXReader.run('build');
check('run("build") reports a real, sizeable output file that was actually written', result.byteLength > 1000000 && fs.existsSync(result.outPath));

var output = fs.readFileSync(result.outPath, 'utf8');
check('output has neither placeholder token left unsubstituted', output.indexOf('__PDFJS_LIB_SOURCE_PLACEHOLDER__') === -1 && output.indexOf('__PDFJS_WORKER_SOURCE_PLACEHOLDER__') === -1);
check('output embeds the real pdf.js library source (executable script)', output.indexOf(fs.readFileSync(path.join(__dirname, '..', 'pdfjs.min.js'), 'utf8')) !== -1);
check('output embeds the real pdf.js worker source (inert text block)', output.indexOf(fs.readFileSync(path.join(__dirname, '..', 'pdfjs.worker.min.js'), 'utf8')) !== -1);
check('output carries the app UI/logic from the template (run(cmd) dispatcher, file drop zone)', output.indexOf('var PDFVaultXReader = (function()') !== -1 && output.indexOf('id="dropzone"') !== -1);
// Targeted checks rather than counting <script> tags via regex: both the
// template and the assembled output legitimately contain the literal text
// `<script src="./X.js">` inside a doc comment (about rewriting a
// viewer's OWN script tags at runtime), which makes any naive "scan for
// <script src=" text search false-positive on itself.
var templateSource = fs.readFileSync(path.join(__dirname, '..', 'PDFVaultXReader.template.html'), 'utf8');
check('output has no reference to a CDN or other external host for a script/stylesheet', !/(?:src|href)\s*=\s*["'](?:https?:)?\/\//.test(output));
check('output defines the worker-source and app-logic blocks by id/name, confirming all 3 real script blocks made it through', output.indexOf('id="pdfjs-worker-source"') !== -1 && output.indexOf('var PDFVaultXReader = (function()') !== -1);
check('template has no external stylesheet references', !/<link[^>]+stylesheet/.test(templateSource));

check('run("build") is idempotent: building twice in a row produces byte-identical output', BuildPDFVaultXReader.run('build').byteLength === result.byteLength && fs.readFileSync(result.outPath, 'utf8') === output);

check('run() rejects an unknown command rather than throwing', !!BuildPDFVaultXReader.run('not-a-command').error);
check('run() rejects a non-string command rather than throwing', !!BuildPDFVaultXReader.run(42).error);

module.exports = { name: 'BuildPDFVaultXReader.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
