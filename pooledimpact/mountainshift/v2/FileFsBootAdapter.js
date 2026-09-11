/**
 * @file FileFsBootAdapter.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Closes the gap BIOS.js's boot sequence left open: turns a
 *   BootDeviceScan hit (a same-named artifact on a storage surface) into a
 *   CONFIRMED boot entry by actually mounting it through FileFsX and
 *   checking for a real ESP/bootloader marker inside it. Without this,
 *   BootDeviceScan can only say "something named meshui-vol-<id> exists on
 *   this surface" — it can't tell a bootable volume from a same-named
 *   artifact that happens to share the naming convention but holds no OS.
 *   Implements the findBootEntry(device, firmwareType) contract BIOS.boot()
 *   already calls.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BootDeviceScan.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BootDeviceScan.js'));
  else root.FileFsBootAdapter = factory(root.BootDeviceScan);
}(typeof self !== 'undefined' ? self : this, function(BootDeviceScan) {
  'use strict';
  if (!BootDeviceScan) throw new Error('FileFsBootAdapter requires BootDeviceScan.js to be loaded first');

  // Sub-order within the 'disk' step, most-automatic first. 'picker' (a
  // real filesystem via the File System Access API) is last and, for now,
  // always skipped in automatic scanning: it requires an interactive user
  // gesture to grant access and cannot be probed headlessly — confirmed
  // unavailable in this environment. The seam stays open for a future UI
  // flow that calls the picker explicitly, on a real user click.
  const DISK_SUB_ORDER = ['idb', 'opfs', 'cache', 'picker'];

  // Every BootDeviceScan surface is now mountable through FileFsX.
  const MOUNTABLE_SURFACES = ['idb', 'opfs', 'cache'];

  function markerPathFor(firmwareType) {
    return firmwareType === 'BIOS-L' ? '/boot/boot.bin' : '/EFI/BOOT/BOOTX64.EFI';
  }

  // Same small hash used by ISO.js (via BaseClassX.hashString) and
  // Installer.js — duplicated here deliberately: this is a standalone
  // utility file, not a BaseClassX subclass, so it carries its own copy
  // rather than taking on a shared dependency for one function.
  function _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return Math.abs(hash).toString(36);
  }

  class FileFsBootAdapter {
    constructor(FileFS) {
      if (!FileFS) throw new Error('FileFsBootAdapter requires the FileFsX FileFS class');
      this.FileFS = FileFS;
    }

    async findBootEntry(device, firmwareType) {
      if (device !== 'disk') return null; // 'esp'/'network' lookups not implemented yet
      const hits = (await BootDeviceScan.scanAll()).filter(h => MOUNTABLE_SURFACES.includes(h.surface));
      const marker = markerPathFor(firmwareType);

      // Removable media first (step 5's real-BIOS convention: a bootable
      // USB stick, when present, is used before falling through to fixed
      // media), DISK_SUB_ORDER as the surface-priority tiebreak within
      // each removable/fixed group.
      const bySurfaceRank = s => { const i = DISK_SUB_ORDER.indexOf(s); return i === -1 ? DISK_SUB_ORDER.length : i; };
      const ordered = [...hits].sort((a, b) => {
        if (a.removable !== b.removable) return a.removable ? -1 : 1;
        return bySurfaceRank(a.surface) - bySurfaceRank(b.surface);
      });

      for (const hit of ordered) {
        try {
          const fs = await this.FileFS.create({ backend: hit.surface, key: (hit.removable ? BootDeviceScan.USB_PREFIX : BootDeviceScan.VOLUME_PREFIX) + hit.id });
          await fs.stat(marker);
          // Content check, not just presence: real firmware validates a
          // signature before handoff (step 6), on every boot — not only
          // once, at install time, the way ISO.verifyIntegrity() runs.
          // Installer.js writes a "<marker>.sha" sidecar alongside every
          // installed file; a missing or mismatched sidecar means this
          // marker is unconfirmed, even though a file exists at the path.
          const content = await fs.readFile(marker, 'utf8');
          let sidecarOk = false;
          try {
            const sidecar = await fs.readFile(marker + '.sha', 'utf8');
            sidecarOk = sidecar === _hash(content);
          } catch (e) { sidecarOk = false; }
          if (!sidecarOk) continue; // present but unsigned/tampered — not bootable, try the next hit
          return { surface: hit.surface, id: hit.id, removable: hit.removable, path: marker, confirmed: true };
        } catch (e) {
          // no marker at that path on this volume — not bootable, try the next hit
        }
      }
      return null;
    }
  }

  return FileFsBootAdapter;
}));
