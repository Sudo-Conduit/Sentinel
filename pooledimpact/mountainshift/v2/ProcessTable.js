/**
 * @file ProcessTable.js
 * @description The one pid space `ps`/`jobs`/`fg`/`bg`/`kill` actually
 *   operate over. Two genuinely different kinds of "long-running thing"
 *   exist in this system, and this file is what makes them look like
 *   one job table to a caller:
 *
 *   - A STATEFUL WASM module (top.wasm) only ever does anything while
 *     something calls run() on it again -- there's no way for it to
 *     "keep going" on its own, so backgrounding one means this file
 *     keeps calling JobTable.js's tick() on an interval until the job
 *     is killed. See JobTable.js for why the SAME instance has to
 *     survive across those calls.
 *   - A real external process (a backgrounded node.wasm/php.wasm SPAWN
 *     delegation) is the opposite: once child_process.spawn() starts
 *     it, it runs on its own, for real, whether or not anything ever
 *     calls back into it again. Backgrounding one just means not
 *     awaiting its completion Promise inline -- the real OS process
 *     keeps running regardless.
 *
 *   Same split as a real kernel: a WASM tick-job is like a cooperative
 *   green thread that only advances when scheduled; a spawned process
 *   is a real, preemptible OS process. `kill(pid)` doesn't care which
 *   kind it's aimed at -- same as real kill(2) doesn't care whether
 *   the target is a shell built-in job or an arbitrary binary.
 *
 *   pids for the two kinds are drawn from disjoint ranges (WASM jobs
 *   from JobTable.js's own low counter; spawned processes from a high
 *   offset here) purely to guarantee no collision without needing a
 *   shared allocator -- callers never see or need to know this.
 *
 * @tests test/JobControl.test.js
 */
'use strict';

const { createJobTable } = require('./JobTable.js');

const WASM_TICK_INTERVAL_MS = 200;
const SPAWN_PID_BASE = 1000000;

function createProcessTable()
{
    const wasmJobs = createJobTable();
    const wasmTimers = new Map(); // pid -> interval handle

    const procJobs = new Map(); // pid -> {pid, name, cmdline, state, child, done, result}
    let nextSpawnPid = SPAWN_PID_BASE;

    /**
     * Starts a stateful WASM module (top.wasm) as a background job,
     * auto-ticking it on an interval until it's killed. Returns the
     * pid immediately -- the caller never waits on this.
     */
    function startWasmTicking(mod, reqOptions)
    {
        const started = wasmJobs.start(mod, reqOptions);
        const timer = setInterval(() =>
        {
            const r = wasmJobs.tick(started.pid);
            if (!r)
            {
                clearInterval(timer);
                wasmTimers.delete(started.pid);
            }
        }, WASM_TICK_INTERVAL_MS);
        timer.unref?.(); // never keep the process alive on its own
        wasmTimers.set(started.pid, timer);
        return started;
    }

    /**
     * Registers a real spawned process (already started -- `child` is
     * a live child_process.ChildProcess) as a background job. `done`
     * is the Promise this file already gets from performProcessSpawn/
     * the SPAWN-delegation flow, resolving once the real process
     * actually exits; this file just remembers it happened.
     */
    function startProcess(name, cmdline, child, done)
    {
        const pid = nextSpawnPid++;
        const job = { pid, name, cmdline, state: 'running', child, done, result: null };
        done.then((result) => { job.state = 'done'; job.result = result; })
            .catch(() => { job.state = 'done'; });
        procJobs.set(pid, job);
        return pid;
    }

    /** @returns {Array<{pid:number, name:string, cmdline:string, state:string, detail:string}>} */
    function list()
    {
        const wasmList = wasmJobs.list().map((j) => ({
            pid: j.pid, name: j.name, cmdline: j.cmdline, state: j.state, detail: 'tick ' + j.ticks
        }));
        const procList = Array.from(procJobs.values()).map((j) => ({
            pid: j.pid, name: j.name, cmdline: j.cmdline, state: j.state,
            detail: j.state === 'running' ? 'pid ' + (j.child ? j.child.pid : '?') : 'exit ' + (j.result ? j.result.rc : '?')
        }));
        return [...wasmList, ...procList];
    }

    /**
     * Brings a job's current/final state back to the caller. For a
     * spawned process, this really does wait for the real process to
     * exit (same as real Unix's fg blocking until the job finishes).
     * For a WASM tick job, there's no separate "foreground" execution
     * mode to switch into -- this just returns one more live tick.
     * @returns {null} if no such job exists.
     */
    async function fg(pid)
    {
        const proc = procJobs.get(pid);
        if (proc)
        {
            const result = await proc.done;
            procJobs.delete(pid);
            return result;
        }
        return wasmJobs.tick(pid);
    }

    /**
     * Real bash's own behavior for a job that's already running in the
     * background: not an error, just a no-op with a note -- there's no
     * SIGSTOP/SIGCONT suspend-and-resume modeled here (nothing in this
     * system ever stops a job short of killing it), so `bg` can never
     * mean anything more than confirming that.
     */
    function bg(pid)
    {
        const isKnown = procJobs.has(pid) || wasmJobs.list().some((j) => j.pid === pid);
        if (!isKnown) return null;
        return { rc: 0, stdout: 'bg: job ' + pid + ' is already in background\n' };
    }

    /**
     * Terminates a job for real: a spawned process gets an actual
     * SIGTERM to its actual OS pid; a WASM tick job gets its auto-tick
     * interval stopped and one final --stop call via JobTable.kill().
     * @returns {null} if no such job exists.
     */
    function kill(pid)
    {
        const timer = wasmTimers.get(pid);
        if (timer) { clearInterval(timer); wasmTimers.delete(pid); }

        const proc = procJobs.get(pid);
        if (proc)
        {
            if (proc.state === 'running' && proc.child) proc.child.kill('SIGTERM');
            procJobs.delete(pid);
            return { pid };
        }

        return wasmJobs.kill(pid);
    }

    return { startWasmTicking, startProcess, list, fg, bg, kill };
}

module.exports = { createProcessTable };
