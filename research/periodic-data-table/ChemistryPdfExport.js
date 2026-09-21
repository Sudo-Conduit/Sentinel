// Renders ChemistryProblemGenerator results into real downloadable PDF
// files (Questions-only, or an Answer Key with full steps) using pdf-lib.
// Pure rendering: takes the result objects generate()/run() already
// produced, never re-derives an answer or a step itself.
(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('pdf-lib'));
    } else {
        root.ChemistryPdfExport = factory(root.PDFLib);
    }
}(typeof self !== 'undefined' ? self : this, function(PDFLib) {
    'use strict';

    var PAGE_WIDTH = 612, PAGE_HEIGHT = 792; // US Letter, points
    var MARGIN = 54;
    var FONT_SIZE = 11;
    var LINE_HEIGHT = 15;
    var TITLE_SIZE = 16;
    var FIELD_HEIGHT = 18;

    // The unit each problem type's generate() answer is suffixed with (see
    // ChemistryProblemGenerator.js's solve() branches) - known here only to
    // label the fillable answer field, e.g. "____ g/mol", the same way the
    // uploaded CHEM 130 exam sheet prints a blank with its unit already
    // printed after it. Not derived from a specific result's answer, so
    // this never has to touch (and can't leak) the actual numeric answer.
    var UNIT_BY_TYPE = {
        'molar-mass': 'g/mol',
        'mass-to-moles': 'mol',
        'moles-to-mass': 'g',
        'percent-composition': '%'
        // balance-equation has no unit - it gets a wide equation field instead.
    };

    function wrapText(text, font, size, maxWidth) {
        var words = String(text).split(/\s+/);
        var lines = [];
        var current = '';
        words.forEach(function(word) {
            var candidate = current ? current + ' ' + word : word;
            if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
                lines.push(current);
                current = word;
            } else {
                current = candidate;
            }
        });
        if (current) lines.push(current);
        return lines;
    }

    function makeWriter(pdfDoc, font, boldFont) {
        var page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        var y = PAGE_HEIGHT - MARGIN;

        function newPage() {
            page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            y = PAGE_HEIGHT - MARGIN;
        }
        function ensureSpace(needed) {
            if (y - needed < MARGIN) newPage();
        }
        function writeLine(text, opts) {
            opts = opts || {};
            var size = opts.size || FONT_SIZE;
            var useFont = opts.bold ? boldFont : font;
            ensureSpace(LINE_HEIGHT);
            page.drawText(text, { x: opts.x || MARGIN, y: y, size: size, font: useFont });
            y -= LINE_HEIGHT;
        }
        function writeWrapped(text, opts) {
            opts = opts || {};
            var size = opts.size || FONT_SIZE;
            var useFont = opts.bold ? boldFont : font;
            var indent = opts.x || MARGIN;
            var maxWidth = PAGE_WIDTH - MARGIN - indent;
            wrapText(text, useFont, size, maxWidth).forEach(function(line) {
                ensureSpace(LINE_HEIGHT);
                page.drawText(line, { x: indent, y: y, size: size, font: useFont });
                y -= LINE_HEIGHT;
            });
        }
        // A real, typeable AcroForm text field for the student's answer -
        // "enter answers" means fillable in any PDF reader, not just a
        // printed blank line. `unit`, when given, is printed to the right
        // of the field, matching the uploaded exam sheet's own
        // blank-then-unit layout (e.g. "[____] g/mol").
        function writeAnswerField(form, fieldName, opts) {
            opts = opts || {};
            var indent = opts.x || MARGIN;
            var width = opts.width || 150;
            ensureSpace(FIELD_HEIGHT + 4);
            var field = form.createTextField(fieldName);
            field.addToPage(page, { x: indent, y: y - FIELD_HEIGHT + 3, width: width, height: FIELD_HEIGHT, borderWidth: 1 });
            if (opts.unit) {
                page.drawText(opts.unit, { x: indent + width + 8, y: y - FIELD_HEIGHT + 7, size: FONT_SIZE, font: font });
            }
            y -= (FIELD_HEIGHT + 6);
        }
        function gap(px) { y -= px; }
        return { writeLine: writeLine, writeWrapped: writeWrapped, writeAnswerField: writeAnswerField, gap: gap };
    }

    function embedFonts(pdfDoc) {
        return Promise.all([
            pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica),
            pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold)
        ]);
    }

    function buildQuestionsPdf(results, opts) {
        opts = opts || {};
        return PDFLib.PDFDocument.create().then(function(pdfDoc) {
            return embedFonts(pdfDoc).then(function(fonts) {
                var w = makeWriter(pdfDoc, fonts[0], fonts[1]);
                var form = pdfDoc.getForm();
                w.writeLine(opts.title || 'Chemistry Worksheet', { bold: true, size: TITLE_SIZE });
                w.gap(10);
                results.forEach(function(r, i) {
                    if (r.error) return;
                    w.writeWrapped((i + 1) + '. ' + r.question);
                    var unit = UNIT_BY_TYPE[r.type];
                    w.writeAnswerField(form, 'q' + (i + 1) + '_answer', {
                        x: MARGIN + 14,
                        width: unit ? 150 : 320,
                        unit: unit
                    });
                    w.gap(6);
                });
                return pdfDoc.save();
            });
        });
    }

    function buildAnswerKeyPdf(results, opts) {
        opts = opts || {};
        return PDFLib.PDFDocument.create().then(function(pdfDoc) {
            return embedFonts(pdfDoc).then(function(fonts) {
                var w = makeWriter(pdfDoc, fonts[0], fonts[1]);
                w.writeLine(opts.title || 'Chemistry Worksheet — Answer Key', { bold: true, size: TITLE_SIZE });
                w.gap(10);
                results.forEach(function(r, i) {
                    if (r.error) return;
                    w.writeWrapped((i + 1) + '. ' + r.question);
                    w.writeWrapped('Answer: ' + r.answer, { x: MARGIN + 14, bold: true });
                    (r.steps || []).forEach(function(s, si) {
                        w.writeWrapped((si + 1) + '. ' + s, { x: MARGIN + 14 });
                    });
                    w.gap(12);
                });
                return pdfDoc.save();
            });
        });
    }

    return {
        version: '1.0',
        buildQuestionsPdf: buildQuestionsPdf,
        buildAnswerKeyPdf: buildAnswerKeyPdf
    };
}));
