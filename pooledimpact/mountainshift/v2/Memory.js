/**
 * @file Memory.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Volatile address-space model. The schema-tracked `regions`
 *   ledger (who owns which byte range) is real BaseClassX state; the actual
 *   backing byte store — a Physical's CPU.memory array, or a standalone
 *   Uint8Array — is a runtime handle in a WeakMap, wiped on every attach()
 *   the same way real RAM loses state on power-cycle.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.Memory = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('Memory requires BaseClassX to be loaded first');

  const _backing = new WeakMap();

  class Memory extends BaseClassX {
    static version = '1.0.0';
    static domain = 'machine.memory';
    static _schema = { properties: {
      sizeBytes: { type: 'number', default: 0x100000 },
      pageSize: { type: 'number', default: 4096 },
      regions: { type: 'array', default: [] }
    }};

    constructor(options = {}) {
      super({ type: 'machine.memory', name: 'Memory' });
      this.sizeBytes = options.sizeBytes || 0x100000;
      this.pageSize = options.pageSize || 4096;
      this.regions = [];
    }

    // Attach to a live backing store — a Physical's CPU.memory array, or
    // (with none given) a fresh Uint8Array. Volatile: called again on every
    // reboot, previous contents are gone.
    attach(cpu) {
      _backing.set(this, cpu ? cpu.memory : new Uint8Array(this.sizeBytes));
      this.regions = [];
      this._recordTrace('attach', { sizeBytes: this.sizeBytes, external: !!cpu });
      return this;
    }

    _store() {
      if (!_backing.has(this)) throw new Error('Memory.attach() must be called before use');
      return _backing.get(this);
    }

    alloc(pid, length, label) {
      const store = this._store();
      const lastEnd = this.regions.reduce((max, r) => Math.max(max, r.base + r.length), 0);
      const base = Math.ceil(lastEnd / this.pageSize) * this.pageSize;
      if (base + length > store.length) throw new Error('Memory.alloc: out of memory (' + length + ' bytes requested at ' + base + ')');
      const region = { pid, base, length, label: label || '' };
      this.regions = [...this.regions, region];
      this._recordTrace('alloc', region);
      return region;
    }

    free(pid) {
      const before = this.regions.length;
      this.regions = this.regions.filter(r => r.pid !== pid);
      this._recordTrace('free', { pid, freedCount: before - this.regions.length });
      return this;
    }

    read(addr, length) {
      const store = this._store();
      return store.slice(addr, addr + length);
    }

    write(addr, bytes) {
      const store = this._store();
      for (let i = 0; i < bytes.length; i++) store[addr + i] = bytes[i];
      return this;
    }
  }

  return Memory;
}));
