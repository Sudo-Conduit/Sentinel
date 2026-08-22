/**
 * @file StorageDevice.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Device façade over a FileFsX mount — the shape scoped in
 *   Kernel-Machine-Architecture.md's MockUSBDrive analysis: sector/capacity
 *   math, an fsType label, and connect/mount/hotplug lifecycle, delegating
 *   actual reads/writes to the attached FileFsX mount instead of owning a
 *   second filesystem. One class covers both device personalities —
 *   `removable: true` (USB) vs `false` (fixed hard drive) — since the only
 *   real difference is that flag plus which naming-convention prefix it
 *   uses (`meshui-usb-` vs `meshui-vol-`), not the storage/lifecycle logic
 *   itself. Not a BaseClassX subclass — same reasoning as CPU.js/
 *   MockUSBDrive.js/BootDeviceScan.js: host-emulation runtime state.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BootDeviceScan.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BootDeviceScan.js'));
  else root.StorageDevice = factory(root.BootDeviceScan);
}(typeof self !== 'undefined' ? self : this, function(BootDeviceScan) {
  'use strict';

  const FALLBACK_VOLUME_PREFIX = 'meshui-vol-';
  const FALLBACK_USB_PREFIX = 'meshui-usb-';

  class StorageDevice {
    // options.FileFS: the FileFsX FileFS class (required to mount()).
    // options.removable: true = USB-shaped device, false = fixed hard drive.
    // options.surface: 'idb' | 'opfs' | 'cache' (default 'idb').
    // options.id: volume id under this device's naming-convention prefix.
    constructor(options = {}) {
      this.FileFS = options.FileFS || null;
      this.removable = !!options.removable;
      this.label = options.label || (this.removable ? 'USB_DRIVE' : 'HARD_DRIVE');
      this.fsType = options.fsType || 'FAT32';
      this.totalSize = options.totalSize || (this.removable ? 512 * 1024 * 1024 : 8 * 1024 * 1024 * 1024);
      this.sectorSize = 512;
      this.totalSectors = Math.floor(this.totalSize / this.sectorSize);
      this.surface = options.surface || 'idb';
      this.id = options.id || (this.removable ? 'usb0' : 'root');
      this.isConnected = options.connected !== undefined ? options.connected : true;
      this.isMounted = false;
      this._fs = null;
    }

    get prefix() {
      return this.removable
        ? ((BootDeviceScan && BootDeviceScan.USB_PREFIX) || FALLBACK_USB_PREFIX)
        : ((BootDeviceScan && BootDeviceScan.VOLUME_PREFIX) || FALLBACK_VOLUME_PREFIX);
    }

    get key() { return this.prefix + this.id; }

    connect() { this.isConnected = true; return this; }

    disconnect() { this.isConnected = false; this.isMounted = false; this._fs = null; return this; }

    async mount() {
      if (!this.isConnected) throw new Error('StorageDevice.mount: "' + this.label + '" is not connected');
      if (!this.FileFS) throw new Error('StorageDevice.mount: no FileFsX FileFS class given (options.FileFS)');
      this._fs = await this.FileFS.create({ backend: this.surface, key: this.key });
      this.isMounted = true;
      return this._fs;
    }

    unmount() { this.isMounted = false; this._fs = null; return this; }

    async simulateHotplug(ms) {
      this.disconnect();
      await new Promise(r => setTimeout(r, ms || 0));
      this.connect();
      return this;
    }

    _assertMounted() {
      if (!this.isMounted || !this._fs) throw new Error('StorageDevice: "' + this.label + '" is not mounted — call mount() first');
    }

    readFile(path, options) { this._assertMounted(); return this._fs.readFile(path, options); }
    writeFile(path, data, options) { this._assertMounted(); return this._fs.writeFile(path, data, options); }
    mkdir(path, options) { this._assertMounted(); return this._fs.mkdir(path, options); }
    stat(path) { this._assertMounted(); return this._fs.stat(path); }

    getInfo() {
      return {
        label: this.label, fsType: this.fsType, removable: this.removable,
        totalSize: this.totalSize, totalSectors: this.totalSectors,
        surface: this.surface, key: this.key,
        isConnected: this.isConnected, isMounted: this.isMounted
      };
    }

    static usb(options = {}) { return new StorageDevice({ ...options, removable: true }); }
    static hardDrive(options = {}) { return new StorageDevice({ ...options, removable: false }); }
  }

  return StorageDevice;
}));
