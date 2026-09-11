/**
 * @file BIOS.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Firmware layer implementing steps 2-6 of the boot sequence
 *   in Kernel-Machine-Architecture.md: POST -> read environment -> scan
 *   bootDeviceOrder for a valid ESP/bootloader entry -> hand off to a fresh
 *   Kernel. Defaults to UEFI (bootDeviceOrder scans an ESP-shaped entry
 *   first); firmwareType: 'BIOS-L' is available for a deliberate legacy-MBR
 *   scenario but is not the project default.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js', './Environment.js', './Kernel.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./Environment.js'), require('./Kernel.js'));
  else root.BIOS = factory(root.BaseClassX, root.Environment, root.Kernel);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, Environment, Kernel) {
  // Registry.js is optional and NOT required at load time — BIOS.attachRegistry()
  // just needs an object shaped like one (get/has), so BIOS.js has no hard
  // dependency on it.
  'use strict';
  if (!BaseClassX) throw new Error('BIOS requires BaseClassX to be loaded first');

  const _kernelFactories = new Map(); // this.id -> factory({bootedFrom, firmwareType, cores}) | null
  function defaultKernelFactory(opts) { return new Kernel(opts); }

  // NOT `typeof this.addChild === 'function'` -- BaseClassX itself already
  // defines a NATIVE addChild(childInstance) for its own always-on tree
  // (a totally separate feature from StructureMixin's, taking a real
  // BaseClassX instance, not an extId string). That native method exists
  // on every BIOS instance whether or not StructureMixin is composed, so a
  // bare typeof check finds it every time and calls it with the wrong
  // argument shape -- proven live: "Child must be an instance of
  // BaseClassX" thrown from BaseClassX.js, not from anything obviously
  // BIOS-related. This checks for a graph/both-mode StructureMixin
  // SPECIFICALLY, by mixinId prefix, so the native BaseClassX tree is
  // never confused with it.
  function hasGraphStructure(instance) {
    const raw = instance.constructor && instance.constructor._rawMixins;
    if (!raw) return false;
    return raw.some(function(m) {
      return typeof m.mixinId === 'string' &&
        (m.mixinId.indexOf('structure:graph:') === 0 || m.mixinId.indexOf('structure:both:') === 0);
    });
  }

  class BIOS extends BaseClassX {
    static version = '1.0.0';
    static domain = 'machine.bios';
    static _schema = { properties: {
      firmwareType: { type: 'string', default: 'UEFI' },
      bootDeviceOrder: { type: 'array', default: ['esp', 'disk', 'network'] },
      postComplete: { type: 'boolean', default: false },
      registryRef: { type: 'object', default: null },
      installTargetSurface: { type: 'string', default: 'idb' },
      installTargetId: { type: 'string', default: 'root' }
    }};

    constructor(options = {}) {
      super({ type: 'machine.bios', name: 'BIOS' });
      this.firmwareType = options.firmwareType || 'UEFI';
      this.bootDeviceOrder = options.bootDeviceOrder || ['esp', 'disk', 'network'];
      this.postComplete = false;
      this.registryRef = null;
      // Injectable, like Physical's cpuFactory -- without it, boot() always
      // hands off to a plain, unsecured Kernel regardless of whether BIOS
      // itself is composed with SecurityMixin, exactly the raw-unsecured-CPU
      // leak Physical.js had before its own cpuFactory fix. Keyed by this.id
      // in a module-level Map (not a plain instance property) for the same
      // reason Physical._cpuFactories is: BaseClassX's schema Proxy silently
      // rejects an undeclared property write, and once BIOS is composed via
      // ExtendX a plain instance property would be vulnerable to the same
      // frame-Proxy-identity mismatch as the _host/_cpus WeakMap bugs.
      _kernelFactories.set(this.id, typeof options.kernelFactory === 'function' ? options.kernelFactory : null);
    }

    dispose() {
      _kernelFactories.delete(this.id);
      super.dispose();
    }

    // Step 3 of the boot sequence: read NVRAM-shaped config. When a
    // Registry is attached, its 'bootDeviceOrder'/'firmwareType' entries
    // (if present) override this instance's own schema defaults for the
    // boot that follows.
    attachRegistry(registry) {
      this.registryRef = registry;
      if (registry && registry.has && registry.has('bootDeviceOrder')) this.bootDeviceOrder = registry.get('bootDeviceOrder');
      if (registry && registry.has && registry.has('firmwareType')) this.firmwareType = registry.get('firmwareType');
      this._recordTrace('attach_registry', { hasRegistry: !!registry });
      return this;
    }

    // fs is optional: anything exposing findBootEntry(device, firmwareType)
    // (sync or returning a Promise). Without one, and for the 'disk' step
    // specifically, falls back to BootDeviceScan (IDB/OPFS/Cache, by the
    // project's meshui-vol- naming convention) when it's loaded globally.
    // iso is optional: an ISO instance (step 6-8) to install and boot from
    // when nothing bootable is found anywhere — without one, boot()
    // resolves bootedFrom:'none', matching real hardware's "no bootable
    // device" outcome.
    async boot(physical, fs, iso) {
      physical.post();
      this.postComplete = true;
      const env = Environment.detect();

      let bootTarget = null;
      for (const device of this.bootDeviceOrder) {
        let found = fs && typeof fs.findBootEntry === 'function' ? await fs.findBootEntry(device, this.firmwareType) : null;
        if (!found && device === 'disk' && typeof BootDeviceScan !== 'undefined') {
          const hits = await BootDeviceScan.scanAll();
          if (hits.length > 0) found = hits[0];
        }
        if (found) { bootTarget = { device, entry: found }; break; }
      }

      // Steps 6-8: nothing bootable found, but an ISO was supplied. Verify
      // integrity, run its install manifest onto installTargetSurface/Id,
      // then re-run the same fs.findBootEntry('disk', ...) lookup against
      // what was just written — the post-install reboot, step 8, without an
      // actual page reload.
      //
      // `iso && typeof Installer !== 'undefined'` is NOT enough once this
      // class is composed via ExtendX.extend(): boot(physical, fs) called
      // with only 2 arguments (a legitimate, common call shape -- no ISO
      // available) does not leave `iso` as undefined. ExtendX's dispatcher
      // always appends its own next() callback as the trailing argument to
      // every dispatched call, and it lands in this exact omitted slot --
      // `iso` becomes that injected function, which is truthy. Proven live:
      // this used to crash with "iso.verifyIntegrity is not a function" on
      // a real 2-argument boot() call. Guarding on the actual shape an ISO
      // is required to have (a verifyIntegrity method) is the fix, same
      // typeof-guard convention as fork()/tick() above and StructureMixin's
      // label/next collision -- never trust bare truthiness on an optional
      // trailing dispatched parameter.
      if (!bootTarget && iso && typeof iso.verifyIntegrity === 'function' && typeof Installer !== 'undefined') {
        iso.verifyIntegrity();
        const FileFS = (fs && fs.FileFS) || (typeof FileFsX !== 'undefined' ? FileFsX : undefined);
        const installed = await Installer.install(iso, { FileFS, surface: this.installTargetSurface, id: this.installTargetId });
        this._recordTrace('iso_install', { iso: iso.name, installed });
        if (fs && typeof fs.findBootEntry === 'function') {
          const confirmed = await fs.findBootEntry('disk', this.firmwareType);
          if (confirmed) bootTarget = { device: 'disk', entry: confirmed };
        }
      }

      this._recordTrace('boot', { firmwareType: this.firmwareType, env: env.runtime, bootTarget });

      const kernelFactory = _kernelFactories.get(this.id) || defaultKernelFactory;
      const kernel = kernelFactory({ bootedFrom: bootTarget ? bootTarget.device : 'none', firmwareType: this.firmwareType, cores: env.cores || 1 });
      // Real host signals from Environment.detect() (navigator.deviceMemory /
      // hardwareConcurrency), not the Physical instance's construction-time
      // defaults \u2014 deviceMemoryGB is a coarse browser-reported bucket (0.25/0.5/
      // 1/2/4/8), so it overrides ramBytes only when actually reported (>0).
      const memSizeBytes = env.deviceMemoryGB > 0 ? env.deviceMemoryGB * 1024 * 1024 * 1024 : (physical.ramBytes || 0x400000);
      const memory = (typeof Memory !== 'undefined') ? new Memory({ sizeBytes: memSizeBytes }).attach(physical.getCPU ? physical.getCPU() : null) : null;
      kernel.attach(physical, env, memory);

      // Explicit, not inferred. StructureMixin's graph-mode inference reads
      // whatever extId sits on top of CONTEXT_STACK at the CALLED instance's
      // own construction (its init() hook), and that stack entry is popped
      // by the WRAPPING dispatcher's `finally` the instant boot()'s first
      // `apply()` call returns -- which, for an async method, is immediately,
      // long before any of boot()'s own internal awaits (the findBootEntry
      // scan above) resolve. kernel is constructed only after those awaits,
      // so by the time kernelFactory() runs, BIOS's extId is already off the
      // stack -- proven live: inference silently returned null here. This is
      // exactly the documented "construction after an internal await" gap
      // in StructureMixin.js's own header comment; addChild() is the
      // documented fix for it, not a workaround. Both BIOS and kernel must
      // actually be composed with a StructureMixin in graph/both mode for
      // this to do anything -- guarded by hasGraphStructure() above (NOT a
      // bare typeof check -- see its comment) so this line is safe to leave
      // in place even when BIOS/Kernel aren't composed with structure
      // tracking, and never collides with BaseClassX's own native,
      // differently-shaped addChild().
      if (hasGraphStructure(this) && hasGraphStructure(kernel)) this.addChild(kernel._extId);
      return kernel;
    }
  }

  return BIOS;
}));
