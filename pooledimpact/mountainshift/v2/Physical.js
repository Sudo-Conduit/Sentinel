/**
 * @file Physical.js
 * @author Will Fobbs
 * @version 1.2.0
 * @description The hardware surface (Kernel-Machine-Architecture.md's
 *   Machine: BIOS -> Physical [Hardware, Energy]). Schema-tracked capacity
 *   figures live on the instance; the live CPU.js engine those figures
 *   describe is a runtime handle in a Map keyed by this.id, never
 *   schema-validated per register/memory write.
 *
 * v1.1.0: _cpus changed from a WeakMap keyed by `this` to a Map keyed by
 * `this.id`. Composing Physical via ExtendX.extend() (see SecurityMixin.js)
 * dispatches each call through a freshly-created "frame" Proxy wrapping the
 * receiver -- correct for `this.super.x()` chaining, but it means every
 * top-level dispatched call runs the real method body with a DIFFERENT
 * object identity for `this`. A WeakMap keyed by that identity breaks
 * outright: post() sets _cpus.set(frameA, cpu), and the very next call to
 * getCPU() runs with `this = frameB`, a different frame -- `_cpus.get(this)`
 * misses even though post() just ran. this.id is BaseClassX's own stable
 * string identity, present on every instance whether or not it's ever
 * composed, and reads through consistently regardless of how many Proxy/
 * frame layers wrap the access -- so keying by it works identically
 * standalone or composed. The cost, versus WeakMap, is that a Map holds a
 * strong reference: dispose() below explicitly removes the entry so a
 * disposed Physical's CPU isn't held forever.
 *
 * v1.2.0: post() previously did `new CPU({memorySize})` unconditionally --
 * so getCPU() always handed back a completely raw, unsecured CPU instance,
 * regardless of whatever protection Physical itself had (e.g. composed with
 * SecurityMixin). Fixed via constructor-injectable options.cpuFactory,
 * defaulting to the original plain `new CPU(...)` behavior when omitted --
 * every existing caller across the codebase is unaffected. A caller that
 * wants Physical's internal CPU secured too passes
 * `cpuFactory: (memBytes) => new SecuredCPU({memorySize: memBytes})`.
 * Physical.js itself stays completely decoupled from ExtendX/SecurityMixin
 * -- it never requires or references either, so plain, non-composed usage
 * (every current call site) is byte-for-byte unaffected. The factory is
 * stored in its own module-level Map keyed by this.id, exactly like _cpus
 * -- NOT as `this.cpuFactory`, because a property not declared in
 * _schema.properties is silently rejected by BaseClassX's own Proxy set
 * trap (the same reason _cpus itself lives outside the schema-tracked
 * instance rather than as `this.cpu`).
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './CPU.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./CPU.js'));
  else root.Physical = factory(root.BaseClassX, root.CPU);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, CPU) {
  'use strict';
  if (!BaseClassX) throw new Error('Physical requires BaseClassX to be loaded first');
  if (!CPU) throw new Error('Physical requires CPU.js to be loaded first');

  const _cpus = new Map();
  const _cpuFactories = new Map();

  function defaultCPUFactory(memBytes) {
    return new CPU({ memorySize: memBytes });
  }

  class Physical extends BaseClassX {
    static version = '1.2.0';
    static domain = 'machine.physical';
    static _schema = { properties: {
      capacityMHz: { type: 'number', default: 2400 },
      ramBytes: { type: 'number', default: 0x100000 },
      storageBytes: { type: 'number', default: 0 },
      energyBudgetW: { type: 'number', default: 65 },
      poweredOn: { type: 'boolean', default: false }
    }};

    constructor(options = {}) {
      super({ type: 'machine.physical', name: 'Physical' });
      this.capacityMHz = options.capacityMHz || 2400;
      this.ramBytes = options.ramBytes || 0x100000;
      this.storageBytes = options.storageBytes || 0;
      this.energyBudgetW = options.energyBudgetW || 65;
      this.poweredOn = false;
      _cpuFactories.set(this.id, typeof options.cpuFactory === 'function' ? options.cpuFactory : defaultCPUFactory);
    }

    // POST: power hardware on, size and construct the CPU.js engine
    // (via the injected factory, defaulting to a plain `new CPU(...)`),
    // hold it as a runtime handle.
    post() {
      const factory = _cpuFactories.get(this.id) || defaultCPUFactory;
      const cpu = factory(this.ramBytes);
      _cpus.set(this.id, cpu);
      this.poweredOn = true;
      this._recordTrace('post', { capacityMHz: this.capacityMHz, ramBytes: this.ramBytes });
      return cpu.boot();
    }

    getCPU() {
      if (!_cpus.has(this.id)) throw new Error('Physical.getCPU: call post() first (CPU not powered on)');
      return _cpus.get(this.id);
    }

    reset() {
      const cpu = this.getCPU();
      this._recordTrace('reset', {});
      return cpu.reset();
    }

    // Explicit cleanup: _cpus/_cpuFactories are Maps (strong references),
    // not WeakMaps, so a disposed Physical's CPU/factory are otherwise
    // held forever.
    dispose() {
      _cpus.delete(this.id);
      _cpuFactories.delete(this.id);
      super.dispose();
    }
  }

  return Physical;
}));
