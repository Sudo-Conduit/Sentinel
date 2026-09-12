/**
 * @file MemoryMapArena.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Thin, correct wrapper over the ACTUAL compiled memorymap.wasm
 *   (getUUID/getPublicKey/getAuthScratch/authenticate/deauthenticate/read/
 *   write/getMemoryMap/getBase/slotBase/maxSlots/totalPages) -- a single,
 *   capability-gated flat f32 slot arena with one global identity/auth per
 *   WASM instance, not a multi-mailbox mm_create()/mm_kvStore() system.
 *
 *   This file replaces an earlier MemoryMapFS.js reference that documented
 *   a richer mm_* API (multiple named mailboxes, key-value store, chain
 *   linking, bitmap allocation) -- that API was never actually compiled
 *   into memorymap.wasm. Checked live: the .wasm's real exports are
 *   getUUID/getPublicKey/getAuthScratch/authenticate/deauthenticate/read/
 *   write/getMemoryMap/slotBase/slotByteOffset/maxSlots/totalPages/getBase/
 *   offsetA/B/C/BBatch/CBatch/pagesNeeded/pagesBatch -- confirmed against
 *   MemoryMap-Manager.dc.html, the demo that actually drives this binary
 *   correctly. This wrapper follows THAT proven pattern, not the
 *   aspirational one.
 *
 *   The module also imports the full wasi_snapshot_preview1 interface
 *   (compiled via a standard wasm32-wasi toolchain, not freestanding) --
 *   satisfied here the same way the demo does it: every WASI import gets a
 *   generic no-op stub built from WebAssembly.Module.imports() rather than
 *   a real WASI polyfill, since none of this module's actual behavior
 *   (identity, auth, slot read/write) exercises real filesystem/process
 *   syscalls.
 *
 *   packBytes()/unpackBytes() below use a LENGTH-HEADER-FIRST codec (byte
 *   count written as its own slot, then 3-bytes-per-slot data after it),
 *   not an in-band tail marker in the final group's low byte -- the
 *   original MemoryMap-Manager.dc.html's own header comments documented
 *   exactly why that in-band approach is fragile (a real byte that happens
 *   to look like the marker corrupts unpacking); the length-header
 *   convention already proven safe elsewhere in this codebase (Installer.js/
 *   FileFsBootAdapter.js) avoids that class of bug entirely.
 * @docs Kernel-Machine-Architecture.md
 * @tests test/MemoryMapArena.test.js
 */
(function(root, factory)
{
    if (typeof module === 'object' && module.exports)
    {
        module.exports = factory();
    }
    else
    {
        root.MemoryMapArena = factory();
    }
}(typeof self !== 'undefined' ? self : this, function()
{
    'use strict';

    var _isNode = typeof process !== 'undefined' && process.versions && !!process.versions.node;
    var _isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

    class MemoryMapArena
    {
        static name = 'MemoryMapArena';
        static author = 'Will Fobbs';
        static version = '1.0.0';
        static description = 'Capability-gated flat f32 slot arena over the real compiled memorymap.wasm (single global identity/auth, not multi-mailbox).';
        static docs = ['Kernel-Machine-Architecture.md'];
        static tests = ['test/MemoryMapArena.test.js'];

        constructor()
        {
            this._exports = null;
            this._memory = null;
            this._initialized = false;
        }

        /**
         * Load memorymap.wasm's raw bytes -- fs.readFile in Node, fetch in
         * Browser, matching this codebase's existing dual-runtime convention
         * (Environment.js, FileFsX.js).
         * @param {string} wasmPath - path/URL to memorymap.wasm
         * @returns {Promise<ArrayBuffer|Buffer>}
         */
        static loadWasm(wasmPath)
        {
            if (_isNode)
            {
                var fs = require('fs');
                return new Promise(function(resolve, reject)
                {
                    fs.readFile(wasmPath, function(err, buffer)
                    {
                        if (err)
                        {
                            reject(err);
                        }
                        else
                        {
                            resolve(buffer);
                        }
                    });
                });
            }
            if (_isBrowser)
            {
                return fetch(wasmPath).then(function(resp)
                {
                    return resp.arrayBuffer();
                });
            }
            return Promise.reject(new Error('MemoryMapArena.loadWasm: cannot load WASM in this environment'));
        }

        /**
         * Instantiate the module, satisfying every import (WASI or
         * otherwise) generically -- this module's real behavior never
         * exercises actual filesystem/process syscalls, so a real WASI
         * polyfill is unnecessary; a harmless stub per import is
         * sufficient and portable to both Node and Browser without an
         * extra dependency.
         * @param {ArrayBuffer|Buffer} wasmBinary
         * @returns {Promise<MemoryMapArena>} this, for chaining
         */
        async init(wasmBinary)
        {
            const mod = await WebAssembly.compile(wasmBinary);
            const importDescs = WebAssembly.Module.imports(mod);
            const importObj = {};
            importDescs.forEach((imp) =>
            {
                importObj[imp.module] = importObj[imp.module] || {};
                if (imp.kind === 'memory')
                {
                    const t = imp.type || {};
                    const initial = t.minimum != null ? t.minimum : 4096;
                    const maximum = t.maximum != null ? t.maximum : 4096;
                    importObj[imp.module][imp.name] = new WebAssembly.Memory(t.shared ? { initial, maximum, shared: true } : { initial, maximum });
                }
                else if (imp.kind === 'table')
                {
                    importObj[imp.module][imp.name] = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
                }
                else if (imp.kind === 'global')
                {
                    importObj[imp.module][imp.name] = new WebAssembly.Global({ value: 'i32', mutable: false }, 0);
                }
                else
                {
                    importObj[imp.module][imp.name] = () => 0;
                }
            });
            const result = await WebAssembly.instantiate(mod, importObj);
            this._exports = result.exports;
            this._memory = this._exports.memory || (importObj.env && importObj.env.memory);
            if (!this._memory)
            {
                throw new Error('MemoryMapArena.init: no linear memory found on the instantiated module');
            }
            this._initialized = true;
            return this;
        }

        _requireInit()
        {
            if (!this._initialized)
            {
                throw new Error('MemoryMapArena: init() must be called before use');
            }
        }

        _u8()
        {
            return new Uint8Array(this._memory.buffer);
        }

        /**
         * Write a 32-byte key into the module's PublicKey slot (host-side
         * provisioning -- the module compares against this on every
         * authenticate() call).
         * @param {Uint8Array|string} key - key bytes (a string is UTF-8
         *   encoded and padded/truncated to exactly 32 bytes)
         */
        provisionKey(key)
        {
            this._requireInit();
            const bytes = this._keyToBytes(key);
            this._u8().set(bytes, this._exports.getPublicKey());
        }

        /**
         * Authenticate: writes the given key into Scratch and calls the
         * module's constant-time comparison against PublicKey.
         * @param {Uint8Array|string} key
         * @returns {boolean} true if authenticate() returned success (1)
         */
        authenticate(key)
        {
            this._requireInit();
            const bytes = this._keyToBytes(key);
            this._u8().set(bytes, this._exports.getAuthScratch());
            return this._exports.authenticate() === 1;
        }

        /**
         * @returns {void}
         */
        deauthenticate()
        {
            this._requireInit();
            this._exports.deauthenticate();
        }

        _keyToBytes(key)
        {
            const raw = typeof key === 'string' ? key : this._bytesToString(key);
            const padded = raw.padEnd(32, '\0').slice(0, 32);
            return new TextEncoder().encode(padded);
        }

        _bytesToString(bytes)
        {
            let str = '';
            for (let i = 0; i < bytes.length; i++)
            {
                str += String.fromCharCode(bytes[i]);
            }
            return str;
        }

        /**
         * @param {number} slot
         * @returns {number} the f32 value stored at that slot
         */
        readSlot(slot)
        {
            this._requireInit();
            return this._exports.read(slot >>> 0);
        }

        /**
         * @param {number} slot
         * @param {number} value
         * @returns {number} result code (0 = success; nonzero typically
         *   means not authenticated)
         */
        writeSlot(slot, value)
        {
            this._requireInit();
            return this._exports.write(slot >>> 0, value);
        }

        /**
         * @returns {number} total number of usable f32 slots in the arena
         */
        maxSlots()
        {
            this._requireInit();
            return this._exports.maxSlots() >>> 0;
        }

        /**
         * Pack an arbitrary byte array into the arena starting at
         * startSlot: a length-header slot (the real byte count, an exact
         * integer well inside f32's 2^24 ceiling for any realistic
         * payload) followed by ceil(byteLength / 3) data slots, each
         * holding 3 real bytes as byte0*65536 + byte1*256 + byte2. See
         * this file's header comment for why a length header is used
         * instead of an in-band tail marker.
         * @param {number} startSlot
         * @param {Uint8Array} bytes
         * @returns {number} number of slots written (1 header + N data)
         * @throws {Error} if any writeSlot() call is rejected (e.g. not authenticated)
         */
        packBytes(startSlot, bytes)
        {
            this._requireInit();
            const headerRc = this.writeSlot(startSlot, bytes.length);
            if (headerRc !== 0)
            {
                throw new Error('MemoryMapArena.packBytes: writing the length header failed (rc=' + headerRc + ') -- authenticated?');
            }
            const groupCount = Math.ceil(bytes.length / 3);
            for (let g = 0; g < groupCount; g++)
            {
                const b0 = bytes[g * 3] || 0;
                const b1 = bytes[g * 3 + 1] || 0;
                const b2 = bytes[g * 3 + 2] || 0;
                const exact = b0 * 65536 + b1 * 256 + b2;
                const rc = this.writeSlot(startSlot + 1 + g, exact);
                if (rc !== 0)
                {
                    throw new Error('MemoryMapArena.packBytes: writing data group ' + g + ' failed (rc=' + rc + ')');
                }
            }
            return 1 + groupCount;
        }

        /**
         * Inverse of packBytes(): reads the length header at startSlot,
         * then reconstructs exactly that many bytes from the following
         * data slots.
         * @param {number} startSlot
         * @returns {Uint8Array} the reconstructed bytes
         */
        unpackBytes(startSlot)
        {
            this._requireInit();
            const byteLength = Math.round(this.readSlot(startSlot));
            if (!Number.isFinite(byteLength) || byteLength < 0)
            {
                throw new Error('MemoryMapArena.unpackBytes: invalid length header at slot ' + startSlot + ' (read ' + byteLength + ')');
            }
            const groupCount = Math.ceil(byteLength / 3);
            const out = new Uint8Array(groupCount * 3);
            for (let g = 0; g < groupCount; g++)
            {
                const exact = Math.round(this.readSlot(startSlot + 1 + g));
                out[g * 3] = Math.floor(exact / 65536) & 0xFF;
                out[g * 3 + 1] = Math.floor(exact / 256) & 0xFF;
                out[g * 3 + 2] = exact & 0xFF;
            }
            return out.subarray(0, byteLength);
        }
    }

    return MemoryMapArena;
}));
