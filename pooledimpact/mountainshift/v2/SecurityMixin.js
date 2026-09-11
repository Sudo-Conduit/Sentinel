/**
 * SecurityMixin.js — Activation-token-gated dispatch, composed onto any
 * class via ExtendX.extend(). Mirrors the first of Gen 2 kernel.js's three
 * tokens (activation token: proof a call came through a sanctioned path),
 * reimplemented as a reusable, base-class-agnostic mixin instead of
 * hand-written per class.
 *
 * v3: enableLayer/disableLayer are handled by ExtendX itself now
 * (ExtendX.js v1.2.0's `mixin.locked` check), not by this file. Two earlier
 * attempts both failed for reasons worth keeping on record:
 *
 *   v1 sealed enableLayer/disableLayer via Object.defineProperty with
 *   configurable:false/writable:false. That broke on any BaseClassX-derived
 *   target: BaseClassX's `get` trap always returns `rawValue.bind(receiver)`,
 *   and the Proxy spec requires a non-configurable, non-writable data
 *   property's get trap to return the exact SameValue -- .bind() returns a
 *   new function every time, so the engine itself threw a native invariant
 *   violation instead of this file's own error.
 *
 *   v2 fixed that by hand-declaring enableLayer/disableLayer as real mixin
 *   methods riding ExtendX's normal per-call dispatch chain, checking a
 *   sealed flag and calling ExtendX.prototype's implementation directly.
 *   That introduced a worse, silent bug: disableLayer(securityMixin) sets
 *   the security mixin's OWN bit to 0, and _resolvePipeline then excludes
 *   the mixin from every subsequent call's chain -- including the very
 *   enableLayer call meant to turn it back on. That call silently no-ops
 *   (empty chain, no throw), and the mixin is permanently excluded from
 *   dispatch from then on. A mixin gating its own on/off switch through
 *   that same switch is self-defeating by construction.
 *
 * The actual fix: this is a composition-time property, not a per-instance,
 * post-hoc lock. createSecurityMixin() sets `locked: true` on the returned
 * mixin; ExtendX.prototype.enableLayer/disableLayer both refuse outright
 * (for every instance, from construction, always) whenever the mixin
 * argument is locked -- general mixins (Logger, Cache, anything not
 * security-shaped) are completely unaffected, since `locked` defaults to
 * unset/false. A security mixin's presence is a decision made once, when
 * extend() composes it in; it was never meant to be something a live
 * instance's holder can flip off and back on, the way a feature layer is.
 *
 * dispose/disposeAsync are a separate problem: ExtendX's own NON_DISPATCH
 * excludes both from normal per-property dispatch entirely (lifecycle
 * hooks, invoked directly, never chained), so there's no dispatch path to
 * hook a check into at all, locked mixin or not. seal() still overrides
 * both directly on the instance -- as an ordinary configurable:true,
 * writable:true function (no Proxy invariant either way, since the
 * property is never made non-configurable).
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
    // reflectable from outside this file. Only gates dispose/disposeAsync
    // now -- enableLayer/disableLayer are refused unconditionally by
    // ExtendX itself (mixin.locked), not something seal() needs to touch.
    const SEALED = new Set();

    function sealedError(name) {
        return new Error(
            'SecurityMixin: "' + name + '" is sealed on this instance. ' +
            'dispose/disposeAsync are locked once seal() has been called -- ' +
            'permanently, for this instance. A fresh, unsealed instance is ' +
            'the only way to get this capability back; there is no unseal().'
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

        // locked (ExtendX.js v1.2.0+): refuses enableLayer/disableLayer for
        // THIS mixin on every instance, unconditionally, from construction
        // onward. Not a per-instance seal -- a property of the mixin's
        // identity, checked by ExtendX.prototype.enableLayer/disableLayer
        // themselves before touching the bit. See the file header for why
        // gating a mixin's own on/off switch through that same switch
        // (the earlier approach) was a self-defeating dead end.
        const mixin = { mixinId: mixinId, locked: true };

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

        // enableLayer/disableLayer are NOT declared here at all -- `locked:
        // true` above (checked by ExtendX.prototype.enableLayer/
        // disableLayer directly) is what refuses them, so this mixin never
        // needs its own versions of either, and ExtendX's normal
        // per-instance attach-if-missing behavior is left untouched.

        // ─── Isolated-proof introspection (not part of the Gen 2 surface) ──
        mixin._securityArmed = function() { return isArmed(this._extId); };
        mixin._securityViolations = function() { return VIOLATIONS.get(this._extId) || 0; };

        return mixin;
    }

    // ─── Seal ─────────────────────────────────────────────────────────
    // enableLayer/disableLayer need nothing here at all -- `locked: true`
    // on the mixin (above) makes ExtendX itself refuse them unconditionally,
    // for every instance, from construction. seal() exists only for
    // dispose/disposeAsync, which are a different problem entirely.
    //
    // dispose/disposeAsync can't ride the normal dispatch chain: ExtendX's own
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
