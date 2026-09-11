/**
 * BaseClassX.js — Core Foundation for MountainShift OS
 * 
 * Provides:
 * - Tree structure with parent-child relationships (WeakRef-based)
 * - Forensic history (trace/replay)
 * - Conflict tracking (dissonance/anomalies)
 * - State management with history
 * - Tags and metadata
 * - Event system
 * - Debugger subsystem ($break, $watch, $dump, $step, $resume, $inspect, $trace, $replay, $pause)
 * - Fingerprinting (integrity verification)
 * - Batching (grouped operations)
 * - Serialization (toJSON/fromJSON)
 * - Mixin system (composition)
 * - Disposal/Cleanup
 * - Graph linking (linkTo/unlinkFrom) + relational/replication/origin projections
 * 
 * @version 2.2.06 (wildcard '*' event listener support)
 * @author Will Fobbs III
 * @license MIT
 * @created 2026-07-06T17:57:15Z
 * @modified 2026-07-18T00:00:00Z
 * 
 * v2.2.06 changelog:
 * - Added wildcard ('*') event listener support. Registering
 *   `instance.on('*', handler)` now receives EVERY event that instance
 *   emits, as `handler(eventType, data)` — type-specific listeners are
 *   unaffected and continue to receive `handler(data)` exactly as
 *   before. This is additive only: no existing on()/emit() call sites
 *   change behavior unless they specifically register '*'.
 * - Motivation: the intended RootApplication object tree (each UI
 *   component as a BaseClassX child of a single root) needs a way for
 *   Root to observe every descendant's events without knowing every
 *   event name in advance. Per-instance emit() was and remains
 *   non-bubbling; wildcard listeners are the building block a parent
 *   uses to bridge child events explicitly (see RootApplication.js).
 *
 * v1.5.03: Replaces external validation approach with Proxy-based schema validation.
 * Subclasses define static _schema; Proxy set trap enforces constraints.
 * No external validators needed—type checking is built-in.
 *
 * v2.2.00 changelog (fixes on top of v2.1.00's broken Projection APIs):
 * - GlobalVector.append() now actually computes and persists a chained
 *   `accumHash` per entry. Previously entries never got an accumHash at
 *   all, so verifyChain() compared real values against `undefined` and
 *   could never meaningfully fail.
 * - Added GlobalVector.getAccumulatedHash(id) and getExternalState(id).
 *   Both were called by ReplicationProjection/DualProjection in v2.1.00
 *   but were never defined, so those methods threw at call time.
 * - appendToVector() now computes a real per-entry `confidence` from
 *   `dissonance` and inter-transition timing, persisted on the vector
 *   entry. Previously `entry.confidence` was never set anywhere, so
 *   ReplicationProjection.confidence()/transitionConfidence()/transitions()
 *   always silently fell back to a hardcoded 0.5.
 * - DualProjection.conflicts()/merged() rewritten: `state` is a scalar
 *   string (e.g. 'initialized'), not a keyed object, so the old
 *   Object.keys(local) approach produced nonsense character-index
 *   "conflicts". Now compares state as the single scalar value it is.
 * - RelationalProjection.inEdges()/outEdges()/transitiveReferences()
 *   rewritten to read the node's own inEdges/outEdges arrays (which
 *   existed since v2.0 but were never populated by anything) instead of
 *   querying GlobalVector for e.target/e.source fields that never
 *   existed on any vector entry.
 * - Added BaseClassX#linkTo(target, label) / #unlinkFrom(target) so
 *   inEdges/outEdges are actually populated — without this, the
 *   RelationalProjection fix above would just correctly return empty
 *   results forever.
 * - Added a module-level id -> live-instance registry inside
 *   GlobalVector (registerNode/getNode), populated at construction.
 *   OriginProjection.getAllOriginInstances() and
 *   ReplicationProjection.instances() previously assumed vector entries
 *   carried a `.target` node reference; entries only ever store an id
 *   string, so both methods threw. They now resolve real instances via
 *   this registry.
 *
 * v2.2.01 changelog:
 * - Fix (BUG-3): _loadedFingerprint and integrityOk are now pre-declared
 *   in the constructor (defaulting to null / true respectively) instead
 *   of only ever being assigned inside fromJSON(). Previously, setting
 *   either field on a normally-constructed instance silently failed —
 *   the Proxy set trap's `prop in target` guard saw them as undeclared
 *   and rejected the write with a console.warn.
 * - Fix (BUG-1+2): the Proxy set trap now also allows a property through
 *   when it's explicitly listed in the instance's schema (own or
 *   inherited parent schema), even if it hasn't been assigned on the
 *   target yet. Schema validation already ran before the `prop in
 *   target` guard; the actual defect was that the guard itself rejected
 *   legitimate, schema-approved properties that simply hadn't been
 *   pre-declared.
 * - Fix (BUG-1, constructor): the constructor now reads
 *   this.constructor._schema (and _parentSchema) and initializes every
 *   schema-defined property from `options`, falling back to the
 *   schema's `default` when present. Combined with the trap fix above,
 *   a subclass's schema properties are now usable from the very first
 *   write, not just after being poked once externally.
 * - Fix (BUG-4): clone() now uses `new this.constructor(...)` instead of
 *   a hardcoded `new BaseClassX(...)`, so subclass instances stay their
 *   own type (and keep their schema/methods) after cloning. clone() also
 *   now records lineage — `_cloneOf` (immediate parent), `_cloneOrigin`
 *   (the very first ancestor in the chain), and `_cloneGeneration` (hop
 *   count from that origin) — and carries forward any schema-defined
 *   properties, which previously reset to their schema default (or
 *   undefined) on every clone.
 *
 * v2.2.02 changelog:
 * - Fix: the Proxy get trap bound every method to the raw, unwrapped
 *   `target` instead of the Proxy (`receiver`) the property was actually
 *   accessed through. Consequence: any internal helper method — e.g. a
 *   constructor calling `this._initFields(options)`, which then does
 *   `this.someField = value` inside that method — ran with `this`
 *   pointing at the raw object, so that assignment completely bypassed
 *   the set trap: no schema validation, and no _recordTrace('set', ...)
 *   entry. A field could be set with zero forensic trace of the write
 *   ever happening, simply by setting it from a called method instead of
 *   directly in the constructor body — the exact opposite of what
 *   BaseClassX's trace/validation system exists to guarantee.
 *   Fixed by binding methods to `receiver` instead of `target`, so any
 *   `this.field = value` executed from inside a method invoked through
 *   the Proxy is itself routed back through the same Proxy, and hits the
 *   same set trap as a direct assignment would. Verified: a property
 *   assigned via a called method is now rejected/validated identically
 *   to one assigned directly in the constructor — no more distinction
 *   between the two paths.
 *
 * v2.2.03 changelog:
 * - linkTo(target, label, options) supports an OPT-IN edge weight.
 *   options.weight, when provided, must be a finite number and is
 *   stored on the edge. When omitted, the edge simply has no `weight`
 *   field at all — it is never silently defaulted to 1 or any other
 *   placeholder. This keeps `edge.weight === undefined` an unambiguous
 *   signal that a relation was never intended to carry a weight, rather
 *   than a value that could be mistaken for a deliberate measurement.
 * - Added relation cardinality: a class declares static _relations =
 *   { <label>: { cardinality, max } } once, and every linkTo() call
 *   for that label is checked against it. Supported: '1:1' (source and
 *   target each allow at most one edge of this label), '1:M' (many
 *   sources, but each target has at most one owner per label — the
 *   classic FK shape), '1:X' (source allows at most `max` outgoing
 *   edges of this label; requires max), 'M:M' (unconstrained).
 *   linkTo's own options.cardinality/options.max override whatever the
 *   class declared for that label, per-call.
 * - Violations throw immediately, matching how schema property
 *   validation already behaves — a cardinality violation is treated
 *   with the same severity as an invalid property write, not silently
 *   ignored or auto-corrected.
 * - unlinkFrom(target, label) now accepts an optional label to remove
 *   only edges with that label between the two nodes, rather than
 *   removing every edge between them regardless of label.
 *
 * v2.2.04 changelog:
 * - Fix: the Proxy get trap's property-read branch used plain
 *   `target[prop]` instead of `Reflect.get(target, prop, receiver)`.
 *   For a normal data property this makes no difference — but for an
 *   ACCESSOR property (a `get foo() {...}` defined on the class),
 *   plain `target[prop]` always evaluates the getter with `this =
 *   target` (the raw, unwrapped instance), silently ignoring `receiver`
 *   (the Proxy) entirely. This is the same target-vs-receiver identity
 *   bug the get trap's method-binding branch was fixed for in v2.2.02
 *   — just in a code path that fix didn't reach, because getters and
 *   methods take different branches through the trap.
 *   Concretely: a getter reading `someWeakMap.get(this)` would silently
 *   read a DIFFERENT key than a method (correctly bound to `receiver`
 *   per the v2.2.02 fix) had used to `.set()` into that same WeakMap —
 *   two different object identities for what should be "the same
 *   instance," with no error, just a getter that always reports back
 *   as if nothing had ever been set. Any subclass pattern that pairs a
 *   getter with a WeakMap keyed by `this` (a legitimate, deliberate way
 *   to hold instance state OUTSIDE BaseClassX's schema/trace system —
 *   see LayeredStore.js's Layer class for a real example) was silently
 *   broken by this until now.
 *   Fixed by routing property reads through `Reflect.get(target, prop,
 *   receiver)`, evaluated exactly once (not twice, as the original
 *   two-branch structure did), so an accessor property now correctly
 *   runs with `this` bound to `receiver` — the same Proxy identity
 *   every method call already resolves to.
 *
 * v2.2.05 changelog:
 * - Added two independent, static, opt-OUT downgrade flags — both
 *   default to `true`, so every existing subclass is unaffected unless
 *   it explicitly sets one to `false`:
 *     static enableDebugger = false — skips allocating _debugState/
 *       _debugMetadata at construction. Every $break/$watch/$dump/$step/
 *       $resume/$inspect/$continue/$trace/$replay/$pause entry point,
 *       plus the internal _getDebugger(), throws a clear error if called
 *       on an instance whose class disabled this, rather than silently
 *       no-op'ing or touching now-nonexistent state.
 *     static enableDiff = false — diff() and equals() throw a clear
 *       error rather than executing, for classes that never need
 *       structural comparison.
 *   Both flags leave every other feature (tree, tags, metadata, state,
 *   events, trace, linkTo/cardinality/weight, serialization) completely
 *   unaffected — a downgraded node is a normal node minus exactly the
 *   one feature its flag names.
 * - Added content-hash caching, distinct from `fingerprint` (which is
 *   node IDENTITY). A subclass implements computeContentHash() to
 *   express "these inputs, this operation" — the actual signal needed
 *   for CSE (common subexpression elimination), since two structurally
 *   distinct nodes (different id/fingerprint) can still represent the
 *   same computation over the same inputs. No default implementation
 *   is provided; calling getCached()/linkToCached() before a subclass
 *   implements computeContentHash() throws, rather than silently
 *   hashing generic fields that would look meaningful but aren't.
 *     getCached(computeFn) — global cache (a new module-level Map,
 *       ContentCache, kept deliberately separate from GlobalVector,
 *       which remains an append-only log, not a lookup structure).
 *       Two different node instances with the same content-hash share
 *       one computed result; computeFn only runs on a genuine miss.
 *     linkToCached(target, label, computeFn, options) — LOCAL
 *       memoization for a 1:X relation, with the cached result stored
 *       on the edge itself (outEdges), not in a global table. A 1:X
 *       source can have at most `max` outgoing edges of that label, so
 *       the existing cardinality constraint already bounds how much
 *       this can ever cache — cheaper than a global lookup and needs
 *       no eviction policy. Cardinality/weight enforcement from linkTo
 *       still applies in full on a cache miss.
 */

(function(root, factory) {
    'use strict';
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BaseClassX = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    // ---------- UTF24Timestamp DETECTION ----------
    var UTF24Timestamp = null;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
        try { UTF24Timestamp = require('./UTF24Timestamp.js'); } catch (e) { /* fall through */ }
    }
    if (!UTF24Timestamp) {
        var _root = typeof self !== 'undefined' ? self : this;
        UTF24Timestamp = (_root && _root.UTF24Timestamp) ||
            (typeof globalThis !== 'undefined' && globalThis.UTF24Timestamp) ||
            (typeof window !== 'undefined' && window.UTF24Timestamp) || null;
    }

    const SCHEMA_VERSION = '2.2.05';
    const FILE_CREATED = '2026-07-06T17:57:15Z';
    const FILE_MODIFIED = '2026-07-14T11:33:12Z';


    // ─── REPLAY HANDLERS (v1.5.03b) ────────────────────────────────────
    // How to replay local trace entries (reconstruct state)
    const REPLAY_HANDLERS = {
        'init': function(target, entry) {},
        'set': function(target, entry) {
            const {
                property,
                value
            } = entry.data;
            target[property] = value;
        },
        'add_tag': function(target, entry) {
            target.addTag(entry.data.tag);
        },
        'remove_tag': function(target, entry) {
            target.removeTag(entry.data.tag);
        },
        'set_metadata': function(target, entry) {
            target.setMetadata(entry.data.key, entry.data.value);
        },
        'remove_metadata': function(target, entry) {
            target.removeMetadata(entry.data.key);
        },
        'add_dissonance': function(target, entry) {
            target.addDissonance(entry.data.amount);
        },
        'resolve_dissonance': function(target, entry) {
            target.resolveDissonance(entry.data.amount);
        },
        'add_anomaly': function(target, entry) {
            target.addAnomaly(entry.data.anomaly);
        },
        'remove_anomaly': function(target, entry) {
            target.removeAnomaly(entry.data.index);
        },
        'resolve_anomaly': function(target, entry) {
            target.resolveAnomaly(entry.data.index, entry.data.resolution);
        },
        'state_change': function(target, entry) {
            target.updateState(entry.data.newState);
        },
        'set_type': function(target, entry) {
            target.type = entry.data.type;
        },
        'set_name': function(target, entry) {
            target.name = entry.data.name;
        },
        'set_source': function(target, entry) {
            target.source = entry.data.source;
        },
        'set_version': function(target, entry) {
            target.version = entry.data.version;
        },
        'clear_trace': function(target, entry) {
            target._trace = [];
        },
        'prune_history': function(target, entry) {
            target.pruneHistory(entry.data.keep);
        },
        'add_child': function(target, entry) {
            // Marker for replay; child recreated separately
        },
        'remove_child': function(target, entry) {
            // Marker for replay; child removed separately
        },
        'debug_breakpoint_set': function(target, entry) {
            if (target._debugState) {
                target._debugState.breakpoints.push(entry.data.breakpoint);
            }
        },
        'debug_watch_set': function(target, entry) {
            if (target._debugState) {
                target._debugState.watches.push(entry.data.watch);
            }
        },
        'debug_paused': function(target, entry) {
            if (target._debugState) {
                target._debugState.isPaused = true;
                target._debugState.pausedAt = entry.data.timestamp;
            }
        },
        'debug_resumed': function(target, entry) {
            if (target._debugState) {
                target._debugState.isPaused = false;
            }
        },
        'debug_step': function(target, entry) {
            if (target._debugState) {
                target._debugState.stepMode = entry.data.mode;
            }
        }
    };

    // ─── GLOBAL VECTOR (v2.0) ──────────────────────────────────────────
    // Global accumulation chain with hash verification (separate from trace)
    const GlobalVector = (() => {
        let entries = [];
        let entryIndex = new Map();  // id → [indices]

        // Registry of live instances by id. Vector entries only ever store
        // an id (string) — resolving that id back to an actual node object
        // (for OriginProjection/ReplicationProjection) requires this lookup.
        const nodeRegistry = new Map(); // id -> node instance

        return {
            append(entry) {
                const index = entries.length;
                const previous = index > 0 ? entries[index - 1] : null;

                // Chain this entry's accumHash off the previous entry's accumHash,
                // per the formula verifyChain() already assumes exists.
                entry.accumHash = this._computeAccumHash(
                    previous ? previous.accumHash : '0',
                    entry.hash
                );

                entries.push(entry);

                if (!entryIndex.has(entry.id)) {
                    entryIndex.set(entry.id, []);
                }
                entryIndex.get(entry.id).push(index);

                return { index, entry };
            },

            getEntries(id) {
                const indices = entryIndex.get(id) || [];
                return indices.map(i => entries[i]);
            },

            getEntry(index) {
                return entries[index];
            },

            getAll() {
                return [...entries];
            },

            /**
             * Last known state for id as recorded in the shared global log
             * (as opposed to node.state, which is this instance's local, possibly
             * unflushed, view). Used by DualProjection to detect divergence.
             */
            getExternalState(id) {
                const indices = entryIndex.get(id) || [];
                if (indices.length === 0) return null;
                const latest = entries[indices[indices.length - 1]];
                return latest.state !== undefined ? latest.state : null;
            },

            /**
             * accumHash of the most recent entry recorded for id.
             */
            getAccumulatedHash(id) {
                const indices = entryIndex.get(id) || [];
                if (indices.length === 0) return null;
                return entries[indices[indices.length - 1]].accumHash;
            },

            verifyChain() {
                for (let i = 1; i < entries.length; i++) {
                    const current = entries[i];
                    const previous = entries[i - 1];

                    const expectedHash = this._computeAccumHash(
                        previous.accumHash,
                        current.hash
                    );

                    if (current.accumHash !== expectedHash) {
                        return {
                            valid: false,
                            error: `Entry ${i} accumulation hash mismatch`,
                            index: i
                        };
                    }
                }
                return { valid: true };
            },

            _computeAccumHash(prevHash, currentHash) {
                const str = `${prevHash}|${currentHash}`;
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                    hash = ((hash << 5) - hash) + str.charCodeAt(i);
                    hash |= 0;
                }
                return Math.abs(hash).toString(16);
            },

            reset() {
                entries = [];
                entryIndex.clear();
                nodeRegistry.clear();
            },

            size() {
                return entries.length;
            },

            registerNode(node) {
                nodeRegistry.set(node.id, node);
            },

            getNode(id) {
                return nodeRegistry.get(id) || null;
            }
        };
    })();

    // ─── CONTENT CACHE (v2.2.05) ────────────────────────────────────────
    // A separate module-level Map, deliberately distinct from GlobalVector.
    // GlobalVector is an append-only forensic log (every entry is kept,
    // history is the point). ContentCache is a lookup structure: keyed by
    // a node-supplied content-hash (NOT the same as `fingerprint`, which
    // is identity — two structurally-identical-but-distinct nodes can
    // share one ContentCache entry while still having two different
    // fingerprints/ids), it exists purely so that two nodes computing the
    // same thing from the same inputs share one result instead of both
    // paying for the computation — real CSE, not history.
    const ContentCache = (() => {
        const cache = new Map(); // contentHash -> result

        return {
            has(contentHash) {
                return cache.has(contentHash);
            },
            get(contentHash) {
                return cache.get(contentHash);
            },
            set(contentHash, result) {
                cache.set(contentHash, result);
                return result;
            },
            delete(contentHash) {
                return cache.delete(contentHash);
            },
            reset() {
                cache.clear();
            },
            size() {
                return cache.size;
            }
        };
    })();

    // ─── PROXY HANDLER ──────────────────────────────────────────────────
    const proxyHandler = {
        get(target, prop, receiver) {
            if (typeof prop === 'symbol') {
                const val = target[prop];
                return typeof val === 'function' ? val.bind(receiver) : val;
            }
            if (prop === '__isProxy') return true;

            // Debugger magic properties (v1.5.02)
            if (prop === '$debug') return target._getDebugger.call(receiver);
            if (prop === '$break') return target._break.bind(receiver);
            if (prop === '$watch') return target._watch.bind(receiver);
            if (prop === '$dump') return target._dump.bind(receiver);
            if (prop === '$step') return target._step.bind(receiver);
            if (prop === '$resume') return target._resume.bind(receiver);
            if (prop === '$inspect') return target._inspect.bind(receiver);
            if (prop === '$continue') return target._continue.bind(receiver);
            if (prop === '$trace') return target._getTrace.bind(receiver);
            if (prop === '$replay') return target._replay.bind(receiver);
            if (prop === '$pause') return target._pause.bind(receiver);

            if (prop === 'constructor') {
                return target.constructor;
            }

            // Evaluate the property exactly once, through Reflect.get with
            // `receiver` passed explicitly. This matters specifically for
            // accessor properties (getters): plain `target[prop]` access
            // silently ignores whatever receiver you intended and always
            // runs the getter with `this = target` (the raw, unwrapped
            // instance) — never `receiver` (the Proxy). That's the same
            // target-vs-receiver bug the method-binding branch below was
            // fixed for in v2.2.02, just in a path that fix didn't reach:
            // a getter reading `this.someField` would silently read/write
            // state keyed on the wrong object identity from anything that
            // (correctly) keyed off the Proxy elsewhere — e.g. a WeakMap
            // keyed by instance, set from a method (bound to receiver) and
            // read from a getter (previously always bound to target).
            const rawValue = Reflect.get(target, prop, receiver);

            if (prop in target && typeof rawValue !== 'function') {
                return rawValue;
            }
            if (typeof rawValue === 'function') {
                // Bind to `receiver` (the Proxy the property was accessed
                // through), not `target` (the raw, unwrapped instance).
                // Binding to target was the actual bug behind ASTNode.js's
                // "_initASTFields sets fields but bypasses validation and
                // tracing" behavior: any method called via the Proxy used
                // to run with `this` pointing at the raw object, so
                // `this.field = value` inside that method never went
                // through the set trap at all — no schema validation, no
                // _recordTrace('set', ...) entry, nothing. Binding to the
                // receiver instead means every internal method call still
                // resolves `this` back to the same Proxy, so the set trap
                // (and everything it enforces) applies uniformly no matter
                // whether a field is assigned directly in a constructor or
                // from a method that constructor calls.
                //
                // Note: for a genuine data property whose VALUE happens to
                // be a function (e.g. GraphQLScalarType.serialize), .bind()
                // on that function is harmless (it's not a method relying
                // on `this`), so this branch is safe to apply uniformly.
                return rawValue.bind(receiver);
            }

            const ch = target.child(prop);
            if (ch) return new Proxy(ch, proxyHandler);
            return undefined;
        },

        set(target, prop, value) {
            // ─── SCHEMA VALIDATION (from subclass) ─────────────────
            // Runs first: this both rejects invalid values outright, and
            // tells us (via a successful, non-error result) whether `prop`
            // is something the schema explicitly recognizes even if it
            // hasn't been assigned on `target` yet.
            let schemaApproved = false;
            if (typeof target._validateProperty === 'function') {
                const validation = target._validateProperty(prop, value);
                if (!validation.valid) {
                    throw new TypeError(`[${target.type}] Property "${prop}" validation failed: ${validation.reason}`);
                }
                const schema = target.constructor._schema || (BaseClassX.getSchema ? BaseClassX.getSchema(target.type) : null);
                const parentSchema = target.constructor._parentSchema;
                schemaApproved = !!(
                    (schema && schema.properties && prop in schema.properties) ||
                    (parentSchema && parentSchema.properties && prop in parentSchema.properties)
                );
            }

            if (prop in target || schemaApproved) {
                const oldValue = target[prop];
                target[prop] = value;
                target._recordTrace('set', {
                    property: prop,
                    value
                });
                return true;
            }
            console.warn(`Cannot set property "${prop}" on node ${target.id}`);
            return false;
        },

        has(target, prop) {
            if (prop === '$debug' || prop === '$break' || prop === '$watch' ||
                prop === '$dump' || prop === '$step' || prop === '$resume' ||
                prop === '$inspect' || prop === '$continue' || prop === '$trace' ||
                prop === '$replay' || prop === '$pause') {
                return true;
            }
            if (prop in target) return true;
            return target._childMap.has(prop);
        },

        ownKeys(target) {
            const realKeys = Reflect.ownKeys(target);
            const realKeySet = new Set(realKeys.map(String));

            for (const ch of target.children) {
                if (ch.name && !realKeySet.has(ch.name)) {
                    realKeys.push(ch.name);
                    realKeySet.add(ch.name);
                }
            }
            return realKeys;
        },

        getOwnPropertyDescriptor(target, prop) {
            if (prop in target) {
                return Reflect.getOwnPropertyDescriptor(target, prop);
            }
            const ch = target.child(prop);
            if (ch) {
                return {
                    enumerable: true,
                    configurable: true,
                    get: () => new Proxy(ch, proxyHandler)
                };
            }
            return undefined;
        }
    };

    // ─── BASECLASSX CLASS ────────────────────────────────────────────────
    class BaseClassX {
        static version = '2.2.06';
        static schemaVersion = '2.2.05';
        static captureState = true;
        static enableDebugger = false;
        static enableDiff = true;

        constructor(options = {}) {
            // ─── CORE FIELDS ──────────────────────────────────
            this.id = options.id || this.generateId();
            this.type = options.type || 'Node';
            this.name = options.name || null;
            this.source = options.source || 'unknown';
            this.version = options.version || '1.0.0';
            this.created = options.created || Date.now();
            this.modified = options.modified || Date.now();
            this.createdUTF24 = options.createdUTF24 || (UTF24Timestamp ? UTF24Timestamp.fromEpochMs(this.created).toHex() : null);
            this.modifiedUTF24 = options.modifiedUTF24 || (UTF24Timestamp ? UTF24Timestamp.fromEpochMs(this.modified).toHex() : null);

            // ─── TREE STRUCTURE ───────────────────────────────
            this._parentRef = options.parent ?
                (typeof WeakRef !== 'undefined' ? new WeakRef(options.parent) : {
                    deref: () => options.parent
                }) :
                null;
            this.children = options.children || [];
            this._childMap = new Map();
            this._rebuildChildMap();

            // ─── STATE & HISTORY ──────────────────────────────
            this.state = options.state || 'initialized';
            this.tags = options.tags || [];
            this.metadata = options.metadata || {};
            this.history = options.history || [];
            this._maxHistoryLength = typeof options.maxHistoryLength === 'number' ? options.maxHistoryLength : 0;

            // ─── CONFLICT TRACKING ────────────────────────────
            this.dissonance = options.dissonance || 0;
            this.anomalies = options.anomalies || [];
            this.rippleCount = options.rippleCount || 0;

            // ─── CLONE LINEAGE (v2.2.01) ──────────────────────
            this._cloneOf = options.cloneOf || null;
            this._cloneOrigin = options.cloneOrigin || null;
            this._cloneGeneration = options.cloneGeneration || 0;

            // ─── FINGERPRINTING ───────────────────────────────
            this.fingerprint = options.fingerprint || this.computeFingerprint();
            this._tokenDivisor = typeof options.tokenDivisor === 'number' ? options.tokenDivisor : 4.5;

            // Pre-declared so the Proxy set trap's `prop in target` guard
            // allows writes to these on every instance, not only ones
            // constructed via fromJSON (which used to be the only place
            // these were ever assigned).
            this._loadedFingerprint = options.loadedFingerprint || null;
            this.integrityOk = options.integrityOk !== undefined ? options.integrityOk : true;

            // ─── EVENT SYSTEM ────────────────────────────────
            this._listeners = new Map();
            this._batching = false;
            this._batchEvents = [];
            this._disposed = false;

            // ─── TRACE & REPLAY ───────────────────────────────
            this._trace = options.trace || [];
            this._maxTraceLength = typeof options.maxTraceLength === 'number' ? options.maxTraceLength : 0;
            this._captureState = options.captureState !== undefined ? options.captureState : this.constructor.captureState;

            // ─── VECTOR STATE (v2.0) ─────────────────────────
            // Separate from trace: global accumulation system
            this.vectorIndex = options.vectorIndex || null;
            this.currentHash = options.currentHash || null;
            this.previousHash = options.previousHash || null;
            this.accumHash = options.accumHash || null;
            this.lastVectorTime = options.lastVectorTime || this.created;

            // ─── GRAPH STATE (for relational projection) ──────
            this.inEdges = options.inEdges || [];
            this.outEdges = options.outEdges || [];

            // Make this instance resolvable by id from vector entries
            // (which only ever store the id, never a live reference).
            GlobalVector.registerNode(this);

            // ─── DEBUGGER STATE (v1.5.02) ────────────────────
            // Gated by static enableDebugger. When a subclass sets
            // enableDebugger = false, these two object allocations (9 +
            // 7 keys) are skipped entirely — every $break/$watch/$dump/
            // etc. method checks this.constructor.enableDebugger first
            // and throws rather than touching _debugState, so there is
            // nothing downstream that needs these objects to exist when
            // the flag is off.
            if (this.constructor.enableDebugger) {
                this._debugState = {
                    enabled: options.debuggerEnabled !== false,
                    breakpoints: [],
                    watches: [],
                    isPaused: false,
                    stepMode: 'none',
                    pausedAt: null,
                    pauseStack: [],
                    debugSession: null,
                    pauseCallbacks: [],
                    _pauseResolver: null // Promise resolver for async pause
                };

                this._debugMetadata = {
                    breakCount: 0,
                    watchCount: 0,
                    dumpCount: 0,
                    stepCount: 0,
                    inspectCount: 0,
                    lastBreak: null,
                    lastWatch: null
                };
            }

            // ─── SCHEMA-DEFINED PROPERTIES ────────────────────
            // Pre-declare any property a subclass's schema knows about, so
            // the Proxy set trap's `prop in target` guard (below) doesn't
            // reject legitimate writes to schema props just because they
            // were never assigned in this constructor. Validation of the
            // value itself still happens in _validateProperty at set-time.
            {
                const schema = this.constructor._schema || (BaseClassX.getSchema ? BaseClassX.getSchema(this.type) : null);
                const schemaSources = [schema, this.constructor._parentSchema].filter(Boolean);
                for (const s of schemaSources) {
                    if (!s.properties) continue;
                    for (const key of Object.keys(s.properties)) {
                        if (key in this) continue; // don't clobber core fields already set above
                        if (key in options) {
                            this[key] = options[key];
                        } else if ('default' in s.properties[key]) {
                            this[key] = s.properties[key].default;
                        } else {
                            this[key] = undefined;
                        }
                    }
                }
            }

            if (typeof this.afterConstruct === 'function') {
                this.afterConstruct(options);
            }

            this._recordTrace('init', {
                id: this.id,
                type: this.type,
                name: this.name,
                version: this.version,
                debuggerEnabled: this.constructor.enableDebugger ? this._debugState.enabled : false
            });

            return new Proxy(this, proxyHandler);
        }

        // ─── ID GENERATION ────────────────────────────────────
        _touchModified() {
            this.modified = Date.now();
            this.modifiedUTF24 = UTF24Timestamp ? UTF24Timestamp.fromEpochMs(this.modified).toHex() : null;
        }

        getCreatedUTF24() { return this.createdUTF24 && UTF24Timestamp ? UTF24Timestamp.fromHex(this.createdUTF24) : null; }
        getModifiedUTF24() { return this.modifiedUTF24 && UTF24Timestamp ? UTF24Timestamp.fromHex(this.modifiedUTF24) : null; }

        generateId() {
            const ts = Date.now().toString(36);
            const rnd = Math.random().toString(36).substring(2, 8);
            return `${this.type || 'Node'}_${ts}_${rnd}`;
        }

        // ─── FINGERPRINTING ───────────────────────────────────
        computeFingerprint() {
            const data = JSON.stringify({
                id: this.id,
                type: this.type,
                name: this.name,
                source: this.source,
                version: this.version,
                created: this.created,
                tags: this.tags.slice().sort(),
                metadataKeys: Object.keys(this.metadata).sort()
            });
            return this.hashString(data);
        }

        hashString(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return Math.abs(hash).toString(36);
        }

        // ─── INTERNAL HELPERS (v1.4.00) ───────────────────────────
        _assertAlive() {
            if (this._disposed) {
                throw new Error(`Node ${this.id} has been disposed`);
            }
        }

        static _makeError(message, code) {
            const err = new Error(message);
            err.code = code;
            return err;
        }

        _captureObject(obj, seen, depth = 0) {
            const MAX_DEPTH = 100;
            if (depth > MAX_DEPTH) {
                return { _ref: 'max-depth-exceeded' };
            }
            if (!obj || typeof obj !== 'object') return obj;
            if (seen.has(obj)) return { _ref: 'circular' };
            seen.add(obj);

            const result = {};
            for (const key of Object.keys(obj)) {
                const value = obj[key];
                if (value && typeof value === 'object') {
                    if (value === this) {
                        result[key] = { _ref: this.id || 'self' };
                    } else if (value instanceof BaseClassX) {
                        result[key] = value._captureState(seen, depth + 1);
                    } else {
                        result[key] = this._captureObject(value, seen, depth + 1);
                    }
                } else {
                    result[key] = value;
                }
            }
            return result;
        }

        _restoreState(state) {
            if (!state) return this;
            for (const key of Object.keys(state)) {
                const value = state[key];
                if (value && typeof value === 'object' && value._ref) {
                    if (value._ref === 'self' || value._ref === this.id) {
                        this[key] = this;
                    } else {
                        this[key] = { _pendingRef: value._ref };
                    }
                    continue;
                }
                if (key === 'children' && Array.isArray(value)) {
                    continue;
                }
                this[key] = value;
            }
            this.fingerprint = state.fingerprint || this.computeFingerprint();
            return this;
        }

        verifyFingerprint() {
            return this.fingerprint === this.computeFingerprint();
        }

        // ─── TREE MANAGEMENT ──────────────────────────────────
        _rebuildChildMap() {
            this._childMap.clear();
            for (const ch of this.children) {
                if (ch.name) this._childMap.set(ch.name, ch);
            }
        }

        child(name) {
            return this._childMap.get(name) || undefined;
        }

        get(name) {
            return this._childMap.get(name) || undefined;
        }

        addChild(ch) {
            if (!(ch instanceof BaseClassX)) {
                throw new Error('Child must be an instance of BaseClassX');
            }
            this.children.push(ch);
            ch.parent = this;
            if (ch.name) this._childMap.set(ch.name, ch);
            this._touchModified();
            this._recordTrace('add_child', {
                childId: ch.id,
                childName: ch.name
            });
            this.emit('add_child', {
                childId: ch.id,
                childName: ch.name
            });
            return this;
        }

        addChildren(children) {
            for (const ch of children) this.addChild(ch);
            return this;
        }

        removeChild(ch) {
            const index = this.children.indexOf(ch);
            if (index !== -1) {
                this.children.splice(index, 1);
                if (ch.name) this._childMap.delete(ch.name);
                ch.parent = null;
                this._touchModified();
                this._recordTrace('remove_child', {
                    childId: ch.id
                });
                this.emit('remove_child', {
                    childId: ch.id
                });
            }
            return this;
        }

        getChildren() {
            return this.children;
        }

        getDescendants() {
            let desc = [];
            for (const ch of this.children) {
                desc.push(ch);
                desc = desc.concat(ch.getDescendants());
            }
            return desc;
        }

        resolve(path) {
            const parts = path.split('.');
            let current = this;
            for (const part of parts) {
                const found = current.get(part);
                if (!found) {
                    console.warn(`Path "${path}" failed at "${part}"`);
                    return undefined;
                }
                current = found;
            }
            return current;
        }

        findByName(name) {
            if (this.name === name) return this;
            for (const ch of this.children) {
                const found = ch.findByName(name);
                if (found) return found;
            }
            return undefined;
        }

        findByType(type) {
            const results = [];
            if (this.type === type) results.push(this);
            for (const ch of this.children) results.push(...ch.findByType(type));
            return results;
        }

        // ─── STATE MANAGEMENT ────────────────────────────────
        updateState(newState) {
            const oldState = this.state;
            this.state = newState;
            if (this._maxHistoryLength === 0 || this.history.length < this._maxHistoryLength) {
                this.history.push(oldState);
            }
            this._recordTrace('state_change', {
                newState,
                oldState
            });
            this.emit('state_changed', {
                oldState,
                newState,
                node: this
            });
            this._touchModified();
            return this;
        }

        // ─── TAGS ────────────────────────────────────────────
        addTag(tag) {
            if (!this.tags.includes(tag)) {
                this.tags.push(tag);
                this._recordTrace('add_tag', {
                    tag
                });
                this.emit('tag_added', {
                    tag
                });
                this._touchModified();
            }
            return this;
        }

        removeTag(tag) {
            const idx = this.tags.indexOf(tag);
            if (idx !== -1) {
                this.tags.splice(idx, 1);
                this._recordTrace('remove_tag', {
                    tag
                });
                this.emit('tag_removed', {
                    tag
                });
                this._touchModified();
            }
            return this;
        }

        hasTag(tag) {
            return this.tags.includes(tag);
        }

        getTags() {
            return this.tags;
        }

        // ─── METADATA ─────────────────────────────────────────
        setMetadata(key, value) {
            this.metadata[key] = value;
            this._recordTrace('set_metadata', {
                key,
                value
            });
            this.emit('metadata_changed', {
                key,
                value
            });
            this._touchModified();
            return this;
        }

        getMetadata(key) {
            return this.metadata[key];
        }

        removeMetadata(key) {
            if (key in this.metadata) {
                delete this.metadata[key];
                this._recordTrace('remove_metadata', {
                    key
                });
                this.emit('metadata_removed', {
                    key
                });
                this._touchModified();
            }
            return this;
        }

        hasMetadata(key) {
            return key in this.metadata;
        }

        // ─── DISSONANCE (CONFLICT TRACKING) ───────────────────
        addDissonance(amount) {
            this.dissonance += amount;
            this._recordTrace('add_dissonance', {
                amount
            });
            this.emit('dissonance_added', {
                amount,
                total: this.dissonance
            });
            this._touchModified();
            return this;
        }

        resolveDissonance(amount) {
            this.dissonance = Math.max(0, this.dissonance - amount);
            this._recordTrace('resolve_dissonance', {
                amount
            });
            this.emit('dissonance_resolved', {
                amount,
                remaining: this.dissonance
            });
            this._touchModified();
            return this;
        }

        // ─── ANOMALIES (KNOWN ISSUES) ────────────────────────
        addAnomaly(anomaly) {
            const item = {
                ...anomaly,
                id: anomaly.id || `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                addedAt: anomaly.addedAt || Date.now()
            };
            this.anomalies.push(item);
            this._recordTrace('add_anomaly', {
                anomaly: item
            });
            this.emit('anomaly_added', {
                anomaly: item
            });
            this._touchModified();
            return this;
        }

        removeAnomaly(index) {
            if (index >= 0 && index < this.anomalies.length) {
                const removed = this.anomalies.splice(index, 1)[0];
                this._recordTrace('remove_anomaly', {
                    index,
                    anomaly: removed
                });
                this.emit('anomaly_removed', {
                    index,
                    anomaly: removed
                });
                this._touchModified();
            }
            return this;
        }

        resolveAnomaly(index, resolution) {
            if (index >= 0 && index < this.anomalies.length) {
                this.anomalies[index].resolved = true;
                this.anomalies[index].resolution = resolution;
                this.anomalies[index].resolvedAt = Date.now();
                this._recordTrace('resolve_anomaly', {
                    index,
                    resolution
                });
                this.emit('anomaly_resolved', {
                    index,
                    resolution
                });
                this._touchModified();
            }
            return this;
        }

        // ─── BATCHING ────────────────────────────────────────
        batch(fn) {
            this._batching = true;
            this._batchEvents = [];
            this._recordTrace('batch_start', {});
            try {
                fn.call(this);
            } finally {
                this._batching = false;
                this._recordTrace('batch_end', {
                    eventCount: this._batchEvents.length
                });
                if (this._batchEvents.length > 0) {
                    this.history.push({
                        event: 'batch',
                        timestamp: Date.now(),
                        state: this.state,
                        dissonance: this.dissonance,
                        events: this._batchEvents
                    });
                    this._batchEvents = [];
                    this._pruneHistory();
                    this.emit('batch', {
                        count: this._batchEvents.length
                    });
                }
            }
            return this;
        }

        // ─── EVENT SYSTEM ────────────────────────────────────
        on(eventType, handler) {
            if (!this._listeners.has(eventType)) {
                this._listeners.set(eventType, []);
            }
            this._listeners.get(eventType).push(handler);
            return this;
        }

        off(eventType, handler) {
            if (this._listeners.has(eventType)) {
                const handlers = this._listeners.get(eventType);
                const index = handlers.indexOf(handler);
                if (index !== -1) {
                    handlers.splice(index, 1);
                }
            }
            return this;
        }

        emit(eventType, data) {
            if (this._batching) {
                this._batchEvents.push({
                    type: eventType,
                    data
                });
                return this;
            }
            if (this._listeners.has(eventType)) {
                const handlers = this._listeners.get(eventType);
                for (const handler of handlers) {
                    try {
                        handler(data);
                    } catch (e) {
                        console.error(`Error in event handler for ${eventType}:`, e);
                    }
                }
            }
            // Wildcard listeners (v2.2.06) — receive every event this
            // instance emits, as handler(eventType, data). Skipped when
            // eventType itself is '*' to avoid a listener observing its
            // own registration event ambiguously.
            if (eventType !== '*' && this._listeners.has('*')) {
                const wildcardHandlers = this._listeners.get('*');
                for (const handler of wildcardHandlers) {
                    try {
                        handler(eventType, data);
                    } catch (e) {
                        console.error(`Error in wildcard event handler for ${eventType}:`, e);
                    }
                }
            }
            return this;
        }

        recordEvent(eventType, data = {}) {
            const entry = {
                event: eventType,
                timestamp: Date.now(),
                state: this.state,
                dissonance: this.dissonance,
                ...data
            };
            if (this._batching) {
                this._batchEvents.push(entry);
            } else {
                this.history.push(entry);
                this._pruneHistory();
                this.emit(eventType, entry);
            }
            return this;
        }

        _pruneHistory() {
            if (this._maxHistoryLength > 0 && this.history.length > this._maxHistoryLength) {
                this.history = this.history.slice(-this._maxHistoryLength);
            }
        }

        pruneHistory(keep) {
            if (keep > 0) {
                this.history = this.history.slice(-keep);
            } else {
                this.history = [];
            }
            this._recordTrace('prune_history', {
                keep
            });
            return this;
        }

        // ─── GRAPH LINKING (relational projection support) ────
        /**
         * Create a directed edge from this node to `target`.
         * Populates both sides so RelationalProjection can traverse
         * in either direction without re-scanning the whole graph.
         */
        // ─── RELATION CARDINALITY DECLARATION (v2.2.03) ────────
        // A class declares its relation contracts once, per label, via
        // static _relations = { <label>: { cardinality, max } }.
        // Cardinality is expressed as "<source>:<target>":
        //   '1:1' — this source may have at most one outgoing edge of this
        //           label, AND the target may have at most one incoming
        //           edge of this label (each target has exactly one owner).
        //   '1:M' — this source may have many outgoing edges of this
        //           label, but each target may have at most one incoming
        //           edge of this label (many children, one parent, per
        //           label — the classic FK relationship).
        //   'M:M' — unconstrained both directions.
        //   '1:X' — this source may have at most `max` outgoing edges of
        //           this label; target side unconstrained. Requires `max`.
        // linkTo's own `cardinality`/`max` arguments, when given, override
        // whatever the class declared for that label — "schema declares
        // default, linkTo can override."
        static getRelationConstraint(label) {
            const relations = this._relations || {};
            return relations[label] || null;
        }

        _resolveRelationConstraint(label, overrideCardinality, overrideMax) {
            const declared = this.constructor.getRelationConstraint(label);
            const cardinality = overrideCardinality || (declared && declared.cardinality) || null;
            const max = overrideMax !== undefined ? overrideMax : (declared && declared.max);
            return cardinality ? { cardinality, max } : null;
        }

        _countEdgesForLabel(edges, label) {
            return edges.filter(e => e.label === label).length;
        }

        _assertCardinality(target, label, constraint) {
            if (!constraint) return;
            const { cardinality, max } = constraint;
            const outCount = this._countEdgesForLabel(this.outEdges, label);
            const inCount = this._countEdgesForLabel(target.inEdges, label);

            if (cardinality === '1:1') {
                if (outCount >= 1) {
                    throw new Error(`Cardinality violation: "${this.id}" already has a 1:1 "${label}" relation (source side)`);
                }
                if (inCount >= 1) {
                    throw new Error(`Cardinality violation: "${target.id}" already has a 1:1 "${label}" relation (target side)`);
                }
            } else if (cardinality === '1:M') {
                if (inCount >= 1) {
                    throw new Error(`Cardinality violation: "${target.id}" already has an owner for 1:M "${label}" relation`);
                }
            } else if (cardinality === '1:X') {
                if (typeof max !== 'number') {
                    throw new Error(`Cardinality "1:X" for "${label}" requires a numeric max`);
                }
                if (outCount >= max) {
                    throw new Error(`Cardinality violation: "${this.id}" already has ${outCount}/${max} "${label}" relations (1:X limit reached)`);
                }
            } else if (cardinality === 'M:M') {
                // unconstrained
            } else {
                throw new Error(`Unknown cardinality "${cardinality}" for relation "${label}"`);
            }
        }

        /**
         * Create a directed, weighted edge from this node to `target`,
         * enforcing whatever cardinality constraint applies to `label`
         * (from options.cardinality/options.max, falling back to the
         * class's static _relations declaration for that label).
         *
         * weight is REQUIRED — there is no default. An edge with no
         * meaningful weight should use 1 explicitly, not rely on this
         * method to decide that for you; this keeps every edge in the
         * graph honestly self-describing rather than silently uniform.
         */
        /**
         * Create a directed edge from this node to `target`, enforcing
         * whatever cardinality constraint applies to `label` (from
         * options.cardinality/options.max, falling back to the class's
         * static _relations declaration for that label).
         *
         * Weighting is OPT-IN, not defaulted. If options.weight is not
         * passed, the edge simply has no `weight` field at all — it is
         * not silently set to 1 or any other placeholder. This keeps
         * `edge.weight === undefined` an unambiguous signal that this
         * relation was never intended to carry a weight, rather than a
         * value someone might mistake for a deliberate "weight of 1".
         * Pass options.weight explicitly (any finite number) to turn
         * weighting on for that edge.
         */
        linkTo(target, label = null, options = {}) {
            this._assertAlive();
            const hasWeight = Object.prototype.hasOwnProperty.call(options, 'weight');
            if (hasWeight && (typeof options.weight !== 'number' || Number.isNaN(options.weight))) {
                throw new Error(`linkTo's "weight", when provided, must be a finite number (relation "${label}" from "${this.id}" to "${target.id}")`);
            }

            const constraint = this._resolveRelationConstraint(label, options.cardinality, options.max);
            this._assertCardinality(target, label, constraint);

            const edge = { source: this, target, label, timestamp: Date.now() };
            if (hasWeight) edge.weight = options.weight;
            this.outEdges.push(edge);
            target.inEdges.push(edge);
            this._recordTrace('link_to', { targetId: target.id, label, weight: hasWeight ? options.weight : null, weighted: hasWeight, cardinality: constraint ? constraint.cardinality : null });
            return edge;
        }

        unlinkFrom(target, label = null) {
            this._assertAlive();
            const matchesLabel = (e) => label === null || e.label === label;
            this.outEdges = this.outEdges.filter(e => !(e.target === target && matchesLabel(e)));
            target.inEdges = target.inEdges.filter(e => !(e.source === this && matchesLabel(e)));
            this._recordTrace('unlink_from', { targetId: target.id, label });
            return this;
        }

        // ─── CONTENT-HASH CACHING (v2.2.05) ────────────────────
        // Deliberately distinct from `fingerprint`. fingerprint is node
        // IDENTITY (id, type, name, source, version, created, tags,
        // metadata) — two nodes with different fingerprints can still
        // represent "the same computation" (e.g. two distinct
        // MatMulNode instances multiplying the same two operand
        // matrices). computeContentHash() is what a subclass uses to
        // express that latter kind of sameness — "these inputs, this
        // operation" — which is what actually matters for CSE.
        //
        // There is no default implementation: silently hashing generic
        // node fields would produce a content-hash that looks
        // meaningful but almost certainly isn't (fingerprint already
        // covers identity; a wrong default here would just be a
        // fingerprint by another name, defeating the whole point).
        // A subclass MUST implement this deliberately, the same
        // philosophy as DomainNode.fromJSON's must-implement contract.
        computeContentHash() {
            throw new Error(
                `${this.constructor.name}.computeContentHash() is not implemented. ` +
                `A subclass must define this to express "same inputs, same operation" ` +
                `for its own domain (e.g. a MatMul node hashing its operand identities) ` +
                `before getCached()/linkToCached() can be used.`
            );
        }

        /**
         * Global CSE cache: if a node with the same content-hash has
         * already computed a result (from ANY node, not just this one),
         * return that cached result instead of recomputing. `computeFn`
         * is only ever invoked on a cache miss.
         */
        getCached(computeFn) {
            const hash = this.computeContentHash();
            if (ContentCache.has(hash)) {
                this._recordTrace('content_cache_hit', { contentHash: hash });
                return ContentCache.get(hash);
            }
            const result = computeFn();
            ContentCache.set(hash, result);
            this._recordTrace('content_cache_miss', { contentHash: hash });
            return result;
        }

        /**
         * Local memoization for a 1:X relation: the edge itself carries
         * the cached result, not a global table. This is deliberately
         * NOT routed through ContentCache — a 1:X source can have at
         * most `max` outgoing edges of this label, so the cardinality
         * constraint already bounds how much can ever be cached here;
         * a per-edge cache is cheaper and needs no eviction policy,
         * unlike the unbounded global cache above.
         *
         * If an edge to `target` with this `label` already exists,
         * returns its stored result. Otherwise computes, creates the
         * edge via linkTo (so cardinality/weight are enforced exactly
         * as any other linkTo call would), stores the result on that
         * edge, and returns it.
         */
        linkToCached(target, label, computeFn, options = {}) {
            const existing = this.outEdges.find(e => e.target === target && e.label === label);
            if (existing && 'cachedResult' in existing) {
                this._recordTrace('edge_cache_hit', { targetId: target.id, label });
                return existing.cachedResult;
            }
            const result = computeFn();
            const edge = this.linkTo(target, label, options);
            edge.cachedResult = result;
            this._recordTrace('edge_cache_miss', { targetId: target.id, label });
            return result;
        }

        // ─── TRACE RECORDING ──────────────────────────────────
        _recordTrace(type, data = {}) {
            const entry = {
                timestamp: Date.now(),
                type,
                data,
                fingerprint: this.fingerprint,
                debugger: this.constructor.enableDebugger ? {
                    enabled: this._debugState.enabled,
                    isPaused: this._debugState.isPaused,
                    stepMode: this._debugState.stepMode
                } : { enabled: false, isPaused: false, stepMode: 'none' }
            };
            this._trace.push(entry);

            if (this._maxTraceLength > 0 && this._trace.length > this._maxTraceLength) {
                this._trace.shift();
            }

            return entry;
        }

        get trace() {
            return this._trace;
        }

        clearTrace() {
            this._trace = [];
            this._recordTrace('clear_trace', {});
            return this;
        }

        // ─── PROPERTY SETTERS (v1.4.00 restoration) ────────────
        setType(type) {
            this._assertAlive();
            this.type = type;
            this._recordTrace('set_type', { type });
            return this;
        }

        setName(name) {
            this._assertAlive();
            this.name = name;
            this._recordTrace('set_name', { name });
            return this;
        }

        setSource(source) {
            this._assertAlive();
            this.source = source;
            this._recordTrace('set_source', { source });
            return this;
        }

        setVersion(version) {
            this._assertAlive();
            this.version = version;
            this._recordTrace('set_version', { version });
            return this;
        }

        // ─── UTILITY PROPERTIES (v1.4.00) ────────────────────────
        get tokenEstimate() {
            return this.toString().length / 4;
        }

        get maxIndentDepth() {
            const str = this.toString();
            let maxDepth = 0, cur = 0;
            for (const ch of str) {
                if ('{[('.includes(ch)) {
                    cur++;
                    if (cur > maxDepth) maxDepth = cur;
                } else if ('}])'.includes(ch)) cur--;
            }
            return maxDepth;
        }

        get topLevelCount() {
            return this.children.length;
        }

        get charCount() {
            return this.toString().length;
        }

        get estSizeKB() {
            return this.charCount / 1024;
        }

        // ─── ANOMALY ACCESS (v1.4.00) ────────────────────────────
        getAnomalies() {
            return this.anomalies;
        }

        // ─── RELATIONSHIP CHECKS (v1.4.00) ───────────────────────
        isDescendantOf(ancestor) {
            let cur = this.parent;
            while (cur) {
                if (cur === ancestor) return true;
                cur = cur.parent;
            }
            return false;
        }

        isAncestorOf(descendant) {
            return descendant.isDescendantOf(this);
        }

        // ─── SNAPSHOT & RESTORE (v1.4.00 restoration) ─────────
        snapshot() {
            return {
                schemaVersion: SCHEMA_VERSION,
                id: this.id,
                fingerprint: this.fingerprint,
                state: this.state,
                metadata: { ...this.metadata },
                tags: [...this.tags],
                children: this.children.map(c => c.snapshot()),
                history: [...this.history],
                dissonance: this.dissonance,
                anomalies: [...this.anomalies],
                rippleCount: this.rippleCount,
                created: this.created,
                modified: this.modified,
                createdUTF24: this.createdUTF24,
                modifiedUTF24: this.modifiedUTF24,
                trace: [...this._trace]
            };
        }

        restore(snapshot) {
            this._assertAlive();
            if (snapshot.schemaVersion && snapshot.schemaVersion !== SCHEMA_VERSION) {
                console.warn(`BaseClassX.restore: snapshot schema ${snapshot.schemaVersion}!==current ${SCHEMA_VERSION}`);
            }
            if (this.id !== snapshot.id) {
                throw new Error('Cannot restore snapshot to a different node');
            }
            this.state = snapshot.state;
            this.metadata = { ...snapshot.metadata };
            this.tags = [...snapshot.tags];
            this.history = [...snapshot.history];
            this.dissonance = snapshot.dissonance || 0;
            this.anomalies = snapshot.anomalies || [];
            this.rippleCount = snapshot.rippleCount || 0;
            this._trace = snapshot.trace || [];
            this._touchModified();
            return this;
        }

        // ─── DUPLICATION (v1.4.00 restoration) ────────────────
        copy() {
            const c = new BaseClassX({
                id: this.id,
                type: this.type,
                name: this.name,
                source: this.source,
                version: this.version,
                created: this.created,
                modified: this.modified,
                createdUTF24: this.createdUTF24,
                modifiedUTF24: this.modifiedUTF24,
                state: this.state,
                tags: [...this.tags],
                metadata: { ...this.metadata },
                history: [...this.history],
                fingerprint: this.fingerprint,
                parent: this.parent,
                children: [...this.children],
                dissonance: this.dissonance,
                anomalies: [...this.anomalies],
                rippleCount: this.rippleCount,
                tokenDivisor: this._tokenDivisor,
                maxHistoryLength: this._maxHistoryLength,
                trace: [...this._trace],
                captureState: this._captureState
            });
            c._childMap = new Map(this._childMap);
            return c;
        }

        clone() {
            const schema = this.constructor._schema || (BaseClassX.getSchema ? BaseClassX.getSchema(this.type) : null);
            const parentSchema = this.constructor._parentSchema;
            const schemaProps = {};
            for (const s of [schema, parentSchema].filter(Boolean)) {
                if (!s.properties) continue;
                for (const key of Object.keys(s.properties)) {
                    schemaProps[key] = this[key];
                }
            }

            const c = new this.constructor({
                type: this.type,
                name: this.name,
                source: this.source,
                version: this.version,
                created: this.created,
                state: this.state,
                tags: [...this.tags],
                metadata: { ...this.metadata },
                history: [...this.history],
                dissonance: this.dissonance,
                anomalies: [...this.anomalies],
                rippleCount: this.rippleCount,
                tokenDivisor: this._tokenDivisor,
                maxHistoryLength: this._maxHistoryLength,
                trace: [...this._trace],
                captureState: this._captureState,
                // ─── LINEAGE (v2.2.01) ────────────────────────
                // Track where this clone came from, so ancestry is
                // recoverable without re-diffing fingerprints.
                cloneOf: this.id,
                cloneOrigin: this._cloneOrigin || this.id,
                cloneGeneration: (this._cloneGeneration || 0) + 1,
                // Carry forward subclass schema properties, not just
                // the fixed base fields above.
                ...schemaProps
            });
            c._recordTrace('cloned_from', {
                sourceId: this.id,
                cloneOrigin: c._cloneOrigin,
                cloneGeneration: c._cloneGeneration
            });
            for (const ch of this.children) {
                c.addChild(ch.clone());
            }
            return c;
        }

        // ─── REPLAY ───────────────────────────────────────────
        replay(trace, expectedFingerprint) {
            const entries = trace || this._trace;
            const expected = expectedFingerprint || this.fingerprint;

            const fresh = new this.constructor();

            for (const entry of entries) {
                const handler = REPLAY_HANDLERS[entry.type];
                if (handler) {
                    handler(fresh, entry);
                } else if (entry.type === 'add_child') {
                    // Skip child recreation
                } else if (typeof fresh[entry.type] === 'function') {
                    fresh[entry.type](...(entry.data.args || []));
                } else {
                    console.warn(`No replay handler for trace type: ${entry.type}`);
                }
            }

            fresh.fingerprint = fresh.computeFingerprint();

            if (fresh.fingerprint !== expected) {
                console.warn(`Replayed state fingerprint does not match original. Expected: ${expected}, Got: ${fresh.fingerprint}`);
            }

            return fresh;
        }

        // ─── PARENT/CHILD RELATIONSHIP ────────────────────────
        get parent() {
            return this._parentRef ? (this._parentRef.deref ? this._parentRef.deref() : null) : null;
        }

        set parent(node) {
            if (node === null || node === undefined) {
                this._parentRef = null;
            } else {
                this._parentRef = typeof WeakRef !== 'undefined' ? new WeakRef(node) : {
                    deref: () => node
                };
            }
            this._recordTrace('parent_change', {
                parentId: node ? node.id : null
            });
        }

        // ─── COMPARISON & DIFF ────────────────────────────────
        diff(other, options = {}) {
            if (!this.constructor.enableDiff) {
                throw new Error(`diff() is disabled for ${this.constructor.name} (static enableDiff = false)`);
            }
            const changes = [];

            if (this.id !== other.id) changes.push({
                field: 'id',
                from: this.id,
                to: other.id
            });
            if (this.type !== other.type) changes.push({
                field: 'type',
                from: this.type,
                to: other.type
            });
            if (this.name !== other.name) changes.push({
                field: 'name',
                from: this.name,
                to: other.name
            });
            if (this.state !== other.state) changes.push({
                field: 'state',
                from: this.state,
                to: other.state
            });
            if (this.dissonance !== other.dissonance) changes.push({
                field: 'dissonance',
                from: this.dissonance,
                to: other.dissonance
            });

            const thisTagSet = new Set(this.tags);
            const otherTagSet = new Set(other.tags);
            for (const tag of thisTagSet) {
                if (!otherTagSet.has(tag)) changes.push({
                    field: 'tags',
                    action: 'removed',
                    tag
                });
            }
            for (const tag of otherTagSet) {
                if (!thisTagSet.has(tag)) changes.push({
                    field: 'tags',
                    action: 'added',
                    tag
                });
            }

            for (const key of Object.keys(this.metadata)) {
                if (this.metadata[key] !== other.metadata[key]) {
                    changes.push({
                        field: 'metadata',
                        action: 'changed',
                        key,
                        from: this.metadata[key],
                        to: other.metadata[key]
                    });
                }
            }
            for (const key of Object.keys(other.metadata)) {
                if (!(key in this.metadata)) {
                    changes.push({
                        field: 'metadata',
                        action: 'added',
                        key,
                        value: other.metadata[key]
                    });
                }
            }

            const thisChildMap = new Map(this.children.map(c => [c.id, c]));
            const otherChildMap = new Map(other.children.map(c => [c.id, c]));

            for (const [id] of thisChildMap) {
                if (!otherChildMap.has(id)) changes.push({
                    field: 'children',
                    action: 'removed',
                    childId: id
                });
            }
            for (const [id, otherChild] of otherChildMap) {
                if (!thisChildMap.has(id)) {
                    changes.push({
                        field: 'children',
                        action: 'added',
                        childId: id
                    });
                } else if (options.recursive) {
                    const childDiffs = thisChildMap.get(id).diff(otherChild, options);
                    if (childDiffs.length > 0) {
                        changes.push({
                            field: 'children',
                            action: 'changed',
                            childId: id,
                            changes: childDiffs
                        });
                    }
                }
            }

            return changes;
        }

        equals(other) {
            if (!this.constructor.enableDiff) {
                throw new Error(`equals() is disabled for ${this.constructor.name} (static enableDiff = false)`);
            }
            if (!(other instanceof BaseClassX)) return false;
            return this.id === other.id && this.fingerprint === other.fingerprint;
        }

        // ─── FREEZING ─────────────────────────────────────────
        freeze() {
            const frozenHandler = {
                get(target, prop) {
                    const val = target[prop];
                    if (typeof val === 'function') {
                        const mutators = new Set(['addChild', 'removeChild', 'addChildren', 'updateState', 'addTag', 'removeTag', 'setMetadata', 'removeMetadata', 'addDissonance', 'resolveDissonance', 'addAnomaly', 'removeAnomaly', 'resolveAnomaly', 'restore', 'batch', 'setType', 'setName', 'setSource', 'setVersion', 'dispose', 'clearTrace']);
                        if (mutators.has(prop)) {
                            return () => {
                                throw new Error(`Node ${target.id} is frozen`);
                            };
                        }
                        return val.bind(target);
                    }
                    return val;
                },
                set() {
                    throw new Error(`Node is frozen`);
                }
            };
            return new Proxy(this, frozenHandler);
        }

        // ─── DISPOSAL ─────────────────────────────────────────
        dispose() {
            if (this._disposed) return;
            if (typeof this.beforeDispose === 'function') this.beforeDispose();
            this._recordTrace('dispose', {});
            this.emit('dispose', {
                id: this.id
            });
            this._disposed = true;
            this.parent = null;
            this._listeners.clear();
            this.recordEvent('disposed');
        }

        isDisposed() {
            return this._disposed;
        }

        // ─── DEBUGGER: CORE (v1.5.02) ─────────────────────────
        _assertDebuggerEnabled() {
            if (!this.constructor.enableDebugger) {
                throw new Error(`Debugger subsystem is disabled for ${this.constructor.name} (static enableDebugger = false)`);
            }
        }

        _getDebugger() {
            this._assertDebuggerEnabled();
            return {
                break: this._break.bind(this),
                watch: this._watch.bind(this),
                dump: this._dump.bind(this),
                step: this._step.bind(this),
                resume: this._resume.bind(this),
                inspect: this._inspect.bind(this),
                continue: this._continue.bind(this),
                trace: this._getTrace.bind(this),
                replay: this._replay.bind(this),
                pause: this._pause.bind(this),
                state: this._debugState,
                metadata: this._debugMetadata,
                enabled: this._debugState.enabled
            };
        }

        _break(condition) {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                console.warn('Debugger not enabled for this node');
                return this;
            }

            const breakpoint = {
                id: 'bp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5),
                condition: condition,
                hits: 0,
                enabled: true,
                createdAt: Date.now(),
                nodeId: this.id,
                nodeType: this.type
            };

            this._debugState.breakpoints.push(breakpoint);
            this._debugMetadata.breakCount++;
            this._debugMetadata.lastBreak = Date.now();

            this._recordTrace('debug_breakpoint_set', {
                breakpointId: breakpoint.id,
                condition: typeof condition === 'function' ? 'function' : condition,
                nodeId: this.id
            });

            this.emit('debug_breakpoint_set', {
                breakpoint: breakpoint,
                node: this
            });

            return this;
        }

        _watch(expression, condition) {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                console.warn('Debugger not enabled for this node');
                return this;
            }

            const watch = {
                id: 'watch_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5),
                expression: expression,
                condition: condition,
                lastValue: undefined,
                changes: 0,
                createdAt: Date.now(),
                nodeId: this.id
            };

            this._debugState.watches.push(watch);
            this._debugMetadata.watchCount++;
            this._debugMetadata.lastWatch = Date.now();

            this._recordTrace('debug_watch_set', {
                watchId: watch.id,
                expression: typeof expression === 'function' ? 'function' : expression,
                nodeId: this.id
            });

            this.emit('debug_watch_set', {
                watch: watch,
                node: this
            });

            return this;
        }

        _dump(includeChildren = true) {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                console.warn('Debugger not enabled for this node');
                return {
                    error: 'Debugger not enabled'
                };
            }

            this._debugMetadata.dumpCount++;

            const dump = {
                node: {
                    id: this.id,
                    type: this.type,
                    name: this.name,
                    state: this.state,
                    dissonance: this.dissonance,
                    tags: this.tags,
                    metadata: this.metadata,
                    fingerprint: this.fingerprint,
                    created: this.created,
                    modified: this.modified,
                    createdUTF24: this.createdUTF24,
                    modifiedUTF24: this.modifiedUTF24,
                    traceLength: this._trace.length,
                    debugState: {
                        isPaused: this._debugState.isPaused,
                        stepMode: this._debugState.stepMode,
                        breakpoints: this._debugState.breakpoints.length,
                        watches: this._debugState.watches.length
                    }
                },
                children: includeChildren ? this.children.map(c => ({
                    id: c.id,
                    type: c.type,
                    name: c.name,
                    state: c.state,
                    dissonance: c.dissonance
                })) : [],
                timestamp: Date.now()
            };

            this._recordTrace('debug_dump', {
                nodeId: this.id,
                childCount: dump.children.length
            });

            this.emit('debug_dump', {
                dump: dump,
                node: this
            });

            return dump;
        }

        _step(mode = 'over') {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                console.warn('Debugger not enabled for this node');
                return this;
            }

            if (!this._debugState.isPaused) {
                console.warn('Cannot step - debugger is not paused');
                return this;
            }

            this._debugState.stepMode = mode;
            this._debugState.isPaused = false;
            this._debugMetadata.stepCount++;

            this._recordTrace('debug_step', {
                nodeId: this.id,
                mode: mode
            });

            this.emit('debug_step', {
                mode: mode,
                node: this
            });

            if (this._debugState._pauseResolver) {
                this._debugState._pauseResolver({
                    resumed: true,
                    stepped: true,
                    mode: mode
                });
                this._debugState._pauseResolver = null;
            }

            this._debugState.pauseCallbacks.forEach(cb => {
                try {
                    cb({
                        mode: mode,
                        node: this
                    });
                } catch (e) {
                    console.error('Error in pause callback:', e);
                }
            });
            this._debugState.pauseCallbacks = [];

            return this;
        }

        _resume() {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                console.warn('Debugger not enabled for this node');
                return this;
            }

            if (!this._debugState.isPaused) {
                console.warn('Cannot resume - debugger is not paused');
                return this;
            }

            this._debugState.isPaused = false;
            this._debugState.stepMode = 'none';

            this._recordTrace('debug_resume', {
                nodeId: this.id
            });

            this.emit('debug_resume', {
                node: this
            });

            if (this._debugState._pauseResolver) {
                this._debugState._pauseResolver({
                    resumed: true
                });
                this._debugState._pauseResolver = null;
            }

            this._debugState.pauseCallbacks.forEach(cb => {
                try {
                    cb({
                        resumed: true,
                        node: this
                    });
                } catch (e) {
                    console.error('Error in pause callback:', e);
                }
            });
            this._debugState.pauseCallbacks = [];

            return this;
        }

        _continue(condition) {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                console.warn('Debugger not enabled for this node');
                return this;
            }

            this._recordTrace('debug_continue', {
                nodeId: this.id,
                condition: typeof condition === 'function' ? 'function' : condition
            });

            this.emit('debug_continue', {
                condition: condition,
                node: this
            });

            if (condition) {
                const bp = this._break(condition);
                bp._temporary = true;
                this._resume();
                return bp;
            }

            return this._resume();
        }

        _inspect() {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                console.warn('Debugger not enabled for this node');
                return {
                    error: 'Debugger not enabled'
                };
            }

            this._debugMetadata.inspectCount++;

            const inspection = {
                id: this.id,
                type: this.type,
                name: this.name,
                state: this.state,
                dissonance: this.dissonance,
                fingerprint: this.fingerprint,
                children: this.children.length,
                tags: this.tags,
                metadata: this.metadata,
                anomalies: this.anomalies.length,
                traceLength: this._trace.length,
                debugger: {
                    isPaused: this._debugState.isPaused,
                    stepMode: this._debugState.stepMode,
                    breakpoints: this._debugState.breakpoints.length,
                    watches: this._debugState.watches.length
                },
                timestamp: Date.now()
            };

            this._recordTrace('debug_inspect', {
                nodeId: this.id
            });

            this.emit('debug_inspect', {
                inspection: inspection,
                node: this
            });

            return inspection;
        }

        _getTrace(filter) {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                console.warn('Debugger not enabled for this node');
                return [];
            }

            let trace = this._trace;

            if (filter) {
                if (typeof filter === 'function') {
                    trace = trace.filter(filter);
                } else if (typeof filter === 'string') {
                    trace = trace.filter(entry => entry.type === filter);
                } else if (Array.isArray(filter)) {
                    trace = trace.filter(entry => filter.indexOf(entry.type) !== -1);
                }
            }

            return {
                entries: trace,
                count: trace.length,
                nodeId: this.id,
                timestamp: Date.now()
            };
        }

        _replay(trace, expectedFingerprint) {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                console.warn('Debugger not enabled for this node');
                return this;
            }

            const entries = trace || this._trace;
            const expected = expectedFingerprint || this.fingerprint;

            this._recordTrace('debug_replay_start', {
                nodeId: this.id,
                entryCount: entries.length
            });

            const result = this.replay(entries, expected);

            this._recordTrace('debug_replay_complete', {
                nodeId: this.id,
                success: result ? true : false
            });

            this.emit('debug_replay', {
                result: result,
                node: this
            });

            return result;
        }

        _pause(callback) {
            this._assertDebuggerEnabled();
            if (!this._debugState.enabled) {
                if (callback) callback({
                    enabled: false
                });
                return Promise.resolve({
                    enabled: false
                });
            }

            // Return a promise that resolves when resumed
            return new Promise((resolve) => {
                if (this._debugState.isPaused) {
                    // Already paused, add callback
                    if (callback) {
                        this._debugState.pauseCallbacks.push(callback);
                    }
                    this._debugState._pauseResolver = resolve;
                } else {
                    // Check if any breakpoints should trigger
                    const shouldBreak = this._checkBreakpoints();

                    if (shouldBreak) {
                        this._debugState.isPaused = true;
                        this._debugState.pausedAt = Date.now();

                        this._recordTrace('debug_paused', {
                            nodeId: this.id,
                            type: this.type,
                            timestamp: this._debugState.pausedAt
                        });

                        this.emit('debug_paused', {
                            node: this,
                            breakpoints: this._debugState.breakpoints,
                            watches: this._debugState.watches
                        });

                        if (callback) {
                            this._debugState.pauseCallbacks.push(callback);
                        }

                        this._debugState._pauseResolver = resolve;
                    } else {
                        resolve({
                            paused: false
                        });
                    }
                }
            });
        }

        _checkBreakpoints() {
            for (let i = 0; i < this._debugState.breakpoints.length; i++) {
                const bp = this._debugState.breakpoints[i];
                if (!bp.enabled) continue;

                if (typeof bp.condition === 'function') {
                    if (bp.condition(this)) {
                        bp.hits++;
                        return true;
                    }
                } else if (bp.condition === 'on:any') {
                    bp.hits++;
                    return true;
                } else if (bp.condition === 'on:state_change' && this.state) {
                    bp.hits++;
                    return true;
                } else if (bp.condition === 'on:children_change' && this.children.length > 0) {
                    bp.hits++;
                    return true;
                }
            }
            return false;
        }

        // ─── SERIALIZATION ────────────────────────────────────
        toJSON() {
            return {
                schemaVersion: SCHEMA_VERSION,
                id: this.id,
                type: this.type,
                name: this.name,
                fingerprint: this.fingerprint,
                created: this.created,
                modified: this.modified,
                createdUTF24: this.createdUTF24,
                modifiedUTF24: this.modifiedUTF24,
                state: this.state,
                tags: this.tags,
                metadata: this.metadata,
                source: this.source,
                version: this.version,
                dissonance: this.dissonance,
                anomalies: this.anomalies,
                rippleCount: this.rippleCount,
                parent: this.parent ? this.parent.id : null,
                children: this.children.map(c => c.toJSON()),
                trace: this._trace,
                debugState: this.constructor.enableDebugger ? {
                    enabled: this._debugState.enabled,
                    breakpoints: this._debugState.breakpoints.map(bp => ({
                        id: bp.id,
                        condition: typeof bp.condition === 'function' ? 'function' : bp.condition,
                        hits: bp.hits,
                        enabled: bp.enabled
                    })),
                    watches: this._debugState.watches.map(w => ({
                        id: w.id,
                        expression: typeof w.expression === 'function' ? 'function' : w.expression,
                        changes: w.changes
                    })),
                    metadata: this._debugMetadata
                } : { enabled: false, disabled: true },
                verified: this.verifyFingerprint()
            };
        }

        static fromJSON(data) {
            if (data.schemaVersion && data.schemaVersion !== SCHEMA_VERSION) {
                console.warn(`BaseClassX.fromJSON: schema ${data.schemaVersion} !== current ${SCHEMA_VERSION}; proceeding`);
            }

            const instance = new BaseClassX({
                id: data.id,
                type: data.type,
                name: data.name,
                created: data.created,
                modified: data.modified,
                state: data.state,
                tags: data.tags,
                metadata: data.metadata,
                source: data.source,
                version: data.version,
                dissonance: data.dissonance,
                anomalies: data.anomalies,
                rippleCount: data.rippleCount,
                trace: data.trace || [],
                captureState: data.captureState !== undefined ? data.captureState : true,
                debuggerEnabled: data.debugState ? data.debugState.enabled : true
            });

            // Restore debugger state
            if (data.debugState) {
                instance._debugState.breakpoints = data.debugState.breakpoints || [];
                instance._debugState.watches = data.debugState.watches || [];
                instance._debugMetadata = data.debugState.metadata || {
                    breakCount: 0,
                    watchCount: 0,
                    dumpCount: 0,
                    stepCount: 0,
                    inspectCount: 0
                };
            }

            instance._loadedFingerprint = data.fingerprint;
            instance.integrityOk = instance.fingerprint === data.fingerprint;

            if (data.children) {
                for (const childData of data.children) {
                    instance.addChild(BaseClassX.fromJSON(childData));
                }
            }

            return instance;
        }

        toShort() {
            return {
                id: this.id,
                type: this.type,
                name: this.name,
                state: this.state,
                dissonance: this.dissonance,
                rippleCount: this.rippleCount,
                fingerprint: this.fingerprint.substring(0, 8) + '...'
            };
        }

        toString() {
            return `${this.type}[${this.id}]`;
        }

        // ─── MIXINS ───────────────────────────────────────────
        static mixin(targetClass, ...args) {
            let options = {};
            let sources = args;

            if (args.length > 0 && args[args.length - 1] !== null && typeof args[args.length - 1] === 'object' && !args[args.length - 1].prototype) {
                options = args[args.length - 1];
                sources = args.slice(0, -1);
            }

            for (const source of sources) {
                const propertyNames = Reflect.ownKeys(source.prototype);
                for (const name of propertyNames) {
                    if (name === 'constructor') continue;
                    const descriptor = Reflect.getOwnPropertyDescriptor(source.prototype, name);
                    if (!descriptor) continue;

                    if (options.warn) {
                        const existing = Reflect.getOwnPropertyDescriptor(targetClass.prototype, name);
                        if (existing) {
                            console.warn(`BaseClassX.mixin: conflict on "${String(name)}" in ${targetClass.name} — overwriting with ${source.name}`);
                        }
                    }

                    Reflect.defineProperty(targetClass.prototype, name, {
                        ...descriptor,
                        configurable: true,
                        writable: true
                    });
                }
            }

            return targetClass;
        }

        static compare(a, b) {
            if (!(a instanceof BaseClassX) || !(b instanceof BaseClassX)) return false;
            return a.fingerprint === b.fingerprint;
        }

        static isClassX(obj) {
            return obj instanceof BaseClassX;
        }

        // ─── SCHEMA VALIDATION FOR EXTENSIONS ────────────────
        static defineSchema(schemaName, schema) {
            if (!BaseClassX._schemas) {
                BaseClassX._schemas = new Map();
            }
            BaseClassX._schemas.set(schemaName, schema);
            return schema;
        }

        static getSchema(schemaName) {
            if (!BaseClassX._schemas) return null;
            return BaseClassX._schemas.get(schemaName);
        }

        _validateProperty(prop, value) {
            // Check if this instance has a schema validator
            const schema = this.constructor._schema || BaseClassX.getSchema(this.type);
            
            if (!schema) {
                // No schema defined; allow any property
                return { valid: true };
            }

            // Properties that are always allowed (base fields)
            const baseProps = new Set([
                'id', 'type', 'name', 'source', 'version', 'state', 'tags', 'metadata',
                'dissonance', 'anomalies', 'rippleCount', 'children', 'created', 'modified',
                'createdUTF24', 'modifiedUTF24',
                'history', 'fingerprint', '_trace', '_listeners', '_childMap', '_parentRef',
                '_debugState', '_debugMetadata', '_disposed', '_batching', '_batchEvents'
            ]);

            if (baseProps.has(prop)) {
                return { valid: true };
            }

            // Check parent schema inheritance
            let inheritedSchema = null;
            if (this.constructor._parentSchema) {
                inheritedSchema = this.constructor._parentSchema;
            }

            // Check schema constraints
            if (schema.properties && prop in schema.properties) {
                const propSchema = schema.properties[prop];
                return this._validatePropertySchema(prop, value, propSchema);
            }

            // Check inherited parent schema
            if (inheritedSchema && inheritedSchema.properties && prop in inheritedSchema.properties) {
                const parentProp = inheritedSchema.properties[prop];
                
                // Check if child schema overrides parent permissions
                const permissions = this._getPropertyPermissions(prop, parentProp);
                
                if (!permissions.enabled) {
                    return {
                        valid: false,
                        reason: `Property "${prop}" disabled in child schema`
                    };
                }

                // Validate based on parent schema + child override
                const mergedSchema = { ...parentProp, ...permissions };
                return this._validatePropertySchema(prop, value, mergedSchema);
            }

            // Property not in schema; check if schema allows additional properties
            if (schema.additionalProperties === false) {
                return {
                    valid: false,
                    reason: `Property "${prop}" not allowed; schema has additionalProperties: false`
                };
            }

            // Allow by default
            return { valid: true };
        }

        _getPropertyPermissions(prop, parentProp) {
            // Permission inheritance from parent
            // Child can: on/off, read, write, modify, mixin
            
            const childOverride = this.constructor._schemaPermissions && this.constructor._schemaPermissions[prop];
            
            if (!childOverride) {
                // No override; inherit parent permissions
                return {
                    enabled: parentProp.enabled !== false,
                    readable: parentProp.readable !== false,
                    writable: parentProp.writable !== false,
                    modifiable: parentProp.modifiable !== false,
                    mixinable: parentProp.mixinable !== false
                };
            }

            // Apply overrides
            return {
                enabled: childOverride.enabled !== undefined ? childOverride.enabled : (parentProp.enabled !== false),
                readable: childOverride.readable !== undefined ? childOverride.readable : (parentProp.readable !== false),
                writable: childOverride.writable !== undefined ? childOverride.writable : (parentProp.writable !== false),
                modifiable: childOverride.modifiable !== undefined ? childOverride.modifiable : (parentProp.modifiable !== false),
                mixinable: childOverride.mixinable !== undefined ? childOverride.mixinable : (parentProp.mixinable !== false)
            };
        }

        _validatePropertySchema(prop, value, propSchema) {
            // Check permissions before validating
            if (propSchema.writable === false && prop in this) {
                return {
                    valid: false,
                    reason: `Property "${prop}" is read-only`
                };
            }

            if (propSchema.modifiable === false && this._trace.some(e => e.data.property === prop)) {
                return {
                    valid: false,
                    reason: `Property "${prop}" cannot be modified after initialization`
                };
            }

            // Type check
            if (propSchema.type) {
                const actualType = Array.isArray(value) ? 'array' : typeof value;
                if (actualType !== propSchema.type && value !== null && value !== undefined) {
                    return {
                        valid: false,
                        reason: `Expected ${propSchema.type}, got ${actualType}`
                    };
                }
            }

            // Min/max checks
            if (typeof value === 'number') {
                if (propSchema.minimum !== undefined && value < propSchema.minimum) {
                    return {
                        valid: false,
                        reason: `Value ${value} is less than minimum ${propSchema.minimum}`
                    };
                }
                if (propSchema.maximum !== undefined && value > propSchema.maximum) {
                    return {
                        valid: false,
                        reason: `Value ${value} exceeds maximum ${propSchema.maximum}`
                    };
                }
            }

            // Enum check
            if (propSchema.enum && !propSchema.enum.includes(value)) {
                return {
                    valid: false,
                    reason: `Value "${value}" not in enum [${propSchema.enum.join(', ')}]`
                };
            }

            // Custom validator
            if (propSchema.validate && typeof propSchema.validate === 'function') {
                const result = propSchema.validate(value);
                if (!result) {
                    return {
                        valid: false,
                        reason: `Custom validation failed for property "${prop}"`
                    };
                }
            }

            return { valid: true };
        }

        // ─── VECTOR METHODS (v2.0) ────────────────────────────
        // DUAL SYSTEM: Separate from trace replay
        // Trace = local replay via REPLAY_HANDLERS
        // Vector = global accumulation chain for forensics

        /**
         * Append this instance to global vector
         */
        appendToVector(data) {
            const hash = this._computeHash({ state: this.state, value: this.value });
            const now = Date.now();

            // Confidence reflects how much to trust this transition:
            // - higher accumulated dissonance (unresolved conflicts/anomalies) lowers it
            // - transitions that happen in rapid succession (thrashing) lower it
            // - a node with no prior vector history starts at full confidence
            const priorEntries = GlobalVector.getEntries(this.id);
            const lastEntry = priorEntries[priorEntries.length - 1];
            const msSinceLast = lastEntry ? now - lastEntry.timestamp : null;

            const dissonancePenalty = Math.min(1, this.dissonance / 10);
            const thrashPenalty = (msSinceLast !== null && msSinceLast < 50)
                ? Math.min(0.5, (50 - msSinceLast) / 100)
                : 0;

            const confidence = Math.max(0, Math.min(1,
                1 - dissonancePenalty - thrashPenalty
            ));

            const entry = GlobalVector.append({
                id: this.id,
                hash,
                data,
                state: this.state,
                confidence,
                timestamp: now
            });
            this.vectorIndex = entry.index;
            this.currentHash = hash;
            this.accumHash = entry.entry.accumHash || hash;
            this.lastVectorTime = entry.entry.timestamp;
            return entry;
        }

        /**
         * Get vector graph for this instance (all recorded entries)
         */
        vectorGraph() {
            const entries = GlobalVector.getEntries(this.id);
            return {
                id: this.id,
                nodeCount: entries.length,
                nodes: entries.map((e, idx) => ({
                    index: idx,
                    hash: e.hash,
                    accumHash: e.accumHash,
                    timestamp: e.timestamp
                }))
            };
        }

        /**
         * Get complete vector history for this instance
         */
        getVectorHistory() {
            return GlobalVector.getEntries(this.id);
        }

        /**
         * Hash computation for state snapshot (for vector)
         * @private
         */
        _computeHash(data) {
            const str = JSON.stringify(data);
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return Math.abs(hash).toString(16);
        }

        /**
         * Static: Verify global vector chain integrity
         */
        static verifyGlobalVector() {
            return GlobalVector.verifyChain();
        }

        /**
         * Static: Get all global vector entries
         */
        static getGlobalVector() {
            return GlobalVector.getAll();
        }

        /**
         * Static: inspect/reset the content-hash cache (v2.2.05).
         */
        static getContentCacheSize() {
            return ContentCache.size();
        }

        static resetContentCache() {
            ContentCache.reset();
        }
    }

    // ─── VECTOR PROJECTIONS (from v2.0.0) ─────────────────────────
    class LongitudinalProjection {
        constructor(node) {
            this.node = node;
        }
        
        entries() {
            return GlobalVector.getEntries(this.node.id);
        }
        
        at(vectorIndex) {
            return GlobalVector.getEntry(vectorIndex);
        }
        
        range(startIdx, endIdx) {
            return GlobalVector.getEntries(this.node.id).filter((_, i) => i >= startIdx && i <= endIdx);
        }
        
        size() {
            return GlobalVector.getEntries(this.node.id).length;
        }
    }

    class OriginProjection {
        constructor(node) {
            this.node = node;
            this.origin = node.parent || node;
        }
        
        getOrigin() {
            return this.origin;
        }
        
        getAllOriginInstances() {
            const seen = new Set();
            const result = [];
            for (const e of GlobalVector.getAll()) {
                const node = GlobalVector.getNode(e.id);
                if (!node || seen.has(node)) continue;
                if ((node.parent || node) === this.origin) {
                    seen.add(node);
                    result.push(node);
                }
            }
            return result;
        }
        
        getMutationPathFromOrigin() {
            let current = this.node;
            const path = [];
            while (current && current !== this.origin) {
                path.push(current);
                current = current.parent;
            }
            return path.reverse();
        }
    }

    class DualProjection {
        constructor(node) {
            this.node = node;
        }
        
        localOnly() {
            return this.node.state;
        }
        
        externalOnly() {
            return GlobalVector.getExternalState(this.node.id);
        }
        
        /**
         * state is a scalar (e.g. 'initialized'), not a keyed object, so there's
         * nothing meaningful to merge key-by-key. "Merged" view is: prefer the
         * local (in-memory) state if present, otherwise fall back to the last
         * externally recorded state.
         */
        merged() {
            const local = this.localOnly();
            return local !== undefined && local !== null ? local : this.externalOnly();
        }
        
        /**
         * Since state is scalar, a "conflict" just means local and external
         * disagree on the single current value.
         */
        conflicts() {
            const local = this.localOnly();
            const external = this.externalOnly();
            if (external !== undefined && external !== null && external !== '' && external !== local) {
                return [{ key: 'state', local, external }];
            }
            return [];
        }
    }

    class RelationalProjection {
        constructor(node) {
            this.node = node;
        }
        
        inEdges() {
            return this.node.inEdges;
        }
        
        outEdges() {
            return this.node.outEdges;
        }
        
        connected() {
            return [...new Set([...this.inEdges(), ...this.outEdges()])];
        }
        
        transitiveReferences() {
            const visited = new Set();
            const queue = [this.node];
            while (queue.length) {
                const current = queue.shift();
                if (visited.has(current)) continue;
                visited.add(current);
                const rel = new RelationalProjection(current);
                queue.push(...rel.outEdges().map(e => e.target));
            }
            visited.delete(this.node);
            return Array.from(visited);
        }
    }

    class ReplicationProjection {
        constructor(node) {
            this.node = node;
        }
        
        instances() {
            const seen = new Set();
            const result = [];
            for (const e of GlobalVector.getEntries(this.node.id)) {
                const node = GlobalVector.getNode(e.id);
                if (node && !seen.has(node)) {
                    seen.add(node);
                    result.push(node);
                }
            }
            return result;
        }
        
        hash() {
            return this.node.fingerprint;
        }
        
        accumHash() {
            return GlobalVector.getAccumulatedHash(this.node.id);
        }
        
        confidence() {
            const instances = this.instances();
            return instances.length > 0 ? 1 - (this.node.dissonance / (instances.length * 100)) : 0;
        }
        
        transitionConfidence() {
            const entries = GlobalVector.getEntries(this.node.id);
            return entries.length > 1 ? entries[entries.length - 1].confidence || 0.5 : 1;
        }
        
        transitions() {
            return GlobalVector.getEntries(this.node.id).map((e, i) => ({
                from: i > 0 ? GlobalVector.getEntry(i - 1) : null,
                to: e,
                confidence: e.confidence || 0.5
            }));
        }
    }

    // ─── PROJECTIONS EXPORT ──────────────────────────────────────
    BaseClassX.Projections = {
        Longitudinal: LongitudinalProjection,
        Origin: OriginProjection,
        Dual: DualProjection,
        Relational: RelationalProjection,
        Replication: ReplicationProjection
    };

    // ─── VERSION FREEZE ──────────────────────────────────────────
    Object.defineProperty(BaseClassX, 'version', {
        value: '2.2.05',
        writable: false,
        enumerable: true,
        configurable: false
    });

    Object.defineProperty(BaseClassX, 'schemaVersion', {
        value: '2.2.05',
        writable: false,
        enumerable: true,
        configurable: false
    });

    Object.defineProperty(BaseClassX, 'fileCreated', {
        value: FILE_CREATED,
        writable: false,
        enumerable: true,
        configurable: false
    });

    Object.defineProperty(BaseClassX, 'fileModified', {
        value: FILE_MODIFIED,
        writable: false,
        enumerable: true,
        configurable: false
    });

    return BaseClassX;
}));