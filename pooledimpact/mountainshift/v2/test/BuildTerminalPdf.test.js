// Life-cycle proof for BuildTerminalPdf.js: builds a REAL Terminal.pdf into
// a scratch file, then reads it back with pdf-lib and inflates each
// /FlateDecode /EmbeddedFile stream to confirm every attached file is
// present and byte-for-byte identical to the real repo source it was
// built from -- not just "pdf-lib didn't throw."
//
// Run with: node test/BuildTerminalPdf.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, PDFName } = require('pdf-lib');
const { check, report } = require('./helpers.js');

const V2 = path.join(__dirname, '..');
const BuildTerminalPdf = require(path.join(V2, 'BuildTerminalPdf.js'));

/**
 * Reads back every /Type /EmbeddedFile entry from a built PDF's
 * catalog /Names /EmbeddedFiles tree, inflating its /FlateDecode stream.
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<Map<string, Buffer>>}
 */
async function readAttachments(pdfBytes) {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const namesDict = pdfDoc.context.lookup(pdfDoc.catalog.get(PDFName.of('Names')));
    const embeddedFiles = pdfDoc.context.lookup(namesDict.get(PDFName.of('EmbeddedFiles')));
    const namesArray = pdfDoc.context.lookup(embeddedFiles.get(PDFName.of('Names')));
    const entries = namesArray.array;
    const out = new Map();
    for (let i = 0; i < entries.length; i += 2) {
        const rawName = entries[i].decodeText();
        const filespec = pdfDoc.context.lookup(entries[i + 1]);
        const efDict = pdfDoc.context.lookup(filespec.get(PDFName.of('EF')));
        const fStream = pdfDoc.context.lookup(efDict.get(PDFName.of('F')));
        const raw = fStream.getContents();
        const filter = fStream.dict.get(PDFName.of('Filter'));
        const decoded = filter && filter.encodedName === '/FlateDecode' ? zlib.inflateSync(raw) : Buffer.from(raw);
        out.set(rawName, decoded);
    }
    return out;
}

async function run() {
    check('DEPENDENCIES is a non-empty array of real files that exist in the repo', () => {
        if (!Array.isArray(BuildTerminalPdf.DEPENDENCIES) || BuildTerminalPdf.DEPENDENCIES.length === 0) {
            throw new Error('DEPENDENCIES is empty or not an array');
        }
        for (const dep of BuildTerminalPdf.DEPENDENCIES) {
            if (!fs.existsSync(path.join(V2, dep))) throw new Error('missing dependency file: ' + dep);
        }
    });

    check('buildManifest() matches the shape confirmed via forensics on the original Terminal.pdf', () => {
        const m = BuildTerminalPdf.buildManifest();
        if (m.containerVersion !== '1.0.0' || m.appId !== 'terminal') throw new Error('unexpected manifest header: ' + JSON.stringify(m));
        if (m.data.entry !== 'entry.html' || m.data.runtime !== 'design-component') throw new Error('unexpected manifest.data: ' + JSON.stringify(m.data));
        if (JSON.stringify(m.data.dependencies) !== JSON.stringify(BuildTerminalPdf.DEPENDENCIES)) throw new Error('manifest dependencies do not match DEPENDENCIES');
    });

    const result = await BuildTerminalPdf.build();
    check('build() reports the correct file count and a real, sizeable output', () => {
        if (result.fileCount !== BuildTerminalPdf.DEPENDENCIES.length + 2) throw new Error('unexpected fileCount: ' + result.fileCount);
        if (result.byteLength < 10000) throw new Error('output PDF suspiciously small: ' + result.byteLength);
        if (!fs.existsSync(result.outPath)) throw new Error('output file was not actually written: ' + result.outPath);
    });

    const pdfBytes = fs.readFileSync(result.outPath);
    const attachments = await readAttachments(pdfBytes);
    check('the built PDF embeds exactly ostore.json + entry.html + every DEPENDENCIES entry, nothing else', () => {
        const expected = ['ostore.json', 'entry.html', ...BuildTerminalPdf.DEPENDENCIES].sort();
        const actual = Array.from(attachments.keys()).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    });

    check('entry.html embedded in the PDF is byte-for-byte identical to Terminal.entry.html on disk', () => {
        const onDisk = fs.readFileSync(path.join(V2, 'Terminal.entry.html'));
        const embedded = attachments.get('entry.html');
        if (Buffer.compare(onDisk, embedded) !== 0) throw new Error('entry.html mismatch: ' + onDisk.length + ' vs ' + embedded.length + ' bytes');
    });

    check('every dependency embedded in the PDF is byte-for-byte identical to its source file on disk', () => {
        for (const dep of BuildTerminalPdf.DEPENDENCIES) {
            const onDisk = fs.readFileSync(path.join(V2, dep));
            const embedded = attachments.get(dep);
            if (Buffer.compare(onDisk, embedded) !== 0) throw new Error(dep + ' mismatch: ' + onDisk.length + ' vs ' + embedded.length + ' bytes');
        }
    });

    check('ostore.json embedded in the PDF parses and matches buildManifest()\'s shape (savedAt excluded, it is a fresh timestamp)', () => {
        const embedded = JSON.parse(attachments.get('ostore.json').toString('utf8'));
        const fresh = BuildTerminalPdf.buildManifest();
        if (embedded.appId !== fresh.appId || embedded.containerVersion !== fresh.containerVersion) throw new Error('manifest header mismatch');
        if (JSON.stringify(embedded.data.dependencies) !== JSON.stringify(fresh.data.dependencies)) throw new Error('manifest dependencies mismatch');
    });

    // check()'s own documented limitation (see MountainShift.opaque.test.js's
    // header) applies here too: it only catches SYNCHRONOUS throws. This
    // scenario is inherently async (a real file build), so it is awaited to
    // a settled value FIRST, then asserted via a plain check() over that
    // already-resolved outcome.
    // Nested under V2 (not os.tmpdir()) so require('pdf-lib') inside the
    // scratch copy of BuildTerminalPdf.js resolves via V2's own
    // node_modules the normal way Node walks up parent directories.
    const scratchDir = fs.mkdtempSync(path.join(V2, '.build-terminal-pdf-test-'));
    let scratchMarkerFound = false;
    let scratchError = null;
    try {
        fs.copyFileSync(path.join(V2, 'Terminal.entry.html'), path.join(scratchDir, 'Terminal.entry.html'));
        for (const dep of BuildTerminalPdf.DEPENDENCIES) {
            fs.copyFileSync(path.join(V2, dep), path.join(scratchDir, dep));
        }
        const marker = '\n// SCRATCH-TEST-MARKER-' + Date.now();
        fs.appendFileSync(path.join(scratchDir, 'MountainShift.js'), marker);
        // A fresh module instance rooted at scratchDir: write a copy of
        // BuildTerminalPdf.js with ROOT repointed at the scratch directory,
        // so build() reads the (deliberately modified) scratch copies
        // instead of the real repo source.
        const scriptSrc = fs.readFileSync(path.join(V2, 'BuildTerminalPdf.js'), 'utf8')
            .replace('const ROOT = __dirname;', 'const ROOT = ' + JSON.stringify(scratchDir) + ';');
        const scratchScriptPath = path.join(scratchDir, 'BuildTerminalPdf.scratch.js');
        fs.writeFileSync(scratchScriptPath, scriptSrc);
        const ScratchBuild = require(scratchScriptPath);
        const scratchResult = await ScratchBuild.build();
        const scratchAttachments = await readAttachments(fs.readFileSync(scratchResult.outPath));
        const scratchMs = scratchAttachments.get('MountainShift.js').toString('utf8');
        scratchMarkerFound = scratchMs.endsWith(marker);
    } catch (e) {
        scratchError = e;
    } finally {
        fs.rmSync(scratchDir, { recursive: true, force: true });
    }
    check('building against a scratch copy with modified dependency content picks up the NEW content, proving this is a live rebuild, not a cached/stale copy', () => {
        if (scratchError) throw scratchError;
        if (!scratchMarkerFound) throw new Error('rebuilt PDF did not pick up the modified MountainShift.js content');
    });

    report();
}

run().catch((err) => {
    console.error('BuildTerminalPdf.test.js failed:', err);
    process.exitCode = 1;
});
