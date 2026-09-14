/**
 * @file research/lib/chain/WeightedGraphMixin.js
 * @author Will Fobbs
 * @version 1.1.0
 * @description Weighted, directed graph edges for any class composed via
 *              ExtendX.extend() — a sibling to StructureMixin's relational
 *              mode, not a modification of it. StructureMixin's edges are
 *              unweighted and effectively undirected (linkTo mirrors into
 *              both EDGES_OUT and EDGES_IN, so getConnectedGraph follows
 *              both directions regardless of which endpoint created the
 *              link). This mixin adds the two things that model doesn't
 *              have:
 *
 *                weight    — a plain number OR a function
 *                             (sourceInstance, targetInstance) => number,
 *                             resolved lazily at query time via
 *                             resolveWeight()/weightTo(), not baked in at
 *                             link time. A function form lets an edge's
 *                             cost be computed FROM the two instances it
 *                             connects (e.g. distance between two Tensor
 *                             states) rather than fixed the moment the
 *                             edge is created.
 *
 *                direction — 'directed' (default): the edge is traversable
 *                             source -> target only; getReachable() will
 *                             not walk it backward. 'undirected': mirrored
 *                             into both endpoints' outgoing set, so it is
 *                             equally traversable either way, matching
 *                             StructureMixin's existing (implicitly
 *                             undirected) behavior for that case.
 *
 *              linkTo() takes the actual target INSTANCE, not just its
 *              extId — a weight FUNCTION needs a real object to call with,
 *              and StructureMixin's own file explains why nothing here is
 *              keyed by object identity in the side tables themselves
 *              (WeakMap-keyed-by-`this` breaks under ExtendX's per-call
 *              frame Proxy dispatch): only the extId is stored; the
 *              instance itself is passed through to a weight function at
 *              the moment of the call, never retained.
 *
 *   v1.1.0  walk(): bounded, decision-driven multi-hop traversal. An edge
 *           only ever stored a target extId (a string), never an instance
 *           reference — correct for weightTo()/resolveWeight() (those take
 *           the target instance as a call argument, never need to retain
 *           it), but it meant there was NO way to actually hop from a
 *           resolved edge to the next real node to keep walking: you'd
 *           have an extId and nothing that could call .getOutgoing() on
 *           it. Fixed by adding INSTANCES, a plain extId -> instance
 *           registry populated by linkTo() (both endpoints) and cleared by
 *           a new dispose() hook — a strong-reference Map, not a WeakMap
 *           keyed by object identity (StructureMixin's own file explains
 *           why THAT breaks under ExtendX's per-call frame Proxy dispatch;
 *           keying by the extId STRING has no such issue, since a string
 *           key is never a fresh Proxy each call).
 *
 *           walk(options) explores up to options.hops steps out (default
 *           4), never unbounded — the actual guard against runaway/
 *           infinite recursion on a cyclic graph, since a decision
 *           function or a random pick could otherwise walk a cycle
 *           forever. At each node, the next edge(s) to follow are chosen
 *           by options.decide(instance, candidateEdges, hopIndex) if
 *           given, else by a seeded PRNG (options.seed, mulberry32 —
 *           deterministic and reproducible, not Math.random()) picking
 *           one candidate uniformly. decide() may return one edge (a
 *           single path continues), an array of edges (the walk fans out
 *           from this node), or a falsy value (this branch stops early).
 *           Direction is respected automatically: candidates always come
 *           from getOutgoing(), the same direction-aware source
 *           getReachable() uses, so a directed edge's target cannot walk
 *           backward through it. options.concurrency picks how a fan-out
 *           is explored: 'parallel' (default) awaits every chosen branch
 *           concurrently via Promise.all; 'sequential' walks them one at
 *           a time in a single control-flow fiber, fully awaiting each
 *           branch before starting the next.
 * @tests research/lib/chain/tests/WeightedGraphMixin.unit.js
 */
(function (root, factory)
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
    root.Chain = root.Chain || {};
    root.Chain.WeightedGraphMixin = factory(root.Chain.ExtendX || root.ExtendX);
  }
}(typeof self !== 'undefined' ? self : this, function (ExtendX)
{
  'use strict';

  if (!ExtendX)
  {
    throw new Error('WeightedGraphMixin requires ExtendX to be loaded first');
  }

  const DIRECTIONS = Object.freeze({ DIRECTED: 'directed', UNDIRECTED: 'undirected' });
  const CONCURRENCY = Object.freeze({ PARALLEL: 'parallel', SEQUENTIAL: 'sequential' });

  // extId -> Set<{ target: extId, weight: number|Function, direction, label }>
  const EDGES_OUT = new Map();

  // extId -> instance. A real (strong-reference) Map, deliberately not
  // object-identity-keyed and not a WeakMap — see the file header (v1.1.0
  // note) for why walk() needs this at all: an edge only carries a target
  // extId, and hopping to the next node requires resolving that extId back
  // to something walk() can call .getOutgoing() on.
  const INSTANCES = new Map();

  function edgeSetOut(extId)
  {
    let s = EDGES_OUT.get(extId);
    if (!s)
    {
      s = new Set();
      EDGES_OUT.set(extId, s);
    }
    return s;
  }

  /**
   * mulberry32: a small, fast, deterministic PRNG — NOT Math.random(),
   * which has no seed control and would make walk()'s "random, with seed"
   * mode unreproducible. Same seed always produces the same sequence.
   * @param {number} seed
   * @returns {Function} a () => number in [0, 1) generator
   */
  function mulberry32(seed)
  {
    let a = seed >>> 0;
    return function ()
    {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * @param {Function} BaseClass - constructor/class this mixin's mixinId is scoped to
   * @returns {Object} the composable mixin object
   * @throws {Error} if BaseClass is not a constructor function/class
   */
  function createWeightedGraphMixin(BaseClass)
  {
    if (typeof BaseClass !== 'function')
    {
      throw new Error('WeightedGraphMixin.createWeightedGraphMixin(): BaseClass must be a constructor function/class');
    }
    const mixinId = 'weightedGraph:' + (BaseClass.name || 'anonymous');

    const mixin = { mixinId: mixinId };

    /**
     * @param {Object} targetInstance - the target instance (its _extId is what gets stored)
     * @param {Object} [options]
     * @param {number|Function} [options.weight=1] - a fixed number, or (sourceInstance, targetInstance) => number
     * @param {string} [options.direction='directed'] - DIRECTIONS.DIRECTED | UNDIRECTED
     * @param {string} [options.label]
     * @returns {Object} this, for chaining
     */
    mixin.linkTo = function (targetInstance, options)
    {
      const opts = options || {};
      const weight = 'weight' in opts ? opts.weight : 1;
      const direction = opts.direction === DIRECTIONS.UNDIRECTED ? DIRECTIONS.UNDIRECTED : DIRECTIONS.DIRECTED;
      const label = typeof opts.label === 'string' ? opts.label : null;
      const targetExtId = targetInstance._extId;

      // Register both endpoints as resolvable-by-extId — walk() needs this
      // to hop past this edge later; weightTo()/resolveWeight() don't (the
      // caller already holds targetInstance when calling those), but there
      // is no way to know in advance whether a caller will later want to
      // walk FROM this target, so both directions are registered here,
      // once, at link time.
      INSTANCES.set(this._extId, this);
      INSTANCES.set(targetExtId, targetInstance);

      edgeSetOut(this._extId).add({ target: targetExtId, weight: weight, direction: direction, label: label });

      // Undirected: mirror into the target's own outgoing set so it is a
      // first-class, equally-traversable edge from either endpoint —
      // NOT just a "something points at me" marker. Directed edges are
      // deliberately NOT mirrored: that asymmetry is the entire point.
      if (direction === DIRECTIONS.UNDIRECTED)
      {
        edgeSetOut(targetExtId).add({ target: this._extId, weight: weight, direction: direction, label: label });
      }

      return this;
    };

    /** @returns {Array<{target:string, weight:number|Function, direction:string, label:string|null}>} */
    mixin.getOutgoing = function ()
    {
      return Array.from(edgeSetOut(this._extId));
    };

    /**
     * @param {Object} targetInstance - required to call a weight FUNCTION with real objects
     * @returns {Array<{target:string, weight:number|Function, direction:string, label:string|null}>|undefined}
     */
    mixin.edgeTo = function (targetInstance)
    {
      const targetExtId = targetInstance._extId;
      let found;
      edgeSetOut(this._extId).forEach((edge) =>
      {
        if (edge.target === targetExtId)
        {
          found = edge;
        }
      });
      return found;
    };

    /**
     * Resolves an edge's weight: calls it with (this, targetInstance) if it
     * is a function, otherwise returns the stored number as-is.
     * @param {Object} edge - as returned by getOutgoing()/edgeTo()
     * @param {Object} targetInstance - the real target instance to call a weight function with
     * @returns {number}
     */
    mixin.resolveWeight = function (edge, targetInstance)
    {
      return typeof edge.weight === 'function' ? edge.weight(this, targetInstance) : edge.weight;
    };

    /**
     * @param {Object} targetInstance
     * @returns {number|undefined} the resolved weight of the edge to targetInstance, or undefined if none exists
     */
    mixin.weightTo = function (targetInstance)
    {
      const edge = this.edgeTo(targetInstance);
      return edge ? this.resolveWeight(edge, targetInstance) : undefined;
    };

    /**
     * BFS reachability that RESPECTS direction: only follows this
     * instance's own outgoing edges, recursively — a directed edge is
     * one-way, so a node it points AT does not thereby gain the ability to
     * reach back through it. (An undirected edge is already mirrored into
     * both endpoints' outgoing sets by linkTo(), so it is naturally
     * traversable either way without any special-casing here.)
     * @returns {string[]} every extId reachable by following outgoing edges
     */
    mixin.getReachable = function ()
    {
      const startId = this._extId;
      const visited = new Set([startId]);
      const queue = [startId];
      while (queue.length > 0)
      {
        const id = queue.shift();
        edgeSetOut(id).forEach((edge) =>
        {
          if (!visited.has(edge.target))
          {
            visited.add(edge.target);
            queue.push(edge.target);
          }
        });
      }
      visited.delete(startId);
      return Array.from(visited);
    };

    /**
     * Bounded, decision-driven multi-hop traversal. See the v1.1.0 file
     * header note for the full design rationale.
     *
     * @param {Object} [options]
     * @param {number} [options.hops=4] - max hops out from this instance; the
     *   actual guard against unbounded/infinite recursion on a cyclic graph
     * @param {function(instance, candidateEdges, hopIndex): (Object|Object[]|null|undefined|Promise)} [options.decide] -
     *   chooses the next edge(s) to follow from `instance`'s getOutgoing();
     *   return one edge to continue a single path, an array to fan out,
     *   or a falsy value to stop this branch. May be async. Defaults to a
     *   seeded-random single pick (options.seed) when omitted.
     * @param {number} [options.seed=1] - seed for the default random-pick
     *   decision (mulberry32); ignored if options.decide is given. Same
     *   seed -> same walk, every time.
     * @param {string} [options.concurrency='parallel'] - CONCURRENCY.PARALLEL
     *   (Promise.all across a fan-out) or CONCURRENCY.SEQUENTIAL (one
     *   branch at a time, fully awaited before the next — "a single fiber")
     * @param {boolean} [options.avoidRevisit=false] - when true, filters out
     *   candidates already present earlier in THIS branch's own path (a
     *   real random walk normally allows revisits; opt in to forbid them)
     * @param {function(instance, hopIndex, path): (void|Promise)} [options.onVisit] -
     *   called once per node visited, including the starting instance at hop 0
     * @returns {Promise<Array<{instance:Object, extId:string, path:string[], hops:number}>>}
     *   every node touched by the walk, in visit order, with the extId
     *   path taken to reach each (path[0] is always this instance's extId)
     * @throws {RangeError} if options.hops is not a non-negative integer
     */
    mixin.walk = async function (options)
    {
      const opts = options || {};
      const maxHops = opts.hops === undefined ? 4 : opts.hops;
      if (!Number.isInteger(maxHops) || maxHops < 0)
      {
        throw new RangeError('WeightedGraphMixin.walk: options.hops must be a non-negative integer');
      }
      const decide = typeof opts.decide === 'function' ? opts.decide : null;
      const rng = decide ? null : mulberry32(typeof opts.seed === 'number' ? opts.seed >>> 0 : 1);
      const sequential = opts.concurrency === CONCURRENCY.SEQUENTIAL;
      const onVisit = typeof opts.onVisit === 'function' ? opts.onVisit : null;
      const avoidRevisit = opts.avoidRevisit === true;

      const visitedLog = [];

      const step = async (instance, hopIndex, path) =>
      {
        if (onVisit)
        {
          await onVisit(instance, hopIndex, path.slice());
        }
        visitedLog.push({ instance: instance, extId: instance._extId, path: path.slice(), hops: hopIndex });

        if (hopIndex >= maxHops)
        {
          return;
        }

        let candidates = instance.getOutgoing();
        if (avoidRevisit)
        {
          candidates = candidates.filter((edge) => path.indexOf(edge.target) === -1);
        }
        if (candidates.length === 0)
        {
          return;
        }

        const chosen = decide
          ? await decide(instance, candidates, hopIndex)
          : candidates[Math.floor(rng() * candidates.length)];

        if (!chosen)
        {
          return;
        }
        const chosenEdges = Array.isArray(chosen) ? chosen : [chosen];

        const advance = async (edge) =>
        {
          const nextInstance = INSTANCES.get(edge.target);
          if (!nextInstance)
          {
            return; // target was never linked-to as a first-class instance, or has since disposed
          }
          await step(nextInstance, hopIndex + 1, path.concat([edge.target]));
        };

        if (sequential)
        {
          for (const edge of chosenEdges)
          {
            await advance(edge);
          }
        }
        else
        {
          await Promise.all(chosenEdges.map(advance));
        }
      };

      await step(this, 0, [this._extId]);
      return visitedLog;
    };

    /** Drops this instance from the extId->instance registry — after dispose, walk() can no longer hop TO it. */
    mixin.dispose = function ()
    {
      INSTANCES.delete(this._extId);
    };

    return mixin;
  }

  return {
    createWeightedGraphMixin: createWeightedGraphMixin,
    DIRECTIONS: DIRECTIONS,
    CONCURRENCY: CONCURRENCY,
    name: 'WeightedGraphMixin',
    author: 'Will Fobbs',
    version: '1.1.0',
    description: 'Weighted (value or function) and directed graph edges, plus bounded decision-driven multi-hop walk(), for any class composed via ExtendX.extend() — sibling to StructureMixin\'s relational mode.',
    docs: ['research/lib/chain/docs/WeightedGraphMixin.md'],
    tests: ['research/lib/chain/tests/WeightedGraphMixin.unit.js'],
  };
}));
