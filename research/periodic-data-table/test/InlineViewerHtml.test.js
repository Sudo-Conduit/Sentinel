// Regression suite for InlineViewerHtml.js - folding a viewer's local JS
// dependencies directly into its HTML as inline <script> blocks. Checked
// against the real repo source files (not synthetic fixtures), since the
// whole point is that the folded output matches what the multi-file
// version actually runs.
var fs = require('fs');
var path = require('path');
var InlineViewerHtml = require('../InlineViewerHtml.js');
var { VIEWERS } = require('../ViewerManifest.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

Object.keys(VIEWERS).forEach(function(viewerKey) {
  var viewer = VIEWERS[viewerKey];
  var result = InlineViewerHtml.inline(viewerKey);

  check(viewerKey + ': inline() reports the real number of dependencies folded in', result.inlinedCount === viewer.deps.length);

  check(viewerKey + ': no <script src="./local.js"> tag for any dependency remains in the output', viewer.deps.every(function(dep) {
    return result.html.indexOf('<script src="./' + dep + '"></script>') === -1;
  }));

  check(viewerKey + ': every dependency\'s real source text is actually present in the output, not just referenced', viewer.deps.every(function(dep) {
    var depSource = fs.readFileSync(path.join(__dirname, '..', dep), 'utf8');
    return result.html.indexOf(depSource) !== -1;
  }));

  check(viewerKey + ': output has no remaining reference to a CDN or other external host (everything is vendored)', !/<script src="https?:\/\//.test(result.html));

  check(viewerKey + ': dependencies appear in the output in the same order ViewerManifest.js lists them', function() {
    var positions = viewer.deps.map(function(dep) {
      var depSource = fs.readFileSync(path.join(__dirname, '..', dep), 'utf8');
      return result.html.indexOf(depSource);
    });
    for (var i = 1; i < positions.length; i++) {
      if (positions[i] <= positions[i - 1]) return false;
    }
    return true;
  }());
});

check('inline() throws on an unknown viewer key rather than silently returning something', function() {
  try { InlineViewerHtml.inline('not-a-real-viewer'); return false; } catch (e) { return true; }
}());

check('run("list is not a real command") style unknown command reports an error rather than throwing', !!InlineViewerHtml.run('not-a-command').error);
check('run() rejects a non-string command rather than throwing', !!InlineViewerHtml.run(42).error);

// No cleanup: this rebuilds the real, committed fobbs-valence-table.standalone.html
// in place (same non-destructive precedent as BuildViewerPdf.test.js/
// BuildTerminalPdf.test.js's own round trips - the rebuilt file is byte-
// for-byte what's already committed, since inline() has no timestamp of
// its own).
var buildResult = InlineViewerHtml.run('build fobbs-valence-table');
check('run("build <key>") writes a real standalone .html file to disk', fs.existsSync(buildResult.outPath) && buildResult.byteLength > 1000);

module.exports = { name: 'InlineViewerHtml.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
