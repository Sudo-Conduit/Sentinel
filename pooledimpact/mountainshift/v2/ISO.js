/**
 * @file ISO.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description An install image: an ordered file manifest (kernel/initrd
 *   equivalent, install script, the bootloader marker) plus a checksum for
 *   the boot sequence's step 6 integrity check. BaseClassX subclass —
 *   unlike CPU.js/MockUSBDrive.js, this IS domain state worth schema-
 *   tracking and fingerprinting (an install image's identity/version/
 *   provenance matters), not a high-frequency runtime engine.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.ISO = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('ISO requires BaseClassX to be loaded first');

  class ISO extends BaseClassX {
    static version = '1.0.0';
    static domain = 'machine.iso';
    static _schema = { properties: {
      name: { type: 'string', default: '' },
      isoVersion: { type: 'string', default: '1.0.0' },
      firmwareType: { type: 'string', default: 'UEFI' },
      manifest: { type: 'array', default: [] },   // [{ path, content }]
      checksum: { type: 'string', default: '' }
    }};

    constructor(options = {}) {
      super({ type: 'machine.iso', name: options.name || 'ISO' });
      this.name = options.name || '';
      this.isoVersion = options.isoVersion || '1.0.0';
      this.firmwareType = options.firmwareType || 'UEFI';
      this.manifest = options.manifest || [];
      this.checksum = options.checksum || this.computeChecksum();
    }

    // Deterministic over manifest contents regardless of insertion order —
    // sorted by path before hashing.
    computeChecksum() {
      const sorted = [...this.manifest].sort((a, b) => a.path.localeCompare(b.path));
      const data = sorted.map(f => f.path + '|' + f.content).join('\n');
      return this.hashString(data);
    }

    // Step 6 of the boot sequence: "after integrity checks". Throws rather
    // than returning false — a failed integrity check is treated with the
    // same severity as a schema validation failure elsewhere in this
    // project, not silently ignored.
    verifyIntegrity() {
      const recomputed = this.computeChecksum();
      if (recomputed !== this.checksum) {
        throw new Error('ISO integrity check failed for "' + this.name + '": checksum mismatch (expected ' + this.checksum + ', got ' + recomputed + ')');
      }
      return true;
    }

    // Convenience: an ISO that's guaranteed to carry the UEFI bootloader
    // marker FileFsBootAdapter checks for, without every caller having to
    // remember the exact path.
    static withDefaultUEFIBootloader(options = {}) {
      const manifest = options.manifest ? [...options.manifest] : [];
      if (!manifest.some(f => f.path === '/EFI/BOOT/BOOTX64.EFI')) {
        manifest.push({ path: '/EFI/BOOT/BOOTX64.EFI', content: options.bootloaderContent || 'stub-bootloader' });
      }
      return new ISO({ ...options, manifest });
    }
  }

  return ISO;
}));
