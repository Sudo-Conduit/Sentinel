/**
 * @file Kernel.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Process table + scheduler. The Kernel owns WHO runs
 *   (schema-tracked `processes`); the attached Physical/Environment (HOW
 *   things actually execute, what host they're running on) are runtime
 *   handles in a WeakMap, not schema state.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.Kernel = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('Kernel requires BaseClassX to be loaded first');

  const _host = new WeakMap();
  let _pidSeq = 1;

  class Kernel extends BaseClassX {
    static version = '1.0.0';
    static domain = 'machine.kernel';
    static _schema = { properties: {
      bootedFrom: { type: 'string', default: 'none' },
      firmwareType: { type: 'string', default: 'UEFI' },
      processes: { type: 'array', default: [] },
      schedulerPolicy: { type: 'string', default: 'round-robin' },
      cores: { type: 'number', default: 1 }
    }};

    constructor(options = {}) {
      super({ type: 'machine.kernel', name: 'Kernel' });
      this.bootedFrom = options.bootedFrom || 'none';
      this.firmwareType = options.firmwareType || 'UEFI';
      this.processes = [];
      this.schedulerPolicy = options.schedulerPolicy || 'round-robin';
      this.cores = options.cores || 1;
    }

    attach(physical, environment, memory) {
      _host.set(this, { physical, environment, memory });
      this._recordTrace('attach', { firmwareType: this.firmwareType, env: environment ? environment.runtime : null });
      return this;
    }

    getPhysical() { return (_host.get(this) || {}).physical || null; }
    getEnvironment() { return (_host.get(this) || {}).environment || null; }
    getMemory() { return (_host.get(this) || {}).memory || null; }

    // Real per-process footprint: each fork() actually reserves a byte range
    // via the attached Memory ledger (a fixed nominal size per process today,
    // real growth tracking is future work) so ps()/top's Mem% reads an actual
    // allocation instead of Math.random(). No Memory attached -> proc.memBytes
    // stays 0, callers fall back gracefully.
    fork(cmd, ppid, memBytes) {
      const pid = _pidSeq++;
      memBytes = memBytes || 65536;
      const memory = this.getMemory();
      let allocated = 0;
      if (memory) {
        try { memory.alloc(pid, memBytes, cmd); allocated = memBytes; } catch (e) { this._recordTrace('fork_alloc_failed', { pid, cmd, error: e.message }); }
      }
      const proc = { pid, ppid: ppid || 0, cmd, state: 'running', priority: 0, context: null, memBytes: allocated };
      this.processes = [...this.processes, proc];
      this._recordTrace('fork', proc);
      return proc;
    }

    kill(pid) {
      // Force Quit semantics: killing a pid also kills every descendant (its
      // children, grandchildren, ...) recursively — no graceful shutdown, no
      // cleanup callbacks, matching real OS SIGKILL cascade. Not the
      // recommended way to stop something (no save, no flush), but necessary
      // for runaway processes / severe leaks.
      const toKill = [pid];
      for (let i = 0; i < toKill.length; i++) {
        const children = this.processes.filter(p => p.ppid === toKill[i]).map(p => p.pid);
        children.forEach(c => { if (!toKill.includes(c)) toKill.push(c); });
      }
      const before = this.processes.length;
      const memory = this.getMemory();
      this.processes = this.processes.filter(p => !toKill.includes(p.pid));
      if (memory) toKill.forEach(k => memory.free(k));
      this._recordTrace('kill', { pid, cascaded: toKill, removed: before - this.processes.length });
      return this;
    }

    _captureContext(cpu) {
      return { EAX: cpu.EAX, EBX: cpu.EBX, ECX: cpu.ECX, EDX: cpu.EDX, ESI: cpu.ESI, EDI: cpu.EDI, EBP: cpu.EBP, ESP: cpu.ESP, EIP: cpu.EIP, EFLAGS: cpu.EFLAGS };
    }

    _restoreContext(cpu, context) {
      Object.assign(cpu, context);
      cpu.config.halted = false;
    }

    // Round-robin tick: each live process gets one scheduler turn AND one
    // real quantum of CPU.js execution (fetch/decode/execute), via the
    // attached Physical — not just a trace entry. One CPU is shared, so
    // each process's register file is saved to proc.context on its way
    // out and restored on its way back in, the same save/restore a real
    // context switch does. A fresh process (context: null) starts from
    // cpu.boot()'s clean register state.
    tick(quantum) {
      quantum = quantum || 10;
      const physical = this.getPhysical();
      const cpu = physical && physical.poweredOn ? physical.getCPU() : null;
      const running = this.processes.filter(p => p.state === 'running');
      for (const proc of running) {
        let executed = 0;
        if (cpu) {
          if (proc.context) this._restoreContext(cpu, proc.context);
          else cpu.boot();
          executed = cpu.run(quantum);
          proc.context = this._captureContext(cpu);
        }
        proc.lastExecuted = executed; // real per-pid cycle count from this tick, used to weight ps()/top's CPU% instead of the unused priority field
        this._recordTrace('schedule_tick', { pid: proc.pid, cmd: proc.cmd, executed });
      }
      return running;
    }

    ps() { return this.processes; }
  }

  return Kernel;
}));
