/**
 * @file BuildPDFVaultXReader.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Assembles PDFVaultXReader.html, a single self-contained
 *   plain HTML file (no CDN, no server, works opened directly from disk)
 *   that unpacks and runs any PDFVaultX-format PDF (Terminal.pdf,
 *   molecule-viewer.pdf, inverse-design.pdf, fobbs-valence-table.pdf, or
 *   any future one) in a sandboxed iframe, or lets you download the
 *   embedded files individually. Password-protected PDFVaultX containers
 *   are handled via pdf.js's own standard PDF security-handler support
 *   (RC4 / AES) -- decryption is PDF's own built-in functionality, not
 *   anything custom here.
 *
 *   PDFVaultXReader.template.html is the real source: hand-written UI and
 *   app logic (behind a run(command) dispatcher, this project's standing
 *   convention), with two placeholder tokens. This script's only job is
 *   substituting those tokens with the vendored pdf.js library source
 *   (executable, sets the global `pdfjsLib`) and its worker source
 *   (inert text, read at runtime and turned into a blob: URL Worker --
 *   a real Worker can't load from a file:// page, but a blob: URL can,
 *   which is what makes the double-click-to-open case work at all).
 *   pdfjs.min.js / pdfjs.worker.min.js are pdf.js's own legacy UMD build
 *   (mozilla/pdf.js, Apache-2.0), vendored here rather than pulled from a
 *   CDN so the assembled reader has zero external dependencies.
 * @tests test/BuildPDFVaultXReader.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TEMPLATE_FILE = 'PDFVaultXReader.template.html';
const LIB_FILE = 'pdfjs.min.js';
const WORKER_FILE = 'pdfjs.worker.min.js';
const OUTPUT_FILE = 'PDFVaultXReader.html';

class BuildPDFVaultXReader
{
    /**
     * Builds PDFVaultXReader.html from the current template + vendored
     * pdf.js sources and writes it to ROOT.
     * @returns {{outPath: string, byteLength: number}}
     */
    static build()
    {
        const template = fs.readFileSync(path.join(ROOT, TEMPLATE_FILE), 'utf8');
        const libSource = fs.readFileSync(path.join(ROOT, LIB_FILE), 'utf8');
        const workerSource = fs.readFileSync(path.join(ROOT, WORKER_FILE), 'utf8');

        if (workerSource.indexOf('</script') !== -1)
        {
            throw new Error('pdfjs.worker.min.js contains a literal "</script" sequence -- inlining it as-is would break out of its <script type="text/plain"> wrapper. Escape it before building.');
        }

        const output = template
            .replace('__PDFJS_LIB_SOURCE_PLACEHOLDER__', () => libSource)
            .replace('__PDFJS_WORKER_SOURCE_PLACEHOLDER__', () => workerSource);

        if (output.indexOf('__PDFJS_LIB_SOURCE_PLACEHOLDER__') !== -1 || output.indexOf('__PDFJS_WORKER_SOURCE_PLACEHOLDER__') !== -1)
        {
            throw new Error('One or both placeholder tokens were not substituted -- check PDFVaultXReader.template.html still has exactly one of each.');
        }

        const outPath = path.join(ROOT, OUTPUT_FILE);
        fs.writeFileSync(outPath, output);
        return { outPath, byteLength: Buffer.byteLength(output) };
    }

    /**
     * run(command): command-pattern entry point.
     *   run('build') -> builds PDFVaultXReader.html
     * @param {string} command
     */
    static run(command)
    {
        if (typeof command !== 'string') { return { error: 'Command must be a string.' }; }
        if (command.trim().toLowerCase() === 'build') { return BuildPDFVaultXReader.build(); }
        return { error: 'Unknown command: "' + command + '". Try BuildPDFVaultXReader.run("build")' };
    }
}

BuildPDFVaultXReader.version = '1.0.0';

module.exports = BuildPDFVaultXReader;

if (require.main === module)
{
    try
    {
        const result = BuildPDFVaultXReader.run('build');
        console.log('wrote', result.outPath, '(' + result.byteLength + ' bytes)');
    }
    catch (e)
    {
        console.error('BuildPDFVaultXReader failed:', e);
        process.exitCode = 1;
    }
}
