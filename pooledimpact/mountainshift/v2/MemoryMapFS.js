/**
 * @file MemoryMapFS.js
 * @author Will Fobbs III
 * @version 1.0.0
 * @description Wrapper over the real compiled memorymap-mm.wasm -- the
 *   richer, multi-mailbox `mm_*` API (originator create/destroy/rotate/
 *   chain-link, client auth/readSlot/writeSlot/status, key-value store,
 *   bitmap-backed free-slot allocation, transaction/GC machinery) that an
 *   earlier D.1 pass (MSOS Cleanup Roadmap) could not find a matching
 *   binary for -- the memorymap.wasm then in the repo only exported a
 *   single-flat-arena API and was wrapped instead as MemoryMapArena.js.
 *
 *   This file and MemoryMapArena.js are deliberately independent, parallel
 *   NVRAM paths, not a replacement of one by the other: memorymap-mm.wasm
 *   is a different compiled binary (confirmed via WebAssembly.Module.
 *   exports(), not assumed) exporting a fundamentally different, richer
 *   shape -- named mailboxes with their own master/access keys, chain
 *   linking between mailboxes, a key-value layer, and bitmap-tracked slot
 *   allocation, versus MemoryMapArena's single global identity over one
 *   flat slot array. Registry.js's existing saveToArena()/loadFromArena()
 *   stay wired to MemoryMapArena; nothing here changes that.
 *
 *   env.memory import: the module declares memory as a SHARED import, so
 *   it must be instantiated with a real `WebAssembly.Memory({shared:true,
 *   ...})` -- an unshared Memory is not a valid substitute (the spec
 *   requires `maximum` whenever `shared` is true; omitting it throws
 *   unconditionally, independent of whether a caller ever touches
 *   SharedArrayBuffer/cross-origin-isolation concerns, which only matter
 *   for actually exposing the underlying buffer, not for constructing it).
 *
 *   Scratch region convention: there is no `mm_heap_alloc` export, so this
 *   wrapper has no safe way to claim WASM memory for the strings/out-params
 *   several `mm_*` calls need real pointers for (a JS string or TypedArray
 *   object coerces to 0/NaN at the WASM numeric-argument boundary and the
 *   C side reads a null pointer). A fixed scratch region is reserved right
 *   after the mailbox arena `mm_init` sized (`base + size`), inside the
 *   out-of-line heap quarter `mm_create`/`mm_writeSlot` never touch (their
 *   arena is capped at `mm_getSize()`) -- safe as long as nothing else
 *   claims it, which is why this is a convention enforced by this wrapper,
 *   not a real allocator.
 * @docs Kernel-Machine-Architecture.md
 * @tests test/MemoryMapFS.test.js
 */
(function(root, factory)
{
    if (typeof module === 'object' && module.exports)
    {
        module.exports = factory();
    }
    else
    {
        root.MemoryMapFS = factory();
    }
}(typeof self !== 'undefined' ? self : this, function()
{
    'use strict';

    var _isNode = typeof process !== 'undefined' && process.versions && !!process.versions.node;
    var _isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

    class MemoryMapFS
    {
        static name = 'MemoryMapFS';
        static author = 'Will Fobbs III';
        static version = '1.0.0';
        static description = 'Multi-mailbox mm_* API wrapper over the real compiled memorymap-mm.wasm (originator create/destroy/chain, client auth/read/write, key-value store, bitmap allocation).';
        static docs = ['Kernel-Machine-Architecture.md'];
        static tests = ['test/MemoryMapFS.test.js'];

        /**
         * @param {number} [sizeBytes=16777216] - bytes to request from
         *   mm_init() on init() (default 16 MB)
         */
        constructor(sizeBytes)
        {
            this._exports = null;
            this._memory = null;
            this._initialized = false;
            this._sizeBytes = sizeBytes || (16 * 1024 * 1024);
            this._baseAddress = null;
            this._totalSize = null;
            this._scratchAddress = null;
            this._scratchSize = 256;
        }

        /**
         * Load memorymap-mm.wasm's raw bytes -- fs.readFile in Node, fetch
         * in Browser, matching this codebase's existing dual-runtime
         * convention (Environment.js, MemoryMapArena.js, FileFsX.js).
         * @param {string} wasmPath - path/URL to memorymap-mm.wasm
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
            return Promise.reject(new Error('MemoryMapFS.loadWasm: cannot load WASM in this environment'));
        }

        /**
         * Instantiate the module and run mm_init(). The module's env.memory
         * import is SHARED -- see this file's header comment for why an
         * unshared Memory is not a valid substitute.
         * @param {ArrayBuffer|Buffer} wasmBinary
         * @param {WebAssembly.Memory} [sharedMemory] - reuse an existing
         *   shared memory instead of allocating a fresh one
         * @returns {Promise<MemoryMapFS>} this, for chaining
         * @throws {Error} if mm_init() itself reports failure
         */
        async init(wasmBinary, sharedMemory)
        {
            const mod = await WebAssembly.compile(wasmBinary);
            this._memory = sharedMemory || new WebAssembly.Memory({ shared: true, initial: 256, maximum: 4096 });
            const result = await WebAssembly.instantiate(mod, { env: { memory: this._memory } });
            this._exports = result.exports;

            const initResult = this._exports.mm_init(this._sizeBytes);
            if (initResult < 0)
            {
                throw new Error('MemoryMapFS.init: mm_init failed (rc=' + initResult + ')');
            }

            this._baseAddress = this._exports.mm_getBase();
            this._totalSize = this._exports.mm_getSize();
            this._scratchAddress = this._baseAddress + this._totalSize;
            this._initialized = true;
            return this;
        }

        _requireInit()
        {
            if (!this._initialized)
            {
                throw new Error('MemoryMapFS: init() must be called before use');
            }
        }

        // --- originator API ---

        /**
         * Create a new named mailbox.
         * @param {string} name - name/UUID of the mailbox
         * @param {number} sizeMB - size in MB
         * @returns {number} address of the new mailbox
         * @throws {Error} if mm_create() reports failure (arena full, or
         *   name/size invalid)
         */
        create(name, sizeMB)
        {
            this._requireInit();
            const namePtr = this._writeScratchString(name, 0);
            const addr = this._exports.mm_create(namePtr, name.length, sizeMB);
            if (addr === 0)
            {
                throw new Error('MemoryMapFS.create: mm_create failed (arena full, or name/size invalid)');
            }
            return addr;
        }

        /**
         * @param {number} address
         * @returns {number} result code
         */
        destroy(address)
        {
            this._requireInit();
            return this._exports.mm_destroy(address);
        }

        /**
         * @param {number} address
         * @returns {number} result code
         */
        rotateKeys(address)
        {
            this._requireInit();
            return this._exports.mm_rotateKeys(address);
        }

        /**
         * @param {number} address - address of the current mailbox
         * @param {number} nextAddr - address of the next mailbox in the chain
         * @returns {number} result code
         */
        chainLink(address, nextAddr)
        {
            this._requireInit();
            return this._exports.mm_chainLink(address, nextAddr);
        }

        // --- client API ---

        /**
         * @param {number} address
         * @param {Uint8Array|Buffer} accessKey - 32-byte access key
         * @returns {number} result code (0 = success)
         */
        auth(address, accessKey)
        {
            this._requireInit();
            const keyPtr = this._scratchAddress + 96; // clear of string(0-31)/blob(32-63)/kvLookup-out(64-71) regions
            this.writeMemory(keyPtr, this._toUint8Array(accessKey));
            return this._exports.mm_auth(address, keyPtr);
        }

        /**
         * @param {number} address
         * @param {number} slot
         * @returns {number} the float value stored at that slot
         */
        readSlot(address, slot)
        {
            this._requireInit();
            return this._exports.mm_readSlot(address, slot);
        }

        /**
         * @param {number} address
         * @param {number} slot
         * @param {number} value
         * @param {number} [timestamp=0] - u32 timestamp to store alongside the value
         * @param {number} [state=0] - SlotState (0=ACTIVE, 1=ARCHIVED, 2=PENDING, 3=DELETED, 4=LOCKED, 5=RESERVED)
         * @param {Uint8Array|Buffer|string} [blob] - up to 20 bytes, stored inline with the slot
         * @returns {number} result code
         * @throws {Error} if blob exceeds the 20-byte inline limit
         */
        writeSlot(address, slot, value, timestamp, state, blob)
        {
            this._requireInit();
            let blobPtr = 0;
            let blobLen = 0;
            if (blob)
            {
                const blobBytes = this._toUint8Array(blob);
                if (blobBytes.length > 20)
                {
                    throw new Error('MemoryMapFS.writeSlot: blob exceeds MAX_BLOB_SIZE (20 bytes)');
                }
                blobPtr = this._scratchAddress + 32; // clear of the 0..31 range name/key writes use
                this.writeMemory(blobPtr, blobBytes);
                blobLen = blobBytes.length;
            }
            return this._exports.mm_writeSlot(address, slot, value, timestamp || 0, state || 0, blobPtr, blobLen);
        }

        /**
         * @param {number} address
         * @returns {number} status (0=locked, 1=unlocked)
         */
        status(address)
        {
            this._requireInit();
            return this._exports.mm_status(address);
        }

        // --- key-value API ---

        /**
         * @param {number} address
         * @param {string} key
         * @param {number} valueAddr - value's mailbox address
         * @param {number} valueSlot - value's slot number
         * @returns {number} result code
         */
        kvStore(address, key, valueAddr, valueSlot)
        {
            this._requireInit();
            const keyPtr = this._writeScratchString(key, 0);
            return this._exports.mm_kvStore(address, keyPtr, valueAddr, valueSlot);
        }

        /**
         * @param {number} address
         * @param {string} key
         * @returns {{valueAddr: number, valueSlot: number}|null}
         */
        kvLookup(address, key)
        {
            this._requireInit();
            const keyPtr = this._writeScratchString(key, 0);
            // Real C signature wants uint32_t* out-params -- real WASM
            // addresses, not JS TypedArray objects (which coerce to 0/NaN
            // at the boundary). Two u32 slots at scratch+64/+68, clear of
            // the key write above.
            const outAddrPtr = this._scratchAddress + 64;
            const outSlotPtr = this._scratchAddress + 68;
            const result = this._exports.mm_kvLookup(address, keyPtr, outAddrPtr, outSlotPtr);
            if (result === 0)
            {
                const dv = new DataView(this._memory.buffer);
                return { valueAddr: dv.getUint32(outAddrPtr, true), valueSlot: dv.getUint32(outSlotPtr, true) };
            }
            return null;
        }

        /**
         * @param {number} address
         * @param {string} key
         * @returns {number} result code
         */
        kvDelete(address, key)
        {
            this._requireInit();
            const keyPtr = this._writeScratchString(key, 0);
            return this._exports.mm_kvDelete(address, keyPtr);
        }

        // --- chain API ---

        /**
         * @param {number} address
         * @returns {number} address of next mailbox in the chain, or 0
         */
        chainNext(address)
        {
            this._requireInit();
            return this._exports.mm_chainNext(address);
        }

        /**
         * @param {string} name
         * @returns {number} address of the matching mailbox, or 0 if not found
         */
        chainFind(name)
        {
            this._requireInit();
            const namePtr = this._writeScratchString(name, 0);
            return this._exports.mm_chainFind(namePtr);
        }

        // --- bitmap API ---

        /**
         * @param {number} address
         * @returns {number} slot number, or -1 if no free slots
         */
        findFreeSlot(address)
        {
            this._requireInit();
            return this._exports.mm_findFreeSlot(address);
        }

        /**
         * @param {number} address
         * @param {number} slot
         * @returns {void}
         */
        markOccupied(address, slot)
        {
            this._requireInit();
            this._exports.mm_markOccupied(address, slot);
        }

        /**
         * @param {number} address
         * @param {number} slot
         * @returns {void}
         */
        markFree(address, slot)
        {
            this._requireInit();
            this._exports.mm_markFree(address, slot);
        }

        /**
         * @param {number} address
         * @param {number} slot
         * @returns {number} 1 if occupied, 0 if free
         */
        isOccupied(address, slot)
        {
            this._requireInit();
            return this._exports.mm_isOccupied(address, slot);
        }

        // --- raw memory access ---

        /**
         * @param {number} address - absolute address
         * @param {number} length - number of bytes to read
         * @returns {Uint8Array}
         */
        readMemory(address, length)
        {
            this._requireInit();
            const buffer = new Uint8Array(this._memory.buffer);
            return buffer.slice(address, address + length);
        }

        /**
         * @param {number} address - absolute address
         * @param {Uint8Array|Buffer|string} data
         * @returns {void}
         */
        writeMemory(address, data)
        {
            this._requireInit();
            const bytes = this._toUint8Array(data);
            const buffer = new Uint8Array(this._memory.buffer);
            buffer.set(bytes, address);
        }

        /**
         * Writes a JS string as a null-terminated C string into the
         * scratch region and returns its WASM address, for calls whose C
         * signature wants a `const char*`/`const uint8_t*` pointer
         * (mm_create's name, mm_kvStore/Lookup/Delete's key, mm_chainFind's
         * name) rather than raw bytes.
         * @param {string} str
         * @param {number} [byteOffset=0] - offset within the scratch region
         * @returns {number} absolute WASM address of the written bytes
         */
        _writeScratchString(str, byteOffset)
        {
            const offset = byteOffset || 0;
            const addr = this._scratchAddress + offset;
            const bytes = this._toUint8Array(str);
            this.writeMemory(addr, bytes);
            const buffer = new Uint8Array(this._memory.buffer);
            buffer[addr + bytes.length] = 0; // null terminator
            return addr;
        }

        _toUint8Array(data)
        {
            if (data instanceof Uint8Array)
            {
                return data;
            }
            if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data))
            {
                return new Uint8Array(data);
            }
            if (typeof data === 'string')
            {
                return new TextEncoder().encode(data);
            }
            throw new Error('MemoryMapFS: invalid data type for writeMemory/scratch write');
        }
    }

    return MemoryMapFS;
}));
