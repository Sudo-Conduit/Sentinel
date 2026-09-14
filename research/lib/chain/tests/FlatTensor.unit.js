/**
 * @file research/lib/chain/tests/FlatTensor.unit.js
 * @author Will Fobbs
 * @description Comprehensive FlatTensor coverage: values getter, every
 *              formula, computeAll, per-instance layer toggling, and that
 *              base Tensor algebra still works through the subclass.
 */
const assert = require('assert');
const FlatTensor = require('../FlatTensor.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('FlatTensor', () =>
  {
    runner.test('values getter returns the flat coordinate view', () =>
    {
      const ft = new FlatTensor().init({ shape: [4] }, [1, 2, 3, 4]);
      assert.deepStrictEqual(ft.values, { data: [1, 2, 3, 4], shape: [4], strides: [1] });
    });

    runner.test('every formula: sum/mean/min/max/variance/magnitude', () =>
    {
      const ft = new FlatTensor().init({ shape: [4] }, [1, 2, 3, 4]);
      assert.strictEqual(ft.sum(), 10);
      assert.strictEqual(ft.mean(), 2.5);
      assert.strictEqual(ft.min(), 1);
      assert.strictEqual(ft.max(), 4);
      assert.strictEqual(ft.variance(), 1.25);
      assert.strictEqual(ft.magnitude(), Math.sqrt(30));
    });

    runner.test('computeAll aggregates every registered formula', () =>
    {
      const ft = new FlatTensor().init({ shape: [4] }, [1, 2, 3, 4]);
      assert.deepStrictEqual(ft.computeAll(), {
        sum: 10, mean: 2.5, min: 1, max: 4, variance: 1.25, magnitude: Math.sqrt(30),
      });
    });

    runner.test('FORMULAS exposes exactly the six mixins by name', () =>
    {
      assert.deepStrictEqual(Object.keys(FlatTensor.FORMULAS).sort(), ['magnitude', 'max', 'mean', 'min', 'sum', 'variance']);
    });

    runner.test('each formula is independently toggleable per instance', () =>
    {
      const a = new FlatTensor().init({ shape: [4] }, [1, 2, 3, 4]);
      const b = new FlatTensor().init({ shape: [4] }, [5, 6, 7, 8]);
      b.disableLayer(FlatTensor.FORMULAS.mean);
      assert.strictEqual(b.mean(), undefined);
      assert.strictEqual(a.mean(), 2.5, 'disabling on one instance must not affect another');
      b.enableLayer(FlatTensor.FORMULAS.mean);
      assert.strictEqual(b.mean(), 6.5);
    });

    runner.test('base Tensor rank/trace/isDiagonal/report still work through the subclass', () =>
    {
      const ft = new FlatTensor().init({ shape: [2, 2] }, [2, 0, 0, 3]);
      assert.strictEqual(ft.rank(), 2);
      assert.strictEqual(ft.trace(), 5);
      assert.ok(ft.isDiagonal());
      assert.strictEqual(ft.report().trace, 5);
    });

    runner.test('base Tensor arithmetic (scale/add) returns a FlatTensor, formulas still attached', () =>
    {
      const ft = new FlatTensor().init({ shape: [3] }, [1, 2, 3]);
      const scaled = ft.scale(2);
      assert.ok(scaled instanceof FlatTensor);
      assert.strictEqual(scaled.sum(), 12);
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
