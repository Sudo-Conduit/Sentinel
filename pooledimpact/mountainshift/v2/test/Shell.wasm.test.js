// shell.wasm's actual command surface, asserted.
//
// The only thing anything ever does with this module is hand it a string
// ("ls /") and take a string back. So that is all this file does: no
// server, no spawned helper process, no gathered file table, nothing
// Node-only. Pass a string, assert on the answer.
//
// This replaces a version that spawned a separate OS process, fetched
// file contents over HTTP, and staged them into ShellHost.js's
// options.files before calling run(). That apparatus existed to satisfy a
// premise its own header stated -- that real content "can't" reach the
// module mid-execution -- which was an assumption, not a finding, and
// options.files was retired by G.12 regardless. The old file also made
// no assertions at all, so it reported success no matter what came back.
//
// Several assertions below pin behavior that is a KNOWN GAP rather than
// desired behavior. They are written as gaps on purpose, in the same
// style as KernelVisibilityMixin.test.js's "documented gap, not silently
// pretended to work" -- a gap that is asserted is one that shows up in a
// diff when someone closes it, instead of being rediscovered from
// scratch.
//
// Run with: node test/Shell.wasm.test.js
'use strict';
const assert = require('assert');
const proto = require('../WasmBlobProtocol.js');
const SHELL = require('../commands/shell.js');

const NUL = String.fromCharCode(0);
const compiled = proto.compile(SHELL.base64);

function ask(cmdline) {
    const { instance, memory } = proto.instantiate(compiled);
    const r = proto.callModule(instance, memory, { cwd: '/', uid: 0, home: '', path: '', cmdline });
    const t = proto.bytesToUtf8(r, 0, r.length);
    if (t.indexOf('EXEC' + NUL) === 0) {
        return { kind: 'exec', delegate: t.slice(5, t.indexOf(NUL, 5)) };
    }
    const firstNul = t.indexOf(NUL);
    const secondNul = t.indexOf(NUL, firstNul + 1);
    return {
        kind: 'answer',
        cwd: t.slice(0, firstNul),
        rc: Number(t.slice(firstNul + 1, secondNul)),
        stdout: t.slice(secondNul + 1)
    };
}

function main() {
    // --- commands shell.wasm implements itself ---

    const who = ask('whoami');
    console.log('whoami   ->', JSON.stringify(who.stdout), 'rc=' + who.rc);
    assert.strictEqual(who.kind, 'answer', 'whoami is native to shell.wasm');

    const exit = ask('exit');
    assert.strictEqual(exit.kind, 'answer');
    assert.strictEqual(exit.rc, 0, 'exit is native and succeeds');

    // --- the one command it delegates ---

    const ls = ask('ls');
    console.log('ls       -> EXEC delegate to', JSON.stringify(ls.delegate));
    assert.strictEqual(ls.kind, 'exec', 'ls is delegated, not implemented here');
    assert.strictEqual(ls.delegate, 'ls');

    const lsArg = ask('ls /bin');
    assert.strictEqual(lsArg.kind, 'exec', 'ls with an argument still delegates');
    assert.strictEqual(lsArg.delegate, 'ls /bin', 'the whole stage cmdline is handed over');

    // --- a genuinely unknown command ---

    const bogus = ask('bogus');
    console.log('bogus    ->', JSON.stringify(bogus.stdout.trim()), 'rc=' + bogus.rc);
    assert.strictEqual(bogus.rc, 127);
    assert.ok(/command not found/.test(bogus.stdout), 'unknown commands report not-found');

    // --- KNOWN GAP: the external registry is stale ---
    //
    // wasm/shell.c's external_commands[] is { "ls", NULL } -- one entry.
    // So every other command module this system ships is, as far as
    // shell.wasm is concerned, nonexistent: it answers 127 rather than
    // delegating. These work today only because ShellHost.js's
    // groupStages() resolves them in JS before shell.wasm is consulted,
    // which means the shell is not the thing doing the routing.
    //
    // shell.c's own comment describes the intended contract correctly:
    // "lookup() failing doesn't mean 'not found' for these; it means
    // 'someone else's job.'" Closing the gap is adding the names to that
    // array. When that happens, these assertions are what will fail.
    for (const [cmdline, name] of [
        ['curl --url http://x', 'curl'],
        ['node --eval 1', 'node'],
        ['php -r 1', 'php'],
        ['top', 'top']
    ]) {
        const r = ask(cmdline);
        assert.strictEqual(r.kind, 'answer', name + ': currently answers instead of delegating (gap)');
        assert.strictEqual(r.rc, 127, name + ': currently reports not-found (gap)');
    }
    console.log('registry -> curl/node/php/top all rc=127 (KNOWN GAP: external_commands[] holds only "ls")');

    // --- KNOWN GAP: G.13, file-backed commands have no source yet ---
    //
    // G.12 removed the host-side staging that used to fill the request
    // blob's file table; G.13 (porting these onto reads the command makes
    // for itself) is open. Until then cat/cd find nothing, and whoami
    // cannot read /etc/passwd so it falls back to a placeholder. Asserted
    // so that closing G.13 shows up here as a failing expectation rather
    // than as a surprise.
    const cat = ask('cat /etc/hostname');
    console.log('cat      ->', JSON.stringify(cat.stdout.trim()), 'rc=' + cat.rc);
    assert.strictEqual(cat.rc, 1, 'cat: nothing to read from yet (G.13 open)');

    const cd = ask('cd /etc');
    assert.strictEqual(cd.rc, 1, 'cd: no directory to find yet (G.13 open)');

    // whoami fails the same way its siblings do. It used to return rc=0 with
    // the placeholder "unknown" on stdout -- indistinguishable, to a pipeline,
    // from a genuinely resolved name, and the reason a ShellServer assertion
    // could pass while the command lied. Fixed to match real whoami(1).
    assert.strictEqual(who.rc, 1, 'whoami: must report failure, not a placeholder (G.13 open)');
    assert.match(who.stdout, /^whoami: cannot /, 'whoami: must name why it failed');
    assert.ok(!/unknown/.test(who.stdout), 'whoami: must not emit a placeholder name');
    console.log('files    -> cat/cd/whoami all fail honestly, rc=1 (KNOWN GAP: G.13 not started)');

    // --- the cwd round-trips, since the caller owns it ---

    const cwdEcho = ask('whoami');
    assert.strictEqual(cwdEcho.cwd, '/', 'the cwd it was handed comes back unchanged');

    console.log('\nALL PASS');
}

main();
