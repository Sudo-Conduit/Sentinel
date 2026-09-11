// filefs.js
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FileFsX = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {

  // ---------- BASE CLASS X DETECTION ----------
  // BaseClassX must already be in scope (Node require or Browser global).
  // This is NOT a reimplementation — it locates the real certified class.
  var BaseClassX = null;

  if (typeof module === 'object' && module.exports && typeof require === 'function') {
    try {
      BaseClassX = require('./BaseClassX.js').BaseClassX || require('./BaseClassX.js');
    } catch (e) {
      // Not found via require — fall through to global check
    }
  }

  if (!BaseClassX) {
    if (typeof root !== 'undefined' && root.BaseClassX) {
      BaseClassX = root.BaseClassX;
    } else if (typeof globalThis !== 'undefined' && globalThis.BaseClassX) {
      BaseClassX = globalThis.BaseClassX;
    } else if (typeof window !== 'undefined' && window.BaseClassX) {
      BaseClassX = window.BaseClassX;
    } else if (typeof self !== 'undefined' && self.BaseClassX) {
      BaseClassX = self.BaseClassX;
    }
  }

  if (!BaseClassX) {
    throw new Error('FileFsX: BaseClassX not found in scope. Load BaseClassX before FileFsX (Node require or Browser <script>).');
  }

  // ---------- PATH NORMALIZATION (POSIX-COMPLIANT) ----------
  class Path {
    static normalize(p) {
      if (p === '' || p === null || p === undefined) return '';
      const path = String(p);
      if (path === '') return '';
      const parts = path.split('/');
      const result = [];
      const isAbsolute = path.charAt(0) === '/';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '' || part === '.') continue;
        if (part === '..') {
          if (result.length > 0) result.pop();
          continue;
        }
        result.push(part);
      }
      const normalized = result.join('/');
      if (normalized === '' && isAbsolute) return '/';
      if (normalized === '') return '';
      return isAbsolute ? '/' + normalized : normalized;
    }

    static dirname(p) {
      const normalized = this.normalize(p);
      if (normalized === '' || normalized === '/') return '/';
      const parts = normalized.split('/');
      parts.pop();
      const result = parts.join('/');
      return result === '' ? '/' : result;
    }

    static basename(p) {
      const normalized = this.normalize(p);
      if (normalized === '' || normalized === '/') return '';
      const parts = normalized.split('/');
      return parts[parts.length - 1] || '';
    }

    static join(...parts) {
      const result = parts.filter(p => p !== '').join('/');
      return this.normalize(result);
    }

    static resolve(from, to) {
      const fromNorm = this.normalize(from);
      const toNorm = this.normalize(to);
      if (to.charAt(0) === '/') return toNorm;
      const fromParts = fromNorm === '' ? [] : fromNorm.split('/');
      const toParts = toNorm === '' ? [] : toNorm.split('/');
      const result = fromParts.slice();
      for (let i = 0; i < toParts.length; i++) {
        const part = toParts[i];
        if (part === '..') {
          if (result.length > 0) result.pop();
        } else if (part !== '.') {
          result.push(part);
        }
      }
      const resolved = result.join('/');
      return resolved === '' ? '/' : '/' + resolved;
    }

    static isAbsolute(p) {
      return String(p).charAt(0) === '/';
    }

    static relative(from, to) {
      const fromNorm = this.normalize(from);
      const toNorm = this.normalize(to);
      if (fromNorm === toNorm) return '';
      const fromParts = fromNorm === '' ? [] : fromNorm.split('/');
      const toParts = toNorm === '' ? [] : toNorm.split('/');
      let i = 0;
      while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
      const result = [];
      for (let j = i; j < fromParts.length; j++) result.push('..');
      for (let j = i; j < toParts.length; j++) result.push(toParts[j]);
      return result.join('/') || '.';
    }
  }

  // ---------- UTILITY FUNCTIONS ----------
  function isUint8Array(obj) {
    return obj instanceof Uint8Array;
  }

  function toUint8Array(str) {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  }

  function toString(uint8) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(uint8);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // ---------- SQLITE BACKEND (sql.js, loaded lazily from CDN) ----------
  // A real SQLite file as the VFS's on-disk format instead of a JSON blob —
  // same single-blob-per-mount storage model (still one row/key per backend),
  // but the blob itself is a portable, versionable, transactional SQLite
  // database any SQLite implementation (Node, other browsers, wa-sqlite) can
  // open directly. One 'nodes' table mirrors the Folder/File tree flatly.
  let _sqlJsPromise = null;
  function loadSqlJs() {
    if (_sqlJsPromise) return _sqlJsPromise;
    const CDN = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';
    _sqlJsPromise = new Promise((resolve, reject) => {
      if (typeof initSqlJs !== 'undefined') {
        initSqlJs({ locateFile: f => CDN + f }).then(resolve).catch(reject);
        return;
      }
      if (typeof document === 'undefined') {
        reject(new Error('FileFsX sqlite backend requires a browser environment (or a pre-loaded global initSqlJs)'));
        return;
      }
      const script = document.createElement('script');
      script.src = CDN + 'sql-wasm.js';
      script.onload = () => { initSqlJs({ locateFile: f => CDN + f }).then(resolve).catch(reject); };
      script.onerror = () => reject(new Error('Failed to load sql.js from CDN'));
      document.head.appendChild(script);
    });
    return _sqlJsPromise;
  }

  function flattenTreeToRows(root) {
    const rows = [];
    (function walk(node, path) {
      if (node.isDirectory()) {
        rows.push({ path: path === '' ? '/' : path, type: 'dir', content: null, mtime: node.mtime, mode: node.mode, uid: node.uid, gid: node.gid });
        const names = node.listChildren();
        names.forEach(name => walk(node.getChild(name), path + '/' + name));
      } else {
        rows.push({ path: path, type: 'file', content: node.getContentString(), mtime: node.mtime, mode: node.mode, uid: node.uid, gid: node.gid });
      }
    })(root, '');
    return rows;
  }

  function rebuildTreeFromRows(rows) {
    const root = new Folder();
    const nodeMap = { '': root, '/': root };
    const sorted = rows.slice().sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    sorted.forEach(row => {
      if (row.path === '' || row.path === '/') {
        if (row.mtime) root.mtime = row.mtime;
        if (row.mode) root.mode = row.mode;
        root.uid = row.uid || 0; root.gid = row.gid || 0;
        return;
      }
      const lastSlash = row.path.lastIndexOf('/');
      const parentPath = lastSlash <= 0 ? '/' : row.path.substring(0, lastSlash);
      const name = row.path.substring(lastSlash + 1);
      const parent = nodeMap[parentPath] || root;
      let node;
      if (row.type === 'dir') {
        node = new Folder();
        nodeMap[row.path] = node;
      } else {
        node = new File(row.content || '');
      }
      node.mtime = row.mtime || node.mtime;
      node.mode = row.mode || node.mode;
      node.uid = row.uid || 0; node.gid = row.gid || 0;
      parent.addChild(name, node);
    });
    return root;
  }

  function mergeStats(node, isDir) {
    const mtime = node.mtime || Date.now();
    const size = isDir ? 4096 : (node.content ? node.content.length : 0);
    const mode = (typeof node.mode === 'number') ? node.mode : (isDir ? 16877 : 33188);
    return {
      dev: 0, ino: 0, mode: mode, nlink: 1,
      uid: node.uid || 0, gid: node.gid || 0, rdev: 0, size: size, blksize: 4096,
      blocks: Math.ceil(size / 512),
      atimeMs: mtime, mtimeMs: mtime, ctimeMs: mtime, birthtimeMs: mtime,
      atime: new Date(mtime), mtime: new Date(mtime),
      ctime: new Date(mtime), birthtime: new Date(mtime),
      isFile: function() { return !isDir; },
      isDirectory: function() { return isDir; },
      isBlockDevice: function() { return false; },
      isCharacterDevice: function() { return false; },
      isSymbolicLink: function() { return false; },
      isFIFO: function() { return false; },
      isSocket: function() { return false; }
    };
  }

  // ---------- ENVIRONMENT CLASS ----------
  class Environment {
    constructor() {
      this._detect();
      this._format = 'json';
    }

    _detect() {
      this.isNode = typeof process !== 'undefined' && 
                    process.versions && 
                    !!process.versions.node;
      this.isBrowser = typeof window !== 'undefined' && 
                       typeof window.document !== 'undefined';
      this.isWorker = typeof self !== 'undefined' && 
                      typeof self.postMessage === 'function' &&
                      !this.isBrowser;
      this.isDeno = typeof Deno !== 'undefined';
      this.isBun = typeof Bun !== 'undefined';
      this.isBrowser = this.isBrowser || (!this.isNode && !this.isDeno && !this.isBun);
      this.hasFileSystemAccess = this.isBrowser && 
                                 typeof window.showOpenFilePicker === 'function' &&
                                 typeof window.showSaveFilePicker === 'function';
      this.supportsStreams = typeof ReadableStream !== 'undefined';
    }

    readFile(source, thresholdKB) {
      thresholdKB = thresholdKB || 1024;
      const self = this;
      
      return new Promise((resolve, reject) => {
        if (self.isNode) {
          const fs = require('fs');
          
          fs.stat(source, (err, stats) => {
            if (err) { reject(err); return; }
            
            const sizeKB = stats.size / 1024;
            
            if (sizeKB > thresholdKB) {
              // Large file - stream it
              const chunks = [];
              const stream = fs.createReadStream(source);
              stream.on('data', chunk => chunks.push(chunk));
              stream.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve(new Uint8Array(buffer));
              });
              stream.on('error', reject);
            } else {
              // Small file - read directly
              fs.readFile(source, (err, data) => {
                if (err) { reject(err); return; }
                resolve(new Uint8Array(data));
              });
            }
          });
        } else if (self.isBrowser && source.getFile) {
          source.getFile().then(file => {
            const sizeKB = file.size / 1024;
            
            if (sizeKB > thresholdKB) {
              const stream = file.stream();
              const reader = stream.getReader();
              const chunks = [];
              
              function read() {
                reader.read().then(result => {
                  if (result.done) {
                    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                    const resultBytes = new Uint8Array(totalLength);
                    let offset = 0;
                    for (let i = 0; i < chunks.length; i++) {
                      resultBytes.set(chunks[i], offset);
                      offset += chunks[i].length;
                    }
                    resolve(resultBytes);
                    return;
                  }
                  chunks.push(result.value);
                  read();
                }).catch(reject);
              }
              read();
            } else {
              file.arrayBuffer().then(buffer => {
                resolve(new Uint8Array(buffer));
              }).catch(reject);
            }
          }).catch(reject);
        } else if (self.isBrowser && typeof fetch !== 'undefined') {
          fetch(source).then(res => {
            if (!res.ok) throw new Error('Failed to fetch: ' + res.status);
            const contentLength = res.headers.get('content-length');
            if (contentLength && (parseInt(contentLength) / 1024) > thresholdKB) {
              const reader = res.body.getReader();
              const chunks = [];
              
              function read() {
                reader.read().then(result => {
                  if (result.done) {
                    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                    const resultBytes = new Uint8Array(totalLength);
                    let offset = 0;
                    for (let i = 0; i < chunks.length; i++) {
                      resultBytes.set(chunks[i], offset);
                      offset += chunks[i].length;
                    }
                    resolve(resultBytes);
                    return;
                  }
                  chunks.push(result.value);
                  read();
                }).catch(reject);
              }
              read();
            } else {
              return res.arrayBuffer().then(buffer => {
                resolve(new Uint8Array(buffer));
              }).catch(reject);
            }
          }).catch(reject);
        } else {
          reject(new Error('No readFile implementation for this environment'));
        }
      });
    }

    writeFile(source, data) {
      const self = this;
      return new Promise((resolve, reject) => {
        const bytes = isUint8Array(data) ? data : toUint8Array(String(data));
        
        if (self.isNode) {
          const fs = require('fs');
          fs.writeFile(source, Buffer.from(bytes), err => {
            if (err) { reject(err); return; }
            resolve();
          });
        } else if (self.isBrowser && source.createWritable) {
          source.createWritable().then(writable => {
            writable.write(bytes);
            writable.close();
            resolve();
          }).catch(reject);
        } else if (self.isBrowser && typeof Blob !== 'undefined') {
          const blob = new Blob([bytes], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'vfs.' + (self._format || 'json');
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          resolve();
        } else {
          reject(new Error('No writeFile implementation for this environment'));
        }
      });
    }

    openFilePicker(format) {
      const self = this;
      return new Promise((resolve, reject) => {
        if (!self.isBrowser) {
          reject(new Error('File picker only available in browser'));
          return;
        }
        if (!self.hasFileSystemAccess) {
          reject(new Error('File System Access API not supported'));
          return;
        }
        const ext = format === 'xml' ? '.xml' : '.json';
        const mime = format === 'xml' ? 'text/xml' : 'application/json';
        window.showOpenFilePicker({
          types: [{ description: 'VFS Storage', accept: { [mime]: [ext] } }],
          multiple: false
        }).then(handles => resolve(handles[0])).catch(reject);
      });
    }

    saveFilePicker(format) {
      const self = this;
      return new Promise((resolve, reject) => {
        if (!self.isBrowser) {
          reject(new Error('File picker only available in browser'));
          return;
        }
        if (!self.hasFileSystemAccess) {
          reject(new Error('File System Access API not supported'));
          return;
        }
        const ext = format === 'xml' ? '.xml' : '.json';
        const mime = format === 'xml' ? 'text/xml' : 'application/json';
        window.showSaveFilePicker({
          types: [{ description: 'VFS Storage', accept: { [mime]: [ext] } }]
        }).then(resolve).catch(reject);
      });
    }
  }

  // ---------- FILE CLASS (extends BaseClassX) ----------
  class File extends BaseClassX {
    static _schema = {
      type: 'file',
      properties: {
        content: { type: 'object', default: null },
        mtime: { type: 'number', default: 0 },
        size: { type: 'number', default: 0 },
        mode: { type: 'number', default: 33188 },
        uid: { type: 'number', default: 0 },
        gid: { type: 'number', default: 0 }
      }
    };
    constructor(content) {
      super({
        type: 'file',
        name: 'File',
        schema: {
          'content': 'object',
          'mtime': 'number',
          'size': 'number',
          'mode': 'number',
          'uid': 'number',
          'gid': 'number'
        }
      });
      this.type = 'file';
      this.content = isUint8Array(content) ? content : toUint8Array(String(content));
      this.mtime = Date.now();
      this.size = this.content.length;
      this.mode = 33188;
      this.uid = 0;
      this.gid = 0;
    }

    isFile() { return true; }
    isDirectory() { return false; }
    getContent() { return this.content; }
    getContentString() { return toString(this.content); }
    
    setContent(content) {
      this.content = isUint8Array(content) ? content : toUint8Array(String(content));
      this.mtime = Date.now();
      this.size = this.content.length;
    }
    
    getSize() { return this.content.length; }
    
    toJSON() {
      return { 
        type: 'file', 
        content: toString(this.content),
        id: this.id,
        mtime: this.mtime
      };
    }
  }

  // ---------- FOLDER CLASS (extends BaseClassX) ----------
  class Folder extends BaseClassX {
    static _schema = {
      type: 'dir',
      properties: {
        mtime: { type: 'number', default: 0 },
        childCount: { type: 'number', default: 0 },
        mode: { type: 'number', default: 16877 },
        uid: { type: 'number', default: 0 },
        gid: { type: 'number', default: 0 }
      }
    };
    constructor() {
      super({
        type: 'dir',
        name: 'Folder',
        schema: {
          'childCount': 'number',
          'mtime': 'number',
          'mode': 'number',
          'uid': 'number',
          'gid': 'number'
        }
      });
      this.type = 'dir';
      this.children = {};
      this.mtime = Date.now();
      this.childCount = 0;
      this.mode = 16877;
      this.uid = 0;
      this.gid = 0;
    }

    isFile() { return false; }
    isDirectory() { return true; }
    
    getChild(name) {
      return this.children[name] || null;
    }
    
    addChild(name, node) {
      this.children[name] = node;
      this.mtime = Date.now();
      this.childCount = Object.keys(this.children).length;
    }
    
    removeChild(name) {
      delete this.children[name];
      this.mtime = Date.now();
      this.childCount = Object.keys(this.children).length;
    }
    
    hasChild(name) {
      return !!this.children[name];
    }
    
    listChildren() {
      return Object.keys(this.children);
    }
    
    toJSON() {
      const result = { 
        type: 'dir', 
        children: {},
        id: this.id,
        mtime: this.mtime,
        childCount: Object.keys(this.children).length
      };
      for (const key in this.children) {
        result.children[key] = this.children[key].toJSON();
      }
      return result;
    }
  }

  // ---------- MOUNT CLASS ----------
  class Mount {
    constructor(options = {}) {
      this.format = options.format || 'json';
      this.source = options.source || null;
      this.backend = options.backend || 'picker'; // 'picker' | 'opfs' | 'idb' | 'localstorage' | 'cache'
      this.key = options.key || 'filefsx-root';
      // Real POSIX-style mount metadata \u2014 the same convention File/Folder already use for
      // node-level mode/uid/gid, applied at the mount level so FinderDialog can show a real
      // display name per mount and enforce/reflect real ownership on the mount as a whole
      // instead of hardcoding mount labels like "Home"/"IDB"/"OPFS" in the UI.
      this.name = options.name || this.key;
      this.mode = options.mode !== undefined ? options.mode : 0o755;
      this.uid = options.uid !== undefined ? options.uid : 0;
      this.gid = options.gid !== undefined ? options.gid : 0;
      this.root = new Folder();
      this.env = new Environment();
      this.env._format = this.format;
      this._dirty = false;
      this._loaded = false;
      this._autoSave = options.autoSave !== undefined ? options.autoSave : true;
      this._nodeCount = 0;
      this._maxNodes = options.maxNodes || 1000000;
      this._thresholdKB = options.thresholdKB || 1024;
    }

    // ---------- Pluggable storage backends: OPFS, IndexedDB, localStorage ----------
    // Each satisfies the same read(key)->Promise<string|null> / write(key,data)->Promise<void>
    // contract regardless of what actually backs it (Interface Polymorphism over storage).
    _idbOpen() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('FileFsX', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('mounts'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    _idbGet(key) {
      return this._idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('mounts', 'readonly');
        const req = tx.objectStore('mounts').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }));
    }
    _idbPut(key, value) {
      return this._idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('mounts', 'readwrite');
        tx.objectStore('mounts').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }));
    }
    _backendRead() {
      const self = this;
      if (this.backend === 'opfs') {
        return navigator.storage.getDirectory()
          .then(root => root.getFileHandle(self.key + '.json', { create: false }))
          .then(handle => handle.getFile()).then(file => file.text())
          .catch(() => null);
      }
      if (this.backend === 'idb') return this._idbGet(this.key).catch(() => null);
      if (this.backend === 'localstorage') return Promise.resolve(localStorage.getItem(this.key));
      if (this.backend === 'cache') {
        // The Cache API stores Response objects keyed by Request, not raw
        // strings — a synthetic same-origin request URL under the mount's
        // own cache (named after this.key, matching BootDeviceScan's
        // meshui-vol-<id> convention) is the FileFsX 'file'.
        return caches.open(self.key)
          .then(cache => cache.match('/mount.json'))
          .then(res => res ? res.text() : null)
          .catch(() => null);
      }
      return Promise.resolve(null);
    }
    _backendWrite(data) {
      const self = this;
      if (this.backend === 'opfs') {
        return navigator.storage.getDirectory()
          .then(root => root.getFileHandle(self.key + '.json', { create: true }))
          .then(handle => handle.createWritable())
          .then(writable => writable.write(data).then(() => writable.close()));
      }
      if (this.backend === 'idb') return this._idbPut(this.key, data);
      if (this.backend === 'localstorage') { localStorage.setItem(this.key, data); return Promise.resolve(); }
      if (this.backend === 'cache') {
        return caches.open(self.key)
          .then(cache => cache.put('/mount.json', new Response(data, { headers: { 'Content-Type': 'application/json' } })));
      }
      return Promise.resolve();
    }

    // Binary variants of the same read/write contract, used only by the sqlite
    // format (a real .sqlite file is bytes, not a JSON/XML string) — the
    // json/xml paths above are untouched, so this adds sqlite without any risk
    // of regressing existing mounts.
    _backendReadBinary() {
      const self = this;
      if (this.backend === 'opfs') {
        return navigator.storage.getDirectory()
          .then(root => root.getFileHandle(self.key + '.sqlite', { create: false }))
          .then(handle => handle.getFile()).then(file => file.arrayBuffer()).then(buf => new Uint8Array(buf))
          .catch(() => null);
      }
      if (this.backend === 'idb') return this._idbGet(this.key).then(v => v || null).catch(() => null);
      if (this.backend === 'localstorage') {
        const b64 = localStorage.getItem(this.key);
        return Promise.resolve(b64 ? base64ToBytes(b64) : null);
      }
      if (this.backend === 'cache') {
        return caches.open(self.key)
          .then(cache => cache.match('/mount.sqlite'))
          .then(res => res ? res.arrayBuffer().then(buf => new Uint8Array(buf)) : null)
          .catch(() => null);
      }
      return Promise.resolve(null);
    }
    _backendWriteBinary(bytes) {
      const self = this;
      if (this.backend === 'opfs') {
        return navigator.storage.getDirectory()
          .then(root => root.getFileHandle(self.key + '.sqlite', { create: true }))
          .then(handle => handle.createWritable())
          .then(writable => writable.write(bytes).then(() => writable.close()));
      }
      if (this.backend === 'idb') return this._idbPut(this.key, bytes);
      if (this.backend === 'localstorage') { localStorage.setItem(this.key, bytesToBase64(bytes)); return Promise.resolve(); }
      if (this.backend === 'cache') {
        return caches.open(self.key)
          .then(cache => cache.put('/mount.sqlite', new Response(bytes.buffer, { headers: { 'Content-Type': 'application/x-sqlite3' } })));
      }
      return Promise.resolve();
    }

    _saveSqlite() {
      const self = this;
      return loadSqlJs().then(SQL => {
        const db = new SQL.Database();
        db.run('CREATE TABLE nodes (path TEXT PRIMARY KEY, type TEXT, content TEXT, mtime INTEGER, mode INTEGER, uid INTEGER, gid INTEGER)');
        const rows = flattenTreeToRows(self.root);
        const stmt = db.prepare('INSERT INTO nodes VALUES (?,?,?,?,?,?,?)');
        rows.forEach(r => stmt.run([r.path, r.type, r.content, r.mtime || 0, r.mode || 0, r.uid || 0, r.gid || 0]));
        stmt.free();
        const bytes = db.export();
        db.close();
        return bytes;
      });
    }
    _loadSqlite(bytes) {
      const self = this;
      if (!bytes || bytes.length === 0) { self.root = new Folder(); return Promise.resolve(); }
      return loadSqlJs().then(SQL => {
        const db = new SQL.Database(bytes);
        const res = db.exec('SELECT path, type, content, mtime, mode, uid, gid FROM nodes');
        db.close();
        if (!res.length) { self.root = new Folder(); return; }
        const rows = res[0].values.map(v => ({ path: v[0], type: v[1], content: v[2], mtime: v[3], mode: v[4], uid: v[5], gid: v[6] }));
        self.root = rebuildTreeFromRows(rows);
      });
    }

    load() {
      const self = this;
      if (this.format === 'sqlite') {
        const read = (this.backend !== 'picker') ? this._backendReadBinary() : this.env.readFile(this.source, this._thresholdKB);
        return read.then(bytes => self._loadSqlite(bytes)).then(() => { self._loaded = true; self._dirty = false; return self; });
      }
      if (this.backend !== 'picker') {
        return this._backendRead().then(data => {
          if (data) {
            const parsed = self.format === 'json' ? JSON.parse(data) : null;
            if (parsed) self.root = self._fromJSON(parsed);
            else if (data && self.format !== 'json') self._deserializeXML(data);
          }
          self._loaded = true;
          self._dirty = false;
          return self;
        });
      }
      return this.env.readFile(this.source, this._thresholdKB).then(bytes => {
        const data = toString(bytes);
        if (self.format === 'json') {
          const parsed = JSON.parse(data);
          self.root = self._fromJSON(parsed);
        } else {
          self._deserializeXML(data);
        }
        self._loaded = true;
        self._dirty = false;
        return self;
      });
    }

    save() {
      const self = this;
      if (!this._dirty) return Promise.resolve();

      if (this.format === 'sqlite') {
        return this._saveSqlite().then(bytes => {
          if (this.backend !== 'picker') return this._backendWriteBinary(bytes).then(() => { self._dirty = false; return self; });
          if (!this.source) {
            if (this.env.isBrowser && this.env.hasFileSystemAccess) {
              return this.env.saveFilePicker(this.format).then(handle => { self.source = handle; return self.env.writeFile(self.source, bytes); }).then(() => { self._dirty = false; return self; });
            }
            return Promise.reject(new Error('No source specified for save'));
          }
          return this.env.writeFile(this.source, bytes).then(() => { self._dirty = false; return self; });
        });
      }

      if (this.backend !== 'picker') {
        const data = this._serialize();
        return this._backendWrite(data).then(() => { self._dirty = false; return self; });
      }

      if (!this.source) {
        if (this.env.isBrowser && this.env.hasFileSystemAccess) {
          return this.env.saveFilePicker(this.format).then(handle => {
            self.source = handle;
            const data = self._serialize();
            return self.env.writeFile(self.source, data);
          });
        } else {
          return Promise.reject(new Error('No source specified for save'));
        }
      }
      
      const data = this._serialize();
      return this.env.writeFile(this.source, data).then(() => {
        self._dirty = false;
        return self;
      });
    }

    _getNode(path, createParents) {
      const normalized = Path.normalize(path);
      if (normalized === '' || normalized === '/') return this.root;
      
      const parts = normalized.split('/');
      let current = this.root;
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '') continue;
        
        if (!current.hasChild(part)) {
          if (!createParents) return null;
          const newFolder = new Folder();
          current.addChild(part, newFolder);
          this._dirty = true;
          this._nodeCount++;
          current = newFolder;
        } else {
          current = current.getChild(part);
          if (!current.isDirectory() && i < parts.length - 1) {
            throw new Error('ENOTDIR: "' + path + '" is not a directory');
          }
        }
      }
      return current;
    }

    _getParentNode(path) {
      const parentDir = Path.dirname(path);
      return this._getNode(parentDir);
    }

    _ensurePath(path) {
      const normalized = Path.normalize(path);
      if (normalized === '' || normalized === '/') return this.root;
      return this._getNode(normalized, true);
    }

    _checkPath(path) {
      const node = this._getNode(path);
      if (!node) throw new Error('ENOENT: "' + path + '" not found');
      return node;
    }

    _serialize() {
      if (this.format === 'json') {
        return JSON.stringify(this.root.toJSON(), null, 2);
      } else {
        return this._toXML(this.root, '');
      }
    }

    _toXML(node, path) {
      const self = this;
      const result = [];
      
      if (node.isDirectory()) {
        const children = node.listChildren();
        for (let i = 0; i < children.length; i++) {
          const name = children[i];
          const child = node.getChild(name);
          const fullPath = path + '/' + name;
          if (child.isDirectory()) {
            result.push('<entry path="' + fullPath + '" type="dir"/>');
            result.push(self._toXML(child, fullPath));
          } else {
            const content = child.getContentString();
            const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            result.push('<entry path="' + fullPath + '" type="file">' + escaped + '</entry>');
          }
        }
      }
      return result.join('\n  ');
    }

    _deserializeXML(raw) {
      if (typeof DOMParser === 'undefined') {
        throw new Error('XML parsing requires DOMParser');
      }
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/xml');
      this.root = new Folder();
      const entries = doc.querySelectorAll('entry');
      
      for (let i = 0; i < entries.length; i++) {
        const el = entries[i];
        const pathAttr = el.getAttribute('path');
        const type = el.getAttribute('type');
        const content = el.textContent || '';
        const normalized = Path.normalize(pathAttr);
        if (normalized === '' || normalized === '/') continue;
        
        const parts = normalized.split('/');
        let current = this.root;
        for (let j = 0; j < parts.length; j++) {
          const name = parts[j];
          if (name === '') continue;
          const isLast = (j === parts.length - 1);
          if (!current.hasChild(name)) {
            if (isLast) {
              const node = type === 'dir' ? new Folder() : new File(content);
              current.addChild(name, node);
              this._nodeCount++;
            } else {
              const newFolder = new Folder();
              current.addChild(name, newFolder);
              this._nodeCount++;
            }
          }
          current = current.getChild(name);
        }
      }
    }

    _fromJSON(data) {
      if (data.type === 'file') {
        this._nodeCount++;
        return new File(data.content);
      } else {
        const folder = new Folder();
        if (data.children) {
          for (const key in data.children) {
            folder.addChild(key, this._fromJSON(data.children[key]));
          }
        }
        this._nodeCount++;
        return folder;
      }
    }

    _saveIfDirty() {
      if (this._autoSave && this._dirty) {
        return this.save();
      }
      return Promise.resolve();
    }

    // ---------- FS API METHODS ----------
    readFile(path, options) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const node = self._checkPath(path);
          if (node.isDirectory()) {
            throw new Error('EISDIR: "' + path + '" is a directory');
          }
          const encoding = options && (options.encoding || options);
          const content = node.getContent();
          const result = encoding ? node.getContentString() : content;
          resolve(result);
        } catch (e) { reject(e); }
      });
    }

    writeFile(path, data, options) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const content = isUint8Array(data) ? data : toUint8Array(String(data));
          const dir = Path.dirname(path);
          const parent = (dir === '/' || dir === '') ? self.root : self._ensurePath(dir);
          const name = Path.basename(path);
          if (name === '') {
            throw new Error('EINVAL: Invalid path "' + path + '"');
          }
          const existing = parent.getChild(name);
          if (existing && existing.isDirectory()) {
            throw new Error('EISDIR: "' + path + '" is a directory');
          }
          const file = new File(content);
          parent.addChild(name, file);
          self._dirty = true;
          self._nodeCount++;
          self._saveIfDirty().then(resolve).catch(reject);
        } catch (e) { reject(e); }
      });
    }

    appendFile(path, data, options) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const node = self._getNode(path);
          const existing = node && node.isFile() ? node.getContentString() : '';
          const appendData = isUint8Array(data) ? toString(data) : String(data);
          self.writeFile(path, existing + appendData, options).then(resolve).catch(reject);
        } catch (e) { reject(e); }
      });
    }

    copyFile(src, dest, mode) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const node = self._checkPath(src);
          if (node.isDirectory()) {
            throw new Error('EISDIR: "' + src + '" is a directory');
          }
          const destDir = Path.dirname(dest);
          const parent = (destDir === '/' || destDir === '') ? self.root : self._ensurePath(destDir);
          const name = Path.basename(dest);
          if (name === '') {
            throw new Error('EINVAL: Invalid dest path "' + dest + '"');
          }
          const copy = new File(node.getContent());
          parent.addChild(name, copy);
          self._dirty = true;
          self._nodeCount++;
          self._saveIfDirty().then(resolve).catch(reject);
        } catch (e) { reject(e); }
      });
    }

    mkdir(path, options) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const recursive = options && options.recursive;
          const normalized = Path.normalize(path);
          if (normalized === '' || normalized === '/') { resolve(); return; }
          
          const parts = normalized.split('/');
          let current = self.root;
          let made = false;
          let currentPath = '';
          
          for (let i = 0; i < parts.length; i++) {
            const name = parts[i];
            if (name === '') continue;
            currentPath = currentPath ? currentPath + '/' + name : name;
            
            if (!current.hasChild(name)) {
              if (!recursive && i < parts.length - 1) {
                throw new Error('ENOENT: parent directory "' + Path.dirname(currentPath) + '" does not exist');
              }
              const newFolder = new Folder();
              current.addChild(name, newFolder);
              self._dirty = true;
              self._nodeCount++;
              made = true;
              current = newFolder;
            } else {
              current = current.getChild(name);
              if (!current.isDirectory()) {
                throw new Error('ENOTDIR: "' + currentPath + '" is not a directory');
              }
            }
          }
          
          if (made) {
            self._saveIfDirty().then(resolve).catch(reject);
          } else {
            resolve();
          }
        } catch (e) { reject(e); }
      });
    }

    readdir(path, options) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const node = self._checkPath(path);
          if (!node.isDirectory()) {
            throw new Error('ENOTDIR: "' + path + '" is not a directory');
          }
          const entries = node.listChildren();
          const withFileTypes = options && options.withFileTypes;
          
          if (withFileTypes) {
            const result = entries.map(name => {
              const child = node.getChild(name);
              return {
                name: name,
                isFile: () => child.isFile(),
                isDirectory: () => child.isDirectory(),
                isBlockDevice: () => false,
                isCharacterDevice: () => false,
                isSymbolicLink: () => false,
                isFIFO: () => false,
                isSocket: () => false
              };
            });
            resolve(result);
          } else {
            resolve(entries);
          }
        } catch (e) { reject(e); }
      });
    }

    stat(path) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const node = self._checkPath(path);
          resolve(mergeStats(node, node.isDirectory()));
        } catch (e) { reject(e); }
      });
    }

    lstat(path) {
      return this.stat(path);
    }

    access(path, mode) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const node = self._getNode(path);
          if (!node) {
            reject(new Error('ENOENT: "' + path + '" not found'));
            return;
          }
          resolve();
        } catch (e) { reject(e); }
      });
    }

    unlink(path) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const parentDir = Path.dirname(path);
          const parent = (parentDir === '/' || parentDir === '') ? self.root : self._getNode(parentDir);
          const name = Path.basename(path);
          if (!parent || !parent.hasChild(name)) {
            throw new Error('ENOENT: "' + path + '" not found');
          }
          const node = parent.getChild(name);
          if (node.isDirectory()) {
            throw new Error('EISDIR: "' + path + '" is a directory');
          }
          parent.removeChild(name);
          self._dirty = true;
          self._nodeCount--;
          self._saveIfDirty().then(resolve).catch(reject);
        } catch (e) { reject(e); }
      });
    }

    rmdir(path, options) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const parentDir = Path.dirname(path);
          const parent = (parentDir === '/' || parentDir === '') ? self.root : self._getNode(parentDir);
          const name = Path.basename(path);
          if (!parent || !parent.hasChild(name)) {
            throw new Error('ENOENT: "' + path + '" not found');
          }
          const node = parent.getChild(name);
          if (!node.isDirectory()) {
            throw new Error('ENOTDIR: "' + path + '" is not a directory');
          }
          const recursive = options && options.recursive;
          if (!recursive && node.listChildren().length > 0) {
            throw new Error('ENOTEMPTY: "' + path + '" not empty');
          }
          if (recursive) {
            this._rmdirRecursive(node);
          }
          parent.removeChild(name);
          self._dirty = true;
          self._nodeCount--;
          self._saveIfDirty().then(resolve).catch(reject);
        } catch (e) { reject(e); }
      });
    }

    _rmdirRecursive(folder) {
      const children = folder.listChildren();
      for (let i = 0; i < children.length; i++) {
        const child = folder.getChild(children[i]);
        if (child.isDirectory()) {
          this._rmdirRecursive(child);
        }
        folder.removeChild(children[i]);
        this._nodeCount--;
      }
    }

    rename(oldPath, newPath) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const oldParentDir = Path.dirname(oldPath);
          const oldParent = (oldParentDir === '/' || oldParentDir === '') ? self.root : self._getNode(oldParentDir);
          const oldName = Path.basename(oldPath);
          if (!oldParent || !oldParent.hasChild(oldName)) {
            throw new Error('ENOENT: "' + oldPath + '" not found');
          }
          
          const node = oldParent.getChild(oldName);
          oldParent.removeChild(oldName);
          
          const newParentDir = Path.dirname(newPath);
          const newParent = (newParentDir === '/' || newParentDir === '') ? self.root : self._ensurePath(newParentDir);
          const newName = Path.basename(newPath);
          if (newName === '') {
            throw new Error('EINVAL: Invalid new path "' + newPath + '"');
          }
          newParent.addChild(newName, node);
          
          self._dirty = true;
          self._saveIfDirty().then(resolve).catch(reject);
        } catch (e) { reject(e); }
      });
    }

    chmod(path, mode) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const node = self._getNode(path);
          if (!node) { reject(new Error('ENOENT: "' + path + '" not found')); return; }
          // Permission bits only (low 12 bits); preserve the file-type bits already on the node.
          const typeBits = (typeof node.mode === 'number' ? node.mode : (node.isDirectory() ? 16877 : 33188)) & ~0o7777;
          node.mode = typeBits | (mode & 0o7777);
          self._dirty = true;
          self._saveIfDirty().then(() => resolve()).catch(() => resolve());
        } catch (e) { reject(e); }
      });
    }
    chown(path, uid, gid) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          const node = self._getNode(path);
          if (!node) { reject(new Error('ENOENT: "' + path + '" not found')); return; }
          if (uid !== undefined && uid !== -1 && uid !== null) node.uid = uid;
          if (gid !== undefined && gid !== -1 && gid !== null) node.gid = gid;
          self._dirty = true;
          self._saveIfDirty().then(() => resolve()).catch(() => resolve());
        } catch (e) { reject(e); }
      });
    }
    utimes(path, atime, mtime) { return Promise.resolve(); }
    
    realpath(path, options) {
      const self = this;
      return new Promise((resolve, reject) => {
        try {
          self._checkPath(path);
          resolve(Path.normalize(path));
        } catch (e) { reject(e); }
      });
    }
    
    mkdtemp(prefix, options) {
      return Promise.reject(new Error('ENOTSUP: mkdtemp not supported'));
    }
    link(existingPath, newPath) {
      return Promise.reject(new Error('ENOTSUP: link not supported'));
    }
    symlink(target, path, type) {
      return Promise.reject(new Error('ENOTSUP: symlink not supported'));
    }
    readlink(path, options) {
      return Promise.reject(new Error('ENOTSUP: readlink not supported'));
    }
  }

  // ---------- FILEFS CLASS ----------
  class FileFS {
    constructor(options = {}) {
      this.env = new Environment();
      this.mount = new Mount({
        format: options.format || 'json',
        source: options.source || null,
        backend: options.backend || 'picker',
        key: options.key || 'filefsx-root',
        name: options.name,
        mode: options.mode,
        uid: options.uid,
        gid: options.gid,
        autoSave: options.autoSave !== undefined ? options.autoSave : true,
        maxNodes: options.maxNodes || 1000000,
        thresholdKB: options.thresholdKB || 1024
      });

      if (this.mount.source || this.mount.backend !== 'picker') {
        const self = this;
        this._loadPromise = this.mount.load().then(() => self).catch(() => self);
      } else {
        this._loadPromise = Promise.resolve(this);
      }
    }

    static open(options = {}) {
      const env = new Environment();
      
      if (env.isNode && !options.source) {
        return Promise.reject(new Error('Node.js requires a source file path'));
      }
      
      if (env.isBrowser && !options.source) {
        if (!env.hasFileSystemAccess) {
          return Promise.reject(new Error('File System Access API not supported'));
        }
        const format = options.format || 'json';
        const ext = format === 'xml' ? '.xml' : '.json';
        const mime = format === 'xml' ? 'text/xml' : 'application/json';
        
        return window.showOpenFilePicker({
          types: [{ description: 'VFS Storage', accept: { [mime]: [ext] } }],
          multiple: false
        }).then(handles => {
          options.source = handles[0];
          const fs = new FileFS(options);
          return fs._loadPromise;
        });
      }
      
      const fs = new FileFS(options);
      return fs._loadPromise;
    }

    static saveAs(options = {}) {
      const env = new Environment();
      if (!env.isBrowser) {
        return Promise.reject(new Error('saveAs only available in browser'));
      }
      if (!env.hasFileSystemAccess) {
        return Promise.reject(new Error('File System Access API not supported'));
      }
      const format = options.format || 'json';
      const ext = format === 'xml' ? '.xml' : '.json';
      const mime = format === 'xml' ? 'text/xml' : 'application/json';
      
      return window.showSaveFilePicker({
        types: [{ description: 'VFS Storage', accept: { [mime]: [ext] } }]
      }).then(handle => {
        options.source = handle;
        const fs = new FileFS(options);
        return fs._loadPromise;
      });
    }

    static create(options = {}) {
      const fs = new FileFS(options);
      return fs._loadPromise.then(() => fs);
    }

    static getEnvironment() {
      const env = new Environment();
      return {
        isNode: env.isNode,
        isBrowser: env.isBrowser,
        isWorker: env.isWorker,
        isDeno: env.isDeno,
        isBun: env.isBun,
        hasFileSystemAccess: env.hasFileSystemAccess,
        supportsStreams: env.supportsStreams
      };
    }

    // ---------- json <-> sqlite conversion (backward compatibility) ----------
    // Existing json/xml mounts aren't stranded when sqlite becomes an option —
    // either format can be converted to the other at any time.
    static jsonToSqlite(jsonTree) {
      const tempMount = new Mount({ format: 'json' });
      tempMount.root = tempMount._fromJSON(jsonTree);
      return tempMount._saveSqlite();
    }
    static sqliteToJson(bytes) {
      const tempMount = new Mount({ format: 'sqlite' });
      return tempMount._loadSqlite(bytes).then(() => tempMount.root.toJSON());
    }

    // POSIX path utilities
    static normalize(p) { return Path.normalize(p); }
    static dirname(p) { return Path.dirname(p); }
    static basename(p) { return Path.basename(p); }
    static join(...parts) { return Path.join(...parts); }
    static resolve(from, to) { return Path.resolve(from, to); }
    static isAbsolute(p) { return Path.isAbsolute(p); }
    static relative(from, to) { return Path.relative(from, to); }

    // Instance methods
    // Real Mount metadata accessor \u2014 name/POSIX mode/uid/gid \u2014 so consumers (FinderDialog)
    // read the mount's actual declared identity instead of hardcoding display labels per backend.
    mnt() { return { name: this.mount.name, backend: this.mount.backend, key: this.mount.key, mode: this.mount.mode, uid: this.mount.uid, gid: this.mount.gid }; }
    readFile(path, options) { return this.mount.readFile(path, options); }
    writeFile(path, data, options) { return this.mount.writeFile(path, data, options); }
    appendFile(path, data, options) { return this.mount.appendFile(path, data, options); }
    copyFile(src, dest, mode) { return this.mount.copyFile(src, dest, mode); }
    mkdir(path, options) { return this.mount.mkdir(path, options); }
    readdir(path, options) { return this.mount.readdir(path, options); }
    stat(path) { return this.mount.stat(path); }
    lstat(path) { return this.mount.lstat(path); }
    access(path, mode) { return this.mount.access(path, mode); }
    unlink(path) { return this.mount.unlink(path); }
    rmdir(path, options) { return this.mount.rmdir(path, options); }
    rename(oldPath, newPath) { return this.mount.rename(oldPath, newPath); }
    chmod(path, mode) { return this.mount.chmod(path, mode); }
    chown(path, uid, gid) { return this.mount.chown(path, uid, gid); }
    utimes(path, atime, mtime) { return this.mount.utimes(path, atime, mtime); }
    realpath(path, options) { return this.mount.realpath(path, options); }
    mkdtemp(prefix, options) { return this.mount.mkdtemp(prefix, options); }
    link(existingPath, newPath) { return this.mount.link(existingPath, newPath); }
    symlink(target, path, type) { return this.mount.symlink(target, path, type); }
    readlink(path, options) { return this.mount.readlink(path, options); }
    save() { return this.mount.save(); }
    
    getEnvironment() {
      return {
        isNode: this.env.isNode,
        isBrowser: this.env.isBrowser,
        isWorker: this.env.isWorker,
        isDeno: this.env.isDeno,
        isBun: this.env.isBun,
        hasFileSystemAccess: this.env.hasFileSystemAccess,
        supportsStreams: this.env.supportsStreams
      };
    }
    
    normalize(p) { return Path.normalize(p); }
    dirname(p) { return Path.dirname(p); }
    basename(p) { return Path.basename(p); }
    join(...parts) { return Path.join(...parts); }
    resolve(from, to) { return Path.resolve(from, to); }
    isAbsolute(p) { return Path.isAbsolute(p); }
    relative(from, to) { return Path.relative(from, to); }
  }

  return FileFS;
}));