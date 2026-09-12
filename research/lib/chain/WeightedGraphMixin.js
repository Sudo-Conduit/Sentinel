/**
 * @file research/lib/chain/WeightedGraphMixin.js
 * @author Will Fobbs
 * @version 1.0.0
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

  // extId -> Set<{ target: extId, weight: number|Function, direction, label }>
  const EDGES_OUT = new Map();

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

    return mixin;
  }

  return {
    createWeightedGraphMixin: createWeightedGraphMixin,
    DIRECTIONS: DIRECTIONS,
    name: 'WeightedGraphMixin',
    author: 'Will Fobbs',
    version: '1.0.0',
    description: 'Weighted (value or function) and directed graph edges for any class composed via ExtendX.extend() — sibling to StructureMixin\'s relational mode.',
    docs: ['research/lib/chain/docs/WeightedGraphMixin.md'],
    tests: ['research/lib/chain/tests/WeightedGraphMixin.unit.js'],
  };
}));
