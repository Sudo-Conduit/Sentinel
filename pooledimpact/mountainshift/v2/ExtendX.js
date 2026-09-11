/**
 * ExtendX.js — MountainShift OS Runtime Composition Engine
 *
 * Author: Wilbert Fobbs III
 * Company: Pooled Impact
 *
 * v1.1.0  (extracted from BaseClassX_Decoupled, v2.3.01-async lineage)
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
    const VERSION = '1.1.0';

    // Mask/loop/dispose/pending-init state is keyed by a small internal id,
    // NOT by object identity.
    //
    // Writing _maskState (or `super`) onto the instance makes ExtendX invasive,
    // and a strict base's Proxy `set` trap (`if (prop in target || schemaApproved)`)
    // rejects plain assignment of anything new. Object.defineProperty bypasses
    // that trap (proven elsewhere in this file -- enableLayer/mixins/etc. are
    // attached the same way), so each instance gets ONE small non-enumerable
    // `_extId` string via defineProperty; every side table below is a plain
    // string-keyed Map on that id, not an object-keyed WeakMap. Cheaper (plain
    // hash lookup, no ephemeron bookkeeping) and fully TS/PHP-portable -- the
    // cost is no automatic GC-driven cleanup, which FINALIZER (below) exists
    // to backstop.
    const MASKS = new Map();

    let __idCounter = 0;
    // Timestamp-prefixed: shrinks the collision surface versus a bare random
    // suffix, AND gives every id a natural chronological sort order for free
    // (useful anywhere ids double as a trace/replay correlation key). No
    // crypto dependency.
    function genId() {
        return 'node_' + Date.now().toString(36) + '_' + (__idCounter++).toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    }

    // Backstop for a forgotten dispose(): a string-keyed Map does not
    // self-clean like a WeakMap, so if an instance is GC'd without ever being
    // disposed its side-table entries would otherwise leak forever. Timing is
    // nondeterministic (that is what FinalizationRegistry is), so this is a
    // safety net, not a substitute for calling dispose().
    const FINALIZER = typeof FinalizationRegistry === 'function'
        ? new FinalizationRegistry((id) => {
            MASKS.delete(id);
            LOOPS.delete(id);
            PENDING_INIT.delete(id);
            DISPOSED.delete(id);
        })
        : null;

    // Returns this instance's internal id, minting and attaching one via
    // defineProperty on first use.
    function getExtId(obj) {
        if (typeof obj._extId === 'string') return obj._extId;
        const id = genId();
        try {
            Object.defineProperty(obj, '_extId', { value: id, enumerable: false, configurable: false, writable: false });
        } catch (e) { /* falls through; id still usable for this call */ }
        if (FINALIZER && typeof obj._extId === 'string') FINALIZER.register(obj, obj._extId, obj);
        return typeof obj._extId === 'string' ? obj._extId : id;
    }

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
    // Keyed by the composed CLASS (not an instance), and composed classes are
    // application-lifetime objects -- same reasoning as USERS below, a plain
    // Map is fine here, no leak risk in practice.
    const PIPELINE_CACHE = new Map();

    // Second memo level: composed class -> ("prop|token|generation" -> resolved
    // function array). Saves the per-call filter/map on hot methods.
    const METHOD_CACHE = new Map();

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

    // Disposal is idempotent and must be observable; keyed by id like MASKS.
    const DISPOSED = new Set();

    // Compute-loop timer and deferred task queue, per instance. Keyed by id.
    const LOOPS = new Map();

    // Pending async init promises, per instance id: mixinId -> promise.
    //
    // The constructor cannot await, so an async init hook is invoked and its
    // promise recorded here. initParallel then AWAITS those recorded promises
    // rather than calling init again -- without this the hook runs twice, once
    // fire-and-forget at construction and once more on the explicit call.
    const PENDING_INIT = new Map();
    function loopState(obj) {
        const id = getExtId(obj);
        let s = LOOPS.get(id);
        if (!s) { s = { timer: null, queue: [] }; LOOPS.set(id, s); }
        return s;
    }

    // ─── Private Helpers ───────────────────────────────────────

    function getMask(obj) {
        const id = getExtId(obj);
        let m = MASKS.get(id);
        if (!m) {
            const d = obj && obj.constructor && obj.constructor._defaultMaskState;
            m = d ? [d[0], [...d[1]]] : [1, []];
            MASKS.set(id, m);
        }
        return m;
    }

    function setMask(obj, mask) {
        MASKS.set(getExtId(obj), mask);
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
    function reindex() {
        const ids = Array.from(REGISTERED.keys()).sort();
        ids.forEach((id, i) => { REGISTERED.get(id)._bitIndex = i; });
        return ids;
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

                const result = currentMethod.apply(frame, args.concat(next));

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
            this.id = options.id || genId();
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
        //
        // mixin.locked (v1.2.0): a mixin declaring `locked: true` on itself
        // opts OUT of ever being toggled through enableLayer/disableLayer,
        // for every instance, permanently, from construction onward -- not
        // a per-instance seal, a property of the mixin's identity. Default
        // is unset/false, so every existing mixin's behavior is unchanged;
        // this is opt-in, for mixins where "toggle it off at runtime" is
        // categorically the wrong operation to expose at all (a security
        // mixin's presence should be a composition-time decision -- whether
        // extend() is called with it in the first place -- not something
        // togglable while the instance is already live). This also closes
        // a real deadlock a naive per-instance lock discovered: a mixin
        // that gates its OWN enableLayer/disableLayer through its OWN bit
        // can disable itself and then can never re-enable itself, because
        // the call that would flip the bit back on is itself excluded from
        // dispatch once the bit is off. Locking at the mixin-identity level
        // sidesteps that entirely -- the bit for a locked mixin never moves
        // through this API in the first place.

        enableLayer(mixin) {
            if (mixin && mixin.locked) {
                throw new Error('ExtendX.enableLayer(): mixin "' + (mixin.mixinId || '(anonymous)') + '" is locked -- it cannot be toggled at runtime.');
            }
            if (mixin._bitIndex === undefined) return this;
            const bits = getMask(this)[1];
            for (let i = bits.length; i < mixin._bitIndex; i++) bits[i] = 1;
            bits[mixin._bitIndex] = 1;
            return this;
        }

        disableLayer(mixin) {
            if (mixin && mixin.locked) {
                throw new Error('ExtendX.disableLayer(): mixin "' + (mixin.mixinId || '(anonymous)') + '" is locked -- it cannot be toggled at runtime.');
            }
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
            if (DISPOSED.has(getExtId(this))) return '0';
            return tokenFor(getMask(this));
        }

        get disposed() { return DISPOSED.has(getExtId(this)); }

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
                    if (DISPOSED.has(getExtId(self))) throw new Error('ExtendX.compute(): instance is disposed');
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
        // Pure, portable name -- not because ExtendX's own interface required
        // Symbol.dispose, but because it was added to hook `using`'s block-scope
        // GC timing. That hook now lives on [DISPOSE] as a thin alias below, so
        // the primary method stays free of a JS-only well-known-symbol
        // dependency (PHP, or any host without Symbol, calls this directly).
        dispose() {
            const id = getExtId(this);
            if (DISPOSED.has(id)) return;
            DISPOSED.add(id);

            const st = LOOPS.get(id);
            if (st && st.timer) clearInterval(st.timer);
            LOOPS.delete(id);
            PENDING_INIT.delete(id);
            // Collapse, don't delete: getMask() regenerates a fresh, fully-
            // enabled default mask for a MISSING entry, which would silently
            // re-enable every mixin's dispatch after "dispose" -- setting [0,[]]
            // is what actually makes the pipeline resolve to nothing.
            setMask(this, [0, []]);
            if (FINALIZER) FINALIZER.unregister(this);

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
        }

        /**
         * Async counterpart. Awaits any mixin dispose hook that returns a
         * thenable, then performs the synchronous teardown.
         */
        async disposeAsync() {
            const id = getExtId(this);
            if (DISPOSED.has(id)) return;
            const declared = this.constructor._rawMixins || [];
            const pending = declared
                .map(m => current(m))
                .filter(impl => typeof impl.dispose === 'function')
                .map(impl => { try { return Promise.resolve(impl.dispose.call(this)); } catch (e) { return Promise.reject(e); } });
            const settled = await Promise.allSettled(pending);
            settled.forEach(r => { if (r.status === 'rejected') console.error('[ExtendX asyncDispose] hook failed:', r.reason); });

            DISPOSED.add(id);
            const st = LOOPS.get(id);
            if (st && st.timer) clearInterval(st.timer);
            LOOPS.delete(id);
            PENDING_INIT.delete(id);
            setMask(this, [0, []]);
            if (FINALIZER) FINALIZER.unregister(this);
        }

        /** Thin alias so `using` still triggers cleanup -- see dispose() above. */
        [DISPOSE]() { return this.dispose(); }

        /** Thin alias so `await using` still triggers cleanup -- see disposeAsync() above. */
        async [ASYNC_DISPOSE]() { return this.disposeAsync(); }

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

            const sortedIds = reindex();

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
                const instance = Reflect.construct(BaseClass, args, Subclass);

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

                // dispose/disposeAsync: ALWAYS wrapped, never conditional on
                // "does the base already have one" the way the methods above
                // are. That conditional is exactly what made mixin dispose
                // hooks silently dead for every BaseClassX subclass: BaseClassX
                // already defines dispose(), so `typeof instance.dispose !==
                // 'function'` was always false, and ExtendX's own hook-running
                // dispose() (the one that calls each mixin's own dispose, per
                // current() so an override() replacement still fires) never
                // got attached at all. The fix preserves whatever the base
                // already provided (BaseClassX's real schema/trace disposal,
                // or nothing for a plain class) by capturing it BEFORE
                // overriding, then always running ExtendX's own mixin-hook
                // logic first and chaining to the original afterward -- so a
                // BaseClassX subclass gets both: its own real disposal AND
                // every composed mixin's dispose hook actually running.
                const originalDispose = typeof instance.dispose === 'function' ? instance.dispose.bind(instance) : null;
                const originalDisposeAsync = typeof instance.disposeAsync === 'function' ? instance.disposeAsync.bind(instance) : null;
                Object.defineProperty(instance, 'dispose', {
                    value: function() {
                        ExtendX.prototype.dispose.call(this);
                        if (originalDispose) originalDispose();
                    },
                    enumerable: false,
                    configurable: true,
                    writable: true
                });
                Object.defineProperty(instance, 'disposeAsync', {
                    value: async function() {
                        await ExtendX.prototype.disposeAsync.call(this);
                        if (originalDisposeAsync) await originalDisposeAsync();
                    },
                    enumerable: false,
                    configurable: true,
                    writable: true
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
                        const pid = getExtId(proxied);
                        let map = PENDING_INIT.get(pid);
                        if (!map) { map = new Map(); PENDING_INIT.set(pid, map); }
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

                // A locked mixin (see enableLayer/disableLayer above) is
                // refused at the per-bit level, but the global override is
                // a SEPARATE kill switch -- dispose()'s own setMask(this,
                // [0,[]]) sets exactly this to 0, and toggleAllLayers(false)
                // does too. Without this check, disposing (or globally
                // toggling off) an instance would silently exclude a locked
                // mixin from every future call's chain despite it never
                // having agreed to be individually disabled -- the same
                // "turned off by a door it never consented to" gap
                // mixin.locked exists to close, just reached through the
                // global bit instead of the per-mixin one. Locked mixins are
                // therefore immune to the global override entirely, not
                // just to their own bit.
                if (globalOverride === 0) {
                    const locked = Subclass._rawMixins.filter(function(m) { return !!m.locked; });
                    return locked.length ? locked.map(current) : [];
                }

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
            if (!prev) reindex();
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
            const pending = PENDING_INIT.get(getExtId(instance));
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
