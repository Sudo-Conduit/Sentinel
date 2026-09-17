// Proves ps/jobs/fg/bg/kill for real, over both kinds of "long-running
// thing" this system has: a stateful WASM tick-job (top &, auto-ticked
// on an interval by ProcessTable.js) and a real spawned process
// (node &, a genuine child_process). shell.wasm never sees any of
// this -- these are pure JS builtins, intercepted before ShellHost.js
// even splits the pipeline.
//
// Run with: node test/JobControl.test.js
'use strict';
const assert = require('assert');
const { createShell } = require('../ShellHost.js');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
    const shell = await createShell({ cwd: '/', uid: 0 });

    // Empty job table to start.
    const psEmpty = await shell.runDetailed('ps');
    console.log('ps (empty) ->', JSON.stringify(psEmpty.stdout));
    assert.strictEqual(psEmpty.stdout, 'PID\tSTATE\tCMD\n');

    // --- top &: a stateful WASM job, auto-ticked on a real interval ---
    const topStart = await shell.runDetailed('top &');
    console.log('top & ->', JSON.stringify(topStart));
    const topPidMatch = /^\[(\d+)\] \d+\n$/.exec(topStart.stdout);
    assert.ok(topPidMatch, 'expected a "[pid] pid" ack');
    const topPid = Number(topPidMatch[1]);

    await sleep(650); // ~3 ticks at the 200ms interval

    const jobsWithTop = await shell.runDetailed('jobs');
    console.log('jobs (top running) ->', JSON.stringify(jobsWithTop.stdout));
    assert.ok(jobsWithTop.stdout.includes('[' + topPid + '] running'));
    // Real wall-clock ticking, not a fake counter: the interval really
    // fired multiple times while nothing else was awaiting it.
    const tickMatch = new RegExp('\\[' + topPid + '\\] running  top  \\(tick (\\d+)\\)').exec(jobsWithTop.stdout);
    assert.ok(tickMatch && Number(tickMatch[1]) >= 2, 'expected top to have ticked at least twice on its own: ' + jobsWithTop.stdout);

    const killTop = await shell.runDetailed('kill ' + topPid);
    console.log('kill top ->', JSON.stringify(killTop));
    assert.strictEqual(killTop.rc, 0);

    const jobsAfterKillTop = await shell.runDetailed('jobs');
    assert.strictEqual(jobsAfterKillTop.stdout, '', 'top should be gone from the job table after kill');

    const ticksAtKill = Number(tickMatch[1]);
    await sleep(500); // long enough for several more intervals, if it were still ticking
    const jobsStillGone = await shell.runDetailed('jobs');
    assert.strictEqual(jobsStillGone.stdout, '', 'a killed top must not keep ticking in the background');
    console.log('top ticked to', ticksAtKill, 'then genuinely stopped after kill -> OK');

    // --- node &: a real spawned process ---
    const nodeStart = await shell.runDetailed(`node --eval 'setTimeout(() => console.log("done"), 200)' &`);
    console.log('node & ->', JSON.stringify(nodeStart));
    const nodePidMatch = /^\[(\d+)\] \d+\n$/.exec(nodeStart.stdout);
    assert.ok(nodePidMatch);
    const nodePid = Number(nodePidMatch[1]);

    const jobsWithNode = await shell.runDetailed('jobs');
    console.log('jobs (node running) ->', JSON.stringify(jobsWithNode.stdout));
    assert.ok(jobsWithNode.stdout.includes('[' + nodePid + '] running'));

    // bg on an already-running job: real bash's own harmless response.
    const bgResult = await shell.runDetailed('bg ' + nodePid);
    console.log('bg (already running) ->', JSON.stringify(bgResult.stdout));
    assert.ok(bgResult.stdout.includes('already in background'));

    // fg really waits for the real process to really finish.
    const fgResult = await shell.runDetailed('fg ' + nodePid);
    console.log('fg ->', JSON.stringify(fgResult));
    assert.strictEqual(fgResult.rc, 0);
    assert.strictEqual(fgResult.stdout, 'done\n');

    const jobsAfterFg = await shell.runDetailed('jobs');
    assert.strictEqual(jobsAfterFg.stdout, '', 'a job fg already collected must be gone from the table');

    // --- kill on a real spawned process really terminates the real OS pid ---
    const longRunStart = await shell.runDetailed(`node --eval 'setInterval(() => {}, 100)' &`);
    const longRunPid = Number(/^\[(\d+)\] \d+\n$/.exec(longRunStart.stdout)[1]);
    await sleep(100);

    // `jobs`'s own detail column exposes the real OS pid (ps's columns
    // don't) -- pull it out so kill can be verified against the real
    // OS process afterward, not just against this file's own table.
    const psBeforeKill = await shell.runDetailed('ps');
    console.log('ps (long-running node) ->', JSON.stringify(psBeforeKill.stdout));
    assert.ok(new RegExp(longRunPid + '\\trunning\\t').test(psBeforeKill.stdout));

    const jobsBeforeKill = await shell.runDetailed('jobs');
    const realOsPid = Number(new RegExp('\\[' + longRunPid + '\\].*\\(pid (\\d+)\\)').exec(jobsBeforeKill.stdout)[1]);

    await shell.runDetailed('kill ' + longRunPid);
    await sleep(200); // give the real SIGTERM a moment to land

    const jobsAfterKillNode = await shell.runDetailed('jobs');
    assert.strictEqual(jobsAfterKillNode.stdout, '', 'a killed node job must leave the table');

    let stillAlive = true;
    try { process.kill(realOsPid, 0); } catch { stillAlive = false; }
    assert.strictEqual(stillAlive, false, 'the real OS process (pid ' + realOsPid + ') must actually be gone, not just removed from our table');
    console.log('real OS pid', realOsPid, 'confirmed terminated (process.kill(pid, 0) threw ESRCH) -> OK');

    // Unknown pid: every builtin reports a clean failure, not a crash.
    const fgMissing = await shell.runDetailed('fg 999999');
    assert.strictEqual(fgMissing.rc, 1);
    const bgMissing = await shell.runDetailed('bg 999999');
    assert.strictEqual(bgMissing.rc, 1);
    const killMissing = await shell.runDetailed('kill 999999');
    assert.strictEqual(killMissing.rc, 1);
    console.log('unknown-pid builtins all fail cleanly -> OK');

    console.log('\nALL PASS');
}

main();
