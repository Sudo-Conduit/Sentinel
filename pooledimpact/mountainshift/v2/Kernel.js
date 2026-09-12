/**
 * @file Kernel.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Process table + scheduler. The Kernel owns WHO runs
 *   (schema-tracked `processes`); the attached Physical/Environment (HOW
 *   things actually execute, what host they're running on) are runtime
 *   handles in a WeakMap, not schema state.
 * @docs Kernel-Machine-Architecture.md
 * @tests test/Kernel.security.test.js
 * @tests test/FullBootChain.lifecycle.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./BaseClassX.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./BaseClassX.js'));
    }
    else
    {
        root.Kernel = factory(root.BaseClassX);
    }
}(typeof self !== 'undefined' ? self : this, function(BaseClassX)
{
    'use strict';
    if (!BaseClassX)
    {
        throw new Error('Kernel requires BaseClassX to be loaded first');
    }

    // Keyed by this.id (a real, stable BaseClassX schema property), NOT by
    // `this` object identity. A WeakMap-by-`this` breaks the moment this
    // class is composed via ExtendX.extend(): ExtendX's dispatch gives every
    // top-level dispatched call a FRESH frame Proxy, so attach()'s `this`
    // and a later getPhysical()'s `this` are different objects even though
    // both calls are on the same logical instance -- proven the same way
    // Physical.js's identical _cpus bug was proven, and fixed the same way.
    const _host = new Map();
    let _pidSeq = 1;

    class Kernel extends BaseClassX
    {
        static name = 'Kernel';
        static author = 'Will Fobbs';
        static version = '1.0.0';
        static domain = 'machine.kernel';
        static description = 'Process table + round-robin scheduler over an attached Physical/Environment/Memory.';
        static docs = ['Kernel-Machine-Architecture.md'];
        static tests = ['test/Kernel.security.test.js', 'test/FullBootChain.lifecycle.test.js'];
        static _schema = { properties: {
            bootedFrom: { type: 'string', default: 'none' },
            firmwareType: { type: 'string', default: 'UEFI' },
            processes: { type: 'array', default: [] },
            schedulerPolicy: { type: 'string', default: 'round-robin' },
            cores: { type: 'number', default: 1 }
        }};

        constructor(options = {})
        {
            super({ type: 'machine.kernel', name: 'Kernel' });
            this.bootedFrom = options.bootedFrom || 'none';
            this.firmwareType = options.firmwareType || 'UEFI';
            this.processes = [];
            this.schedulerPolicy = options.schedulerPolicy || 'round-robin';
            this.cores = options.cores || 1;
        }

        /**
         * @param {Object} physical - the Physical this Kernel runs on
         * @param {Object} environment - host facts from Environment.detect()
         * @param {Object} memory - the attached Memory ledger
         * @returns {Kernel} this, for chaining
         */
        attach(physical, environment, memory)
        {
            _host.set(this.id, { physical, environment, memory });
            this._recordTrace('attach', { firmwareType: this.firmwareType, env: environment ? environment.runtime : null });
            return this;
        }

        /**
         * @returns {Object|null} the attached Physical, or null if unattached
         */
        getPhysical()
        {
            return (_host.get(this.id) || {}).physical || null;
        }

        /**
         * @returns {Object|null} the attached Environment, or null if unattached
         */
        getEnvironment()
        {
            return (_host.get(this.id) || {}).environment || null;
        }

        /**
         * @returns {Object|null} the attached Memory, or null if unattached
         */
        getMemory()
        {
            return (_host.get(this.id) || {}).memory || null;
        }

        /**
         * A Map, unlike the WeakMap this replaced, does not self-clean when
         * an instance is garbage collected -- dispose() must remove this
         * id's entry explicitly or it leaks for the process lifetime.
         * Mirrors Physical.dispose()'s identical cleanup for
         * _cpus/_cpuFactories.
         */
        dispose()
        {
            _host.delete(this.id);
            super.dispose();
        }

        /**
         * Real per-process footprint: each fork() actually reserves a byte
         * range via the attached Memory ledger (a fixed nominal size per
         * process today, real growth tracking is future work) so ps()/top's
         * Mem% reads an actual allocation instead of Math.random(). No
         * Memory attached -> proc.memBytes stays 0, callers fall back
         * gracefully.
         *
         * ppid/memBytes: NOT `x || default`. Once this class is composed via
         * ExtendX.extend(), a caller doing fork(cmd) -- omitting ppid/
         * memBytes -- does not get them as undefined: ExtendX's dispatcher
         * always appends its own next() callback as the trailing argument to
         * every dispatched call, landing in the first omitted slot. A bare
         * `|| 0`/`|| 65536` treats that injected function as a truthy real
         * value and silently corrupts proc.ppid/memBytes with a function
         * reference. typeof-guarding (same fix as StructureMixin's label/
         * next collision) is the only reliable check: a real ppid/memBytes
         * is always a number, and the injected next is always a function,
         * so they can never be confused.
         * @param {string} cmd - command/name for the new process
         * @param {number} [ppid=0] - parent process id
         * @param {number} [memBytes=65536] - nominal memory footprint to reserve
         * @returns {Object} the new process record
         */
        fork(cmd, ppid, memBytes)
        {
            const pid = _pidSeq++;
            ppid = typeof ppid === 'number' ? ppid : 0;
            memBytes = typeof memBytes === 'number' ? memBytes : 65536;
            const memory = this.getMemory();
            let allocated = 0;
            if (memory)
            {
                try
                {
                    memory.alloc(pid, memBytes, cmd);
                    allocated = memBytes;
                }
                catch (e)
                {
                    this._recordTrace('fork_alloc_failed', { pid, cmd, error: e.message });
                }
            }
            const proc = { pid, ppid: ppid, cmd, state: 'running', priority: 0, context: null, memBytes: allocated };
            this.processes = [...this.processes, proc];
            this._recordTrace('fork', proc);
            return proc;
        }

        /**
         * Force Quit semantics: killing a pid also kills every descendant
         * (its children, grandchildren, ...) recursively — no graceful
         * shutdown, no cleanup callbacks, matching real OS SIGKILL cascade.
         * Not the recommended way to stop something (no save, no flush),
         * but necessary for runaway processes / severe leaks.
         * @param {number} pid - process to kill (and its descendants)
         * @returns {Kernel} this, for chaining
         */
        kill(pid)
        {
            const toKill = [pid];
            for (let i = 0; i < toKill.length; i++)
            {
                const children = this.processes.filter(p => p.ppid === toKill[i]).map(p => p.pid);
                children.forEach(c => { if (!toKill.includes(c)) toKill.push(c); });
            }
            const before = this.processes.length;
            const memory = this.getMemory();
            this.processes = this.processes.filter(p => !toKill.includes(p.pid));
            if (memory)
            {
                toKill.forEach(k => memory.free(k));
            }
            this._recordTrace('kill', { pid, cascaded: toKill, removed: before - this.processes.length });
            return this;
        }

        /**
         * @param {Object} cpu - a live CPU.js instance
         * @returns {Object} a snapshot of cpu's register file
         */
        _captureContext(cpu)
        {
            return { EAX: cpu.EAX, EBX: cpu.EBX, ECX: cpu.ECX, EDX: cpu.EDX, ESI: cpu.ESI, EDI: cpu.EDI, EBP: cpu.EBP, ESP: cpu.ESP, EIP: cpu.EIP, EFLAGS: cpu.EFLAGS };
        }

        /**
         * @param {Object} cpu - a live CPU.js instance
         * @param {Object} context - a register-file snapshot from _captureContext()
         */
        _restoreContext(cpu, context)
        {
            Object.assign(cpu, context);
            cpu.config.halted = false;
        }

        /**
         * Round-robin tick: each live process gets one scheduler turn AND
         * one real quantum of CPU.js execution (fetch/decode/execute), via
         * the attached Physical — not just a trace entry. One CPU is
         * shared, so each process's register file is saved to proc.context
         * on its way out and restored on its way back in, the same save/
         * restore a real context switch does. A fresh process
         * (context: null) starts from cpu.boot()'s clean register state.
         *
         * quantum: typeof-guarded, not `|| 10` -- see fork()'s comment
         * above for why (this is the identical hazard: tick() called with
         * no argument once composed via ExtendX gets the dispatcher's
         * injected next() callback in quantum's slot, and `|| 10` would
         * treat that truthy function as a real quantum and pass it
         * straight to cpu.run()).
         * @param {number} [quantum=10] - CPU cycles to run per process this tick
         * @returns {Object[]} the processes that ran this tick
         */
        tick(quantum)
        {
            quantum = typeof quantum === 'number' ? quantum : 10;
            const physical = this.getPhysical();
            const cpu = physical && physical.poweredOn ? physical.getCPU() : null;
            const running = this.processes.filter(p => p.state === 'running');
            for (const proc of running)
            {
                let executed = 0;
                if (cpu)
                {
                    if (proc.context)
                    {
                        this._restoreContext(cpu, proc.context);
                    }
                    else
                    {
                        cpu.boot();
                    }
                    executed = cpu.run(quantum);
                    proc.context = this._captureContext(cpu);
                }
                proc.lastExecuted = executed; // real per-pid cycle count from this tick, used to weight ps()/top's CPU% instead of the unused priority field
                this._recordTrace('schedule_tick', { pid: proc.pid, cmd: proc.cmd, executed });
            }
            return running;
        }

        /**
         * @returns {Object[]} the current process table
         */
        ps()
        {
            return this.processes;
        }
    }

    return Kernel;
}));
