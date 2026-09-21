/**
 * @file Registry.js
 * @author Will Fobbs
 * @version 1.2.0
 * @description Machine-level persistent key/value config — NVRAM/CMOS
 *   equivalent (boot device priority, hardware config flags, saved
 *   settings). Kept deliberately separate from BIOS.js's own per-boot
 *   schema and from CPU.js's MSRs: MSRs are live CPU control state,
 *   Registry.js is small, persistent, non-file-shaped machine config —
 *   the thing BIOS reads at step 3 of the boot sequence, before it even
 *   knows what's on disk.
 *
 *   v1.1.0 (D.1, MSOS Cleanup Roadmap): saveToArena()/loadFromArena() --
 *   an NVRAM persistence path via MemoryMapArena.js, alongside the
 *   existing FileFsX-backed save()/load(), not replacing it. Closes the
 *   Node/Browser split every FileFsX backend has (IDB/OPFS/Cache/
 *   localStorage are browser-only; real fs needs a user gesture) -- a
 *   capability-gated WASM arena instantiates identically in both
 *   runtimes. Today's arena is per-process memory only; real
 *   cross-restart persistence needs a host-layer decision about what
 *   backs the arena's linear memory, deliberately out of scope here.
 *   v1.2.0 (C.4, MSOS Cleanup Roadmap): added `firstBootComplete: false`
 *   to the default entries, alongside bootDeviceOrder/firmwareType/
 *   secureBoot -- the flag BIOS.boot() reads to distinguish a real first
 *   boot from steady-state and gate its one-time post-install setup.
 *   Registry itself stays a plain key/value bag; no new methods needed.
 * @docs Kernel-Machine-Architecture.md
 * @tests test/NextInjection.audit.test.js
 * @tests test/MemoryMapArena.test.js
 * @tests test/BIOS.firstBoot.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./BaseClassX.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./BaseClassX.js'));
    }
    else
    {
        root.Registry = factory(root.BaseClassX);
    }
}(typeof self !== 'undefined' ? self : this, function(BaseClassX)
{
    'use strict';
    if (!BaseClassX)
    {
        throw new Error('Registry requires BaseClassX to be loaded first');
    }

    class Registry extends BaseClassX
    {
        static name = 'Registry';
        static author = 'Will Fobbs';
        static version = '1.2.0';
        static domain = 'machine.registry';
        static description = 'Machine-level persistent key/value config -- NVRAM/CMOS equivalent (boot device priority, hardware config flags, saved settings).';
        static docs = ['Kernel-Machine-Architecture.md'];
        static tests = ['test/NextInjection.audit.test.js', 'test/MemoryMapArena.test.js', 'test/BIOS.firstBoot.test.js'];
        static _schema = { properties: {
            entries: { type: 'object', default: {} }
        }};

        constructor(options = {})
        {
            super({ type: 'machine.registry', name: 'Registry' });
            this.entries = options.entries || {
                bootDeviceOrder: ['esp', 'disk', 'network'],
                firmwareType: 'UEFI',
                secureBoot: false,
                firstBootComplete: false
            };
        }

        /**
         * @param {string} key - registry key to read
         * @returns {*} the value stored at that key, or undefined if absent
         */
        get(key)
        {
            return this.entries[key];
        }

        // KNOWN GAP (next()-injection audit, unlike fork()/tick()/boot()'s
        // ppid/quantum/iso -- NOT fixed with a typeof-guard here, deliberately):
        // if this class is ever composed via ExtendX.extend(), a caller doing
        // set(key) with the value omitted does not get value === undefined --
        // ExtendX's dispatcher always appends its own next() callback as the
        // trailing argument to every dispatched call, so value becomes that
        // injected function instead. Every other instance of this hazard found
        // this session (StructureMixin's label, Kernel's ppid/memBytes/quantum,
        // BIOS's iso) was fixable by trusting only a specific expected TYPE
        // (string, number) since next is always a function and never one of
        // those. That fix does not apply here: a Registry value is legitimately
        // ANY type, including a function, so there is no type check that can
        // tell "caller meant undefined" apart from "ExtendX's next landed here"
        // without arbitrarily restricting what a registry entry can hold. As
        // of this writing set() is never called with fewer than 2 arguments
        // anywhere in this codebase (grepped, confirmed), so this is currently
        // unreachable -- documented here so it stays that way on purpose,
        // not by accident, if this class is later composed with SecurityMixin/
        // StructureMixin for the NVRAM-as-fast-path work. Callers composing
        // this class MUST always pass both key and value explicitly.
        /**
         * @param {string} key - registry key to write
         * @param {*} value - value to store (any type, see KNOWN GAP note above)
         * @returns {Registry} this, for chaining
         */
        set(key, value)
        {
            this.entries = { ...this.entries, [key]: value };
            this._recordTrace('registry_set', { key, value });
            return this;
        }

        /**
         * @param {string} key - registry key to check
         * @returns {boolean} true if the key is present
         */
        has(key)
        {
            return Object.prototype.hasOwnProperty.call(this.entries, key);
        }

        /**
         * @param {string} key - registry key to remove
         * @returns {Registry} this, for chaining
         */
        delete(key)
        {
            const { [key]: _removed, ...rest } = this.entries;
            this.entries = rest;
            this._recordTrace('registry_delete', { key });
            return this;
        }

        /**
         * @returns {string[]} all currently stored keys
         */
        keys()
        {
            return Object.keys(this.entries);
        }

        // Persistence — opt-in, not automatic on construction (constructor
        // stays sync, matching the rest of this project's BaseClassX classes).
        // Without ever calling save()/load(), Registry behaves exactly as
        // before: an in-memory-only key/value store for one page session.
        /**
         * @param {Object} FileFS - the FileFsX FileFS class
         * @param {Object} [options={}] - options.backend (default 'idb'), options.key (default 'meshui-registry')
         * @returns {Promise<Registry>} this, for chaining
         */
        async save(FileFS, options = {})
        {
            const backend = options.backend || 'idb';
            const key = options.key || 'meshui-registry';
            const fs = await FileFS.create({ backend, key });
            await fs.writeFile('/registry.json', JSON.stringify(this.entries));
            this._recordTrace('registry_persist_save', { backend, key });
            return this;
        }

        /**
         * @param {Object} FileFS - the FileFsX FileFS class
         * @param {Object} [options={}] - options.backend (default 'idb'), options.key (default 'meshui-registry')
         * @returns {Promise<Registry>} a Registry loaded from storage, or a fresh default one if none was found
         */
        static async load(FileFS, options = {})
        {
            const backend = options.backend || 'idb';
            const key = options.key || 'meshui-registry';
            try
            {
                const fs = await FileFS.create({ backend, key });
                const data = await fs.readFile('/registry.json', 'utf8');
                return new Registry({ entries: JSON.parse(data) });
            }
            catch (e)
            {
                return new Registry();
            }
        }

        // D.1 (MSOS Cleanup Roadmap): NVRAM record via MemoryMapArena --
        // additive, alongside save()/load() above, not a replacement.
        // Today's arena is per-process memory only (it does not survive a
        // real process restart on its own -- that needs a host-layer
        // decision about what backs the arena's linear memory, out of
        // scope here); what this closes is the Node/Browser SPLIT every
        // FileFsX backend has (IDB/OPFS/Cache/localStorage are browser-
        // only, real fs needs a user gesture) -- a capability-gated WASM
        // arena instantiates identically in both runtimes.
        //
        // arenaSlot: NOT optional with a `|| default`, deliberately --
        // startSlot has no sensible implicit value the way ppid/label do
        // elsewhere in this codebase's next()-injection fixes; every real
        // call site should say explicitly which slot range it owns.
        /**
         * Pack this Registry's entries into a MemoryMapArena, JSON-encoded
         * as UTF-8 bytes via the arena's length-header binary codec.
         * @param {Object} arena - an initialized, authenticated MemoryMapArena
         * @param {number} startSlot - first slot to write (a length header,
         *   then the packed data slots after it)
         * @returns {Registry} this, for chaining
         */
        saveToArena(arena, startSlot)
        {
            const bytes = new TextEncoder().encode(JSON.stringify(this.entries));
            arena.packBytes(startSlot, bytes);
            this._recordTrace('registry_persist_save_arena', { startSlot, byteLength: bytes.length });
            return this;
        }

        /**
         * Inverse of saveToArena(): reads and JSON-decodes entries back out
         * of the arena. Falls back to a fresh default Registry if nothing
         * valid is found at that slot (mirrors load()'s own fallback
         * behavior for a missing/corrupt FileFsX record).
         * @param {Object} arena - an initialized, authenticated MemoryMapArena
         * @param {number} startSlot - the slot saveToArena() was given
         * @returns {Registry} a Registry loaded from the arena, or a fresh default one
         */
        static loadFromArena(arena, startSlot)
        {
            try
            {
                const bytes = arena.unpackBytes(startSlot);
                const json = new TextDecoder().decode(bytes);
                return new Registry({ entries: JSON.parse(json) });
            }
            catch (e)
            {
                return new Registry();
            }
        }
    }

    return Registry;
}));
