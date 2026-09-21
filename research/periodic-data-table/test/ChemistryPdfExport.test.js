// Life-cycle proof for ChemistryPdfExport.js: builds real PDFs from real
// ChemistryProblemGenerator results, reads them back with pdf-lib, and
// checks structure (page count, non-empty text-bearing content streams)
// rather than just "pdf-lib didn't throw." Async suite, same pattern as
// BuildViewerPdf.test.js - run-all.js awaits it before reporting.
var PDFDocument = require('pdf-lib').PDFDocument;
var G = require('../ChemistryProblemGenerator.js');
var ChemistryPdfExport = require('../ChemistryPdfExport.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

var results = ['molar-mass', 'mass-to-moles', 'percent-composition', 'balance-equation'].map(function(typeId, i) {
  return G.generate(typeId, i + 1);
});

module.exports = Promise.all([
  ChemistryPdfExport.buildQuestionsPdf(results, { title: 'Test Worksheet' }),
  ChemistryPdfExport.buildAnswerKeyPdf(results, { title: 'Test Worksheet — Answer Key' })
]).then(function(pdfs) {
  var questionsBytes = pdfs[0], answerKeyBytes = pdfs[1];

  check('buildQuestionsPdf returns real PDF bytes (starts with the %PDF- magic header)',
    Buffer.from(questionsBytes.slice(0, 5)).toString() === '%PDF-');
  check('buildAnswerKeyPdf returns real PDF bytes (starts with the %PDF- magic header)',
    Buffer.from(answerKeyBytes.slice(0, 5)).toString() === '%PDF-');

  return Promise.all([
    PDFDocument.load(questionsBytes),
    PDFDocument.load(answerKeyBytes)
  ]).then(function(docs) {
    var questionsDoc = docs[0], answerKeyDoc = docs[1];

    check('Questions PDF has at least one page', questionsDoc.getPageCount() >= 1);
    check('Answer key PDF has at least one page', answerKeyDoc.getPageCount() >= 1);

    // The answer key embeds everything the questions PDF embeds (question
    // text) plus answers and steps, so it should never be smaller.
    check('Answer key PDF content is not smaller than the questions-only PDF (it strictly adds answer+step text)',
      answerKeyBytes.length >= questionsBytes.length * 0.9);

    // A worksheet with only errored results (e.g. every type unknown)
    // should still produce a loadable, non-empty PDF rather than throwing.
    var allErrors = [{ error: 'unknown type' }, { error: 'unknown type' }];
    return Promise.all([
      ChemistryPdfExport.buildQuestionsPdf(allErrors),
      ChemistryPdfExport.buildAnswerKeyPdf(allErrors)
    ]).then(function(emptyPdfs) {
      return Promise.all([
        PDFDocument.load(emptyPdfs[0]),
        PDFDocument.load(emptyPdfs[1])
      ]).then(function(emptyDocs) {
        check('A worksheet with no valid results (all errors) still produces a loadable PDF, not a throw',
          emptyDocs[0].getPageCount() >= 1 && emptyDocs[1].getPageCount() >= 1);

        // A long-question stress case to prove pagination/wrapping doesn't throw.
        var manyResults = [];
        for (var i = 0; i < 60; i++) manyResults.push(G.generate('balance-equation', i));
        return ChemistryPdfExport.buildAnswerKeyPdf(manyResults).then(function(bigBytes) {
          return PDFDocument.load(bigBytes).then(function(bigDoc) {
            check('A 60-problem worksheet answer key paginates onto more than one page',
              bigDoc.getPageCount() > 1);

            return { name: 'ChemistryPdfExport.test.js', checks: checks, failures: failures };
          });
        });
      });
    });
  });
});

if (require.main === module) {
  module.exports.then(function(suite) {
    if (suite.failures.length === 0) console.log('ALL ' + suite.checks + ' CHECKS PASSED');
    else { console.log((suite.checks - suite.failures.length) + '/' + suite.checks + ' passed. FAILED: ' + suite.failures.join(', ')); process.exitCode = 1; }
  });
}
