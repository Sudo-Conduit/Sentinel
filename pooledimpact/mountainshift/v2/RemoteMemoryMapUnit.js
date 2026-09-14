/**
 * @file RemoteMemoryMapUnit.js
 * @author Will Fobbs
 * @version 1.0.1
 * @description The machine-to-machine half of MemoryMapUnit.js's local
 *   shared-memory story. A real memorymap.wasm mailbox's address space
 *   cannot cross a process boundary at all (WebAssembly.Memory.prototype
 *   .buffer has no external-aliasing hook, proven directly against the
 *   real binary), so mm_chainLink -- the actual, wasm-level link -- is
 *   fundamentally single-machine. What DOES cross a real machine-to-
 *   machine transport is messages, so this file gives a remote unit's
 *   readSlot/writeSlot/auth the SAME method names and argument shape as
 *   MemoryMapUnit's, over any DataChannel-shaped transport (a real
 *   RTCDataChannel in a browser, werift's in Node, or a mock for pure-
 *   Node tests) -- deliberately NOT hardcoding an import of werift or any
 *   browser API, so this class stays as dependency-free as every other
 *   file in this directory and works with whatever real transport a
 *   caller already has a connection through.
 *
 * ONE deliberate, honest asymmetry from MemoryMapUnit: local readSlot/
 * writeSlot/auth are synchronous (a real memory access), these are
 * ALWAYS Promises (a real network round trip, min tens of microseconds
 * on a good LAN, unbounded if the peer never replies). This is not
 * hidden behind a fake-sync wrapper -- see the WebRTC/MemoryMap
 * combination discussion this file grew out of: collapsing "free, local"
 * and "paid, remote" into one indistinguishable call shape is exactly
 * the mistake that lets a caller accidentally treat a chatty remote
 * access pattern as if it were free.
 *
 * Federation still composes the same way MemoryMapUnit.js established:
 * chainLink() (the real wasm link) has no meaning here at all -- this
 * file exports no such method. StructureMixin's linkTo() (composed
 * separately, exactly like MemoryMapUnit's) is the ONLY link a
 * RemoteMemoryMapUnit ever participates in, and that was already true
 * for local units too -- the JS-graph bookkeeping never distinguished
 * local from remote to begin with. A caller federates a remote unit into
 * an existing topology with the exact same call it already uses locally:
 * localUnit.linkTo(remoteUnit._extId).
 *
 * Wire protocol: small JSON request/response, correlated by id, so many
 * concurrent calls over one DataChannel don't need to be serialized by
 * the caller. { id, op: 'readSlot'|'writeSlot'|'auth', ...args } out,
 * { id, ok, result } or { id, ok: false, error } back. serveMemoryMapUnit()
 * is the other half: point it at a REAL local MemoryMapUnit (already
 * create()'d) and a channel, and it answers exactly that protocol using
 * the local unit's real methods -- nothing here assumes which side of a
 * connection is "the server."
 *
 * v1.0.1: v1.0.0 wrongly assumed a base class's OWN init()/dispose()
 * methods get auto-invoked by ExtendX the same way a composed MIXIN's do
 * -- they do not. ExtendX's constructor loop iterates the MIXINS passed
 * to extend() only (`mixins.forEach(...)`); a plain method sitting on the
 * base class itself is just an ordinary (dispatched, but never
 * auto-called) method. Confirmed the hard way: a real end-to-end run
 * (Node <-> browser over an actual WebRTC DataChannel) threw "no channel
 * attached" on the very first call, because the extId-keyed CHANNELS map
 * that init() was supposed to populate never got populated at all. Fix:
 * this file never needed extId-keyed closure-private state in the first
 * place -- that pattern exists in SecurityMixin/StructureMixin because
 * THEY need state unreachable from outside the instance (a real security
 * token) or state that must survive being read through many different
 * dispatch frames sharing one logical instance. A channel reference and a
 * pending-request map are neither -- they're ordinary instance data, and
 * MemoryMapUnit.js's own this._mm/this.address already prove plain
 * instance properties read correctly from every dispatched method
 * regardless of which frame Proxy wraps a given call. So: this._channel
 * and this._pending now, set directly in the constructor (where
 * `options` and `this` both already exist) instead of deferred to a
 * lifecycle hook nothing was ever going to call.
 */
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./ExtendX.js', './SecurityMixin.js', './StructureMixin.js'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./ExtendX.js'), require('./SecurityMixin.js'), require('./StructureMixin.js'));
    } else {
        root.RemoteMemoryMapUnit = factory(root.ExtendX, root.SecurityMixin, root.StructureMixin);
    }
}(typeof self !== 'undefined' ? self : this, function(ExtendX, SecurityMixin, StructureMixin) {
    'use strict';
    if (!ExtendX) throw new Error('RemoteMemoryMapUnit requires ExtendX to be loaded first');
    if (!SecurityMixin) throw new Error('RemoteMemoryMapUnit requires SecurityMixin to be loaded first');
    if (!StructureMixin) throw new Error('RemoteMemoryMapUnit requires StructureMixin to be loaded first');

    let nextRequestId = 1;
    const DEFAULT_TIMEOUT_MS = 10000;

    function attachChannelListener(channel, pending) {
        const handler = function(eventOrData) {
            // Normalize: a real RTCDataChannel/werift 'message' listener
            // hands an event with .data; a bare mock channel may just call
            // the handler with the payload directly. Accept both rather
            // than forcing every transport to wrap itself.
            const raw = (eventOrData && typeof eventOrData === 'object' && 'data' in eventOrData) ? eventOrData.data : eventOrData;
            let msg;
            try {
                msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString());
            } catch (e) {
                return; // not a message for this protocol -- ignore rather than throw
            }
            if (!msg || typeof msg.id !== 'number') return;
            const entry = pending.get(msg.id);
            if (!entry) return; // no longer waiting (already timed out, or not ours)
            clearTimeout(entry.timer);
            pending.delete(msg.id);
            if (msg.ok) entry.resolve(msg.result);
            else entry.reject(new Error('RemoteMemoryMapUnit: remote error -- ' + msg.error));
        };
        if (typeof channel.addEventListener === 'function') {
            channel.addEventListener('message', handler);
        } else if (typeof channel.on === 'function') {
            channel.on('message', handler); // werift-style EventEmitter fallback, if ever needed
        } else {
            throw new Error('RemoteMemoryMapUnit: channel has neither addEventListener nor on() for "message"');
        }
        return handler;
    }

    class RemoteMemoryMapUnit {
        /**
         * @param {Object} options
         * @param {Object} options.channel - anything with .send(string) and
         *   either .addEventListener('message', fn) or .on('message', fn)
         *   -- a real RTCDataChannel (browser or werift) or a mock.
         * @param {string} options.name - the REMOTE unit's own name, for
         *   logging/identification only; this class never calls mm_create
         *   itself (the remote side already owns a real, create()'d
         *   MemoryMapUnit -- see serveMemoryMapUnit() below).
         * @param {number} [options.timeoutMs]
         */
        constructor(options) {
            options = options || {};
            if (!options.channel) throw new Error('RemoteMemoryMapUnit: options.channel is required');
            if (!options.name) throw new Error('RemoteMemoryMapUnit: options.name is required');
            this.name = options.name;
            this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
            this._channel = options.channel;
            this._pending = new Map(); // requestId -> {resolve, reject, timer}
            this._listenerHandler = attachChannelListener(this._channel, this._pending);
        }

        _sendRequest(op, args) {
            const id = nextRequestId++;
            const payload = Object.assign({ id: id, op: op }, args);
            const pending = this._pending;
            const channel = this._channel;
            const timeoutMs = this.timeoutMs;
            return new Promise(function(resolve, reject) {
                const timer = setTimeout(function() {
                    pending.delete(id);
                    reject(new Error('RemoteMemoryMapUnit: request timed out (op=' + op + ', id=' + id + ') after ' + timeoutMs + 'ms -- the DataChannel may have dropped a message; local shared memory structurally cannot fail this way, this is the real cost of a network transport'));
                }, timeoutMs);
                pending.set(id, { resolve: resolve, reject: reject, timer: timer });
                channel.send(JSON.stringify(payload));
            });
        }

        // No init()/dispose() lifecycle methods here -- see the v1.0.1
        // note above for why a base class's own such methods would be
        // silently never called, not why they'd be redundant. Pending
        // requests are simply not auto-cancelled by disposal; a caller
        // that composes this with SecurityMixin (which DOES get a real
        // dispose() hook, since it's a mixin passed to extend()) still
        // gets writeSlot/readSlot/auth blocked post-dispose, just not an
        // immediate rejection of anything already in flight.

        readSlot(slot) {
            return this._sendRequest('readSlot', { slot: slot });
        }

        writeSlot(slot, value) {
            return this._sendRequest('writeSlot', { slot: slot, value: value });
        }

        // keyHex: a hex string, not raw bytes -- JSON has no binary type,
        // and this protocol is deliberately plain JSON (readable in a
        // DataChannel trace) rather than a second, binary-framed path.
        auth(keyHex) {
            return this._sendRequest('auth', { keyHex: keyHex });
        }
    }

    const SecuredRemoteMemoryMapUnit = ExtendX.extend(
        RemoteMemoryMapUnit,
        SecurityMixin.createSecurityMixin(RemoteMemoryMapUnit),
        StructureMixin.createStructureMixin(RemoteMemoryMapUnit, { mode: 'relational' })
    );

    /**
     * The server/responder half. Wires a REAL, already-create()'d
     * MemoryMapUnit (or SecuredMemoryMapUnit) to answer readSlot/
     * writeSlot/auth requests arriving over `channel`, using the local
     * unit's real methods. Symmetric with RemoteMemoryMapUnit's protocol
     * deliberately -- this file makes no assumption about which peer in a
     * connection calls serveMemoryMapUnit() and which constructs a
     * RemoteMemoryMapUnit; a real federation can have either, or both
     * directions at once over separate DataChannels.
     *
     * @param {Object} localUnit - a real, already-created MemoryMapUnit
     * @param {Object} channel - same shape as RemoteMemoryMapUnit's
     */
    function serveMemoryMapUnit(localUnit, channel) {
        function reply(id, ok, resultOrError) {
            const payload = ok ? { id: id, ok: true, result: resultOrError } : { id: id, ok: false, error: String(resultOrError && resultOrError.message || resultOrError) };
            channel.send(JSON.stringify(payload));
        }
        function handler(eventOrData) {
            const raw = (eventOrData && typeof eventOrData === 'object' && 'data' in eventOrData) ? eventOrData.data : eventOrData;
            let msg;
            try {
                msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString());
            } catch (e) {
                return;
            }
            if (!msg || typeof msg.id !== 'number' || typeof msg.op !== 'string') return;
            try {
                let result;
                if (msg.op === 'readSlot') {
                    result = localUnit.readSlot(msg.slot);
                } else if (msg.op === 'writeSlot') {
                    result = localUnit.writeSlot(msg.slot, msg.value);
                } else if (msg.op === 'auth') {
                    const keyBytes = new Uint8Array(msg.keyHex.match(/.{2}/g).map(function(h) { return parseInt(h, 16); }));
                    result = localUnit.auth(keyBytes);
                } else {
                    reply(msg.id, false, 'unknown op "' + msg.op + '"');
                    return;
                }
                reply(msg.id, true, result);
            } catch (e) {
                reply(msg.id, false, e);
            }
        }
        if (typeof channel.addEventListener === 'function') {
            channel.addEventListener('message', handler);
        } else if (typeof channel.on === 'function') {
            channel.on('message', handler);
        } else {
            throw new Error('serveMemoryMapUnit: channel has neither addEventListener nor on() for "message"');
        }
        return handler; // returned so a caller can removeEventListener/off it later if needed
    }

    return {
        RemoteMemoryMapUnit: RemoteMemoryMapUnit,
        SecuredRemoteMemoryMapUnit: SecuredRemoteMemoryMapUnit,
        serveMemoryMapUnit: serveMemoryMapUnit
    };
}));
