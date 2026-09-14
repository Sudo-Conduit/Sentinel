/**
 * @file research/lib/chain/tests/GeodesicLink.unit.js
 * @author Will Fobbs
 * @description Coverage for the four link-math mixins: coupling()
 *              (scalar strength times the sesquilinear overlap),
 *              interaction() (arbitrary injected function, plus the
 *              required-fn TypeError), fubiniStudyDistance() and
 *              buresDistance() (verified by hand against orthonormal
 *              and identical-state cases, where the closed forms are
 *              exact), the shared not-ready-yet null behavior, per-
 *              instance toggling, and dimension-mismatch/zero-vector
 *              error paths.
 */
const assert = require('assert');
const Tensor = require('../Tensor.js');
const Hilbert = require('../Hilbert.js');
const SystemAdapter = require('../SystemAdapter.js');
const GeodesicLink = require('../GeodesicLink.js');

/** @returns {SystemAdapter} a streamless SystemAdapter wrapping the given Hilbert instance */
function adapterFor(systemId, hilbertInstance)
{
  return new SystemAdapter().init(hilbertInstance, { systemId, writable: null, readable: null, errable: null });
}

/** @param {SystemAdapter} adapter @param {Array} data feeds a synthetic `state` message directly, bypassing streams */
function feedState(adapter, data)
{
  adapter._lastState = { type: 'state', step: 0, data };
}

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('GeodesicLink', () =>
  {
    runner.test('coupling(): before either side has state, returns null rather than throwing', () =>
    {
      const link = new GeodesicLink().init({ left: adapterFor('a', new Hilbert().init({ shape: [2] }, [1, 0])), right: adapterFor('b', new Hilbert().init({ shape: [2] }, [1, 0])) });
      assert.strictEqual(link.coupling(1), null);
      assert.strictEqual(link.interaction(() => 1), null);
      assert.strictEqual(link.fubiniStudyDistance(), null);
      assert.strictEqual(link.buresDistance(), null);
    });

    runner.test('coupling(): real dtype, g * <left|right> reduces to g * ordinary dot product', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [3] }, [1, 2, 3]));
      const right = adapterFor('b', new Hilbert().init({ shape: [3] }, [4, 5, 6]));
      const link = new GeodesicLink().init({ left, right });
      feedState(left, [1, 2, 3]);
      feedState(right, [4, 5, 6]);
      const result = link.coupling(2);
      assert.strictEqual(result.re, 64); // 2 * (1*4+2*5+3*6) = 2*32
      assert.strictEqual(result.im, 0);
    });

    runner.test('coupling(): omitted strength defaults to 1, even with the injected trailing next argument', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [2] }, [1, 0]));
      const right = adapterFor('b', new Hilbert().init({ shape: [2] }, [1, 0]));
      const link = new GeodesicLink().init({ left, right });
      feedState(left, [1, 0]);
      feedState(right, [1, 0]);
      const result = link.coupling();
      assert.strictEqual(result.re, 1);
      assert.strictEqual(result.im, 0);
    });

    runner.test('coupling(): complex dtype is sesquilinear (conjugate-linear in left), matching Hilbert.innerProduct', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 0, im: 1 }, { re: 0, im: 0 }]));
      const right = adapterFor('b', new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 1, im: 0 }, { re: 0, im: 0 }]));
      const link = new GeodesicLink().init({ left, right });
      feedState(left, [{ re: 0, im: 1 }, { re: 0, im: 0 }]);
      feedState(right, [{ re: 1, im: 0 }, { re: 0, im: 0 }]);
      // <left|right> = conj(0+1i)*1 = (0-1i)*1 = -1i
      const result = link.coupling(1);
      assert.strictEqual(result.re, 0);
      assert.strictEqual(result.im, -1);
    });

    runner.test('coupling(): throws RangeError on dimension mismatch', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [2] }, [1, 0]));
      const right = adapterFor('b', new Hilbert().init({ shape: [3] }, [1, 0, 0]));
      const link = new GeodesicLink().init({ left, right });
      feedState(left, [1, 0]);
      feedState(right, [1, 0, 0]);
      assert.throws(() => link.coupling(1), /dimension mismatch/);
    });

    runner.test('interaction(): dispatches to the caller-supplied function with the raw data buffers', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [2] }, [1, 0]));
      const right = adapterFor('b', new Hilbert().init({ shape: [2] }, [0, 1]));
      const link = new GeodesicLink().init({ left, right });
      feedState(left, [1, 0]);
      feedState(right, [0, 1]);
      const result = link.interaction((l, r) => l.length + r.length);
      assert.strictEqual(result, 4);
    });

    runner.test('interaction(): throws TypeError when fn is not a function', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [1] }, [1]));
      const right = adapterFor('b', new Hilbert().init({ shape: [1] }, [1]));
      const link = new GeodesicLink().init({ left, right });
      assert.throws(() => link.interaction('not a function'), /fn must be a function/);
    });

    runner.test('fubiniStudyDistance(): identical normalized states have distance 0', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [2] }, [1, 0]));
      const right = adapterFor('b', new Hilbert().init({ shape: [2] }, [1, 0]));
      const link = new GeodesicLink().init({ left, right });
      feedState(left, [1, 0]);
      feedState(right, [1, 0]);
      assert.ok(Math.abs(link.fubiniStudyDistance() - 0) < 1e-9);
    });

    runner.test('fubiniStudyDistance(): orthonormal states have distance pi/2', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [2] }, [1, 0]));
      const right = adapterFor('b', new Hilbert().init({ shape: [2] }, [0, 1]));
      const link = new GeodesicLink().init({ left, right });
      feedState(left, [1, 0]);
      feedState(right, [0, 1]);
      assert.ok(Math.abs(link.fubiniStudyDistance() - Math.PI / 2) < 1e-9);
    });

    runner.test('fubiniStudyDistance(): scale-invariant (unnormalized states give the same angle as their normalized forms)', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [2] }, [3, 0]));
      const right = adapterFor('b', new Hilbert().init({ shape: [2] }, [0, 7]));
      const link = new GeodesicLink().init({ left, right });
      feedState(left, [3, 0]);
      feedState(right, [0, 7]);
      assert.ok(Math.abs(link.fubiniStudyDistance() - Math.PI / 2) < 1e-9);
    });

    runner.test('fubiniStudyDistance(): throws RangeError for a zero-vector state', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [2] }, [0, 0]));
      const right = adapterFor('b', new Hilbert().init({ shape: [2] }, [1, 0]));
      const link = new GeodesicLink().init({ left, right });
      feedState(left, [0, 0]);
      feedState(right, [1, 0]);
      assert.throws(() => link.fubiniStudyDistance(), /zero-vector/);
    });

    runner.test('buresDistance(): identical normalized states have distance 0, orthonormal states have distance sqrt(2)', () =>
    {
      const identicalLeft = adapterFor('a', new Hilbert().init({ shape: [2] }, [1, 0]));
      const identicalRight = adapterFor('b', new Hilbert().init({ shape: [2] }, [1, 0]));
      const identicalLink = new GeodesicLink().init({ left: identicalLeft, right: identicalRight });
      feedState(identicalLeft, [1, 0]);
      feedState(identicalRight, [1, 0]);
      assert.ok(Math.abs(identicalLink.buresDistance() - 0) < 1e-9);

      const orthoLeft = adapterFor('c', new Hilbert().init({ shape: [2] }, [1, 0]));
      const orthoRight = adapterFor('d', new Hilbert().init({ shape: [2] }, [0, 1]));
      const orthoLink = new GeodesicLink().init({ left: orthoLeft, right: orthoRight });
      feedState(orthoLeft, [1, 0]);
      feedState(orthoRight, [0, 1]);
      assert.ok(Math.abs(orthoLink.buresDistance() - Math.sqrt(2)) < 1e-9);
    });

    runner.test('each mixin is independently toggleable per instance', () =>
    {
      const left = adapterFor('a', new Hilbert().init({ shape: [2] }, [1, 0]));
      const right = adapterFor('b', new Hilbert().init({ shape: [2] }, [1, 0]));
      feedState(left, [1, 0]);
      feedState(right, [1, 0]);
      const a = new GeodesicLink().init({ left, right });
      const b = new GeodesicLink().init({ left, right });
      b.disableLayer(GeodesicLink.OPERATIONS.coupling);
      assert.strictEqual(b.coupling(1), undefined);
      assert.ok(a.coupling(1), 'disabling on one instance must not affect another');
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
