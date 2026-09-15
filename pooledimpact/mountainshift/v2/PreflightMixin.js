/**
 * @file PreflightMixin.js
 * @author Wilbert Fobbs III / Pooled Impact (ExtendX composition pattern)
 * @version 1.0.0
 * @description Generalizes the shape SecurityMixin.js already uses (a
 *   same-named wrapper per BaseClass.prototype method, checking something
 *   before calling `this.super.<method>()`) into a reusable, declarative
 *   mixin factory: `createPreflightMixin(BaseClass, { before, after })`.
 *   Nothing new is added to ExtendX itself -- the underlying mechanism
 *   (this.super()/next() chain dispatch) already IS preflight/postflight
 *   composition; every mixin method that runs code before and/or after
 *   calling `this.super[name]()` is already both. What this file adds is
 *   NOT having to hand-write that per-method wrapper loop, the mixinId
 *   scheme, and the sync/async result handling every time a new "check
 *   before, react after" concern comes up -- exactly the kind of concern
 *   named in the design discussion this file answers: an egress policy
 *   mixin over Shell's curl calls (rewrite/reject a target before the real
 *   socket opens), or a max-ticks/max-wall-clock budget over Shell's
 *   node/php spawns (refuse or kill past a limit).
 *
 *   `before(ctx)` runs before the real call:
 *     ctx = { method, args, instance }
 *     - throw to veto the call entirely (same as SecurityMixin's pattern)
 *     - return an array to REPLACE args for the real call and every
 *       `after` hook downstream
 *     - return anything else (including undefined) to pass args through
 *       unchanged
 *     - may be async (return a Promise); the whole call becomes a Promise
 *       from that point on, same as ExtendX's own "a thenable anywhere
 *       makes the chain thenable from that point outward" rule
 *
 *   `after(ctx)` runs after the real call resolves:
 *     ctx = { method, args, instance, result }
 *     - return anything other than undefined to REPLACE the result
 *     - return undefined to pass the real result through unchanged
 *     - if the real call's result is a Promise, `after` runs once it
 *       resolves and the wrapper stays a Promise; if it's a synchronous
 *       value, `after` runs synchronously and the wrapper stays synchronous
 *       -- adaptive, matching ExtendX's own dispatch philosophy, not the
 *       "always async" shortcut that would silently change every wrapped
 *       method's calling convention
 *
 *   `only` (optional array of method names) scopes which of BaseClass.
 *   prototype's own methods get wrapped -- default is every public
 *   (non-`_`-prefixed) method, same discovery SecurityMixin.js uses.
 *
 *   mixinId defaults to 'preflight:<BaseClass.name>:<label>' (label
 *   defaults to 'default') so more than one preflight/postflight mixin
 *   can be composed onto the SAME class -- e.g. an egress-policy layer
 *   and a logging layer over Shell, each its own independently
 *   toggleable ExtendX bit. Pass `mixinId` explicitly to control it
 *   directly (required if two mixins for the same class would otherwise
 *   collide on the default label).
 * @tests test/PreflightMixin.test.js
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
        root.PreflightMixin = factory(root.ExtendX);
    }
}(typeof self !== 'undefined' ? self : this, function(ExtendX)
{
    'use strict';
    if (!ExtendX)
    {
        throw new Error('PreflightMixin requires ExtendX to be loaded first');
    }

    /**
     * @param {Function} BaseClass - constructor/class whose prototype methods get wrapped
     * @param {Object} [options={}]
     * @param {Function} [options.before] - (ctx) => void|Array|Promise -- see file header
     * @param {Function} [options.after] - (ctx) => any|Promise -- see file header
     * @param {string[]} [options.only] - method names to wrap; default: every public method
     * @param {string} [options.label='default'] - distinguishes this mixin's id from another preflight/postflight mixin on the same class
     * @param {string} [options.mixinId] - explicit id, overriding the label-derived default
     * @param {boolean} [options.locked=false] - see SecurityMixin.js's header for why a mixin would opt out of enableLayer/disableLayer
     * @returns {Object} the composable mixin object
     * @throws {Error} if BaseClass is not a constructor function/class
     */
    function createPreflightMixin(BaseClass, options)
    {
        if (typeof BaseClass !== 'function')
        {
            throw new Error('PreflightMixin.createPreflightMixin(): BaseClass must be a constructor function/class');
        }
        const opts = options || {};
        const before = typeof opts.before === 'function' ? opts.before : null;
        const after = typeof opts.after === 'function' ? opts.after : null;
        if (!before && !after)
        {
            throw new Error('PreflightMixin.createPreflightMixin(): supply at least one of `before`/`after` -- a mixin with neither does nothing');
        }

        const mixinId = opts.mixinId || ('preflight:' + (BaseClass.name || 'anonymous') + ':' + (opts.label || 'default'));

        const methodNames = Object.getOwnPropertyNames(BaseClass.prototype).filter(function(name)
        {
            if (name === 'constructor') return false;
            if (name.charAt(0) === '_') return false;
            if (Array.isArray(opts.only) && opts.only.indexOf(name) === -1) return false;
            return typeof BaseClass.prototype[name] === 'function';
        });

        const mixin = { mixinId: mixinId };
        if (opts.locked) mixin.locked = true;

        methodNames.forEach(function(name)
        {
            mixin[name] = function(...args)
            {
                const self = this;

                function afterHook(finalArgs, value)
                {
                    if (!after) return value;
                    const rewritten = after({ method: name, args: finalArgs, instance: self, result: value });
                    return rewritten !== undefined ? rewritten : value;
                }

                function proceed(finalArgs)
                {
                    const result = self.super[name].apply(self, finalArgs);
                    if (!after) return result;
                    if (result && typeof result.then === 'function')
                    {
                        return result.then(function(value) { return afterHook(finalArgs, value); });
                    }
                    return afterHook(finalArgs, result);
                }

                if (!before) return proceed(args);

                const decision = before({ method: name, args: args, instance: self });
                if (decision && typeof decision.then === 'function')
                {
                    return decision.then(function(maybeArgs)
                    {
                        return proceed(Array.isArray(maybeArgs) ? maybeArgs : args);
                    });
                }
                return proceed(Array.isArray(decision) ? decision : args);
            };
        });

        return mixin;
    }

    return {
        createPreflightMixin: createPreflightMixin,
        name: 'PreflightMixin',
        author: 'Wilbert Fobbs III / Pooled Impact (ExtendX composition pattern)',
        version: '1.0.0',
        description: 'Declarative before/after wrapper mixin factory over any class\'s public methods, composed via ExtendX.extend() -- the reusable shape SecurityMixin.js already used once, generalized.',
        tests: ['test/PreflightMixin.test.js']
    };
}));
