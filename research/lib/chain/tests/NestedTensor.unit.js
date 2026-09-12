/**
 * @file research/lib/chain/tests/NestedTensor.unit.js
 * @author Will Fobbs
 * @description Comprehensive NestedTensor coverage: values getter, every
 *              formula (computed by genuine recursion over the nesting),
 *              exact parity with FlatTensor, per-instance toggling, and
 *              the ASCII 'w' -> bitmap -> nested pipeline end to end.
 */
const assert = require('assert');
const NestedTensor = require('../NestedTensor.js');
const FlatTensor = require('../FlatTensor.js');
const Data = require('../Data.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('NestedTensor', () =>
  {
    runner.test('values getter returns the nested coordinate view', () =>
    {
      const nt = new NestedTensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      assert.deepStrictEqual(nt.values, [[1, 2], [3, 4]]);
    });

    runner.test('every formula: depth/leafCount/sum/mean/min/max/variance/magnitude', () =>
    {
      const nt = new NestedTensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      assert.strictEqual(nt.depth(), 2);
      assert.strictEqual(nt.leafCount(), 4);
      assert.strictEqual(nt.sum(), 10);
      assert.strictEqual(nt.mean(), 2.5);
      assert.strictEqual(nt.min(), 1);
      assert.strictEqual(nt.max(), 4);
      assert.strictEqual(nt.variance(), 1.25);
      assert.strictEqual(nt.magnitude(), Math.sqrt(30));
    });

    runner.test('FORMULAS exposes exactly eight mixins by name', () =>
    {
      assert.deepStrictEqual(
        Object.keys(NestedTensor.FORMULAS).sort(),
        ['depth', 'leafCount', 'magnitude', 'max', 'mean', 'min', 'sum', 'variance']
      );
    });

    runner.test('exact parity with FlatTensor on identical data for every shared formula', () =>
    {
      const ft = new FlatTensor().init({ shape: [4] }, [1, 2, 3, 4]);
      const nt = new NestedTensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      ['sum', 'mean', 'min', 'max', 'variance', 'magnitude'].forEach((name) =>
      {
        assert.strictEqual(ft[name](), nt[name](), name + ' must match between FlatTensor and NestedTensor');
      });
    });

    runner.test('each formula is independently toggleable per instance', () =>
    {
      const a = new NestedTensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      const b = new NestedTensor().init({ shape: [2, 2] }, [5, 6, 7, 8]);
      b.disableLayer(NestedTensor.FORMULAS.mean);
      assert.strictEqual(b.mean(), undefined);
      assert.strictEqual(a.mean(), 2.5, 'disabling on one instance must not affect another');
    });

    runner.test('computeAll reports undefined for a disabled formula, not omitted', () =>
    {
      const nt = new NestedTensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      nt.disableLayer(NestedTensor.FORMULAS.depth);
      const all = nt.computeAll();
      assert.ok('depth' in all);
      assert.strictEqual(all.depth, undefined);
    });

    runner.test('ASCII "w" -> NestedTensor: depth 2, leafCount 7 (bit-level "w" IS a bitmap)', () =>
    {
      const d = new Data().init('w', { type: Data.SOURCE_TYPES.ASCII });
      const ntW = new NestedTensor().init({ shape: [7, 1] }, d);
      assert.strictEqual(ntW.depth(), 2);
      assert.strictEqual(ntW.leafCount(), 7);
      assert.strictEqual(ntW.sum(), 6); // 'w' = 1110111 -> six 1-bits
    });

    runner.test('base Tensor algebra (trace/isDiagonal) works through the subclass too', () =>
    {
      const nt = new NestedTensor().init({ shape: [2, 2] }, [2, 0, 0, 3]);
      assert.strictEqual(nt.trace(), 5);
      assert.ok(nt.isDiagonal());
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
