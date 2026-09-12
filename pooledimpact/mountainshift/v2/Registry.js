/**
 * @file Registry.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Machine-level persistent key/value config — NVRAM/CMOS
 *   equivalent (boot device priority, hardware config flags, saved
 *   settings). Kept deliberately separate from BIOS.js's own per-boot
 *   schema and from CPU.js's MSRs: MSRs are live CPU control state,
 *   Registry.js is small, persistent, non-file-shaped machine config —
 *   the thing BIOS reads at step 3 of the boot sequence, before it even
 *   knows what's on disk.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.Registry = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('Registry requires BaseClassX to be loaded first');

  class Registry extends BaseClassX {
    static version = '1.0.0';
    static domain = 'machine.registry';
    static _schema = { properties: {
      entries: { type: 'object', default: {} }
    }};

    constructor(options = {}) {
      super({ type: 'machine.registry', name: 'Registry' });
      this.entries = options.entries || {
        bootDeviceOrder: ['esp', 'disk', 'network'],
        firmwareType: 'UEFI',
        secureBoot: false
      };
    }

    get(key) { return this.entries[key]; }

    // KNOWN GAP (next()-injection audit, unlike fork()/tick()/boot()'s
    // ppid/quantum/iso -- NOT fixed with a typeof-guard here, deliberately):
    // if this class is ever composed via ExtendX.extend(), a caller doing
    // set(key) with the value omitted does not get value === undefined --
    // ExtendX's dispatcher always appends its own next() callback as the
    // trailing argument to every dispatched call, so value becomes that
    // injected function instead. Every other instance of this hazard found
    // this session (StructureMixin's label, Kernel's ppid/memBytes/quantum,
    // BIOS's iso) was fixable by trusting only a specific expected TYPE
    // (string, number) since next is always a function and never one of
    // those. That fix does not apply here: a Registry value is legitimately
    // ANY type, including a function, so there is no type check that can
    // tell "caller meant undefined" apart from "ExtendX's next landed here"
    // without arbitrarily restricting what a registry entry can hold. As
    // of this writing set() is never called with fewer than 2 arguments
    // anywhere in this codebase (grepped, confirmed), so this is currently
    // unreachable -- documented here so it stays that way on purpose,
    // not by accident, if this class is later composed with SecurityMixin/
    // StructureMixin for the NVRAM-as-fast-path work. Callers composing
    // this class MUST always pass both key and value explicitly.
    set(key, value) {
      this.entries = { ...this.entries, [key]: value };
      this._recordTrace('registry_set', { key, value });
      return this;
    }

    has(key) { return Object.prototype.hasOwnProperty.call(this.entries, key); }

    delete(key) {
      const { [key]: _removed, ...rest } = this.entries;
      this.entries = rest;
      this._recordTrace('registry_delete', { key });
      return this;
    }

    keys() { return Object.keys(this.entries); }

    // Persistence — opt-in, not automatic on construction (constructor
    // stays sync, matching the rest of this project's BaseClassX classes).
    // Without ever calling save()/load(), Registry behaves exactly as
    // before: an in-memory-only key/value store for one page session.
    async save(FileFS, options = {}) {
      const backend = options.backend || 'idb';
      const key = options.key || 'meshui-registry';
      const fs = await FileFS.create({ backend, key });
      await fs.writeFile('/registry.json', JSON.stringify(this.entries));
      this._recordTrace('registry_persist_save', { backend, key });
      return this;
    }

    static async load(FileFS, options = {}) {
      const backend = options.backend || 'idb';
      const key = options.key || 'meshui-registry';
      try {
        const fs = await FileFS.create({ backend, key });
        const data = await fs.readFile('/registry.json', 'utf8');
        return new Registry({ entries: JSON.parse(data) });
      } catch (e) {
        return new Registry();
      }
    }
  }

  return Registry;
}));
