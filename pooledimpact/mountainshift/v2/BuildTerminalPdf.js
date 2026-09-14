/**
 * @file BuildTerminalPdf.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Build tooling for Terminal.pdf, the PDFVaultX-format
 *   container the Terminal DC ships as. Reverse-engineered from a prior
 *   Terminal.pdf via direct binary forensics (its own /Producer metadata,
 *   plus its /Names/EmbeddedFiles + /AF catalog structure): it is not a
 *   custom format at all, just a standard PDF file-attachment container
 *   produced by the `pdf-lib` npm library, one /Type /EmbeddedFile stream
 *   per attached file (ostore.json manifest, entry.html, and every JS
 *   dependency entry.html's own <script> tags load in order).
 *
 *   This script re-derives that same container from the CURRENT, hardened
 *   repo source rather than patching the old PDF's bytes in place --
 *   whatever ships in Terminal.pdf is always exactly what
 *   Terminal.entry.html and its dependency list say it is, never a stale
 *   copy. Run after any change to Terminal.entry.html or to a file in
 *   DEPENDENCIES.
 *
 *   Not a runtime module -- a build-time CLI script, run directly via
 *   `node BuildTerminalPdf.js`. Requires the `pdf-lib` devDependency
 *   declared in package.json.
 * @tests test/BuildTerminalPdf.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const ROOT = __dirname;
const ENTRY_FILE = 'Terminal.entry.html';
const OUTPUT_FILE = 'Terminal.pdf';

/**
 * Every file entry.html's own <helmet> <script src> tags load, in the
 * exact order they load in -- kept here as an explicit, reviewable list
 * rather than derived by globbing the directory, since the boot order
 * matters and not every .js file in this repo belongs in the Terminal.
 * @type {string[]}
 */
const DEPENDENCIES = [
    'support.js',
    'BaseClassX.js',
    'ExtendX.js',
    'SecurityMixin.js',
    'StructureMixin.js',
    'FileFsX.js',
    'Environment.js',
    'CPU.js',
    'Physical.js',
    'Memory.js',
    'Kernel.js',
    'BIOS.js',
    'Registry.js',
    'MountainShift.js',
    'Procd.js',
    'PosixCommands.js'
];

class BuildTerminalPdf
{
    /**
     * Maps a filename to the MIME subtype the original Terminal.pdf used
     * for that extension (confirmed via forensics on its /Subtype keys,
     * e.g. /Subtype /application#2Fjavascript for a real "/" escaped as
     * "#2F" per PDF name-object syntax -- pdf-lib handles that escaping
     * itself, this only needs to supply the unescaped MIME string).
     * @param {string} name
     * @returns {string}
     */
    static mimeFor(name)
    {
        if (name.endsWith('.js')) { return 'application/javascript'; }
        if (name.endsWith('.html')) { return 'text/html'; }
        if (name.endsWith('.json')) { return 'application/vnd.mountainshift.ostore+json'; }
        return 'application/octet-stream';
    }

    /**
     * Builds the ostore.json manifest object. Shape confirmed against the
     * original Terminal.pdf's own embedded ostore.json byte-for-byte
     * (after zlib-inflating its /FlateDecode stream): containerVersion,
     * appId, securityTier, savedAt (epoch ms, refreshed on every build),
     * and data.{entry, runtime, dependencies}.
     * @returns {Object}
     */
    static buildManifest()
    {
        return {
            containerVersion: '1.0.0',
            appId: 'terminal',
            securityTier: 'simple',
            savedAt: Date.now(),
            data: {
                entry: 'entry.html',
                runtime: 'design-component',
                dependencies: DEPENDENCIES.slice()
            }
        };
    }

    /**
     * Builds Terminal.pdf from the current repo source and writes it to
     * OUTPUT_FILE. Every embedded file is attached via pdf-lib's own
     * attach() API -- no hand-crafted PDF object dictionaries -- since a
     * real reader only cares that the container is standards-conformant,
     * not that its bytes match the original build tool's output exactly.
     * @returns {Promise<{outPath: string, fileCount: number, byteLength: number}>}
     */
    static async build()
    {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([300, 150]);
        page.drawText('MountainShift OS -- Terminal.pdf', { x: 20, y: 100, size: 12 });
        page.drawText('PDFVaultX container -- open with a MountainShift-aware host.', { x: 20, y: 80, size: 8 });
        page.drawText('Rebuilt ' + new Date().toISOString().slice(0, 10) + ' -- hardened boot chain (MountainShift/E.1, Signature/C.1).', { x: 20, y: 65, size: 7 });

        const manifestBytes = Buffer.from(JSON.stringify(BuildTerminalPdf.buildManifest(), null, 2), 'utf8');
        await pdfDoc.attach(manifestBytes, 'ostore.json', {
            mimeType: BuildTerminalPdf.mimeFor('ostore.json'),
            description: 'MountainShift OS container manifest'
        });

        const entryBytes = fs.readFileSync(path.join(ROOT, ENTRY_FILE));
        await pdfDoc.attach(entryBytes, 'entry.html', {
            mimeType: BuildTerminalPdf.mimeFor('entry.html'),
            description: 'Terminal DC entry point'
        });

        for (const dep of DEPENDENCIES)
        {
            const bytes = fs.readFileSync(path.join(ROOT, dep));
            await pdfDoc.attach(bytes, dep, {
                mimeType: BuildTerminalPdf.mimeFor(dep),
                description: dep
            });
        }

        const outBytes = await pdfDoc.save();
        const outPath = path.join(ROOT, OUTPUT_FILE);
        fs.writeFileSync(outPath, outBytes);

        return { outPath, fileCount: DEPENDENCIES.length + 2, byteLength: outBytes.length };
    }
}

BuildTerminalPdf.version = '1.0.0';
BuildTerminalPdf.DEPENDENCIES = DEPENDENCIES;

module.exports = BuildTerminalPdf;

if (require.main === module)
{
    BuildTerminalPdf.build()
        .then((result) =>
        {
            console.log('wrote', result.outPath, '(' + result.byteLength + ' bytes,', result.fileCount, 'embedded files)');
        })
        .catch((e) =>
        {
            console.error('BuildTerminalPdf failed:', e);
            process.exitCode = 1;
        });
}
