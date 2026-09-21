/**
 * @file DocMeta.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Live proof of "Class + Template = a standard doc created
 *   at runtime, the Class is the data" (Envelope-Format-Spec.md's own
 *   Addendum C, applied to itself): a document's `Version:`/Changelog
 *   block is schema-tracked state on a `BaseClassX` instance, not prose
 *   a person edits by hand in two separate places that can disagree.
 *
 *   `BaseClassX` already provides the append-only log this needs --
 *   `_recordTrace()` pushes an entry onto `this._trace` and never prunes
 *   it by default (`_maxTraceLength` defaults to 0, meaning unbounded).
 *   `release()` below calls the existing `setVersion()` (which itself
 *   records a `set_version` trace entry) and then records one additional
 *   `changelog_entry` trace entry carrying the human summary. The
 *   changelog is never stored as its own array -- `getChangelog()` is a
 *   read-only PROJECTION filtering `this.trace` down to entries of that
 *   type, so there is exactly one place a release is recorded, not two.
 *
 *   `renderVersionBlock()` is the Template half: a pure function of a
 *   `DocMeta` instance's current state, producing the same
 *   `**Version:**`/`**Last updated:**`/`## Changelog` markdown shape
 *   `MSOS-Cleanup-Roadmap.md` and `Envelope-Format-Spec.md` currently
 *   maintain by hand. It reads `docMeta.version`/`getChangelog()` fresh
 *   on every call -- there is nothing for it to remember, so there is
 *   nothing for it to have wrong.
 * @docs Envelope-Format-Spec.md
 * @tests test/DocMeta.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./BaseClassX.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./BaseClassX.js'));
    }
    else
    {
        root.DocMeta = factory(root.BaseClassX);
    }
}(typeof self !== 'undefined' ? self : this, function(BaseClassX)
{
    'use strict';
    if (!BaseClassX)
    {
        throw new Error('DocMeta requires BaseClassX to be loaded first');
    }

    class DocMeta extends BaseClassX
    {
        static name = 'DocMeta';
        static author = 'Will Fobbs';
        static version = '1.0.0';
        static domain = 'envelope.docmeta';
        static description = 'Schema-tracked doc version/changelog state -- the Class half of "Class + Template = a standard doc created at runtime."';
        static docs = ['Envelope-Format-Spec.md'];
        static tests = ['test/DocMeta.test.js'];
        static _schema = { properties: {
            title: { type: 'string', default: '' }
        }};

        constructor(options = {})
        {
            super({ type: 'envelope.docmeta', name: options.title || 'DocMeta', version: options.version || '0.0.0' });
            this.title = options.title || '';
        }

        /**
         * Bumps the doc's version and appends exactly one real changelog
         * entry to the append-only trace log. Never overwrites a prior
         * entry -- setVersion() already records its own 'set_version'
         * trace entry, and this adds a second, richer 'changelog_entry'
         * one carrying the human-readable summary alongside it.
         * @param {string} version
         * @param {string} summary
         * @returns {DocMeta}
         */
        release(version, summary)
        {
            this._assertAlive();
            this.setVersion(version);
            this._recordTrace('changelog_entry', { version, summary });
            return this;
        }

        /**
         * The changelog as a read-only projection over the trace log --
         * never separately stored, so it cannot drift from what
         * release() actually recorded.
         * @returns {Array<{version: string, summary: string, timestamp: number}>}
         */
        getChangelog()
        {
            return this.trace
                .filter((entry) => entry.type === 'changelog_entry')
                .map((entry) => ({
                    version: entry.data.version,
                    summary: entry.data.summary,
                    timestamp: entry.timestamp
                }));
        }
    }

    /**
     * Template: renders the same Version/Last-updated/Changelog
     * markdown block MSOS-Cleanup-Roadmap.md and
     * Envelope-Format-Spec.md currently maintain by hand, as a pure
     * function of a DocMeta instance's current state. Newest entry
     * first, matching both docs' existing changelog convention.
     * @param {DocMeta} docMeta
     * @returns {string}
     */
    function renderVersionBlock(docMeta)
    {
        const changelog = docMeta.getChangelog();
        const last = changelog[changelog.length - 1];
        const lastUpdated = new Date(last ? last.timestamp : docMeta.modified).toISOString().slice(0, 10);

        const lines = [
            '**Version:** ' + docMeta.version,
            '**Last updated:** ' + lastUpdated,
            '',
            '## Changelog',
            ''
        ];

        for (const entry of [...changelog].reverse())
        {
            lines.push('- **' + entry.version + '** — ' + entry.summary);
        }

        return lines.join('\n');
    }

    DocMeta.renderVersionBlock = renderVersionBlock;

    return DocMeta;
}));
