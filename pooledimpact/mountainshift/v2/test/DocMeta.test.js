// Life-cycle proof for DocMeta.js: a document's Version:/Changelog block
// rendered as a live PROJECTION over a BaseClassX instance's own
// append-only trace log, rather than prose maintained by hand in two
// places that can disagree (Envelope-Format-Spec.md's Addendum C,
// applied to itself).
//
// Run with: node test/DocMeta.test.js
'use strict';
const path = require('path');
const V2 = path.join(__dirname, '..');
const BaseClassX = require(path.join(V2, 'BaseClassX.js'));
const DocMeta = require(path.join(V2, 'DocMeta.js'));
const { check, report } = require('./helpers.js');

function run()
{
    const doc = new DocMeta({ title: 'Test Doc' });

    check('a fresh DocMeta has no changelog entries yet', () =>
    {
        if (doc.getChangelog().length !== 0) throw new Error('expected an empty changelog, got ' + doc.getChangelog().length);
    });

    doc.release('1.0.0', 'Initial draft.');

    check('release() sets version via the real setVersion() -- not a separate field', () =>
    {
        if (doc.version !== '1.0.0') throw new Error('expected version 1.0.0, got ' + doc.version);
    });

    check('release() records exactly one changelog_entry trace entry, alongside setVersion()\'s own set_version entry', () =>
    {
        const setVersionEntries = doc.trace.filter((e) => e.type === 'set_version');
        const changelogEntries = doc.trace.filter((e) => e.type === 'changelog_entry');
        if (setVersionEntries.length !== 1) throw new Error('expected exactly 1 set_version trace entry, got ' + setVersionEntries.length);
        if (changelogEntries.length !== 1) throw new Error('expected exactly 1 changelog_entry trace entry, got ' + changelogEntries.length);
    });

    check('getChangelog() projects the real recorded entry, not a separately-stored copy', () =>
    {
        const cl = doc.getChangelog();
        if (cl.length !== 1) throw new Error('expected 1 changelog entry, got ' + cl.length);
        if (cl[0].version !== '1.0.0' || cl[0].summary !== 'Initial draft.') throw new Error('unexpected entry: ' + JSON.stringify(cl[0]));
    });

    doc.release('1.1.0', 'Second real round of change.');
    doc.release('1.2.0', 'Third real round of change.');

    check('multiple release() calls accumulate -- the log is append-only, nothing is overwritten', () =>
    {
        const cl = doc.getChangelog();
        if (cl.length !== 3) throw new Error('expected 3 accumulated changelog entries, got ' + cl.length);
        if (cl.map((e) => e.version).join(',') !== '1.0.0,1.1.0,1.2.0') throw new Error('entries out of order or lost: ' + JSON.stringify(cl));
    });

    check('the trace log itself is unbounded by default (_maxTraceLength defaults to 0) -- confirmed against the live instance, not assumed', () =>
    {
        if (doc._maxTraceLength !== 0) throw new Error('expected default _maxTraceLength of 0 (unbounded), got ' + doc._maxTraceLength);
        // Every real 'set_version' and 'changelog_entry' trace entry from
        // all 3 releases so far must still be present -- proving nothing
        // was pruned, without hardcoding the exact total (the schema
        // Proxy's own 'set'/'init' entries also land in this.trace,
        // confirmed live via node -e rather than assumed at 2-per-release).
        const setVersionCount = doc.trace.filter((e) => e.type === 'set_version').length;
        const changelogCount = doc.trace.filter((e) => e.type === 'changelog_entry').length;
        if (setVersionCount !== 3) throw new Error('expected 3 surviving set_version entries, got ' + setVersionCount);
        if (changelogCount !== 3) throw new Error('expected 3 surviving changelog_entry entries, got ' + changelogCount);
    });

    const rendered = DocMeta.renderVersionBlock(doc);

    check('renderVersionBlock() reports the CURRENT (latest) version, not the first', () =>
    {
        if (!rendered.startsWith('**Version:** 1.2.0')) throw new Error('expected the block to lead with the latest version, got:\n' + rendered);
    });

    check('renderVersionBlock() lists every changelog entry, newest first, matching this repo\'s existing changelog convention', () =>
    {
        const idx120 = rendered.indexOf('**1.2.0**');
        const idx110 = rendered.indexOf('**1.1.0**');
        const idx100 = rendered.indexOf('**1.0.0**');
        if (idx120 === -1 || idx110 === -1 || idx100 === -1) throw new Error('a changelog entry is missing from the rendered output:\n' + rendered);
        if (!(idx120 < idx110 && idx110 < idx100)) throw new Error('expected newest-first ordering, got:\n' + rendered);
    });

    // The real payoff: mutate the SAME instance again, re-render, and
    // confirm the new render reflects it -- proving this is a live
    // projection over current state, not a snapshot taken once.
    doc.release('1.3.0', 'A fourth round, added after the first render.');
    const rerendered = DocMeta.renderVersionBlock(doc);

    check('re-rendering after a further release() reflects the new state with no other change to the render call', () =>
    {
        if (!rerendered.startsWith('**Version:** 1.3.0')) throw new Error('expected the re-render to lead with 1.3.0, got:\n' + rerendered);
        if (rerendered.indexOf('**1.3.0**') === -1) throw new Error('new entry missing from re-render:\n' + rerendered);
        if (rerendered.indexOf('**1.0.0**') === -1) throw new Error('original entry lost from re-render:\n' + rerendered);
    });

    check('the original rendered string (captured before the fourth release) is untouched -- it is a plain string, not a live-bound view', () =>
    {
        if (!rendered.startsWith('**Version:** 1.2.0')) throw new Error('prior render should remain frozen at 1.2.0, got:\n' + rendered);
    });

    check('a DocMeta instance really is a BaseClassX instance -- this is not a lookalike, it is the real inherited machinery', () =>
    {
        if (!(doc instanceof BaseClassX)) throw new Error('expected doc to be an instanceof BaseClassX');
        if (typeof doc.computeFingerprint !== 'function') throw new Error('expected the real BaseClassX.computeFingerprint to be inherited');
    });

    report();
}

run();
