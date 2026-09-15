// shell.wasm, run for real: real compiled module, real filesystem
// underneath ShellHost.js's open(), real commands. No assertions, no
// pass/fail, no host-side fake path table -- just each command and
// exactly what it produced.
//
// Run with: node test/Shell.wasm.test.js
'use strict';
const path = require('path');
const { createShell } = require('../ShellHost.js');

const shell = createShell({ cwd: path.join(__dirname, '..') });

function show(cmdline, stdin) {
    const r = shell.runDetailed(cmdline, stdin);
    console.log('$ ' + cmdline);
    process.stdout.write(r.stdout);
    console.log('(rc=' + r.rc + ')\n');
}

show('whoami');
show('ls');
show('ls /');
show('ls /bin');
show('cat shell.c');
show('cat ShellHost.js');
show('ls | grep .c');
show('cat shell.c | grep host_');
show('cd test');
show('ls');
show('cat nonexistent.txt');
show('bogus');
