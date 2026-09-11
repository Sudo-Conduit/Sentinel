// Runs every individual-class (white-box) test in this directory as a
// separate process, so one file's module-level state/mutations (mixin
// registries, ExtendX's REGISTERED map, etc.) never leak into another's.
// Run with: node test/run-all.js
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const files = [
    'CPU.security.test.js',
    'Physical.security.test.js',
    'PreMixed.hazard.test.js',
    'StructureMixin.test.js'
];

let anyFailed = false;
files.forEach((file) => {
    console.log('=== ' + file + ' ===');
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
    if (result.status !== 0) anyFailed = true;
    console.log('');
});

process.exitCode = anyFailed ? 1 : 0;
