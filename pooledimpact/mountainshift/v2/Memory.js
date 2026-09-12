/**
 * @file Memory.js
 * @author Will Fobbs
 * @version 1.1.0
 * @description Volatile address-space model. The schema-tracked `regions`
 *   ledger (who owns which byte range) is real BaseClassX state; the actual
 *   backing byte store — a Physical's CPU.memory array, or a standalone
 *   Uint8Array — is a runtime handle in a Map keyed by this.id, wiped on
 *   every attach() the same way real RAM loses state on power-cycle.
 *
 * v1.1.0 (next()-injection systemic audit, B.6): _backing changed from a
 * WeakMap keyed by `this` to a Map keyed by this.id (same fix, same root
 * cause, as Physical.js's _cpus and Kernel.js's _host); attach(cpu)'s bare
 * `cpu ? ... : ...` and alloc(pid, length, label)'s bare `label || ''`
 * both replaced with typeof-guards, since ExtendX's dispatcher-injected
 * next() callback would otherwise be treated as a real cpu/label under
 * composition. This class is not yet actually composed with
 * SecurityMixin/StructureMixin anywhere in the codebase, and how Kernel/
 * Physical use Memory is NOT being changed here -- this is the same
 * "harden what exists before it's needed" pass CPU/Physical/Kernel/BIOS
 * already got, scoped narrowly on purpose. Broader changes to how Memory
 * is used wait for the Terminal 2.0 reference implementation.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.Memory = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('Memory requires BaseClassX to be loaded first');

  // Keyed by this.id, NOT by `this` object identity -- the same
  // WeakMap-by-`this` bug found and fixed in Physical.js's _cpus and
  // Kernel.js's _host, reproduced here: composing this class via
  // ExtendX.extend() gives every dispatched call a FRESH frame Proxy
  // `this`, so attach()'s `this` and a later read()/write()'s `this` are
  // different objects even on the same logical instance. Confirmed live
  // (attach() then write() threw "Memory.attach() must be called before
  // use" despite attach() having just run) before this fix. A Map, unlike
  // the WeakMap it replaces, does not self-clean on GC -- dispose() below
  // removes the entry explicitly.
  const _backing = new Map();

  class Memory extends BaseClassX {
    static version = '1.1.0';
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
    //
    // `cpu && typeof cpu === 'object'`, NOT bare `cpu ? ... : ...` --
    // once this class is composed via ExtendX.extend(), attach() called
    // with NO argument (the documented "give me a fresh buffer" case) does
    // not get cpu === undefined: ExtendX's dispatcher always appends its
    // own next() callback as the trailing argument to every dispatched
    // call, landing in the omitted cpu slot. A bare truthy check treats
    // that injected FUNCTION as a real cpu and reads its (nonexistent)
    // .memory property, silently backing this instance with undefined
    // instead of a real buffer -- confirmed live, breaking every
    // subsequent read()/write()/alloc(). A real cpu argument is always an
    // object (typeof 'object'); the injected next is always typeof
    // 'function' -- same typeof-guard convention as Kernel's ppid/
    // memBytes/quantum and StructureMixin's label.
    attach(cpu) {
      const hasRealCPU = cpu && typeof cpu === 'object';
      _backing.set(this.id, hasRealCPU ? cpu.memory : new Uint8Array(this.sizeBytes));
      this.regions = [];
      this._recordTrace('attach', { sizeBytes: this.sizeBytes, external: hasRealCPU });
      return this;
    }

    _store() {
      if (!_backing.has(this.id)) throw new Error('Memory.attach() must be called before use');
      return _backing.get(this.id);
    }

    // label: typeof-guarded for the identical reason attach()'s cpu is --
    // alloc(pid, length) omitting label under composition would otherwise
    // store the injected next() function as region.label instead of ''.
    alloc(pid, length, label) {
      const store = this._store();
      const safeLabel = typeof label === 'string' ? label : '';
      const lastEnd = this.regions.reduce((max, r) => Math.max(max, r.base + r.length), 0);
      const base = Math.ceil(lastEnd / this.pageSize) * this.pageSize;
      if (base + length > store.length) throw new Error('Memory.alloc: out of memory (' + length + ' bytes requested at ' + base + ')');
      const region = { pid, base, length, label: safeLabel };
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

    // _backing is a Map (not a WeakMap) since the this.id fix above, so it
    // does not self-clean when an instance is garbage collected -- mirrors
    // Physical.dispose()/Kernel.dispose()'s identical cleanup.
    dispose() {
      _backing.delete(this.id);
      super.dispose();
    }
  }

  return Memory;
}));
