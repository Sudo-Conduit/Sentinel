/**
 * @file Physical.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The hardware surface (Kernel-Machine-Architecture.md's
 *   Machine: BIOS -> Physical [Hardware, Energy]). Schema-tracked capacity
 *   figures live on the instance; the live CPU.js engine those figures
 *   describe is a runtime handle in a WeakMap, never schema-validated per
 *   register/memory write (same convention as LoadingIcon's DOM refs).
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './CPU.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./CPU.js'));
  else root.Physical = factory(root.BaseClassX, root.CPU);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, CPU) {
  'use strict';
  if (!BaseClassX) throw new Error('Physical requires BaseClassX to be loaded first');
  if (!CPU) throw new Error('Physical requires CPU.js to be loaded first');

  const _cpus = new WeakMap();

  class Physical extends BaseClassX {
    static version = '1.0.0';
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
    }

    // POST: power hardware on, size and construct the CPU.js engine,
    // hold it as a runtime handle.
    post() {
      const cpu = new CPU({ memorySize: this.ramBytes });
      _cpus.set(this, cpu);
      this.poweredOn = true;
      this._recordTrace('post', { capacityMHz: this.capacityMHz, ramBytes: this.ramBytes });
      return cpu.boot();
    }

    getCPU() {
      if (!_cpus.has(this)) throw new Error('Physical.getCPU: call post() first (CPU not powered on)');
      return _cpus.get(this);
    }

    reset() {
      const cpu = this.getCPU();
      this._recordTrace('reset', {});
      return cpu.reset();
    }
  }

  return Physical;
}));
