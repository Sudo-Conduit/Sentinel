/**
 * @file MemoryMapUnit.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Wraps one real memorymap.wasm mailbox (an address + access
 *   key created via mm_create) as an ExtendX-composable class, so the real
 *   federation primitives proven directly against the WASM exports --
 *   mm_auth, mm_readSlot/mm_writeSlot, mm_chainLink/mm_chainNext/
 *   mm_chainFind/mm_chainUnlink -- get the SAME activation-token discipline
 *   and graph discoverability every other class in this codebase gets,
 *   instead of being called ad hoc against raw wasm exports.
 *
 * Two DIFFERENT, deliberately separate notions of "linked" exist once this
 * is composed with StructureMixin in 'relational' mode, and they are NOT
 * the same call:
 *
 *   - chainLink(otherUnit) (this file) -- calls the REAL mm_chainLink on
 *     the live memorymap.wasm instance. This is the actual, load-bearing
 *     link: mm_chainNext/mm_chainFind on the wasm side will reflect it,
 *     regardless of whether anything at the JS layer ever asks about it.
 *
 *   - linkTo(otherUnit._extId) (StructureMixin, composed separately) --
 *     records the SAME fact in a JS-side, in-process relational graph
 *     (getConnected()/getConnectedGraph()) so an orchestrator can discover
 *     topology (what's linked to what, transitively) WITHOUT making a
 *     real, potentially cross-machine mm_chainNext call for every hop of
 *     a query. It is bookkeeping, not the link itself.
 *
 * A caller that wants both (the common case) calls both explicitly --
 * chainLink() intentionally does NOT also call linkTo() on your behalf.
 * StructureMixin's 'relational' linkTo() is a leaf mixin method (it never
 * calls this.super), so naming this file's method linkTo() instead of
 * chainLink() would have let StructureMixin's composed version silently
 * shadow the real WASM call the instant both were composed together --
 * exactly the kind of silent-collision hazard PreMixed.hazard.test.js
 * exists to catch for hand-merged mixins. Two names, two behaviors, no
 * ambiguity about which one a given call actually does.
 *
 * SecurityMixin composition (see the exported SecuredMemoryMapUnit below)
 * means every method here -- readSlot/writeSlot/chainLink/chainNext/
 * chainUnlink/chainFind/auth included -- is blocked with a real thrown
 * error until init() has minted this instance's activation token, and
 * blocked again after dispose() revokes it. A unit that was constructed
 * but never armed cannot touch real shared memory at all.
 */
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./ExtendX.js', './SecurityMixin.js', './StructureMixin.js'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./ExtendX.js'), require('./SecurityMixin.js'), require('./StructureMixin.js'));
    } else {
        root.MemoryMapUnit = factory(root.ExtendX, root.SecurityMixin, root.StructureMixin);
    }
}(typeof self !== 'undefined' ? self : this, function(ExtendX, SecurityMixin, StructureMixin) {
    'use strict';
    if (!ExtendX) throw new Error('MemoryMapUnit requires ExtendX to be loaded first');
    if (!SecurityMixin) throw new Error('MemoryMapUnit requires SecurityMixin to be loaded first');
    if (!StructureMixin) throw new Error('MemoryMapUnit requires StructureMixin to be loaded first');

    // Scratch regions for key/name staging inside the shared WASM memory --
    // offset by a large per-unit stride so concurrently-live units never
    // collide, matching the convention the raw test scripts already used
    // (0x2000-plus-offset for names, 0x800-plus-offset for keys).
    let nextScratchSlot = 0;

    class MemoryMapUnit {
        /**
         * @param {Object} options
         * @param {Object} options.mm - memorymap.wasm's exports object
         *   (already instantiated by the caller against a real
         *   WebAssembly.Memory -- this class never instantiates the wasm
         *   module itself, so the SAME mm instance can back many units).
         * @param {WebAssembly.Memory} options.memory
         * @param {string} options.name
         * @param {number} [options.sizeMB=8]
         */
        constructor(options) {
            options = options || {};
            if (!options.mm) throw new Error('MemoryMapUnit: options.mm (memorymap.wasm exports) is required');
            if (!options.memory) throw new Error('MemoryMapUnit: options.memory (WebAssembly.Memory) is required');
            if (!options.name) throw new Error('MemoryMapUnit: options.name is required');

            this._mm = options.mm;
            this._memory = options.memory;
            this.name = options.name;
            this.sizeMB = options.sizeMB || 8;
            this.address = 0;
            this.key = null;

            this._scratchSlot = nextScratchSlot++;
        }

        // ─── Lifecycle: real mm_create happens here, not in the
        // constructor -- so a unit that's never init()'d (SecurityMixin
        // blocks dispatch until then anyway) never touches wasm state. ──
        create() {
            const nameBytes = new TextEncoder().encode(this.name);
            const NAME_PTR = 0x4000 + this._scratchSlot * 256;
            new Uint8Array(this._memory.buffer).set(nameBytes, NAME_PTR);
            const address = this._mm.mm_create(NAME_PTR, nameBytes.length, this.sizeMB);
            if (address <= 0) throw new Error('MemoryMapUnit(' + this.name + ').create(): mm_create failed, code ' + address);
            this.address = address;
            const keyPtr = this._mm.mm_getAccessKey(address);
            if (!keyPtr) throw new Error('MemoryMapUnit(' + this.name + ').create(): mm_getAccessKey failed');
            this.key = new Uint8Array(this._memory.buffer, keyPtr, 32).slice();

            // mm_writeSlot is real, stateful, session-gated: empirically
            // (no source available, confirmed by direct probing) it
            // refuses every write with rc=-1 until THIS mailbox has had a
            // successful mm_auth() against it -- passing the key again on
            // every writeSlot call does not substitute for it. A unit
            // authenticates against its own just-created mailbox with its
            // own just-minted key immediately, since nothing else could
            // legitimately hold that key yet.
            const authRc = this.auth(this.key);
            if (authRc !== 0) throw new Error('MemoryMapUnit(' + this.name + ').create(): self-auth failed, code ' + authRc);

            return this.address;
        }

        // ─── Real mm_auth check -- returns 0 on success, matching the
        // raw wasm return convention rather than coercing to boolean, so
        // a caller inspecting the exact error code isn't forced through
        // an extra layer of translation.
        //
        // FAIL-CLOSED, not fail-stable: a failed auth() attempt (wrong
        // key) genuinely de-authenticates this mailbox, even if a prior
        // call to auth() with the correct key already succeeded.
        // Confirmed by direct probing against the real wasm export (no
        // source available): write/readSlot correctly fail again
        // immediately after a rejected auth() attempt, and only start
        // working again once auth() is called successfully a second time.
        // A caller that probes with a possibly-wrong key (e.g. trying
        // several candidate keys) MUST re-auth with a known-good key
        // afterward before relying on write access again -- the mailbox
        // does not remember the earlier successful session through a
        // later failed attempt. ──────────────────────────────────────
        auth(keyBytes) {
            const KEY_PTR = 0x5000 + this._scratchSlot * 64;
            new Uint8Array(this._memory.buffer).set(keyBytes, KEY_PTR);
            return this._mm.mm_auth(this.address, KEY_PTR);
        }

        readSlot(slot) {
            return this._mm.mm_readSlot(this.address, slot);
        }

        // mm_writeSlot's real signature is (address, slot, value, i32,
        // i32, i32, i32) -- 4 trailing i32 params beyond what its name
        // suggests. Confirmed by direct probing (no C source available):
        // all-zero trailing params write correctly once mm_auth has
        // succeeded against this mailbox; their actual purpose (mode/
        // generation/flags) is undocumented from the compiled binary
        // alone, so this deliberately does not guess at exposing them as
        // real writeSlot() parameters until that meaning is confirmed.
        writeSlot(slot, value) {
            return this._mm.mm_writeSlot(this.address, slot, value, 0, 0, 0, 0);
        }

        // ─── The REAL wasm-level chain link -- see the file header for
        // why this is deliberately NOT named linkTo(). ──────────────────
        chainLink(otherUnit) {
            return this._mm.mm_chainLink(this.address, otherUnit.address);
        }

        chainUnlink() {
            return this._mm.mm_chainUnlink(this.address);
        }

        chainNext() {
            return this._mm.mm_chainNext(this.address);
        }

        chainFind() {
            return this._mm.mm_chainFind(this.address);
        }

        exists() {
            return this._mm.mm_exists(this.address);
        }

        status() {
            return this._mm.mm_status(this.address);
        }
    }

    const SecuredMemoryMapUnit = ExtendX.extend(
        MemoryMapUnit,
        SecurityMixin.createSecurityMixin(MemoryMapUnit),
        StructureMixin.createStructureMixin(MemoryMapUnit, { mode: 'relational' })
    );

    return {
        MemoryMapUnit: MemoryMapUnit,
        SecuredMemoryMapUnit: SecuredMemoryMapUnit
    };
}));
