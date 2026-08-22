/**
 * @file BootDeviceScan.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Step 5 of the boot sequence, made real: scans the three
 *   storage surfaces a browser/Node host exposes that can hold a bootable
 *   volume — IndexedDB, OPFS, and the Cache API — for entries matching the
 *   project's naming convention, instead of BIOS.js always falling through
 *   to `bootedFrom: 'none'`. Stateless utility, not a BaseClassX subclass —
 *   same reasoning as CPU.js/MockUSBDrive.js: this reads host-runtime
 *   storage APIs directly, there is no domain state to schema-track.
 *
 * Naming convention: a volume is anything named `meshui-vol-<id>` on its
 * surface — an IndexedDB database, an OPFS directory entry, or a Cache API
 * cache. Everything else on that surface (FileFsX's own 'FileFsX' database
 * being the notable example) is deliberately invisible to the boot scan;
 * bootable and non-bootable storage share the same surfaces but not the
 * same names.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BootDeviceScan = factory();
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Two naming-convention prefixes, both hard-drive-shaped surfaces
  // otherwise: fixed volumes (meshui-vol-) vs removable/USB volumes
  // (meshui-usb-). Same three storage surfaces scan for both.
  const VOLUME_PREFIX = 'meshui-vol-';
  const USB_PREFIX = 'meshui-usb-';

  function classify(name) {
    if (name.startsWith(USB_PREFIX)) return { id: name.slice(USB_PREFIX.length), removable: true };
    if (name.startsWith(VOLUME_PREFIX)) return { id: name.slice(VOLUME_PREFIX.length), removable: false };
    return null;
  }

  async function scanIDB() {
    if (typeof indexedDB === 'undefined') return [];
    // FileFsX's idb backend keeps every mount as a ROW in one shared
    // 'FileFsX' database's 'mounts' object store (keyed by mount key) —
    // not as a separate database per mount. Scan keys in that store, not
    // indexedDB.databases() (which would only ever find literal database
    // names, never individual FileFsX mount keys).
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('FileFsX', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('mounts'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!db.objectStoreNames.contains('mounts')) { db.close(); return []; }
      const keys = await new Promise((resolve, reject) => {
        const tx = db.transaction('mounts', 'readonly');
        const req = tx.objectStore('mounts').getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return keys.map(k => classify(String(k))).filter(c => c !== null).map(c => ({ surface: 'idb', id: c.id, removable: c.removable }));
    } catch (e) {
      return [];
    }
  }

  async function scanOPFS() {
    if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.getDirectory !== 'function') return [];
    try {
      const root = await navigator.storage.getDirectory();
      const found = [];
      // FileFsX's opfs backend stores a mount as a FILE named
      // '<key>.json' at the OPFS root, not a directory named '<key>' —
      // same class of convention mismatch scanIDB() had.
      for await (const [name, handle] of root.entries()) {
        if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
        const c = classify(name.slice(0, -('.json'.length)));
        if (c !== null) found.push({ surface: 'opfs', id: c.id, removable: c.removable });
      }
      return found;
    } catch (e) {
      return [];
    }
  }

  async function scanCache() {
    if (typeof caches === 'undefined' || typeof caches.keys !== 'function') return [];
    const names = await caches.keys();
    return names
      .map(n => classify(n))
      .filter(c => c !== null)
      .map(c => ({ surface: 'cache', id: c.id, removable: c.removable }));
  }

  // Union across all three surfaces. The same id can legitimately appear
  // on more than one surface (e.g. an IDB-backed volume that also keeps a
  // Cache-API mirror) — callers get every hit, not a deduped single guess.
  async function scanAll() {
    const [idb, opfs, cache] = await Promise.all([scanIDB(), scanOPFS(), scanCache()]);
    return [...idb, ...opfs, ...cache];
  }

  return { VOLUME_PREFIX, USB_PREFIX, scanIDB, scanOPFS, scanCache, scanAll };
}));
