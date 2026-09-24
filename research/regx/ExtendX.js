/**
 * ExtendX.js — MountainShift OS Runtime Composition Engine
 *
 * Author: Wilbert Fobbs III
 * Company: Pooled Impact
 *
 * v1.2.0  (extracted from BaseClassX_Decoupled, v2.3.01-async lineage)
 *
 * v1.2.0 changelog (1.1.0 -> 1.2.0) -- three real, confirmed bugs found
 * while hardening ExtendX/SQL2Regex/HTTP together:
 *  1. reindex() could silently shift an already-registered mixin's bit
 *     position (a new, alphabetically-earlier mixinId registered on an
 *     unrelated class) without bumping REGISTRY_GENERATION, so
 *     PIPELINE_CACHE/METHOD_CACHE kept serving pre-shift results under a
 *     mask token the shift had changed the meaning of -- confirmed for
 *     real: an instance's disableLayer() silently reverted after a wholly
 *     unrelated extend() call elsewhere. Now bumps generation and warns
 *     whenever a shift actually happens (extend() and override() both).
 *  2. makeDispatcher() unconditionally appended a `next` callback to
 *     EVERY dispatched call, even the innermost link with no layer below
 *     it to call. For any handler invoked with fewer real arguments than
 *     parameters it declares, the injected `next` landed in the gap --
 *     confirmed for real via HTTP.js: every bare, no-argument command call
 *     (HTTP.run('session'), HTTP.run('retrieve'), etc.) received a
 *     stringified function instead of undefined/empty input. `next` is
 *     now only appended when a genuine layer exists below.
 *  3. The Subclass constructor hardcoded its own closure-captured
 *     `Subclass` as Reflect.construct's newTarget instead of propagating
 *     the real new.target, so composing ExtendX on top of an ALREADY
 *     extend()-composed base (ExtendX.extend(HTTP, SomeMixin), exactly
 *     what SQLRegex.js does) silently set every constructed instance's
 *     prototype to the INNER class, not the outer one -- the outer
 *     layer's own methods were unreachable on every instance, confirmed
 *     for real (present in the original files, not introduced by this
 *     hardening pass): `instance.sql is not a function`. Now propagates
 *     new.target so nested composition works like a real `class X
 *     extends Y` chain's super() calls do.
 *
 * Runtime subclassing and mixin composition WITHOUT the `extends` keyword and
 * without requiring BaseClassX. ExtendX.extend(AnyClass, ...mixins) composes on
 * top of any constructor -- a plain ES class, a function, a third-party base --
 * so composition is available in contexts where BaseClassX is not an option.
 *
 * Provides:
 * - extend(): ordered, runtime-toggleable mixin composition over any base
 * - async-capable middleware chain dispatch (this.super.m() / next())
 * - per-instance bitmask layer toggling (enableLayer / disableLayer)
 * - deliberate mixinId override as a hot-swap across composed classes
 * - chain discovery (mixins(prop) / activeMixins() / explain(prop))
 * - Von Neumann relational set inspection over layer masks
 * - Base36 cache-token generation for a pipeline configuration
 *
 * Chain dispatch notes:
 *   * each layer runs on a frame-local `this` (own `super`), so awaiting
 *     layers cannot clobber each other's super binding;
 *   * the cursor is an index passed down, never a destructive pop, so a layer
 *     may call down more than once (parallel fan-out);
 *   * adaptive -- sync chains stay sync, a thenable anywhere makes the chain
 *     thenable from that point outward;
 *   * `next` is passed as a trailing argument for (req, res, next) middleware.
 *
 * ExtendX carries the composition surface only. BaseClassX keeps trace, schema,
 * events, graph linking, and disposal; where both are present BaseClassX may
 * delegate composition here rather than reimplementing it.
 *
 * @author Wilbert Fobbs III
 * @company Pooled Impact
 * @license Proprietary — All Rights Reserved
 */
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ExtendX = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {

    'use strict';

    // ─── Private State ──────────────────────────────────────────
    // Not exposed. Lives in the closure.

    const AUTHOR = 'Wilbert Fobbs III';
    const COMPANY = 'Pooled Impact';
    const VERSION = '1.2.0';

    // Mask state is kept OFF the instance.
    //
    // Writing _maskState (or `super`) onto the instance makes ExtendX invasive,
    // and a strict base rejects it outright: BaseClassX wraps instances in a
    // validating Proxy whose set trap is `if (prop in target || schemaApproved)`,
    // so any property ExtendX introduces after construction is refused and
    // composition dies with "trap returned falsish for property '_maskState'".
    // A WeakMap means ExtendX adds no properties to any base, strict or not.
    const MASKS = new WeakMap();

    // mixinId -> mixin object.
    //
    // The registry is the SOURCE OF TRUTH for what an id currently means.
    // Composed classes keep their declared mixin objects in _rawMixins, but
    // dispatch resolves each one through here by id -- so replacing an id's
    // implementation reaches every class already composed with it, with no
    // bookkeeping and no rebuild. That is what makes override a hot-swap
    // rather than a re-compose.
    const REGISTERED = new Map();

    // cacheToken -> resolved pipeline, per composed class. _resolvePipeline
    // copies, sorts and filters on EVERY method call, which for a request
    // pipeline is several allocations before the handler runs. The token
    // already identifies a mask exactly, so it is the correct memo key.
    const PIPELINE_CACHE = new WeakMap();

    // Second memo level: composed class -> ("prop|token|generation" -> resolved
    // function array). Saves the per-call filter/map on hot methods.
    const METHOD_CACHE = new WeakMap();

    // mixinId -> composed classes using it. override() needs this to install
    // wrappers for method names a replacement introduces; without it a
    // late-added method sits on the mixin, is reachable by hand, and is
    // silently never dispatched. Composed classes are application-lifetime
    // objects, so a strong Set is acceptable here.
    const USERS = new Map();
    function trackUser(mixinId, Subclass) {
        let s = USERS.get(mixinId);
        if (!s) { s = new Set(); USERS.set(mixinId, s); }
        s.add(Subclass);
    }

    // Bumped whenever an id's implementation is replaced. Folded into the memo
    // key so a swap cannot serve a stale resolved chain -- cacheToken itself
    // stays a pure function of the mask, since the mask is what it describes.
    let REGISTRY_GENERATION = 0;

    // Symbol.dispose / Symbol.asyncDispose are recent; fall back to the
    // well-known registry so `using` semantics still work on older engines
    // once a polyfill installs the real symbols.
    const DISPOSE = typeof Symbol.dispose === 'symbol' ? Symbol.dispose : Symbol.for('Symbol.dispose');
    const ASYNC_DISPOSE = typeof Symbol.asyncDispose === 'symbol' ? Symbol.asyncDispose : Symbol.for('Symbol.asyncDispose');

    // Disposal is idempotent and must be observable, but a strict base rejects
    // new instance properties, so the flag lives in a side table like the mask.
    const DISPOSED = new WeakSet();

    // Compute-loop timer and deferred task queue, per instance. Off-instance
    // for the same reason.
    const LOOPS = new WeakMap();

    // Pending async init promises, per instance: mixinId -> promise.
    //
    // The constructor cannot await, so an async init hook is invoked and its
    // promise recorded here. initParallel then AWAITS those recorded promises
    // rather than calling init again -- without this the hook runs twice, once
    // fire-and-forget at construction and once more on the explicit call.
    const PENDING_INIT = new WeakMap();
    function loopState(obj) {
        let s = LOOPS.get(obj);
        if (!s) { s = { timer: null, queue: [] }; LOOPS.set(obj, s); }
        return s;
    }

    // ─── Private Helpers ───────────────────────────────────────

    function getMask(obj) {
        let m = MASKS.get(obj);
        if (!m) {
            const d = obj && obj.constructor && obj.constructor._defaultMaskState;
            m = d ? [d[0], [...d[1]]] : [1, []];
            MASKS.set(obj, m);
        }
        return m;
    }

    function setMask(obj, mask) {
        MASKS.set(obj, mask);
        return mask;
    }

    // Base36 scalar identity for a mask. Shared by the cacheToken getter and
    // the pipeline memo, so a configuration and its cached resolved pipeline
    // can never disagree about which mask they describe.
    function tokenFor(mask) {
        const [globalOverride, bitArray] = mask;
        if (globalOverride === 0) return '0';
        // Normalize holes to 1 (implicitly-on) so a mask that was never grown
        // and one explicitly filled with 1s produce the SAME token -- otherwise
        // 'undefined' would stringify into the binary literal and throw.
        const binary = Array.from(bitArray, b => (b === 0 ? 0 : 1)).reverse().join('');
        if (!binary) return '1';
        return (((BigInt('0b' + binary)) << 1n) | BigInt(globalOverride)).toString(36);
    }

    // Current implementation for a declared mixin: the registry's entry for its
    // id, falling back to the object itself if it was never registered.
    function current(m) {
        return REGISTERED.get(m.mixinId) || m;
    }

    // Reindex every known mixin. A new id inserted alphabetically before an
    // existing one shifts the positions after it, so previously assigned
    // indices must move too or old and new classes disagree about bit meaning.
    //
    // Returns the ids whose _bitIndex actually changed -- extend() uses this
    // to decide whether the registration it just performed needs to bump
    // REGISTRY_GENERATION and warn. A shift is not just a caching concern:
    // an already-constructed instance's _maskState array holds explicit
    // toggle bits at fixed positions, and a shift retroactively changes
    // which mixin an already-set bit refers to -- an instance that had a
    // layer disabled can silently read as enabled again (or vice versa)
    // after a wholly unrelated extend() call elsewhere registers a new,
    // alphabetically-earlier mixinId. Confirmed for real: disableLayer a
    // mixin at bit 0, register an unrelated mixin whose id sorts first
    // (shifting the original to bit 1), then resolve the same mask fresh
    // (uncached) -- the disabled layer comes back active, no error, no
    // warning, because bitArray[1] is undefined and undefined reads as
    // "enabled" (the documented, correct default for a never-configured
    // slot -- it just no longer describes the same mixin it used to).
    function reindex() {
        const ids = Array.from(REGISTERED.keys()).sort();
        const shifted = [];
        ids.forEach((id, i) => {
            const m = REGISTERED.get(id);
            if (m._bitIndex !== undefined && m._bitIndex !== i) shifted.push(id);
            m._bitIndex = i;
        });
        return { ids, shifted };
    }

    // ─── Dispatch wrapper factory ───────────────────────────────
    //
    // Fast dispatch: a real function installed on Subclass.prototype, so there
    // is no proxy get-trap on every property access and methods are enumerable
    // and introspectable. The cost is that the set of wrapped names is decided
    // when the wrapper is installed -- see installWrappers, which override()
    // calls again so a replacement introducing a NEW method name still gets
    // one. Without that top-up, a late-added method is present on the mixin,
    // reachable by hand, and silently never dispatched.
    function makeDispatcher(Subclass, BaseClass, prop) {
        return function(...methodArgs) {
            const receiver = this;
            const mask = getMask(receiver);

            // Two-level memo. _resolvePipeline caches the active mixin list per
            // mask; this caches the resolved FUNCTION array per method per mask,
            // so a hot method skips the filter/map/unshift entirely. The key
            // carries the registry generation, so an override invalidates it.
            const mKey = String(prop) + '|' + tokenFor(mask) + '|' + REGISTRY_GENERATION;
            let methodCache = METHOD_CACHE.get(Subclass);
            if (!methodCache) { methodCache = new Map(); METHOD_CACHE.set(Subclass, methodCache); }

            let chain = methodCache.get(mKey);
            if (!chain) {
                chain = Subclass._resolvePipeline(mask)
                    .filter(mixin => typeof mixin[prop] === 'function')
                    .map(mixin => mixin[prop]);
                const baseMethod = BaseClass.prototype[prop];
                if (typeof baseMethod === 'function') chain.unshift(baseMethod);
                methodCache.set(mKey, chain);
            }

            // Index cursor, NOT a destructive pop. Popping consumes the chain,
            // so two calls to this.super.m() from the SAME layer -- a parallel
            // fan-out, Promise.all([this.super.m(), this.super.m()]) -- eat the
            // same array: the first drains it and the second returns undefined,
            // silently.
            const invokeNext = (cursor, ...args) => {
                if (cursor < 0) return undefined;
                const currentMethod = chain[cursor];

                // Frame-local view of the instance.
                //
                // Object.create(receiver) is wrong here: reads resolve up the
                // prototype chain, but a WRITE (this._hits++) creates an own
                // property on the throwaway frame and vanishes when the layer
                // returns -- a plugin holding state silently never persists it.
                // A forwarding proxy instead: every get and set reaches the real
                // instance, with `super` the single frame-local exception. That
                // keeps concurrent layers from clobbering each other's super
                // binding without detaching them from the instance.
                const layerSuper = Object.create(receiver.super || null);
                const below = cursor - 1;
                const frame = new Proxy(receiver, {
                    get(t, p) { return p === 'super' ? layerSuper : t[p]; },
                    set(t, p, v) { if (p === 'super') return true; t[p] = v; return true; },
                    has(t, p) { return p === 'super' ? true : (p in t); }
                });

                // A synchronous layer cannot await, so if the layer below
                // returns a promise the sync layer has no way to unwrap it --
                // `return this.super.m() + 'x'` yields "[object Promise]x". No
                // dispatch strategy can fix that; what dispatch CAN do is refuse
                // to let it pass silently.
                let downstreamAsync = false;
                const observe = (v) => {
                    if (v && typeof v.then === 'function') downstreamAsync = true;
                    return v;
                };
                const next = (...nextArgs) =>
                    observe(invokeNext(below, ...(nextArgs.length ? nextArgs : args)));
                layerSuper[prop] = (...superArgs) => observe(invokeNext(below, ...superArgs));

                // `next` is only meaningful when there is an actual layer
                // below this one to call -- for the innermost link (below
                // < 0, nothing left to invoke) it is dead weight, and
                // dead weight that silently corrupts callers: appending it
                // unconditionally means any handler called with FEWER
                // real arguments than parameters it declares receives
                // `next` itself in the gap. Confirmed for real and NOT
                // theoretical: HTTP.js dispatches its own run(input,
                // ...args) through this exact mechanism (BaseHTTP.run +
                // CommandMixin.run is a real two-layer chain), and a bare
                // no-argument call like run('session') put the injected
                // `next` into run()'s own `...args` rest parameter, which
                // CommandMixin.run then forwarded verbatim as the target
                // command's sole argument -- HTTP.run('session'),
                // HTTP.run('cache'), HTTP.run('retrieve'), HTTP.run('delete'),
                // and HTTP.run('validate') (every bare command whose handler
                // declares a parameter) all silently received a stringified
                // function instead of undefined/empty input.
                const result = below >= 0
                    ? currentMethod.apply(frame, args.concat(next))
                    : currentMethod.apply(frame, args);

                if (downstreamAsync && !(result && typeof result.then === 'function')) {
                    throw new Error(
                        'ExtendX chain: a synchronous layer of "' + String(prop) + '" received a ' +
                        'promise from the layer below and returned a non-promise (' + typeof result + '). ' +
                        'A sync function cannot await, so the downstream result was discarded or ' +
                        'stringified. Make this layer async and await this.super.' + String(prop) + '(), ' +
                        'or return the promise unmodified.'
                    );
                }
                return result;
            };

            return invokeNext(chain.length - 1, ...methodArgs);
        };
    }

    // Names a mixin contributes to dispatch. init/dispose are lifecycle hooks
    // invoked directly, not chained; the rest is bookkeeping.
    const NON_DISPATCH = new Set(['init', 'dispose', 'mixinId', '_bitIndex', 'overrides']);

    function dispatchKeys(mixin) {
        return Object.keys(mixin).filter(k =>
            !NON_DISPATCH.has(k) && typeof mixin[k] === 'function');
    }

    /**
     * Install (or top up) dispatch wrappers on a composed class.
     *
     * Idempotent and additive: called once at extend(), and again by override()
     * for any method name the replacement introduces.
     */
    function installWrappers(Subclass) {
        const BaseClass = Subclass._extendXBase;
        const installed = Subclass._wrapped || (Subclass._wrapped = new Set());
        (Subclass._rawMixins || []).forEach(m => {
            dispatchKeys(current(m)).forEach(key => {
                if (installed.has(key)) return;
                installed.add(key);
                Object.defineProperty(Subclass.prototype, key, {
                    value: makeDispatcher(Subclass, BaseClass, key),
                    enumerable: false, configurable: true, writable: true
                });
            });
        });
        return Subclass;
    }

    // ─── ExtendX Class ──────────────────────────────────────────

    class ExtendX {
        constructor(options = {}) {
            this.id = options.id || 'node_' + Math.random().toString(36).substring(2, 7);
            this.state = options.state || 'initialized';
            getMask(this);
        }

        // ─── Authorship Info ────────────────────────────────────

        static get author() { return AUTHOR; }
        static get company() { return COMPANY; }
        static get version() { return VERSION; }

        get author() { return AUTHOR; }
        get company() { return COMPANY; }
        get version() { return VERSION; }

        // ─── Read-only view for callers that reference `_maskState` ──

        get _maskState() { return getMask(this); }
        set _maskState(v) { setMask(this, v); }

        // ─── Introspection API ──────────────────────────────────

        /**
         * Chain discovery.
         *
         *   mixins()        -> every declared mixin, in declaration order
         *   mixins(prop)    -> the chain that WILL run for prop, dispatch order
         *                      first to last, with '<base>' where the base
         *                      method sits
         *
         * The second form is the answer to "why isn't my layer running". Two
         * bugs found while hardening this were invisible without it: a mixin
         * dropped because its bit index fell outside the mask array, and
         * disableLayer being swallowed by chain dispatch. Either would have
         * shown instantly as a missing entry here.
         */
        mixins(prop) {
            const C = this.constructor;
            if (prop === undefined) return C._rawMixins ? [...C._rawMixins] : [];
            return ExtendX.mixins(C, prop, getMask(this));
        }

        /** Active layers only, honouring this instance's mask. */
        activeMixins() {
            const C = this.constructor;
            if (typeof C._resolvePipeline !== 'function') return [];
            return [...C._resolvePipeline(getMask(this))].reverse();
        }

        /** One-line human-readable chain, e.g. "handle: Log -> Auth -> <base>". */
        explain(prop) {
            const chain = this.mixins(prop);
            return String(prop) + ': ' + (chain.length ? chain.join(' -> ') : '(nothing dispatches)');
        }

        hasMixin(mixin) {
            if (!this.constructor._rawMixins) return false;
            return this.constructor._rawMixins.includes(mixin);
        }

        // ─── Instance Bitmask Control ───────────────────────────

        enableLayer(mixin) {
            if (mixin._bitIndex === undefined) return this;
            const bits = getMask(this)[1];
            for (let i = bits.length; i < mixin._bitIndex; i++) bits[i] = 1;
            bits[mixin._bitIndex] = 1;
            return this;
        }

        disableLayer(mixin) {
            if (mixin._bitIndex === undefined) return this;
            const bits = getMask(this)[1];
            // Assigning past the end extends the array; the holes it creates
            // read as implicitly-on, which is the correct default for a layer
            // registered after this instance's class was composed.
            for (let i = bits.length; i < mixin._bitIndex; i++) bits[i] = 1;
            bits[mixin._bitIndex] = 0;
            return this;
        }

        toggleAllLayers(enabled) {
            getMask(this)[0] = enabled ? 1 : 0;
            return this;
        }

        get cacheToken() {
            return tokenFor(getMask(this));
        }

        get disposed() { return DISPOSED.has(this); }

        // ─── Compute loop ───────────────────────────────────────
        //
        // Drives continuous recalculation and rendering. Returns a lifecycle
        // handle rather than starting immediately, so a caller decides when.
        // main() and render() are plain hooks -- a mixin that defines either
        // one joins the dispatch chain for it like any other method.
        compute(mode = 'canvas', canvasIdOrContext = null, fps = 60) {
            const intervalMs = Math.max(1, Math.floor(1000 / fps));
            const self = this;
            let ctx = null;

            if (mode === 'canvas' && canvasIdOrContext) {
                ctx = typeof canvasIdOrContext === 'string'
                    ? (typeof document !== 'undefined' ? document.getElementById(canvasIdOrContext)?.getContext('2d') : null)
                    : canvasIdOrContext;
            }

            const lifecycle = {
                start: () => {
                    const st = loopState(self);
                    if (st.timer) return lifecycle;
                    if (DISPOSED.has(self)) throw new Error('ExtendX.compute(): instance is disposed');
                    st.timer = setInterval(() => {
                        try {
                            self.flushQueue();
                            self.main();
                            if (mode === 'canvas' && ctx) self.render(mode, ctx);
                            else {
                                if (mode === 'console' && typeof console.clear === 'function') console.clear();
                                self.render(mode);
                            }
                        } catch (err) {
                            lifecycle.rescue(err);
                        }
                    }, intervalMs);
                    return lifecycle;
                },
                stop: () => {
                    const st = loopState(self);
                    if (st.timer) { clearInterval(st.timer); st.timer = null; }
                    return lifecycle;
                },
                get running() { return !!loopState(self).timer; },
                schedule: (task) => { loopState(self).queue.push(task); return lifecycle; },
                rescue: (error) => {
                    console.error('[ExtendX compute loop] halted:', error);
                    lifecycle.stop();
                }
            };
            return lifecycle;
        }

        main() { /* dispatch hook */ }
        render(mode, ctx) { /* dispatch hook */ }

        /** Run and clear every queued task. Errors do not stop the queue. */
        flushQueue() {
            const st = loopState(this);
            while (st.queue.length > 0) {
                const task = st.queue.shift();
                if (typeof task !== 'function') continue;
                try { task.call(this); }
                catch (e) { console.error('[ExtendX queue] task failed:', e); }
            }
            return this;
        }

        schedule(task) { loopState(this).queue.push(task); return this; }

        // ─── Explicit resource disposal ─────────────────────────
        //
        // Fires when an instance leaves a `using` block. Stops the loop, drops
        // queued work, runs each active mixin's dispose hook, and collapses the
        // mask to the empty set -- so cacheToken becomes "0" and the pipeline
        // resolves to nothing, which is what a disposed composition should mean.
        //
        // Idempotent: `using` can dispose an instance that a caller already
        // disposed by hand, and a mixin's dispose must not run twice.
        [DISPOSE]() {
            if (DISPOSED.has(this)) return;
            DISPOSED.add(this);

            const st = loopState(this);
            if (st.timer) { clearInterval(st.timer); st.timer = null; }
            st.queue.length = 0;

            // Through current(), so an overridden id disposes with its
            // replacement's hook rather than the original's.
            const declared = this.constructor._rawMixins || [];
            declared.forEach(m => {
                const impl = current(m);
                if (typeof impl.dispose === 'function') {
                    try { impl.dispose.call(this); }
                    catch (e) { console.error('[ExtendX dispose] mixin "' + m.mixinId + '" failed:', e); }
                }
            });

            // cacheToken is a getter over the mask, so collapsing the mask IS
            // setting the token -- there is no separate field to write.
            setMask(this, [0, []]);
        }

        /**
         * Async counterpart for `await using`. Awaits any mixin dispose hook
         * that returns a thenable, then performs the synchronous teardown.
         */
        async [ASYNC_DISPOSE]() {
            if (DISPOSED.has(this)) return;
            const declared = this.constructor._rawMixins || [];
            const pending = declared
                .map(m => current(m))
                .filter(impl => typeof impl.dispose === 'function')
                .map(impl => { try { return Promise.resolve(impl.dispose.call(this)); } catch (e) { return Promise.reject(e); } });
            const settled = await Promise.allSettled(pending);
            settled.forEach(r => { if (r.status === 'rejected') console.error('[ExtendX asyncDispose] hook failed:', r.reason); });

            DISPOSED.add(this);
            const st = loopState(this);
            if (st.timer) { clearInterval(st.timer); st.timer = null; }
            st.queue.length = 0;
            setMask(this, [0, []]);
        }

        // ─── Static Methods ─────────────────────────────────────

        static extend(BaseClass, ...args) {
            let options = { order: 'left-right' };
            let mixins = args;

            // Isolate configuration block from structural mixins
            if (args.length > 0 &&
                typeof args[args.length - 1] === 'object' &&
                !args[args.length - 1].prototype &&
                !('init' in args[args.length - 1])) {
                const lastArg = args[args.length - 1];
                if ('order' in lastArg || 'custommap' in lastArg || 'array' in lastArg) {
                    options = { ...options, ...args.pop() };
                    mixins = args;
                }
            }

            // ─── Deterministic bit assignment ──────────────────
            //
            // Load order is NOT usable: a mixin's bit position decides its
            // place in the cacheToken, so two processes loading the same mixins
            // in different order would produce different tokens for an
            // identical configuration -- destroying the token's main use as a
            // portable cache key. Position is the mixin's index in the
            // ALPHABETICALLY SORTED list of every mixinId ever registered.
            const overriddenIds = [];
            mixins.forEach(m => {
                if (!m.mixinId || typeof m.mixinId !== 'string') {
                    throw new Error('ExtendX.extend(): every mixin needs a stable string mixinId for deterministic bit assignment');
                }
                const owner = REGISTERED.get(m.mixinId);
                if (owner && owner !== m) {
                    // Two intents share this shape, and only the caller knows
                    // which:
                    //   accidental collision -- two unrelated mixins that
                    //     happen to pick the same id. They would share a bit,
                    //     so disableLayer on either toggles both. Silently
                    //     allowing it is the bug the guard exists for.
                    //   deliberate override -- a replacement implementation for
                    //     an id that already exists (a patched layer, a test
                    //     double, a v2). Here sharing the bit is the POINT:
                    //     same identity, same toggle, new behaviour.
                    // So the guard stays and `overrides: true` declares the
                    // second case.
                    if (m.overrides !== true) {
                        throw new Error('ExtendX.extend(): mixinId "' + m.mixinId + '" is already registered to a different mixin. ' +
                            'Ids map to bit positions, so two mixins sharing one id share one bit -- disableLayer on either would toggle both. ' +
                            'If the replacement is intentional, set overrides: true on the new mixin (or call ExtendX.override(mixin)).');
                    }
                    m._bitIndex = owner._bitIndex;   // same identity keeps the same bit
                    REGISTRY_GENERATION++;
                    // Top up AFTER the registry is updated below -- installWrappers
                    // reads current(), so running it here would still see the old
                    // implementation and find no new method names.
                    overriddenIds.push(m.mixinId);
                }
                REGISTERED.set(m.mixinId, m);
            });

            const { ids: sortedIds, shifted } = reindex();

            // A new id that sorts before an existing one moves the existing
            // one's bit position -- see reindex()'s comment for why that is
            // a correctness hazard, not just a cache one. overriddenIds
            // already bumps the generation for the "same id, new
            // implementation" case; this covers "brand-new id, existing ids
            // shifted", which previously left REGISTRY_GENERATION untouched
            // and let PIPELINE_CACHE/METHOD_CACHE keep serving pre-shift
            // results under a mask token the shift had silently changed the
            // meaning of.
            if (shifted.length) {
                REGISTRY_GENERATION++;
                console.warn('ExtendX.extend(): registering ' +
                    mixins.map(m => m.mixinId).join(', ') +
                    ' shifted the bit position of already-registered mixin(s) [' + shifted.join(', ') + ']. ' +
                    'Any already-constructed instance that explicitly enabled/disabled one of those layers ' +
                    'may now read the wrong toggle state for it -- re-apply enableLayer/disableLayer on such ' +
                    'instances if this registration happened after they were built.');
            }

            // Now that REGISTERED holds the replacements, top up wrappers on any
            // class already composed with an overridden id.
            overriddenIds.forEach(id => {
                const users = USERS.get(id);
                if (users) users.forEach(Sub => installWrappers(Sub));
            });

            // ─── Build mask array sized to global registry ─────
            //
            // Sized to the registry, NOT mixins.length. _bitIndex is a global
            // position, so a mixins.length-sized array leaves later mixins
            // reading undefined in _resolvePipeline's
            // `bitArray[mixin._bitIndex] === 1` check -- and being silently
            // dropped from the pipeline. Symptom is a middleware that registers
            // without error and never runs.
            const initialBits = new Array(sortedIds.length).fill(1);
            const classDefaultMaskState = [1, initialBits];

            // ─── Subclass constructor ──────────────────────────
            function Subclass(...args) {
                // new.target, NOT the closure-captured Subclass, is what
                // must reach the innermost Reflect.construct call.
                // Composing ExtendX on top of an ALREADY extend()-composed
                // base (e.g. ExtendX.extend(HTTP, SomeMixin) where HTTP is
                // itself an extend() result) is real, supported usage --
                // SQLRegex.js does exactly this. Hardcoding `Subclass`
                // here ignored whatever the actual outermost constructor
                // was, so the inner layer's Reflect.construct always set
                // the instance's prototype to ITS OWN Subclass.prototype,
                // never the outer one's -- the outer layer's own methods
                // (SQL2RegexHTTP's sql/sqltest/etc.) were silently
                // unreachable on every constructed instance, confirmed for
                // real: `instance.sql is not a function`, present in the
                // original, unmodified files, not something introduced by
                // hardening. Using new.target (falling back to Subclass
                // for the ordinary, non-nested case, where they are the
                // same object anyway) makes this propagate the same way a
                // real `class X extends Y` chain's super() calls do.
                const instance = Reflect.construct(BaseClass, args, new.target || Subclass);

                // A base that is not an ExtendX subclass has none of these, so
                // attach them here. Own properties via defineProperty, because
                // a `prop in target`-style set trap on a strict base rejects
                // plain assignment of anything new.
                const methods = ['enableLayer', 'disableLayer', 'toggleAllLayers',
                    'mixins', 'activeMixins', 'explain', 'hasMixin',
                    'compute', 'main', 'render', 'flushQueue', 'schedule'];
                methods.forEach(fn => {
                    if (typeof instance[fn] !== 'function') {
                        Object.defineProperty(instance, fn, {
                            value: ExtendX.prototype[fn],
                            enumerable: false,
                            configurable: true,
                            writable: true
                        });
                    }
                });

                // Authorship getters live on ExtendX.prototype, so an instance
                // whose base is NOT an ExtendX subclass never sees them.
                ['author', 'company', 'version'].forEach(p => {
                    if (!(p in instance)) {
                        Object.defineProperty(instance, p, {
                            get: Object.getOwnPropertyDescriptor(ExtendX.prototype, p).get,
                            enumerable: false,
                            configurable: true
                        });
                    }
                });

                // Disposal symbols: a foreign base has no ExtendX.prototype, so
                // `using` would find no [Symbol.dispose] and silently not clean up.
                [DISPOSE, ASYNC_DISPOSE].forEach(sym => {
                    if (typeof instance[sym] !== 'function') {
                        Object.defineProperty(instance, sym, {
                            value: ExtendX.prototype[sym],
                            enumerable: false, configurable: true, writable: true
                        });
                    }
                });
                if (!('disposed' in instance)) {
                    Object.defineProperty(instance, 'disposed', {
                        get: Object.getOwnPropertyDescriptor(ExtendX.prototype, 'disposed').get,
                        enumerable: false, configurable: true
                    });
                }

                if (!('cacheToken' in instance)) {
                    Object.defineProperty(instance, 'cacheToken', {
                        get: Object.getOwnPropertyDescriptor(ExtendX.prototype, 'cacheToken').get,
                        enumerable: false,
                        configurable: true
                    });
                }

                if (!('_maskState' in instance)) {
                    Object.defineProperty(instance, '_maskState', {
                        get() { return getMask(this); },
                        set(v) { setMask(this, v); },
                        enumerable: false,
                        configurable: true
                    });
                }

                // No outer proxy: dispatch wrappers live on Subclass.prototype,
                // so `instance` is the object callers hold and every side table
                // keys on it directly. This also removes the raw-vs-proxy
                // identity hazard that previously made PENDING_INIT lookups miss.
                const proxied = instance;
                setMask(proxied, [
                    Subclass._defaultMaskState[0],
                    [...Subclass._defaultMaskState[1]]
                ]);

                // Run init lifecycles -- through current(), so an overridden id
                // constructs with its replacement's init, not the original's.
                // A hook that returns a thenable is recorded, not re-run later:
                // ExtendX.initParallel() awaits these same promises.
                mixins.forEach(mixin => {
                    const impl = current(mixin);
                    if (typeof impl.init !== 'function') return;
                    const im = getMask(proxied);
                    if (im[0] !== 1 || im[1][mixin._bitIndex] === 0) return;
                    const record = (p) => {
                        let map = PENDING_INIT.get(proxied);
                        if (!map) { map = new Map(); PENDING_INIT.set(proxied, map); }
                        map.set(mixin.mixinId, p);
                    };
                    let r;
                    try { r = impl.init.call(proxied, ...args); }
                    catch (e) {
                        const p = Promise.reject(e);
                        p.catch(() => {});   // defuse; initParallel re-raises
                        record(p);
                        return;
                    }
                    if (r && typeof r.then === 'function') {
                        r.catch(() => {});   // same: the real report is initParallel's
                        record(r);
                    }
                });

                return proxied;
            }

            // ─── Prototype chain ───────────────────────────────
            Subclass.prototype = Object.create(BaseClass.prototype);
            Subclass.prototype.constructor = Subclass;
            Object.setPrototypeOf(Subclass, BaseClass);

            // ─── Metadata ──────────────────────────────────────
            Subclass._rawMixins = [...mixins];
            Subclass._orderStrategy = options.order;
            Subclass._customMap = options.custommap || null;
            Subclass._explicitArray = options.array || null;
            Subclass._defaultMaskState = classDefaultMaskState;

            // ─── Pipeline Resolution ───────────────────────────
            //
            // All four strategies resolve by mixinId as well as by object
            // reference: a custommap or explicit array written with ids is the
            // readable form, and was previously broken -- `map[a]` used the
            // mixin OBJECT as a plain-object key, which stringifies to
            // "[object Object]", so every weight read 0 and the sort was a
            // no-op that silently fell back to declaration order.
            Subclass._resolvePipeline = function(currentMask) {
                const mask = currentMask || classDefaultMaskState;
                const [globalOverride, bitArray] = mask;
                if (globalOverride === 0) return [];

                const token = tokenFor(mask) + ':' + REGISTRY_GENERATION;
                let cache = PIPELINE_CACHE.get(Subclass);
                if (!cache) {
                    cache = new Map();
                    PIPELINE_CACHE.set(Subclass, cache);
                }
                const hit = cache.get(token);
                if (hit) return hit;

                let pipeline = [...Subclass._rawMixins];

                const rank = (list, m) => {
                    let i = list.indexOf(m);
                    if (i === -1) i = list.indexOf(m.mixinId);
                    return i;
                };

                // Strategy A: Explicit Array Order (mixins or mixinIds)
                if (Subclass._explicitArray && Array.isArray(Subclass._explicitArray)) {
                    const list = Subclass._explicitArray;
                    pipeline.sort((a, b) => {
                        const ia = rank(list, a);
                        const ib = rank(list, b);
                        return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) -
                               (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
                    });
                    pipeline.reverse();
                }
                // Strategy B: Custom Map Weight (Map by mixin, object by mixinId)
                else if (Subclass._customMap && typeof Subclass._customMap === 'object') {
                    const map = Subclass._customMap;
                    const weight = (m) => {
                        if (typeof map.get === 'function') {
                            return map.get(m) ?? map.get(m.mixinId) ?? 0;
                        }
                        return map[m.mixinId] ?? 0;
                    };
                    pipeline.sort((a, b) => weight(a) - weight(b));
                    pipeline.reverse();
                }
                // Strategy C: Right-to-Left
                else if (Subclass._orderStrategy === 'right-left') {
                    // keep order as-is
                }
                // Strategy D: Left-to-Right (default)
                else {
                    pipeline.reverse();
                }

                // Missing bits mean ENABLED, not disabled.
                //
                // initialBits is sized to the registry at extend() time, but the
                // registry keeps growing: any mixin registered later gets an
                // index past the end of an earlier class's mask array. Testing
                // `=== 1` then reads undefined and silently drops the layer --
                // the same failure as the original mixins.length sizing bug, but
                // temporal, so it appears only once a second composition has
                // happened. A short array means "not yet configured", and the
                // default for an unconfigured layer is on.
                const resolved = pipeline
                    .filter(mixin => bitArray[mixin._bitIndex] !== 0)
                    .map(current);   // an overridden id dispatches its replacement
                cache.set(token, resolved);
                return resolved;
            };

            // ─── Dispatch wrappers ─────────────────────────────
            Subclass._extendXBase = BaseClass;
            installWrappers(Subclass);
            mixins.forEach(m => trackUser(m.mixinId, Subclass));

            return Subclass;
        }

        // ─── Override ──────────────────────────────────────────

        /**
         * Deliberately replace the implementation behind an existing mixinId.
         *
         * Hot-swap, not re-compose: every class already composed with that id
         * picks the replacement up on its next dispatch, because dispatch
         * resolves ids through the registry rather than holding the object. The
         * bit position is unchanged, so enableLayer/disableLayer and cacheToken
         * keep working and an instance that had the layer off still has it off.
         *
         * Returns the previous implementation so a caller can restore it -- the
         * shape a test double or a temporary patch needs.
         */
        static override(mixin) {
            if (!mixin || typeof mixin.mixinId !== 'string') {
                throw new Error('ExtendX.override(): needs a mixin with a string mixinId');
            }
            const prev = REGISTERED.get(mixin.mixinId) || null;
            if (prev === mixin) return prev;
            if (prev) mixin._bitIndex = prev._bitIndex;
            REGISTERED.set(mixin.mixinId, mixin);
            if (!prev) {
                const { shifted } = reindex();
                if (shifted.length) {
                    console.warn('ExtendX.override(): registering brand-new id "' + mixin.mixinId +
                        '" shifted the bit position of already-registered mixin(s) [' + shifted.join(', ') + ']. ' +
                        'Any already-constructed instance that explicitly enabled/disabled one of those layers ' +
                        'may now read the wrong toggle state for it.');
                }
            }
            REGISTRY_GENERATION++;

            // Top up dispatch wrappers on every class already composed with this
            // id. A replacement may define a method the original never had; with
            // fast prototype dispatch the wrapped-name set is decided at install
            // time, so without this the new method sits on the mixin, is
            // reachable by hand, and is silently never dispatched.
            const users = USERS.get(mixin.mixinId);
            if (users) users.forEach(Sub => installWrappers(Sub));
            return prev;
        }

        /**
         * Concurrently resolve asynchronous mixin init hooks.
         *
         * The synchronous init in the Subclass constructor cannot await, so a
         * mixin needing async setup declares init as async and the caller runs
         * this once after construction. Resolves through current(), so an
         * overridden id initialises with its replacement.
         *
         * Honours the instance mask: a layer that is off does not initialise.
         */
        static async initParallel(instance, ...args) {
            const declared = (instance.constructor && instance.constructor._rawMixins) || [];
            const mask = getMask(instance);
            const pending = PENDING_INIT.get(instance);
            const tasks = [];

            declared.forEach(m => {
                if (mask[0] !== 1 || mask[1][m._bitIndex] === 0) return;
                // Already in flight from the constructor: await THAT promise.
                // Re-invoking would run the hook a second time.
                if (pending && pending.has(m.mixinId)) { tasks.push(pending.get(m.mixinId)); return; }
                const impl = current(m);
                if (typeof impl.init === 'function' && args.length) {
                    // Only re-invoke when the caller supplies different args than
                    // construction did; otherwise the constructor already ran it.
                    tasks.push(Promise.resolve().then(() => impl.init.apply(instance, args)));
                }
            });

            const settled = await Promise.allSettled(tasks);
            const failed = settled.filter(r => r.status === 'rejected');
            if (pending) pending.clear();
            if (failed.length) {
                throw new Error('ExtendX.initParallel(): ' + failed.length + ' mixin init hook(s) failed: ' +
                    failed.map(f => (f.reason && f.reason.message) || String(f.reason)).join('; '));
            }
            return instance;
        }

        /** Current implementation registered for an id. */
        static registered(mixinId) { return REGISTERED.get(mixinId) || null; }

        /** Every registered id, alphabetical -- the order that defines bits. */
        static registry() { return Array.from(REGISTERED.keys()).sort(); }

        // ─── Static Introspection ──────────────────────────────

        static mixins(TargetClass, prop, mask) {
            if (!TargetClass._rawMixins) return [];
            if (prop === undefined) return [...TargetClass._rawMixins];

            const pipeline = typeof TargetClass._resolvePipeline === 'function'
                ? TargetClass._resolvePipeline(mask || TargetClass._defaultMaskState)
                : [];

            // Dispatch pops from the end, so reverse to read in execution
            // order. An id whose implementation has been overridden is flagged,
            // because "the layer is running but not the code you're reading" is
            // otherwise invisible -- exactly the case override introduces.
            const declared = new Map(TargetClass._rawMixins.map(m => [m.mixinId, m]));
            const names = [...pipeline]
                .filter(m => typeof m[prop] === 'function')
                .map(m => {
                    const d = declared.get(m.mixinId);
                    return (d && d !== m) ? m.mixinId + ' (overridden)' : m.mixinId;
                })
                .reverse();

            const Base = Object.getPrototypeOf(TargetClass.prototype);
            if (Base && typeof Base[prop] === 'function') names.push('<base>');
            return names;
        }

        static hasMixin(TargetClass, mixin) {
            if (!TargetClass._rawMixins) return false;
            return TargetClass._rawMixins.includes(mixin);
        }

        static removeMixin(TargetClass, mixinToRemove) {
            if (!TargetClass._rawMixins) return;
            TargetClass._rawMixins = TargetClass._rawMixins.filter(m => m !== mixinToRemove);
        }

        static evaluateSetRelation(nodeA, nodeB) {
            const mA = getMask(nodeA);
            const mB = getMask(nodeB);
            const bitsA = mA[1];
            const bitsB = mB[1];
            if (mA[0] === 0 && mB[0] === 0) return 'EQUIVALENT_EMPTY_SETS';
            if (mA[0] === 0) return 'NODE_A_IS_EMPTY_SUBSET_OF_B';
            if (mB[0] === 0) return 'NODE_B_IS_EMPTY_SUBSET_OF_A';

            let isSubset = true;
            let isSuperset = true;

            for (let i = 0; i < Math.max(bitsA.length, bitsB.length); i++) {
                const bA = bitsA[i] ?? 0;
                const bB = bitsB[i] ?? 0;
                if (bA === 1 && bB !== 1) isSubset = false;
                if (bB === 1 && bA !== 1) isSuperset = false;
            }

            if (isSubset && isSuperset) return 'IDENTITY_EQUIVALENT_SETS';
            if (isSubset) return 'SUBSET';
            if (isSuperset) return 'SUPERSET';
            return 'DISJOINT_OR_INTERSECTING_SETS';
        }
    }

    // ─── Return ─────────────────────────────────────────────────

    return ExtendX;

}));
