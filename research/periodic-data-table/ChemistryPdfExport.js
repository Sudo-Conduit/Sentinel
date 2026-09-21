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
        function gap(px) { y -= px; }
        return { writeLine: writeLine, writeWrapped: writeWrapped, gap: gap };
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
                w.writeLine(opts.title || 'Chemistry Worksheet', { bold: true, size: TITLE_SIZE });
                w.gap(10);
                results.forEach(function(r, i) {
                    if (r.error) return;
                    w.writeWrapped((i + 1) + '. ' + r.question);
                    w.gap(12);
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
