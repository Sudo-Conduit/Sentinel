/**
 * @file SecurityMixin.js
 * @author Wilbert Fobbs III / Pooled Impact (ExtendX composition pattern)
 * @version 3.0.0
 * @description Activation-token-gated dispatch, composed onto any class via
 *   ExtendX.extend(). Mirrors the first of Gen 2 kernel.js's three tokens
 *   (activation token: proof a call came through a sanctioned path),
 *   reimplemented as a reusable, base-class-agnostic mixin instead of
 *   hand-written per class.
 *
 *   v3: enableLayer/disableLayer are handled by ExtendX itself now
 *   (ExtendX.js v1.2.0's `mixin.locked` check), not by this file. Two earlier
 *   attempts both failed for reasons worth keeping on record:
 *
 *     v1 sealed enableLayer/disableLayer via Object.defineProperty with
 *     configurable:false/writable:false. That broke on any BaseClassX-derived
 *     target: BaseClassX's `get` trap always returns `rawValue.bind(receiver)`,
 *     and the Proxy spec requires a non-configurable, non-writable data
 *     property's get trap to return the exact SameValue -- .bind() returns a
 *     new function every time, so the engine itself threw a native invariant
 *     violation instead of this file's own error.
 *
 *     v2 fixed that by hand-declaring enableLayer/disableLayer as real mixin
 *     methods riding ExtendX's normal per-call dispatch chain, checking a
 *     sealed flag and calling ExtendX.prototype's implementation directly.
 *     That introduced a worse, silent bug: disableLayer(securityMixin) sets
 *     the security mixin's OWN bit to 0, and _resolvePipeline then excludes
 *     the mixin from every subsequent call's chain -- including the very
 *     enableLayer call meant to turn it back on. That call silently no-ops
 *     (empty chain, no throw), and the mixin is permanently excluded from
 *     dispatch from then on. A mixin gating its own on/off switch through
 *     that same switch is self-defeating by construction.
 *
 *   The actual fix: this is a composition-time property, not a per-instance,
 *   post-hoc lock. createSecurityMixin() sets `locked: true` on the returned
 *   mixin; ExtendX.prototype.enableLayer/disableLayer both refuse outright
 *   (for every instance, from construction, always) whenever the mixin
 *   argument is locked -- general mixins (Logger, Cache, anything not
 *   security-shaped) are completely unaffected, since `locked` defaults to
 *   unset/false. A security mixin's presence is a decision made once, when
 *   extend() composes it in; it was never meant to be something a live
 *   instance's holder can flip off and back on, the way a feature layer is.
 *
 *   dispose/disposeAsync are a separate problem: ExtendX's own NON_DISPATCH
 *   excludes both from normal per-property dispatch entirely (lifecycle
 *   hooks, invoked directly, never chained), so there's no dispatch path to
 *   hook a check into at all, locked mixin or not. seal() still overrides
 *   both directly on the instance -- as an ordinary configurable:true,
 *   writable:true function (no Proxy invariant either way, since the
 *   property is never made non-configurable).
 * @tests test/CPU.security.test.js
 * @tests test/Physical.security.test.js
 * @tests test/Kernel.security.test.js
 * @tests test/BIOS.security.test.js
 * @tests test/Memory.security.test.js
 * @tests test/PreMixed.hazard.test.js
 */
(function(root, factory)
{
    if (typeof define === 'function' && define.amd)
    {
        define(['./ExtendX.js'], factory);
    }
    else if (typeof module === 'object' && module.exports)
    {
        module.exports = factory(require('./ExtendX.js'));
    }
    else
    {
        root.SecurityMixin = factory(root.ExtendX);
    }
}(typeof self !== 'undefined' ? self : this, function(ExtendX)
{
    'use strict';
    if (!ExtendX)
    {
        throw new Error('SecurityMixin requires ExtendX to be loaded first');
    }

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

    /**
     * Mint and store a fresh activation token for extId.
     * @param {string} extId - the instance's ExtendX-minted id
     * @returns {string} the minted token
     */
    function mint(extId)
    {
        const token = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : 'tok_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
        TOKENS.set(extId, { token: token, mintedAt: Date.now() });
        return token;
    }

    /**
     * Revoke extId's activation token (e.g. on dispose).
     * @param {string} extId - the instance's ExtendX-minted id
     * @returns {void}
     */
    function revoke(extId)
    {
        TOKENS.delete(extId);
    }

    /**
     * @param {string} extId - the instance's ExtendX-minted id
     * @returns {boolean} true if extId currently holds an activation token
     */
    function isArmed(extId)
    {
        return TOKENS.has(extId);
    }

    /**
     * @param {string} extId - the instance's ExtendX-minted id
     * @returns {void}
     */
    function recordViolation(extId)
    {
        VIOLATIONS.set(extId, (VIOLATIONS.get(extId) || 0) + 1);
    }

    // ─── Fingerprinting (verify) ────────────────────────────────────────
    // Same hashString() algorithm BaseClassX itself uses for
    // computeFingerprint() -- deliberately not a new scheme, so this stays
    // consistent with how the rest of the codebase already reasons about
    // integrity. This is a character-level (toString()) content check, NOT
    // reference-identity: a hand-merged "pre-mixed" mixin (see the
    // PreMixed hazard) can hold a DIFFERENT object than the one
    // createSecurityMixin() returned, reusing the same mixinId, with some
    // method slots silently replaced by an unrelated mixin's
    // implementation -- reference equality wouldn't even be askable in
    // that case (it's a different object), but the SOURCE TEXT of the
    // replaced method differs from what was recorded at creation time, and
    // that's what this catches. This is a diagnostic/testing aid, not a
    // security control: toString() output is fully visible and trivially
    // reproducible, so it cannot stop a deliberate forgery -- it exists to
    // catch accidental silent overwrites (the actual hazard demonstrated),
    // not a malicious actor who bothers to match hashes.
    const MIXIN_FINGERPRINTS = new Map(); // mixinId -> { methodName: hash }

    /**
     * @param {string} str - source text to hash
     * @returns {string} a base36 hash of str
     */
    function hashString(str)
    {
        let hash = 0;
        for (let i = 0; i < str.length; i++)
        {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * @param {Object} mixin - a mixin object
     * @returns {Object} map of methodName -> source-hash for every function on mixin
     */
    function fingerprintMixin(mixin)
    {
        const fp = {};
        Object.keys(mixin).forEach(function(key)
        {
            if (typeof mixin[key] === 'function')
            {
                fp[key] = hashString(mixin[key].toString());
            }
        });
        return fp;
    }

    /**
     * Compare a mixin object's CURRENT method source against what
     * createSecurityMixin() recorded for this mixinId at creation time.
     *
     * @param {Object} mixin - the mixin object to verify
     * @returns {{verified: boolean, problems: string[], extraMethods: string[]}}
     *   verified     -- true only if every recorded method is present with
     *                    an unchanged toString() hash.
     *   problems     -- human-readable list of missing/changed methods.
     *   extraMethods -- method names present now that weren't part of the
     *                    original recording (e.g. a merge added them) --
     *                    informational, not necessarily itself a problem.
     */
    function verify(mixin)
    {
        if (!mixin || typeof mixin.mixinId !== 'string')
        {
            return { verified: false, problems: ['mixin has no string mixinId to look up'], extraMethods: [] };
        }
        const expected = MIXIN_FINGERPRINTS.get(mixin.mixinId);
        if (!expected)
        {
            return { verified: false, problems: ['unknown mixinId "' + mixin.mixinId + '" -- no fingerprint was ever recorded for it'], extraMethods: [] };
        }
        const actual = fingerprintMixin(mixin);
        const problems = [];
        Object.keys(expected).forEach(function(name)
        {
            if (!(name in actual))
            {
                problems.push(name + ': missing (present at creation, absent now)');
            }
            else if (actual[name] !== expected[name])
            {
                problems.push(name + ': content changed (toString() hash mismatch -- likely overwritten by an outside merge)');
            }
        });
        const extraMethods = Object.keys(actual).filter(function(name)
        {
            return !(name in expected);
        });
        return { verified: problems.length === 0, problems: problems, extraMethods: extraMethods };
    }

    // ─── Sealed state ───────────────────────────────────────────────────
    // Keyed by extId like TOKENS -- a closure-private flag, not a property
    // on the instance, so nothing about "is this sealed" is reachable or
    // reflectable from outside this file. Only gates dispose/disposeAsync
    // now -- enableLayer/disableLayer are refused unconditionally by
    // ExtendX itself (mixin.locked), not something seal() needs to touch.
    const SEALED = new Set();

    /**
     * @param {string} name - "dispose" or "disposeAsync"
     * @returns {Error} a descriptive sealed-instance error
     */
    function sealedError(name)
    {
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
     *
     * @param {Function} BaseClass - constructor/class whose prototype methods get wrapped
     * @returns {Object} the composable security mixin object
     * @throws {Error} if BaseClass is not a constructor function/class
     */
    function createSecurityMixin(BaseClass)
    {
        if (typeof BaseClass !== 'function')
        {
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
        const methodNames = Object.getOwnPropertyNames(BaseClass.prototype).filter(function(name)
        {
            if (name === 'constructor')
            {
                return false;
            }
            if (name.charAt(0) === '_')
            {
                return false;
            }
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

        methodNames.forEach(function(name)
        {
            mixin[name] = function()
            {
                const extId = this._extId;
                if (!isArmed(extId))
                {
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
        mixin.init = function()
        {
            mint(this._extId);
        };
        mixin.dispose = function()
        {
            revoke(this._extId);
        };

        // enableLayer/disableLayer are NOT declared here at all -- `locked:
        // true` above (checked by ExtendX.prototype.enableLayer/
        // disableLayer directly) is what refuses them, so this mixin never
        // needs its own versions of either, and ExtendX's normal
        // per-instance attach-if-missing behavior is left untouched.

        // ─── Isolated-proof introspection (not part of the Gen 2 surface) ──
        mixin._securityArmed = function()
        {
            return isArmed(this._extId);
        };
        mixin._securityViolations = function()
        {
            return VIOLATIONS.get(this._extId) || 0;
        };

        // Record the fingerprint LAST, after every method above is in
        // place, so verify() has the complete, correct picture of what
        // this mixinId is supposed to look like.
        MIXIN_FINGERPRINTS.set(mixinId, fingerprintMixin(mixin));

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
    /**
     * Permanently disable dispose/disposeAsync on instance.
     * @param {Object} instance - a composed instance carrying `_extId`
     * @returns {Object} the same instance, for chaining
     */
    function seal(instance)
    {
        SEALED.add(instance._extId);
        ['dispose', 'disposeAsync'].forEach(function(name)
        {
            Object.defineProperty(instance, name, {
                value: function()
                {
                    throw sealedError(name);
                },
                enumerable: false,
                configurable: true,
                writable: true
            });
        });
        return instance;
    }

    /**
     * @param {Object} instance - a composed instance carrying `_extId`
     * @returns {boolean} true if seal() has been called on instance
     */
    function isSealed(instance)
    {
        return SEALED.has(instance._extId);
    }

    return {
        createSecurityMixin: createSecurityMixin,
        seal: seal,
        isSealed: isSealed,
        verify: verify,
        // Exposed for the isolated proof/tests only -- a real deployment
        // has no reason to reach these from outside a composed instance's
        // own init/dispose lifecycle.
        _mint: mint,
        _revoke: revoke,
        _isArmed: isArmed,
        name: 'SecurityMixin',
        author: 'Wilbert Fobbs III / Pooled Impact (ExtendX composition pattern)',
        version: '3.0.0',
        description: 'Activation-token-gated dispatch, composed onto any class via ExtendX.extend() -- proof a call came through a sanctioned path.',
        tests: [
            'test/CPU.security.test.js',
            'test/Physical.security.test.js',
            'test/Kernel.security.test.js',
            'test/BIOS.security.test.js',
            'test/Memory.security.test.js',
            'test/PreMixed.hazard.test.js'
        ]
    };
}));
