/**
 * @file BuildViewerPdf.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description PDFVaultX packaging for this directory's standalone chemistry
 *   viewers, the same mechanical envelope pooledimpact/mountainshift/v2's
 *   BuildTerminalPdf.js uses for Terminal.pdf: a standard PDF built with
 *   `pdf-lib`, using its own /Names/EmbeddedFiles file-attachment mechanism
 *   to bundle an HTML entry point plus its ordered JS dependency list as
 *   /Type /EmbeddedFile streams, alongside an ostore.json manifest. Opened
 *   in a normal PDF reader it shows a cover page; a MountainShift-aware
 *   host unpacks the attachments and runs the app.
 *
 *   Unlike Terminal.pdf's dependency list (SecurityMixin/MountainShift's
 *   activation-token-gated, opaque-closure hardening), these viewers are
 *   plain data/math modules with no security-mixin layer of their own --
 *   this file only does the portability envelope, not the OS-core-style
 *   encapsulation Terminal.pdf's own dependencies implement internally.
 *
 *   Primary surface is run(command) per this project's command-pattern
 *   convention: the actual packaging logic lives in build(viewerKey), and
 *   run() is a thin dispatcher over it, so a future UI (a build panel, a
 *   CLI flag elsewhere) can integrate by calling run(cmd) without touching
 *   this logic.
 * @tests test/BuildViewerPdf.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const ROOT = __dirname;

/**
 * One entry per packageable viewer. `deps` is the local (./*.js) script
 * dependency list read directly off each viewer's own <script src> tags,
 * in the order they load in -- kept explicit here, not derived by
 * globbing, so the list stays a reviewable, deliberate choice the way
 * Terminal.pdf's DEPENDENCIES is. External CDN scripts (three.js) are not
 * bundled -- this envelope packages the repo's own local files; the
 * unpacking host still needs network for the one external library.
 * @type {Object<string, {entry: string, deps: string[]}>}
 */
const VIEWERS = {
    'molecule-viewer': {
        entry: 'MoleculeViewer.html',
        deps: [
            'PDT.js', 'Smiles.js', 'Aromaticity.js', 'CoordinationChemistry.js',
            'MolecularStructure.js', 'MolecularGeometry.js', 'MolecularElectrostatics.js',
            'MolecularTPSA.js', 'MolecularVanDerWaals.js', 'MolecularPolarizability.js',
            'MolecularReactivity.js', 'MolecularVibrations.js', 'MolecularVibrationalModes.js',
            'MolecularSymmetry.js', 'MolecularThermodynamics.js', 'MolecularDescriptors.js',
            'MolecularReport.js', 'MolecularViewer.js'
        ]
    },
    'inverse-design': {
        entry: 'InverseDesign.html',
        deps: [
            'PDT.js', 'Smiles.js', 'Aromaticity.js', 'CoordinationChemistry.js',
            'MolecularStructure.js', 'MolecularGeometry.js', 'MolecularElectrostatics.js',
            'MolecularTPSA.js', 'MolecularVanDerWaals.js', 'MolecularPolarizability.js',
            'MolecularReactivity.js', 'MolecularVibrations.js', 'MolecularVibrationalModes.js',
            'MolecularSymmetry.js', 'MolecularThermodynamics.js', 'MolecularDescriptors.js',
            'MolecularReport.js', 'ExtendX.js'
        ]
    },
    'fobbs-valence-table': {
        entry: 'FobbsValenceTable.html',
        deps: []
    }
};

class BuildViewerPdf
{
    /**
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
     * Same manifest shape as BuildTerminalPdf.buildManifest(), scoped to
     * this viewer's own appId/entry/dependency list.
     * @param {string} viewerKey
     * @returns {Object}
     */
    static buildManifest(viewerKey)
    {
        const viewer = VIEWERS[viewerKey];
        return {
            containerVersion: '1.0.0',
            appId: viewerKey,
            securityTier: 'simple',
            savedAt: Date.now(),
            data: {
                entry: viewer.entry,
                runtime: 'design-component',
                dependencies: viewer.deps.slice()
            }
        };
    }

    /**
     * Builds <viewerKey>.pdf from the current repo source and writes it
     * to ROOT. Every embedded file is attached via pdf-lib's attach() API,
     * same as BuildTerminalPdf.build() -- no hand-crafted PDF objects.
     * @param {string} viewerKey one of Object.keys(VIEWERS)
     * @returns {Promise<{outPath: string, fileCount: number, byteLength: number}>}
     */
    static async build(viewerKey)
    {
        const viewer = VIEWERS[viewerKey];
        if (!viewer) { throw new Error('Unknown viewer: ' + viewerKey + '. Known: ' + Object.keys(VIEWERS).join(', ')); }

        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([300, 150]);
        page.drawText(viewer.entry + ' -- PDFVaultX container', { x: 20, y: 100, size: 11 });
        page.drawText('Open with a MountainShift-aware host.', { x: 20, y: 82, size: 8 });
        page.drawText('Built ' + new Date().toISOString().slice(0, 10) + ' from research/periodic-data-table.', { x: 20, y: 67, size: 7 });
        if (viewer.deps.length === 0)
        {
            page.drawText('Self-contained: no local JS dependencies.', { x: 20, y: 52, size: 7 });
        }

        const manifestBytes = Buffer.from(JSON.stringify(BuildViewerPdf.buildManifest(viewerKey), null, 2), 'utf8');
        await pdfDoc.attach(manifestBytes, 'ostore.json', {
            mimeType: BuildViewerPdf.mimeFor('ostore.json'),
            description: 'PDFVaultX container manifest'
        });

        const entryBytes = fs.readFileSync(path.join(ROOT, viewer.entry));
        await pdfDoc.attach(entryBytes, 'entry.html', {
            mimeType: BuildViewerPdf.mimeFor('entry.html'),
            description: viewer.entry
        });

        for (const dep of viewer.deps)
        {
            const bytes = fs.readFileSync(path.join(ROOT, dep));
            await pdfDoc.attach(bytes, dep, {
                mimeType: BuildViewerPdf.mimeFor(dep),
                description: dep
            });
        }

        const outBytes = await pdfDoc.save();
        const outPath = path.join(ROOT, viewerKey + '.pdf');
        fs.writeFileSync(outPath, outBytes);

        return { outPath, fileCount: viewer.deps.length + 2, byteLength: outBytes.length };
    }

    /**
     * run(command): command-pattern entry point, this project's standing
     * convention (PDT.run, Stoichiometry.run, ChemistryProblemGenerator.run).
     *   run('build <viewerKey>')  -> builds one viewer's PDF
     *   run('build-all')          -> builds every known viewer's PDF
     *   run('list')               -> known viewer keys
     *   run('help')               -> usage text
     * @param {string} command
     * @returns {Promise<Object>}
     */
    static async run(command)
    {
        if (typeof command !== 'string') { return { error: 'Command must be a string.' }; }
        const trimmed = command.trim();
        const lower = trimmed.toLowerCase();

        if (lower === 'help')
        {
            return {
                help: '\n' +
                'BuildViewerPdf.run("list")                - List known viewer keys\n' +
                'BuildViewerPdf.run("build <viewerKey>")    - Build one viewer\'s PDF\n' +
                'BuildViewerPdf.run("build-all")            - Build every known viewer\'s PDF\n'
            };
        }
        if (lower === 'list') { return { viewers: Object.keys(VIEWERS) }; }
        if (lower === 'build-all')
        {
            const results = {};
            for (const key of Object.keys(VIEWERS)) { results[key] = await BuildViewerPdf.build(key); }
            return { results };
        }
        const buildMatch = /^build\s+(\S+)$/.exec(trimmed);
        if (buildMatch) { return await BuildViewerPdf.build(buildMatch[1]); }

        return { error: 'Unknown command: "' + command + '". Try BuildViewerPdf.run("help")' };
    }
}

BuildViewerPdf.version = '1.0.0';
BuildViewerPdf.VIEWERS = VIEWERS;

module.exports = BuildViewerPdf;

if (require.main === module)
{
    const arg = process.argv[2] || 'build-all';
    BuildViewerPdf.run(arg)
        .then((result) =>
        {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch((e) =>
        {
            console.error('BuildViewerPdf failed:', e);
            process.exitCode = 1;
        });
}
