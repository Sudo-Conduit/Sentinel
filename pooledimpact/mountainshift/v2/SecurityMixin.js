/**
 * SecurityMixin.js — Activation-token-gated dispatch, composed onto any
 * class via ExtendX.extend(). Mirrors the first of Gen 2 kernel.js's three
 * tokens (activation token: proof a call came through a sanctioned path),
 * reimplemented as a reusable, base-class-agnostic mixin instead of
 * hand-written per class.
 *
 * ISOLATED PROOF ONLY at this step. enableLayer/disableLayer are still
 * directly callable on a bare composed instance -- that's ExtendX's normal
 * per-instance API -- so this mixin alone does NOT yet make an instance's
 * security unbypassable: anyone holding the instance could call
 * instance.disableLayer(securityMixin) and turn gating off. Closing that
 * gap is the outer closure factory's job (the Gen 2 MountainShift() pattern
 * discussed alongside this file): only that closure will ever be allowed
 * to touch enableLayer/disableLayer/dispose, and nothing else will ever
 * see a reference to the raw instance at all. This file proves the gating
 * logic itself works before that final wrapping exists.
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

        // ─── Isolated-proof introspection (not part of the Gen 2 surface) ──
        mixin._securityArmed = function() { return isArmed(this._extId); };
        mixin._securityViolations = function() { return VIOLATIONS.get(this._extId) || 0; };

        return mixin;
    }

    return {
        createSecurityMixin: createSecurityMixin,
        // Exposed for the isolated proof/tests only -- a real deployment
        // has no reason to reach these from outside a composed instance's
        // own init/dispose lifecycle.
        _mint: mint,
        _revoke: revoke,
        _isArmed: isArmed
    };
}));
