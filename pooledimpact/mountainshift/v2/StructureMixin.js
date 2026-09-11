/**
 * StructureMixin.js — optional parent/child/sibling and arbitrary-edge
 * tracking for any class composed via ExtendX.extend(), independent of
 * BaseClassX. Generalizes BaseClassX's own dual model (children/
 * _parentRef for the tree, linkTo/inEdges/outEdges for arbitrary edges) to
 * classes that aren't BaseClassX subclasses, and makes each half
 * independently optional instead of always-on.
 *
 * OFF BY DEFAULT: nothing here runs unless a class is explicitly composed
 * with a mixin this file produces. Every existing class (CPU, Physical,
 * anything composed with SecurityMixin alone) is completely unaffected.
 *
 * Four modes, chosen at createStructureMixin(BaseClass, { mode }) time:
 *   'none'       -- mixin is created but tracks nothing (a documented no-op,
 *                    not the same as never composing it -- useful for a
 *                    build that wants the SAME composition call everywhere
 *                    and toggles behavior via mode alone).
 *   'graph'      -- parent/child/sibling tree only.
 *   'relational' -- arbitrary linkTo/unlinkFrom edges only (no hierarchy).
 *   'both'       -- tree AND arbitrary edges, coexisting, exactly like
 *                    BaseClassX already does internally.
 *
 * PARENTAGE: explicit AND inferred, inferred by default (low touch).
 * Inference rule, stated precisely rather than as a best-effort guess:
 *
 *   A shared, closure-private call-context stack (CONTEXT_STACK) holds
 *   extIds, not object references. Every dispatched method on a 'graph'/
 *   'both' instance pushes its own extId before running the real
 *   implementation and pops it in a finally block after. A newly
 *   constructed 'graph'/'both' instance's inferred parent is whatever
 *   extId sits on top of CONTEXT_STACK at the moment its init() hook
 *   fires; an empty stack means no inferred parent (it registers as a
 *   root, not an error).
 *
 *   This is reliable across a SYNCHRONOUS call chain only. It is also
 *   reliable across the synchronous PROLOGUE of concurrently-started async
 *   work, because `Promise.all([f1(), f2(), f3()])` evaluates its array
 *   eagerly and synchronously -- calling f1()/f2()/f3() runs each body up
 *   to its own first `await` before Promise.all is even invoked. spawnChildren()
 *   below exists specifically to use that: as long as a child's actual
 *   construction happens before the first await inside its own factory,
 *   gathering several such factories through spawnChildren() correctly
 *   attributes ALL of them to the calling parent AND to each other as a
 *   sibling group, regardless of how their continuations subsequently
 *   interleave. A child whose OWN construction happens after an await
 *   inside its own factory is outside what inference can safely cover --
 *   that case needs explicit addChild()/linkTo(), not a guess.
 *
 * WeakMap-keyed-by-`this` would break here the exact same way it broke
 * Physical._cpus (ExtendX's per-call dispatch uses a fresh frame Proxy
 * each call) -- every table below is keyed by extId (a stable string),
 * never by object identity.
 */
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./ExtendX.js'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./ExtendX.js'));
    } else {
        root.StructureMixin = factory(root.ExtendX);
    }
}(typeof self !== 'undefined' ? self : this, function(ExtendX) {
    'use strict';
    if (!ExtendX) throw new Error('StructureMixin requires ExtendX to be loaded first');

    // ─── Shared, closure-private state ──────────────────────────────────
    const CONTEXT_STACK = [];         // extIds, push/pop around dispatched calls
    const PARENTS = new Map();        // extId -> parentExtId | null
    const CHILDREN = new Map();       // extId -> Set<extId>
    const EDGES_OUT = new Map();      // extId -> Set<{ target: extId, label }>
    const EDGES_IN = new Map();       // extId -> Set<{ source: extId, label }>

    function childSet(extId) {
        let s = CHILDREN.get(extId);
        if (!s) { s = new Set(); CHILDREN.set(extId, s); }
        return s;
    }

    function edgeSetOut(extId) {
        let s = EDGES_OUT.get(extId);
        if (!s) { s = new Set(); EDGES_OUT.set(extId, s); }
        return s;
    }

    function edgeSetIn(extId) {
        let s = EDGES_IN.get(extId);
        if (!s) { s = new Set(); EDGES_IN.set(extId, s); }
        return s;
    }

    function attach(childId, parentId) {
        PARENTS.set(childId, parentId);
        if (parentId !== null && parentId !== undefined) {
            childSet(parentId).add(childId);
        }
    }

    function detach(extId) {
        const parentId = PARENTS.get(extId);
        if (parentId !== null && parentId !== undefined) {
            const siblings = CHILDREN.get(parentId);
            if (siblings) siblings.delete(extId);
        }
        // Orphan (not re-parent) this node's own children -- simple,
        // explicit behavior rather than guessing a "promote to grandparent"
        // policy that may not be what a given application wants.
        const kids = CHILDREN.get(extId);
        if (kids) kids.forEach(function(kid) { PARENTS.set(kid, null); });
        PARENTS.delete(extId);
        CHILDREN.delete(extId);
        EDGES_OUT.delete(extId);
        EDGES_IN.delete(extId);
    }

    /**
     * Construct several children "together": each factory's synchronous
     * prologue (up to its own first await, if any) runs while parentId is
     * on top of CONTEXT_STACK, so every child's inferred parent -- and every
     * child's inferred SIBLING group -- is correct regardless of how their
     * continuations subsequently interleave. See the file header for
     * exactly why this works (Promise.all's eager array evaluation).
     *
     * @param {Object} parentInstance - a 'graph'/'both' composed instance
     * @param {Function[]} factoryFns - each returns a value or a promise;
     *   called synchronously, in order, all before any awaiting happens
     * @returns {Promise<any[]>}
     */
    function spawnChildren(parentInstance, factoryFns) {
        const parentId = parentInstance._extId;
        CONTEXT_STACK.push(parentId);
        let results;
        try {
            results = factoryFns.map(function(fn) { return fn(); });
        } finally {
            CONTEXT_STACK.pop();
        }
        return Promise.all(results);
    }

    function createStructureMixin(BaseClass, options) {
        if (typeof BaseClass !== 'function') {
            throw new Error('StructureMixin.createStructureMixin(): BaseClass must be a constructor function/class');
        }
        const mode = (options && options.mode) || 'graph';
        const wantsGraph = mode === 'graph' || mode === 'both';
        const wantsRelational = mode === 'relational' || mode === 'both';
        const mixinId = 'structure:' + mode + ':' + (BaseClass.name || 'anonymous');

        const methodNames = Object.getOwnPropertyNames(BaseClass.prototype).filter(function(name) {
            if (name === 'constructor') return false;
            if (name.charAt(0) === '_') return false;
            return typeof BaseClass.prototype[name] === 'function';
        });

        const mixin = { mixinId: mixinId };

        if (mode === 'none') {
            // Documented no-op: composed, dispatched, but tracks nothing.
            // Still wraps methods (transparently) so a build can compose
            // this mixin unconditionally and vary only `mode`.
            methodNames.forEach(function(name) {
                mixin[name] = function() {
                    return this.super[name].apply(this, arguments);
                };
            });
            return mixin;
        }

        // Every dispatched method pushes/pops this instance's own extId
        // around the real call -- this IS the inference mechanism: whatever
        // extId is on top of CONTEXT_STACK when a new instance's init()
        // fires is that instance's inferred parent.
        methodNames.forEach(function(name) {
            mixin[name] = function() {
                if (!wantsGraph) return this.super[name].apply(this, arguments);
                CONTEXT_STACK.push(this._extId);
                try {
                    return this.super[name].apply(this, arguments);
                } finally {
                    CONTEXT_STACK.pop();
                }
            };
        });

        mixin.init = function() {
            if (!wantsGraph) return;
            const inferredParent = CONTEXT_STACK.length > 0 ? CONTEXT_STACK[CONTEXT_STACK.length - 1] : null;
            attach(this._extId, inferredParent);
        };

        mixin.dispose = function() {
            detach(this._extId);
        };

        if (wantsGraph) {
            mixin.getParent = function() { return PARENTS.get(this._extId) || null; };
            mixin.getChildren = function() { return Array.from(childSet(this._extId)); };
            mixin.getSiblings = function() {
                const parentId = PARENTS.get(this._extId);
                if (parentId === null || parentId === undefined) return [];
                const selfId = this._extId;
                return Array.from(childSet(parentId)).filter(function(id) { return id !== selfId; });
            };
            // Explicit override/escape hatch -- for the async case inference
            // can't cover, or to correct a wrong inference. Re-parenting
            // detaches from any current parent first.
            mixin.addChild = function(childExtId) {
                const oldParent = PARENTS.get(childExtId);
                if (oldParent !== null && oldParent !== undefined) {
                    const oldSiblings = CHILDREN.get(oldParent);
                    if (oldSiblings) oldSiblings.delete(childExtId);
                }
                attach(childExtId, this._extId);
                return this;
            };
            mixin.removeChild = function(childExtId) {
                childSet(this._extId).delete(childExtId);
                if (PARENTS.get(childExtId) === this._extId) PARENTS.set(childExtId, null);
                return this;
            };
        }

        if (wantsRelational) {
            mixin.linkTo = function(targetExtId, label) {
                edgeSetOut(this._extId).add({ target: targetExtId, label: label || null });
                edgeSetIn(targetExtId).add({ source: this._extId, label: label || null });
                return this;
            };
            mixin.unlinkFrom = function(targetExtId, label) {
                const out = edgeSetOut(this._extId);
                out.forEach(function(edge) {
                    if (edge.target === targetExtId && (label === undefined || edge.label === label)) out.delete(edge);
                });
                const inSet = edgeSetIn(targetExtId);
                inSet.forEach(function(edge) {
                    if (edge.source === this._extId && (label === undefined || edge.label === label)) inSet.delete(edge);
                }.bind(this));
                return this;
            };
            mixin.getConnected = function() {
                const out = Array.from(edgeSetOut(this._extId)).map(function(e) { return e.target; });
                const inn = Array.from(edgeSetIn(this._extId)).map(function(e) { return e.source; });
                return Array.from(new Set(out.concat(inn)));
            };
        }

        return mixin;
    }

    return {
        createStructureMixin: createStructureMixin,
        spawnChildren: spawnChildren
    };
}));
