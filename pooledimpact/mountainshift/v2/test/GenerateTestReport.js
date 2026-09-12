/**
 * @file GenerateTestReport.js
 * @author Will Fobbs
 * @company Pooled Impact
 * @description Runs the full white-box test suite (test/run-all.js's own
 *   file list) and writes a branded, attributed, timestamped snapshot of
 *   the REAL captured output to test/reports/ -- not a hand-typed summary.
 *   The point is the same one Docs/MSOS-Cleanup-Roadmap.md's own
 *   "Last test run" section exists for, taken one step further: a
 *   standalone, versioned artifact committed to git history, so a reader
 *   can open any past report and see exactly what the suite actually
 *   printed at that commit -- a living spec of the shape of the code
 *   itself, not just a pass/fail count.
 *
 * Each generated report is a real, runnable UMD module (matching this
 * project's own convention) whose run() method reprints its own frozen
 * historical output byte-for-byte -- a report you can execute, not just
 * read. Confidential & Proprietary banner and versioning convention
 * follows this codebase's existing pattern (see e.g. ExtendX.js).
 *
 * Usage: node test/GenerateTestReport.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const V2 = path.join(__dirname, '..');
const REPORTS_DIR = path.join(__dirname, 'reports');

const TEST_FILES = [
    'CPU.security.test.js',
    'Physical.security.test.js',
    'PreMixed.hazard.test.js',
    'StructureMixin.test.js',
    'Kernel.security.test.js',
    'BIOS.security.test.js',
    'FullBootChain.lifecycle.test.js',
    'NextInjection.audit.test.js',
    'Memory.security.test.js',
    'MemoryMapArena.test.js',
    'MemoryMapFS.test.js',
    'MemoryMapFS.nodeToNode.test.js',
    'BIOS.nvramFastPath.test.js',
    'ExtendX.stacking.test.js',
    'BIOS.firstBoot.test.js',
    'MountainShift.opaque.test.js'
];

function gitInfo() {
    try {
        const commit = execSync('git rev-parse --short HEAD', { cwd: V2 }).toString().trim();
        const fullCommit = execSync('git rev-parse HEAD', { cwd: V2 }).toString().trim();
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: V2 }).toString().trim();
        return { commit, fullCommit, branch };
    } catch (e) {
        return { commit: 'unknown', fullCommit: 'unknown', branch: 'unknown' };
    }
}

function box(lines) {
    const width = 78;
    const top = '╔' + '═'.repeat(width) + '╗';
    const bottom = '╚' + '═'.repeat(width) + '╝';
    const body = lines.map((line) => {
        const padded = line.length > width - 2 ? line.slice(0, width - 2) : line;
        return '║ ' + padded + ' '.repeat(width - 2 - padded.length) + ' ║';
    });
    return [top, ...body, bottom].join('\n');
}

function runSuite() {
    let combined = '';
    let totalChecks = 0;
    let totalFailed = 0;
    let anyFailed = false;
    const perFile = [];

    TEST_FILES.forEach((file) => {
        combined += '\n=== ' + file + ' ===\n';
        const result = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
        const out = (result.stdout || '') + (result.stderr || '');
        combined += out;
        const totalMatch = out.match(/ALL (\d+) CHECKS PASSED/);
        const failMatch = out.match(/(\d+) of (\d+) CHECK\(S\) FAILED/);
        let checks = 0, failed = 0;
        if (totalMatch) checks = parseInt(totalMatch[1], 10);
        else if (failMatch) { failed = parseInt(failMatch[1], 10); checks = parseInt(failMatch[2], 10); }
        totalChecks += checks;
        totalFailed += failed;
        if (result.status !== 0 || failed > 0) anyFailed = true;
        perFile.push({ file, checks, failed, ok: result.status === 0 && failed === 0 });
    });

    return { combined, totalChecks, totalFailed, anyFailed, perFile };
}

function main() {
    const git = gitInfo();
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
    const versionStamp = now.toISOString().slice(0, 10).replace(/-/g, '.');

    const { combined, totalChecks, totalFailed, anyFailed, perFile } = runSuite();

    const headerBox = box([
        'CONFIDENTIAL & PROPRIETARY — POOLED IMPACT',
        'MountainShift OS — Full White-Box Test Suite Report',
        '',
        'Author:   Will Fobbs',
        'Company:  Pooled Impact (PooledImpact.com)',
        'Version:  ' + versionStamp,
        'Date:     ' + now.toISOString(),
        'Repo:     git.pooledimpact.com/Claude/Romans',
        'Branch:   ' + git.branch,
        'Commit:   ' + git.fullCommit,
        '',
        'Not for distribution — Internal Use Only'
    ]);

    const summaryLines = perFile.map((f) => {
        const status = f.ok ? '✅ PASS' : '❌ FAIL';
        return '  ' + status + '  ' + f.file + '  (' + (f.checks - f.failed) + '/' + f.checks + ' checks)';
    });

    const footerBox = box([
        'Report Complete',
        '',
        'Total: ' + (totalChecks - totalFailed) + '/' + totalChecks + ' checks passing, ' +
            perFile.filter((f) => f.ok).length + '/' + perFile.length + ' suites green',
        anyFailed ? 'Overall result: ❌ FAILURES PRESENT' : 'Overall result: ✅ ALL GREEN',
        '',
        now.toISOString(),
        'Will Fobbs · Pooled Impact · Confidential & Proprietary'
    ]);

    const reportBody = [
        headerBox,
        '',
        'Suites:',
        ...summaryLines,
        '',
        '─'.repeat(80),
        'Full captured output (node test/run-all.js file list, run individually',
        'as separate processes so module-level state cannot leak between files):',
        '─'.repeat(80),
        combined,
        '─'.repeat(80),
        footerBox,
        ''
    ].join('\n');

    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const filename = 'MSOS-TestSuiteReport_' + dateStamp + '_' + git.commit + '.js';
    const filepath = path.join(REPORTS_DIR, filename);

    const moduleSource = [
        '/**',
        ' * @file ' + filename,
        ' * @author Will Fobbs',
        ' * @company Pooled Impact',
        ' * @description FROZEN historical test-suite report, generated ' + now.toISOString() + '.',
        ' *   This is a real captured run, not a hand-typed summary -- see',
        ' *   Docs/MSOS-Cleanup-Roadmap.md\'s "Last test run" section for the',
        ' *   live/current version of this same discipline. This file never',
        ' *   changes after being written; run it to reprint exactly what the',
        ' *   suite printed on commit ' + git.commit + '.',
        ' * @version ' + versionStamp,
        ' * Confidential & Proprietary — Pooled Impact. Not for distribution.',
        ' */',
        '(function(root, factory) {',
        '  if (typeof module === \'object\' && module.exports) module.exports = factory();',
        '  else root.MSOSTestSuiteReport = factory();',
        '}(typeof self !== \'undefined\' ? self : this, function() {',
        '  \'use strict\';',
        '  const REPORT = ' + JSON.stringify(reportBody) + ';',
        '  function run() { console.log(REPORT); return REPORT; }',
        '  return { run: run, generatedAt: ' + JSON.stringify(now.toISOString()) + ', commit: ' + JSON.stringify(git.fullCommit) + ' };',
        '}));',
        ''
    ].join('\n');

    fs.writeFileSync(filepath, moduleSource, 'utf8');

    console.log(reportBody);
    console.log('\nWritten to: ' + filepath);
    process.exitCode = anyFailed ? 1 : 0;
}

main();
