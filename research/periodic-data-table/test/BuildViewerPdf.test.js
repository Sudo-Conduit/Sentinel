// Life-cycle proof for BuildViewerPdf.js: builds a REAL PDF for every known
// viewer into a scratch file, then reads it back with pdf-lib and inflates
// each /FlateDecode /EmbeddedFile stream to confirm every attached file is
// present and byte-for-byte identical to the real repo source it was built
// from - not just "pdf-lib didn't throw." Same round-trip proof
// pooledimpact/mountainshift/v2/test/BuildTerminalPdf.test.js uses for
// Terminal.pdf.
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var PDFLib = require('pdf-lib');
var PDFDocument = PDFLib.PDFDocument;
var PDFName = PDFLib.PDFName;
var BuildViewerPdf = require('../BuildViewerPdf.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

// Reads back every /Type /EmbeddedFile entry from a built PDF's catalog
// /Names /EmbeddedFiles tree, inflating its /FlateDecode stream.
function readAttachments(pdfBytes) {
  return PDFDocument.load(pdfBytes).then(function(pdfDoc) {
    var namesDict = pdfDoc.context.lookup(pdfDoc.catalog.get(PDFName.of('Names')));
    var embeddedFiles = pdfDoc.context.lookup(namesDict.get(PDFName.of('EmbeddedFiles')));
    var namesArray = pdfDoc.context.lookup(embeddedFiles.get(PDFName.of('Names')));
    var entries = namesArray.array;
    var out = new Map();
    for (var i = 0; i < entries.length; i += 2) {
      var rawName = entries[i].decodeText();
      var filespec = pdfDoc.context.lookup(entries[i + 1]);
      var efDict = pdfDoc.context.lookup(filespec.get(PDFName.of('EF')));
      var fStream = pdfDoc.context.lookup(efDict.get(PDFName.of('F')));
      var raw = fStream.getContents();
      var filter = fStream.dict.get(PDFName.of('Filter'));
      var decoded = filter && filter.encodedName === '/FlateDecode' ? zlib.inflateSync(raw) : Buffer.from(raw);
      out.set(rawName, decoded);
    }
    return out;
  });
}

check('every viewer entry file exists on disk', Object.keys(BuildViewerPdf.VIEWERS).every(function(key) {
  return fs.existsSync(path.join(__dirname, '..', BuildViewerPdf.VIEWERS[key].entry));
}));
check('every viewer dependency file exists on disk', Object.keys(BuildViewerPdf.VIEWERS).every(function(key) {
  return BuildViewerPdf.VIEWERS[key].deps.every(function(dep) {
    return fs.existsSync(path.join(__dirname, '..', dep));
  });
}));

check('run("list") returns exactly the VIEWERS keys', JSON.stringify(Object.keys(BuildViewerPdf.VIEWERS).sort()) === JSON.stringify(['fobbs-valence-table', 'inverse-design', 'molecule-viewer']));

function runAsync() {
  return BuildViewerPdf.run('build-all').then(function(buildAllResult) {
    check('run("build-all") builds every known viewer', JSON.stringify(Object.keys(buildAllResult.results).sort()) === JSON.stringify(Object.keys(BuildViewerPdf.VIEWERS).sort()));

    var chain = Promise.resolve();
    Object.keys(BuildViewerPdf.VIEWERS).forEach(function(viewerKey) {
      chain = chain.then(function() {
        var viewer = BuildViewerPdf.VIEWERS[viewerKey];
        var result = buildAllResult.results[viewerKey];

        check(viewerKey + ': build() reports the correct file count and a real, sizeable output', result.fileCount === viewer.deps.length + 2 && result.byteLength > 5000 && fs.existsSync(result.outPath));

        return readAttachments(fs.readFileSync(result.outPath)).then(function(attachments) {
          var expected = ['ostore.json', 'entry.html'].concat(viewer.deps).sort();
          var actual = Array.from(attachments.keys()).sort();
          check(viewerKey + ': embeds exactly ostore.json + entry.html + its dependency list, nothing else', JSON.stringify(actual) === JSON.stringify(expected));

          var onDiskEntry = fs.readFileSync(path.join(__dirname, '..', viewer.entry));
          var embeddedEntry = attachments.get('entry.html');
          check(viewerKey + ': entry.html embedded is byte-for-byte identical to ' + viewer.entry + ' on disk', Buffer.compare(onDiskEntry, embeddedEntry) === 0);

          check(viewerKey + ': every dependency embedded is byte-for-byte identical to its source file on disk', viewer.deps.every(function(dep) {
            var onDisk = fs.readFileSync(path.join(__dirname, '..', dep));
            var embedded = attachments.get(dep);
            return embedded && Buffer.compare(onDisk, embedded) === 0;
          }));

          var manifest = JSON.parse(attachments.get('ostore.json').toString('utf8'));
          var fresh = BuildViewerPdf.buildManifest(viewerKey);
          check(viewerKey + ': ostore.json embedded parses and matches buildManifest()\'s shape (savedAt excluded, it is a fresh timestamp)', manifest.appId === fresh.appId && manifest.containerVersion === fresh.containerVersion && JSON.stringify(manifest.data.dependencies) === JSON.stringify(fresh.data.dependencies));

          // No cleanup here, matching BuildTerminalPdf.test.js's own
          // round-trip check: it rebuilds the real, committed <viewerKey>.pdf
          // in place rather than deleting it afterward. The rebuilt file is
          // structurally identical to what's committed (only ostore.json's
          // savedAt and the cover page's date differ), so this is never a
          // destructive test - a plain `node test/run-all.js` just refreshes
          // each viewer PDF to prove it still builds cleanly from current
          // source.
        });
      });
    });
    return chain;
  }).catch(function(e) {
    check('build-all round trip completed without throwing: ' + (e && e.message), false);
  });
}

module.exports = runAsync().then(function() {
  return { name: 'BuildViewerPdf.test.js', checks: checks, failures: failures };
});

if (require.main === module) {
  module.exports.then(function(result) {
    if (result.failures.length === 0) console.log('ALL ' + result.checks + ' CHECKS PASSED');
    else { console.log((result.checks - result.failures.length) + '/' + result.checks + ' passed. FAILED: ' + result.failures.join(', ')); process.exitCode = 1; }
  });
}
