/**
 * @file InlineViewerHtml.js
 * @author Will Fobbs
 * @description Folds a viewer's local JS dependencies directly into its
 *   HTML as inline <script> blocks, replacing each <script src="./X.js">
 *   reference in place -- turning "one HTML file plus N sibling .js files
 *   that all have to stay together in the same folder" into one
 *   standalone .html a human can move, share, or double-click on its own.
 *
 *   This is the same principle PDFVaultXReader.html already applies to
 *   pdf.js (vendored and inlined, no external file needed to run it):
 *   the HTML file itself becomes the archive. External CDN scripts
 *   (three.js) are left alone -- this only inlines the repo's OWN files;
 *   an unpacking/opening host still needs network for a real third-party
 *   library.
 *
 *   Primary surface is run(command), this project's standing convention:
 *   the actual substitution logic lives in inline(viewerKey), and run()
 *   is a thin dispatcher over it.
 * @tests test/InlineViewerHtml.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { VIEWERS } = require('./ViewerManifest.js');

const ROOT = __dirname;

class InlineViewerHtml
{
    /**
     * Builds the exact <script src="./dep"></script> tag InlineViewerHtml
     * expects to find (matches how every viewer here actually writes its
     * own script tags -- see MoleculeViewer.html/InverseDesign.html).
     * @param {string} dep
     * @returns {RegExp}
     */
    static tagPatternFor(dep)
    {
        const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('<script src="\\./' + escaped + '"></script>');
    }

    /**
     * Folds viewerKey's local dependencies into its entry HTML, replacing
     * each <script src="./dep"></script> tag with an inline <script>
     * block holding that file's real content, in the same load order
     * ViewerManifest.js lists them. Throws if a dependency's script tag
     * isn't found -- a silent no-op there would ship a viewer that's
     * still missing a real dependency, exactly the bug this exists to
     * prevent.
     * @param {string} viewerKey one of Object.keys(VIEWERS)
     * @returns {{html: string, inlinedCount: number}}
     */
    static inline(viewerKey)
    {
        const viewer = VIEWERS[viewerKey];
        if (!viewer) { throw new Error('Unknown viewer: ' + viewerKey + '. Known: ' + Object.keys(VIEWERS).join(', ')); }

        let html = fs.readFileSync(path.join(ROOT, viewer.entry), 'utf8');
        let inlinedCount = 0;

        for (const dep of viewer.deps)
        {
            const pattern = InlineViewerHtml.tagPatternFor(dep);
            if (!pattern.test(html))
            {
                throw new Error('Could not find <script src="./' + dep + '"></script> in ' + viewer.entry + ' -- ViewerManifest.js and the real file have drifted apart.');
            }
            const depSource = fs.readFileSync(path.join(ROOT, dep), 'utf8');
            html = html.replace(pattern, '<script>\n' + depSource + '\n</script>');
            inlinedCount++;
        }

        return { html, inlinedCount };
    }

    /**
     * Same as inline(), but also writes the result to
     * <viewerKey>.standalone.html in this directory, as its own
     * shareable artifact independent of the PDFVaultX packaging.
     * @param {string} viewerKey
     * @returns {{outPath: string, byteLength: number, inlinedCount: number}}
     */
    static build(viewerKey)
    {
        const { html, inlinedCount } = InlineViewerHtml.inline(viewerKey);
        const outPath = path.join(ROOT, viewerKey + '.standalone.html');
        fs.writeFileSync(outPath, html);
        return { outPath, byteLength: Buffer.byteLength(html), inlinedCount };
    }

    /**
     * run(command): command-pattern entry point.
     *   run('build <viewerKey>')  -> writes <viewerKey>.standalone.html
     *   run('build-all')          -> builds every known viewer's standalone HTML
     * @param {string} command
     */
    static run(command)
    {
        if (typeof command !== 'string') { return { error: 'Command must be a string.' }; }
        const trimmed = command.trim();
        const lower = trimmed.toLowerCase();

        if (lower === 'help')
        {
            return {
                help: '\n' +
                'InlineViewerHtml.run("build <viewerKey>")  - Write <viewerKey>.standalone.html\n' +
                'InlineViewerHtml.run("build-all")          - Build every known viewer\n'
            };
        }
        if (lower === 'build-all')
        {
            const results = {};
            for (const key of Object.keys(VIEWERS)) { results[key] = InlineViewerHtml.build(key); }
            return { results };
        }
        const buildMatch = /^build\s+(\S+)$/.exec(trimmed);
        if (buildMatch) { return InlineViewerHtml.build(buildMatch[1]); }

        return { error: 'Unknown command: "' + command + '". Try InlineViewerHtml.run("help")' };
    }
}

InlineViewerHtml.version = '1.0.0';

module.exports = InlineViewerHtml;

if (require.main === module)
{
    const arg = process.argv[2] || 'build-all';
    try
    {
        console.log(JSON.stringify(InlineViewerHtml.run(arg), null, 2));
    }
    catch (e)
    {
        console.error('InlineViewerHtml failed:', e);
        process.exitCode = 1;
    }
}
