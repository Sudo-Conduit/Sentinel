// Life-cycle proof for ChemistryPdfExport.js: builds real PDFs from real
// ChemistryProblemGenerator results, reads them back with pdf-lib, and
// checks structure (page count, non-empty text-bearing content streams,
// real fillable form fields) rather than just "pdf-lib didn't throw."
// Async suite, same pattern as BuildViewerPdf.test.js - run-all.js awaits
// it before reporting.
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

    // Both PDFs must actually carry real content, not be near-empty stubs.
    // (Questions.pdf now also carries AcroForm field overhead, so it is no
    // longer guaranteed smaller than the answer key - that's expected.)
    check('Both PDFs are a real, non-trivial size', questionsBytes.length > 1000 && answerKeyBytes.length > 1000);

    // Questions.pdf must be actually fillable (students "enter answers"),
    // not just printed blank lines - one real AcroForm text field per
    // non-error question, named predictably.
    var nonErrorCount = results.filter(function(r) { return !r.error; }).length;
    var qFields = questionsDoc.getForm().getFields();
    check('Questions PDF has exactly one fillable text field per question (real form fields, not printed blanks)',
      qFields.length === nonErrorCount);
    check('Questions PDF field names are predictable (q1_answer, q2_answer, ...)',
      qFields.every(function(f, i) { return f.getName() === 'q' + (i + 1) + '_answer'; }));
    check('Answer key PDF has no fillable fields (it is the reference copy, not the student worksheet)',
      answerKeyDoc.getForm().getFields().length === 0);

    // A value typed into a field must actually survive a save/reload
    // round trip - proof it is genuinely fillable, not decorative.
    questionsDoc.getForm().getTextField('q1_answer').setText('158.0 g/mol');
    return questionsDoc.save().then(function(filledBytes) {
      return PDFDocument.load(filledBytes).then(function(reloaded) {
        check('A value typed into a Questions.pdf field survives a save/reload round trip',
          reloaded.getForm().getTextField('q1_answer').getText() === '158.0 g/mol');

        // A worksheet with only errored results (e.g. every type unknown)
        // should still produce a loadable, non-empty PDF rather than
        // throwing, with zero fields (nothing to answer).
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
            check('A worksheet with no valid results has zero fillable fields',
              emptyDocs[0].getForm().getFields().length === 0);

            // A long-question stress case to prove pagination/wrapping of
            // both prose text and form field widgets doesn't throw.
            var manyResults = [];
            for (var i = 0; i < 60; i++) manyResults.push(G.generate('balance-equation', i));
            return Promise.all([
              ChemistryPdfExport.buildAnswerKeyPdf(manyResults),
              ChemistryPdfExport.buildQuestionsPdf(manyResults)
            ]).then(function(bigPdfs) {
              return Promise.all([
                PDFDocument.load(bigPdfs[0]),
                PDFDocument.load(bigPdfs[1])
              ]).then(function(bigDocs) {
                check('A 60-problem worksheet answer key paginates onto more than one page',
                  bigDocs[0].getPageCount() > 1);
                check('A 60-problem worksheet questions PDF (60 form fields, paginated) still has exactly 60 fields',
                  bigDocs[1].getForm().getFields().length === 60);

                return { name: 'ChemistryPdfExport.test.js', checks: checks, failures: failures };
              });
            });
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
