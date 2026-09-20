// UMD IIFE - TestRunner: pure report/record formatting for this
// directory's test suites, behind a run(command, suites) command
// dispatcher - the same command-pattern convention every other module
// here follows (PDT.run, Stoichiometry.run, ChemistryProblemGenerator.run).
//
// Deliberately has NO console.log and NO filesystem access anywhere in
// this file. Loading *.test.js files (require()) and writing output
// (console.log, fs.writeFileSync, or a browser download/clipboard) are
// host-specific I/O, owned by whatever driver calls this - run-all.js for
// Node today, a future browser/devtools driver later. TestRunner only
// ever takes already-computed suite results in and hands formatted
// strings back out, so a new UI can integrate by calling the same
// run(cmd) and doing its own I/O, without this logic changing at all.
//
// suites: an array of {name, checks, failures} - the exact shape every
// *.test.js file in this directory already exports.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TestRunner = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function aggregate(suites) {
        var totalChecks = 0, totalFailed = 0, greenSuites = 0;
        var lines = ['Suite\tResult'];
        suites.forEach(function(s) {
            totalChecks += s.checks;
            var ok = s.failures.length === 0;
            if (ok) greenSuites++; else totalFailed += s.failures.length;
            lines.push(s.name + '\t' + (ok ? 'ALL ' + s.checks + ' CHECKS PASSED' : (s.checks - s.failures.length) + '/' + s.checks + ' passed. FAILED: ' + s.failures.join(', ')));
        });
        lines.push('Total: ' + (totalChecks - totalFailed) + '/' + totalChecks + ' checks passing, ' + greenSuites + '/' + suites.length + ' suites green.');
        return {
            lines: lines,
            totalChecks: totalChecks,
            totalFailed: totalFailed,
            greenSuites: greenSuites,
            suiteCount: suites.length,
            ok: totalFailed === 0
        };
    }

    // meta: { timestamp (ISO string), commit (string, e.g. 'nogit' when
    // unavailable) } - both supplied by the caller, since "what time is
    // it" and "what commit is checked out" are themselves host-specific
    // (Node: Date()/git rev-parse; a browser tool would need its own
    // source for either).
    function formatSaveRecord(agg, meta) {
        var fileName = meta.timestamp.replace(/[:.]/g, '-') + '_' + meta.commit + '.txt';
        var header = [
            'research/periodic-data-table test suite',
            'Run at: ' + meta.timestamp,
            'Commit: ' + meta.commit,
            ''
        ];
        return { fileName: fileName, contents: header.concat(agg.lines).join('\n') + '\n' };
    }

    // run(command, suites, meta): command-pattern entry point.
    //   run('report', suites)          -> aggregate(suites)
    //   run('save-record', suites, meta) -> { fileName, contents }, meta required
    function run(command, suites, meta) {
        if (typeof command !== 'string') return { error: 'Command must be a string.' };
        if (!Array.isArray(suites)) return { error: 'suites must be an array of {name, checks, failures}.' };
        var cmd = command.trim().toLowerCase();
        if (cmd === 'help') {
            return {
                help: '\n' +
                'TestRunner.run("report", suites)              - Aggregate suite results into report lines\n' +
                'TestRunner.run("save-record", suites, meta)   - Format a save-able record; meta: {timestamp, commit}\n'
            };
        }
        if (cmd === 'report') return aggregate(suites);
        if (cmd === 'save-record') {
            if (!meta || !meta.timestamp || !meta.commit) return { error: 'save-record requires meta: {timestamp, commit}' };
            return formatSaveRecord(aggregate(suites), meta);
        }
        return { error: 'Unknown command: "' + command + '". Try TestRunner.run("help")' };
    }

    return {
        aggregate: aggregate,
        formatSaveRecord: formatSaveRecord,
        run: run
    };
}));
