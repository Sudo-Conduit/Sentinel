/**
 * @file research/lib/chain/tests/WeightedGraphMixin.unit.js
 * @author Will Fobbs
 * @description Comprehensive WeightedGraphMixin coverage: weight as a
 *              value vs. a function (called with the real instances),
 *              directed vs. undirected reachability, defaults, and
 *              coexistence with StructureMixin from one extend() call.
 */
const assert = require('assert');
const Tensor = require('../Tensor.js');
const FlatTensor = require('../FlatTensor.js');
const ExtendX = require('../ExtendX.js');
const StructureMixin = require('../StructureMixin.js');
const WeightedGraphMixin = require('../WeightedGraphMixin.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  // Hoisted to register()'s own scope (not a suite callback's) so BOTH
  // suites below can share the same WeightedTensor — a second
  // createWeightedGraphMixin(Tensor) call would collide with this one's
  // mixinId ('weightedGraph:Tensor').
  const wMixin = WeightedGraphMixin.createWeightedGraphMixin(Tensor);
  const WeightedTensor = ExtendX.extend(Tensor, wMixin);

  runner.suite('WeightedGraphMixin', () =>
  {
    runner.test('weight as a plain number', () =>
    {
      const a = new WeightedTensor().init({ shape: [2] }, [1, 2]);
      const b = new WeightedTensor().init({ shape: [2] }, [3, 4]);
      a.linkTo(b, { weight: 5 });
      assert.strictEqual(a.weightTo(b), 5);
    });

    runner.test('weight as a function, called with the real (source, target) instances', () =>
    {
      const a = new WeightedTensor().init({ shape: [2] }, [0, 0]);
      const b = new WeightedTensor().init({ shape: [2] }, [3, 4]);
      a.linkTo(b, {
        weight: (src, tgt) => Math.sqrt(src.subtract(tgt).toFlat().data.reduce((s, v) => s + v * v, 0)),
      });
      assert.strictEqual(a.weightTo(b), 5); // Euclidean distance (0,0)-(3,4) = 5
    });

    runner.test('default weight is 1 when omitted', () =>
    {
      const a = new WeightedTensor().init({ shape: [1] }, [1]);
      const b = new WeightedTensor().init({ shape: [1] }, [2]);
      a.linkTo(b);
      assert.strictEqual(a.weightTo(b), 1);
    });

    runner.test('weightTo returns undefined for a nonexistent edge', () =>
    {
      const a = new WeightedTensor().init({ shape: [1] }, [1]);
      const b = new WeightedTensor().init({ shape: [1] }, [2]);
      assert.strictEqual(a.weightTo(b), undefined);
    });

    runner.test('directed (default) edges are one-way for getReachable', () =>
    {
      const a = new WeightedTensor().init({ shape: [1] }, [1]);
      const b = new WeightedTensor().init({ shape: [1] }, [2]);
      a.linkTo(b, { direction: WeightedGraphMixin.DIRECTIONS.DIRECTED });
      assert.ok(a.getReachable().includes(b._extId));
      assert.ok(!b.getReachable().includes(a._extId));
    });

    runner.test('undirected edges are traversable from either endpoint', () =>
    {
      const a = new WeightedTensor().init({ shape: [1] }, [1]);
      const b = new WeightedTensor().init({ shape: [1] }, [2]);
      a.linkTo(b, { direction: WeightedGraphMixin.DIRECTIONS.UNDIRECTED });
      assert.ok(a.getReachable().includes(b._extId));
      assert.ok(b.getReachable().includes(a._extId));
    });

    runner.test('direction defaults to directed when omitted', () =>
    {
      const a = new WeightedTensor().init({ shape: [1] }, [1]);
      const b = new WeightedTensor().init({ shape: [1] }, [2]);
      a.linkTo(b);
      assert.ok(!b.getReachable().includes(a._extId));
    });

    runner.test('getReachable is transitive across mixed directed/undirected edges, respecting direction throughout', () =>
    {
      const m1 = new WeightedTensor().init({ shape: [1] }, [1]);
      const m2 = new WeightedTensor().init({ shape: [1] }, [2]);
      const m3 = new WeightedTensor().init({ shape: [1] }, [3]);
      m1.linkTo(m2, { direction: 'directed' });
      m2.linkTo(m3, { direction: 'undirected' });

      const fromM1 = m1.getReachable();
      assert.ok(fromM1.includes(m2._extId));
      assert.ok(fromM1.includes(m3._extId));

      const fromM3 = m3.getReachable();
      assert.ok(fromM3.includes(m2._extId)); // undirected edge, traversable back
      assert.ok(!fromM3.includes(m1._extId)); // blocked by the directed m1->m2 edge
    });

    runner.test('getOutgoing/edgeTo expose the raw edge records', () =>
    {
      const a = new WeightedTensor().init({ shape: [1] }, [1]);
      const b = new WeightedTensor().init({ shape: [1] }, [2]);
      a.linkTo(b, { weight: 7, label: 'test-edge' });
      assert.strictEqual(a.getOutgoing().length, 1);
      const edge = a.edgeTo(b);
      assert.strictEqual(edge.weight, 7);
      assert.strictEqual(edge.label, 'test-edge');
    });

    runner.test('coexists with StructureMixin composed in the same extend() call', () =>
    {
      // Scoped to FlatTensor (not Tensor) specifically so this test's
      // mixinIds ('structure:graph:FlatTensor', 'weightedGraph:FlatTensor')
      // cannot collide with the 'structure:graph:Tensor' etc. mixins
      // ExtendXIntegration.unit.js already registered earlier in the same
      // process when run via run-all.js — see that file's own header for
      // why each mixin factory may only be called once per mixinId.
      const structMixin = StructureMixin.createStructureMixin(FlatTensor, { mode: 'graph' });
      const wMixin2 = WeightedGraphMixin.createWeightedGraphMixin(FlatTensor);
      const Combined = ExtendX.extend(FlatTensor, structMixin, wMixin2);

      const parent = new Combined().init({ shape: [2] }, [1, 2]);
      const child = new Combined().init({ shape: [2] }, [3, 4]);
      parent.addChild(child._extId);
      parent.linkTo(child, { weight: 42 });

      assert.strictEqual(child.getParent(), parent._extId); // tree API
      assert.strictEqual(parent.weightTo(child), 42); // weighted graph API
    });
  });

  runner.suite('WeightedGraphMixin: walk()', () =>
  {
    // Reuses the SAME WeightedTensor (and its wMixin, mixinId
    // 'weightedGraph:Tensor') created in the suite above — a second
    // createWeightedGraphMixin(Tensor) call here would collide with it.
    const G = WeightedTensor;

    runner.test('a pure cycle terminates at exactly hops+1 visits, never runs away', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const b = new G().init({ shape: [1] }, [2]);
      const c = new G().init({ shape: [1] }, [3]);
      a.linkTo(b);
      b.linkTo(c);
      c.linkTo(a); // a -> b -> c -> a -> ...

      const result = await a.walk({ hops: 4, decide: (inst, candidates) => candidates[0] });
      assert.strictEqual(result.length, 5); // hops 0,1,2,3,4
      assert.deepStrictEqual(result.map((r) => r.hops), [0, 1, 2, 3, 4]);
      assert.deepStrictEqual(result.map((r) => r.extId), [a, b, c, a, b].map((x) => x._extId));
    });

    runner.test('hops must be a non-negative integer', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      await assert.rejects(() => a.walk({ hops: -1 }), /non-negative integer/);
      await assert.rejects(() => a.walk({ hops: 1.5 }), /non-negative integer/);
    });

    runner.test('hops=0 visits only the starting instance', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const b = new G().init({ shape: [1] }, [2]);
      a.linkTo(b);
      const result = await a.walk({ hops: 0 });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].extId, a._extId);
    });

    runner.test('a dead-end (no outgoing edges) stops the walk early, not an error', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const result = await a.walk({ hops: 4, seed: 1 });
      assert.strictEqual(result.length, 1);
    });

    runner.test('same seed produces an identical walk (reproducible)', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const b = new G().init({ shape: [1] }, [2]);
      const c = new G().init({ shape: [1] }, [3]);
      a.linkTo(b);
      a.linkTo(c);
      b.linkTo(c);

      const r1 = await a.walk({ seed: 7 });
      const r2 = await a.walk({ seed: 7 });
      assert.deepStrictEqual(r1.map((r) => r.extId), r2.map((r) => r.extId));
    });

    runner.test('decide() drives a deterministic fan-out to multiple edges at once', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const b = new G().init({ shape: [1] }, [2]);
      const c = new G().init({ shape: [1] }, [3]);
      const d = new G().init({ shape: [1] }, [4]);
      a.linkTo(b);
      a.linkTo(c);
      b.linkTo(d);

      // fan out to every candidate at every hop
      const result = await a.walk({ hops: 2, decide: (inst, candidates) => candidates });
      const extIds = result.map((r) => r.extId).sort();
      assert.deepStrictEqual(extIds, [a, b, c, d].map((x) => x._extId).sort());
    });

    runner.test('parallel and sequential concurrency reach the same set of nodes', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const b = new G().init({ shape: [1] }, [2]);
      const c = new G().init({ shape: [1] }, [3]);
      const d = new G().init({ shape: [1] }, [4]);
      a.linkTo(b);
      a.linkTo(c);
      b.linkTo(d);

      const fanOut = (inst, candidates) => candidates;
      const parallel = await a.walk({ hops: 2, decide: fanOut, concurrency: WeightedGraphMixin.CONCURRENCY.PARALLEL });
      const sequential = await a.walk({ hops: 2, decide: fanOut, concurrency: WeightedGraphMixin.CONCURRENCY.SEQUENTIAL });
      const sortIds = (r) => r.map((x) => x.extId).sort();
      assert.deepStrictEqual(sortIds(parallel), sortIds(sequential));
    });

    runner.test('avoidRevisit forbids re-entering a node already on the same path', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const b = new G().init({ shape: [1] }, [2]);
      const c = new G().init({ shape: [1] }, [3]);
      a.linkTo(b);
      b.linkTo(c);
      c.linkTo(a); // cycle

      const result = await a.walk({ hops: 5, avoidRevisit: true, decide: (inst, candidates) => candidates[0] });
      const lastPath = result[result.length - 1].path;
      assert.strictEqual(new Set(lastPath).size, lastPath.length); // no repeats within the path
    });

    runner.test('onVisit fires once per node visited, including the start', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const b = new G().init({ shape: [1] }, [2]);
      a.linkTo(b);
      let count = 0;
      await a.walk({ hops: 1, seed: 1, onVisit: () => { count += 1; } });
      assert.strictEqual(count, 2); // a, then b
    });

    runner.test('a disposed target is no longer resolvable: walk stops there', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const b = new G().init({ shape: [1] }, [2]);
      a.linkTo(b);
      b.dispose();
      const result = await a.walk({ hops: 3, seed: 1 });
      assert.strictEqual(result.length, 1); // only the starting instance
    });

    runner.test('direction is respected during a walk: cannot hop backward through a directed edge', async () =>
    {
      const a = new G().init({ shape: [1] }, [1]);
      const b = new G().init({ shape: [1] }, [2]);
      a.linkTo(b, { direction: WeightedGraphMixin.DIRECTIONS.DIRECTED });
      const fromB = await b.walk({ hops: 2, seed: 1 });
      assert.strictEqual(fromB.length, 1); // b has no outgoing edges; a->b is one-way
    });
  });
}

if (require.main === module)
{
  const TestRunner = require('./TestRunner.js');
  const runner = new TestRunner();
  register(runner);
  runner.run().then((result) => { process.exitCode = result.failed > 0 ? 1 : 0; });
}

module.exports = register;
