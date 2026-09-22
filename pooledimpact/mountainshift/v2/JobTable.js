/**
 * @file JobTable.js
 * @description Owns the one thing shell.wasm/top.wasm never do and
 *   never should: knowing that a "job" exists at all. Same split as a
 *   real kernel and shell -- the kernel just runs a process and
 *   answers kill(pid, sig); it has no idea what `bg`/`fg`/`jobs` mean.
 *   Those words only exist in the shell process's own bookkeeping.
 *   Here, "the shell process" is this file: it hands out pids and
 *   ephemeral keys, keeps the table of what's running, and is the only
 *   thing that ever calls run() more than once against the SAME
 *   WebAssembly.Instance of a stateful command module (top.wasm is the
 *   first one) -- that repeated-call-same-instance pattern is the only
 *   way anything survives inside a WASM module's linear memory from
 *   one tick to the next, since nothing else ever crosses its
 *   boundary.
 *
 *   pid + key: JS assigns both when a job starts. The pid is a plain
 *   handle a caller uses to address the job (`kill <pid>`, list it in
 *   `ps`); the key is a placeholder for the day a job's completion has
 *   to be reported back to Shell from somewhere JS doesn't already
 *   trust by construction -- a native child_process, or (eventually) a
 *   machine-to-machine peer over WebRTC. Today, every job this file
 *   runs is a local WASM instance JS itself is polling, so nothing
 *   downstream currently checks the key; it's carried on every job
 *   entry and exposed via list() so the wiring is already there for
 *   when a job's `tick`/`kill` call has to come FROM the job instead of
 *   being polled BY this file, and has to prove it's who it says.
 *
 *   Ticking: WASM can't be preempted from outside mid-instruction, so
 *   a long-running command has to cooperate -- it does a bounded slice
 *   of work per call and returns, and this file decides whether to
 *   call it again. top.wasm never decides it's finished on its own
 *   (same as real top); it only stops advancing once this file stops
 *   asking it to (kill(), or the caller just stops ticking).
 *
 * @tests test/Top.wasm.test.js
 */
'use strict';

const crypto = require('crypto');
const proto = require('./WasmBlobProtocol.js');

function makeKey()
{
    return crypto.randomBytes(16).toString('hex');
}

function createJobTable()
{
    const jobs = new Map(); // pid -> job
    let nextPid = 1;

    // Real content a stateful module renders (top.wasm's /proc/jobs)
    // is gathered here, outside any WASM call, exactly like every
    // other module's real input -- this file is simply the one place
    // that knows the real job table, since it's the one thing that
    // ever decided to run anything anywhere.
    function snapshotJobsFile(excludePid)
    {
        let text = '';
        for (const job of jobs.values())
        {
            if (job.pid === excludePid) continue;
            text += job.pid + '\t' + job.state + '\t' + job.cmdline + '\n';
        }
        return text;
    }

    /**
     * Starts a stateful command module (e.g. commands/top.js) as a
     * job: compiles + instantiates it ONCE, and keeps that instance
     * for the job's whole lifetime so its own linear memory can carry
     * state between ticks. Runs the module's initial (non-tick) call
     * immediately and returns the first frame.
     * @param {{name:string, base64:string, stateful:true}} mod
     * @param {Object} [reqOptions] - {cwd, uid, home, path}
     * @returns {{pid:number, key:string, rc:number, stdout:string}}
     */
    function start(mod, reqOptions)
    {
        reqOptions = reqOptions || {};
        const compiledModule = proto.compile(mod.base64);
        const { instance, memory } = proto.instantiate(compiledModule);

        const pid = nextPid++;
        const key = makeKey();
        const job = {
            pid, key, name: mod.name, cmdline: mod.name,
            instance, memory, ticks: 0, state: 'running',
            reqOptions
        };
        jobs.set(pid, job);

        const response = proto.callModule(instance, memory, {
            ...reqOptions, cmdline: mod.name,
            files: { '/proc/jobs': snapshotJobsFile(pid) }
        });
        const { rc, stdout } = proto.parseAnswer(response);
        return { pid, key, rc, stdout };
    }

    /**
     * Advances one job by one tick, if it's still running. A no-op
     * (not an error) on a job that's already been killed or doesn't
     * exist -- same as real Unix silently having nothing to signal
     * once a process is gone.
     */
    function tick(pid)
    {
        const job = jobs.get(pid);
        if (!job || job.state !== 'running') return null;

        const response = proto.callModule(job.instance, job.memory, {
            ...job.reqOptions, cmdline: job.name + ' --tick',
            files: { '/proc/jobs': snapshotJobsFile(pid) }
        });
        const { rc, stdout } = proto.parseAnswer(response);
        job.ticks++;
        return { pid, rc, stdout, ticks: job.ticks };
    }

    /**
     * Stops a job: one final "--stop" call for a clean last frame,
     * then the job leaves the table. Real Unix's kill() only sends a
     * signal and returns immediately -- it doesn't wait for the target
     * to act on it -- but there IS no separate "target acting on it
     * later" here: a WASM instance only ever does anything while this
     * file is actively calling run() on it, so the stop frame IS the
     * target noticing and reacting, synchronously, in the same call.
     */
    function kill(pid)
    {
        const job = jobs.get(pid);
        if (!job || job.state !== 'running') return null;

        const response = proto.callModule(job.instance, job.memory, {
            ...job.reqOptions, cmdline: job.name + ' --stop',
            files: { '/proc/jobs': snapshotJobsFile(pid) }
        });
        const { rc, stdout } = proto.parseAnswer(response);
        job.state = 'killed';
        jobs.delete(pid);
        return { pid, rc, stdout };
    }

    /** @returns {Array<{pid:number, key:string, name:string, cmdline:string, state:string, ticks:number}>} */
    function list()
    {
        return Array.from(jobs.values()).map(({ pid, key, name, cmdline, state, ticks }) => ({ pid, key, name, cmdline, state, ticks }));
    }

    return { start, tick, kill, list };
}

module.exports = { createJobTable };
