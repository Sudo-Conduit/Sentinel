/**
 * @file Installer.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Runs an ISO's install manifest onto a fresh FileFsX-backed
 *   volume, named per BootDeviceScan's meshui-vol-<id> convention so the
 *   result is immediately findable by a subsequent boot scan. Stateless
 *   static utility, not a BaseClassX subclass — same reasoning as
 *   BootDeviceScan/FileFsBootAdapter: this performs host filesystem
 *   writes, there's no domain state of its own to schema-track (the ISO
 *   being installed already is one).
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Installer = factory();
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  const DEFAULT_PREFIX = 'meshui-vol-';

  // Same small hash FileFsBootAdapter.js checks against — duplicated
  // deliberately, same reasoning as there: standalone utility file, not
  // worth a shared dependency for one function.
  function _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return Math.abs(hash).toString(36);
  }

  class Installer {
    // options.FileFS: the FileFsX FileFS class (required).
    // options.surface: 'idb' | 'opfs' | 'cache' (default 'idb').
    // options.id: volume id, becomes key `<prefix><id>` (default 'root').
    // options.removable: writes under the USB naming-convention prefix
    // instead of the fixed-volume one, when BootDeviceScan.js is loaded.
    static async install(iso, options = {}) {
      const FileFS = options.FileFS;
      if (!FileFS) throw new Error('Installer.install requires a FileFsX FileFS class (options.FileFS)');
      iso.verifyIntegrity();

      const surface = options.surface || 'idb';
      const id = options.id || 'root';
      const hasBDS = typeof BootDeviceScan !== 'undefined';
      const prefix = options.removable
        ? (hasBDS && BootDeviceScan.USB_PREFIX) || 'meshui-usb-'
        : (hasBDS && BootDeviceScan.VOLUME_PREFIX) || DEFAULT_PREFIX;
      const key = prefix + id;

      const fs = await FileFS.create({ backend: surface, key });
      const installedFiles = [];
      for (const file of iso.manifest) {
        const dir = file.path.split('/').slice(0, -1).join('/');
        if (dir && dir !== '') {
          await fs.mkdir(dir, { recursive: true }).catch(() => {});
        }
        await fs.writeFile(file.path, file.content);
        // Sidecar checksum, checked by FileFsBootAdapter on every boot
        // (not just here, at install time) — see its findBootEntry.
        await fs.writeFile(file.path + '.sha', _hash(file.content));
        installedFiles.push(file.path);
      }

      return { surface, id, key, removable: !!options.removable, installedFiles };
    }
  }

  return Installer;
}));
