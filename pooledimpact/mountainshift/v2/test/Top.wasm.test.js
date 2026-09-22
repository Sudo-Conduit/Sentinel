// Proves the pid+key+tick+kill mechanics top.wasm exists to test:
// a WASM module's own linear memory can carry state (a running tick
// count) across many calls, as long as the SAME instance is reused --
// JobTable.js is the thing that keeps it alive and drives it. No
// shell.wasm involved here at all; this is JobTable.js talking
// directly to a stateful command module, same as ShellHost.js talks
// directly to a one-shot one.
//
// Run with: node test/Top.wasm.test.js
'use strict';
const assert = require('assert');
const top = require('../commands/top.js');
const { createJobTable } = require('../JobTable.js');

function main() {
    const jobs = createJobTable();

    // A second, unrelated job entry -- just data, proving top renders
    // more than its own row. It's never ticked or killed; it's here to
    // be listed.
    const fakeJob = { pid: 999, key: 'n/a', name: 'sleep', cmdline: 'sleep 100', state: 'running', ticks: 0 };
    jobs.list = (function (realList) {
        return function () { return realList().concat([fakeJob]); };
    })(jobs.list);
    // JobTable's own snapshot is private to its closure, so the fake
    // row above only affects list() (what a `ps`/`jobs` builtin would
    // show later) -- it does NOT appear inside top's own rendered
    // /proc/jobs snapshot. That's fine: this test's job is to prove
    // the tick/kill mechanics, not to fabricate a second real process.

    const started = jobs.start(top, { cwd: '/', uid: 0 });
    console.log('start ->', JSON.stringify(started));
    assert.strictEqual(started.rc, 0);
    assert.strictEqual(started.stdout, 'top - tick 0\nPID\tSTATE\tCMD\n', 'first frame: tick 0, header, no job rows (the fake job was never added to the real job table)');
    const { pid, key } = started;
    assert.ok(pid >= 1);
    assert.ok(/^[0-9a-f]{32}$/.test(key), 'ephemeral key should be a real random token');

    // Tick three times. Each response's tick count must have advanced
    // by exactly one from the last -- the only way that's possible is
    // if top.wasm's g_ticks survived inside the SAME instance across
    // three separate run() calls; a fresh instance each time (the
    // ls.wasm-style, stateless path) would read back 0 every time.
    for (let expected = 1; expected <= 3; expected++) {
        const r = jobs.tick(pid);
        console.log('tick', expected, '->', JSON.stringify(r.stdout));
        assert.strictEqual(r.ticks, expected);
        assert.ok(r.stdout.startsWith('top - tick ' + expected + '\n'), 'tick ' + expected + ' should report tick ' + expected);
    }

    // Kill it: one final "--stop" frame, then the job leaves the table.
    const killed = jobs.kill(pid);
    console.log('kill ->', JSON.stringify(killed));
    assert.ok(killed.stdout.startsWith('top - tick 3 (stopped)\n'), 'stop frame should report the last real tick count, marked stopped');

    // Ticking a killed (or nonexistent) pid is a documented no-op, not
    // a crash -- matches real Unix silently having nothing to signal
    // once a process is already gone.
    assert.strictEqual(jobs.tick(pid), null, 'ticking a killed job must be a no-op');
    assert.strictEqual(jobs.kill(pid), null, 'killing an already-killed job must be a no-op');
    assert.strictEqual(jobs.tick(12345), null, 'ticking a pid that never existed must be a no-op');

    // ps/jobs would read this: the killed job is gone, the fake one
    // (added directly for this test) is still listed.
    const remaining = jobs.list();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].pid, 999);
    console.log('jobs after kill ->', JSON.stringify(remaining));

    // The actual point of `top`: it has to see OTHER real jobs, not
    // just itself. Start a second top instance while a first is still
    // running -- each one's own /proc/jobs snapshot should list the
    // OTHER as a real running row (never itself; JobTable excludes a
    // job's own pid from its own snapshot).
    const a = jobs.start(top, { cwd: '/', uid: 0 });
    const b = jobs.start(top, { cwd: '/', uid: 0 });
    assert.notStrictEqual(a.pid, b.pid);

    const aTick = jobs.tick(a.pid);
    assert.ok(aTick.stdout.includes(b.pid + '\trunning\ttop\n'), "job a's snapshot must list job b as a real running row");
    assert.ok(!aTick.stdout.includes(a.pid + '\trunning\ttop\n'), "job a's snapshot must not list itself");

    const bTick = jobs.tick(b.pid);
    assert.ok(bTick.stdout.includes(a.pid + '\trunning\ttop\n'), "job b's snapshot must list job a as a real running row");

    jobs.kill(a.pid);
    jobs.kill(b.pid);

    console.log('\nALL PASS');
}

main();
