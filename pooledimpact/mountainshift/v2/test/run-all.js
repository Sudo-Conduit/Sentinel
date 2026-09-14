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
    'MountainShift.opaque.test.js',
    'WeightedGraphMixin.test.js',
    'Signature.test.js'
];

let anyFailed = false;
files.forEach((file) => {
    console.log('=== ' + file + ' ===');
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
    if (result.status !== 0) anyFailed = true;
    console.log('');
});

process.exitCode = anyFailed ? 1 : 0;
