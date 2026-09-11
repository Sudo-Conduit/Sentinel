/**
 * SecurityMixin.js — Activation-token-gated dispatch, composed onto any
 * class via ExtendX.extend(). Mirrors the first of Gen 2 kernel.js's three
 * tokens (activation token: proof a call came through a sanctioned path),
 * reimplemented as a reusable, base-class-agnostic mixin instead of
 * hand-written per class.
 *
 * enableLayer/disableLayer/dispose/disposeAsync default ON -- ExtendX's
 * normal, dev-friendly behavior: toggle layers, dispose freely, iterate
 * fast. That is also exactly the gap that matters for production: any
 * caller holding the instance could call disableLayer(securityMixin) to
 * turn gating off, or call dispose() -- which collapses ExtendX's own mask
 * to [0,[]], emptying the mixin pipeline entirely, so a "disposed"
 * instance's methods silently fall through to the raw, unguarded base
 * implementation instead of being blocked. seal() closes both, permanently,
 * for one instance; "unsealing" is never reversing it -- it's constructing
 * a fresh, unsealed instance when that capability is needed again.
 *
 * v2: seal() no longer locks properties via configurable:false/
 * writable:false. That broke on any BaseClassX-derived target: BaseClassX's
 * own `get` trap always returns `rawValue.bind(receiver)`, and a Proxy's
 * `get` trap is REQUIRED by spec to return the exact same value (SameValue)
 * for a non-configurable, non-writable data property -- .bind() returns a
 * new function object every time, so the engine itself threw a native
 * invariant-violation TypeError instead of this file's own clear error.
 * That invariant only constrains non-configurable DATA properties, so the
 * fix is to stop relying on non-configurability for enforcement at all:
 * enableLayer/disableLayer are now real mixin methods that ride ExtendX's
 * already-working per-call dispatch chain (the same mechanism every other
 * gated method already uses successfully through a Proxy) -- they check a
 * closure-private sealed flag and, if clear, call straight through to
 * ExtendX.prototype's own implementation (the literal "call super" this
 * needed, since hand-declaring these names on the mixin means ExtendX no
 * longer auto-attaches its own -- there's nothing left for `this.super` to
 * reach, so the real behavior has to be invoked directly). dispose/
 * disposeAsync can't ride that same chain (ExtendX's own NON_DISPATCH
 * excludes them from normal dispatch), so seal() still overrides them
 * directly on the instance -- but as an ordinary configurable:true,
 * writable:true function, which carries no Proxy invariant at all.
 *
 * @author Wilbert Fobbs III / Pooled Impact (ExtendX composition pattern)
 */
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./ExtendX.js'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./ExtendX.js'));
    } else {
        root.SecurityMixin = factory(root.ExtendX);
    }
}(typeof self !== 'undefined' ? self : this, function(ExtendX) {
    'use strict';
    if (!ExtendX) throw new Error('SecurityMixin requires ExtendX to be loaded first');

    // ─── Private token store ────────────────────────────────────────────
    // Keyed by the instance's ExtendX-minted `_extId` -- a real, own
    // property (readable as instance._extId) but non-enumerable, non-
    // configurable, non-writable, attached via defineProperty. Never keyed
    // by the instance object itself: a plain string-keyed Map, matching
    // the same convention ExtendX's own MASKS/LOOPS tables use (cheap,
    // no ephemeron bookkeeping, portable). The token VALUE itself never
    // leaves this closure -- nothing outside this file can read it.
    const TOKENS = new Map();      // extId -> { token, mintedAt }
    const VIOLATIONS = new Map();  // extId -> count (isolated-proof telemetry)

    function mint(extId) {
        const token = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : 'tok_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
        TOKENS.set(extId, { token: token, mintedAt: Date.now() });
        return token;
    }

    function revoke(extId) {
        TOKENS.delete(extId);
    }

    function isArmed(extId) {
        return TOKENS.has(extId);
    }

    function recordViolation(extId) {
        VIOLATIONS.set(extId, (VIOLATIONS.get(extId) || 0) + 1);
    }

    // ─── Sealed state ───────────────────────────────────────────────────
    // Keyed by extId like TOKENS -- a closure-private flag, not a property
    // on the instance, so nothing about "is this sealed" is reachable or
    // reflectable from outside this file.
    const SEALED = new Set();

    function sealedError(name) {
        return new Error(
            'SecurityMixin: "' + name + '" is sealed on this instance. ' +
            'enableLayer/disableLayer/dispose/disposeAsync are locked once ' +
            'seal() has been called -- permanently, for this instance. A ' +
            'fresh, unsealed instance is the only way to get this capability ' +
            'back; there is no unseal().'
        );
    }

    /**
     * Build a security mixin for BaseClass: a same-named wrapper for every
     * one of BaseClass.prototype's own methods, each checking this
     * instance's activation token before calling this.super.<method>(...).
     *
     * Generated per-class, not one shared hand-written object, because
     * ExtendX's fast dispatch only wraps method names actually present on
     * the mixin (see dispatchKeys() in ExtendX.js) -- a hand-written mixin
     * would need to already know every target class's method names in
     * advance and be kept in sync by hand. Introspecting
     * BaseClass.prototype instead means CPU, Physical, Kernel, BIOS (or
     * anything else) all get full method coverage automatically.
     *
     * mixinId is derived from BaseClass.name so each target's security
     * layer is its own independently toggleable bit -- ExtendX.extend()
     * requires a stable string id per mixin, and reusing one id across
     * different method sets would be exactly the "accidental collision"
     * case ExtendX's own registry guard rejects.
     */
    function createSecurityMixin(BaseClass) {
        if (typeof BaseClass !== 'function') {
            throw new Error('SecurityMixin.createSecurityMixin(): BaseClass must be a constructor function/class');
        }
        const mixinId = 'security:' + (BaseClass.name || 'anonymous');

        // True ES private methods (#foo) never appear in
        // getOwnPropertyNames at all -- invisible by spec, not by
        // convention, and unreachable through the prototype/dispatch
        // mechanism entirely, so a class's own internal self-calls to one
        // (e.g. from its own constructor) are never affected by this mixin
        // in the first place. That's the correct fix for a method a
        // constructor calls on itself before any instance exists to arm.
        //
        // Underscore-prefixed names are a softer, convention-only
        // exemption for existing code not yet using real private methods --
        // skipped here defensively, but unlike '#foo' this is enforced by
        // agreement, not by the language.
        const methodNames = Object.getOwnPropertyNames(BaseClass.prototype).filter(function(name) {
            if (name === 'constructor') return false;
            if (name.charAt(0) === '_') return false;
            return typeof BaseClass.prototype[name] === 'function';
        });

        const mixin = { mixinId: mixinId };

        methodNames.forEach(function(name) {
            mixin[name] = function() {
                const extId = this._extId;
                if (!isArmed(extId)) {
                    recordViolation(extId);
                    throw new Error(
                        'SecurityMixin: "' + name + '" blocked on ' + (BaseClass.name || 'instance') +
                        ' -- no activation token. This instance was never armed (init() never ran), ' +
                        'or dispose()/disposeAsync() already revoked it.'
                    );
                }
                return this.super[name].apply(this, arguments);
            };
        });

        // Lifecycle: mint on construction, revoke on disposal. Both run
        // through ExtendX's current()-resolved init/dispose hooks, so an
        // override() replacement still arms/disarms correctly.
        mixin.init = function() {
            mint(this._extId);
        };
        mixin.dispose = function() {
            revoke(this._extId);
        };

        // enableLayer/disableLayer, hand-declared rather than introspected:
        // BaseClass never defines these itself (ExtendX attaches its own
        // generic versions per-instance, only when the base doesn't already
        // have one), so they never appear in BaseClass.prototype and the
        // introspection loop above never sees them. Declaring them here
        // means ExtendX's own per-instance attach is skipped instead (an
        // instance already inheriting a real function via Subclass.prototype
        // no longer needs one) -- which also means there is no more "base"
        // implementation left for this.super to reach, so the sealed check
        // calls ExtendX.prototype's real implementation directly (the
        // literal "call super") rather than through the chain.
        mixin.enableLayer = function(m) {
            if (SEALED.has(this._extId)) throw sealedError('enableLayer');
            return ExtendX.prototype.enableLayer.call(this, m);
        };
        mixin.disableLayer = function(m) {
            if (SEALED.has(this._extId)) throw sealedError('disableLayer');
            return ExtendX.prototype.disableLayer.call(this, m);
        };

        // ─── Isolated-proof introspection (not part of the Gen 2 surface) ──
        mixin._securityArmed = function() { return isArmed(this._extId); };
        mixin._securityViolations = function() { return VIOLATIONS.get(this._extId) || 0; };

        return mixin;
    }

    // ─── Seal ─────────────────────────────────────────────────────────
    // enableLayer/disableLayer are handled above, as real mixin methods
    // riding ExtendX's normal per-call dispatch chain -- no property
    // surgery needed for those two at all, since they already check SEALED
    // on every call regardless of how they were reached.
    //
    // dispose/disposeAsync can't ride that chain: ExtendX's own
    // NON_DISPATCH set excludes both from normal per-property dispatch
    // (they're lifecycle hooks, invoked directly, not chained), so there is
    // no dispatch-chain path to hook a check into. seal() overrides them
    // directly on the instance instead -- as an ordinary configurable:true,
    // writable:true function. That's deliberately NOT the non-configurable
    // lock the first version of this file used: this instance permanently
    // stops offering working dispose/disposeAsync once sealed (nothing
    // legitimate ever needs to call through to the original afterward), but
    // the override itself carries no Proxy invariant, so it behaves
    // identically whether the instance is a plain object or a BaseClassX
    // Proxy.
    function seal(instance) {
        SEALED.add(instance._extId);
        ['dispose', 'disposeAsync'].forEach(function(name) {
            Object.defineProperty(instance, name, {
                value: function() { throw sealedError(name); },
                enumerable: false,
                configurable: true,
                writable: true
            });
        });
        return instance;
    }

    function isSealed(instance) {
        return SEALED.has(instance._extId);
    }

    return {
        createSecurityMixin: createSecurityMixin,
        seal: seal,
        isSealed: isSealed,
        // Exposed for the isolated proof/tests only -- a real deployment
        // has no reason to reach these from outside a composed instance's
        // own init/dispose lifecycle.
        _mint: mint,
        _revoke: revoke,
        _isArmed: isArmed
    };
}));
