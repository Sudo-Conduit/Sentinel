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
      if (!bootTarget && iso && typeof Installer !== 'undefined') {
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

      const kernel = new Kernel({ bootedFrom: bootTarget ? bootTarget.device : 'none', firmwareType: this.firmwareType, cores: env.cores || 1 });
      // Real host signals from Environment.detect() (navigator.deviceMemory /
      // hardwareConcurrency), not the Physical instance's construction-time
      // defaults \u2014 deviceMemoryGB is a coarse browser-reported bucket (0.25/0.5/
      // 1/2/4/8), so it overrides ramBytes only when actually reported (>0).
      const memSizeBytes = env.deviceMemoryGB > 0 ? env.deviceMemoryGB * 1024 * 1024 * 1024 : (physical.ramBytes || 0x400000);
      const memory = (typeof Memory !== 'undefined') ? new Memory({ sizeBytes: memSizeBytes }).attach(physical.getCPU ? physical.getCPU() : null) : null;
      kernel.attach(physical, env, memory);
      return kernel;
    }
  }

  return BIOS;
}));
