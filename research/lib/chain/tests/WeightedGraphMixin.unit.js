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
  runner.suite('WeightedGraphMixin', () =>
  {
    const wMixin = WeightedGraphMixin.createWeightedGraphMixin(Tensor);
    const WeightedTensor = ExtendX.extend(Tensor, wMixin);

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
}

if (require.main === module)
{
  const TestRunner = require('./TestRunner.js');
  const runner = new TestRunner();
  register(runner);
  const result = runner.run();
  process.exitCode = result.failed > 0 ? 1 : 0;
}

module.exports = register;
