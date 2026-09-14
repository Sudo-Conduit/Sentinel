/**
 * @file research/lib/chain/tests/Geodesic.unit.js
 * @author Will Fobbs
 * @description Coverage for the Geodesic base class: endpoint validation
 *              (must be SystemAdapter-shaped, must be two distinct
 *              systems), leftState()/rightState() delegation, and
 *              isReady() reflecting whether both sides have received a
 *              state message yet -- all of it deliberately free of any
 *              link math, since that's mixin territory built later.
 */
const assert = require('assert');
const Hilbert = require('../Hilbert.js');
const SystemAdapter = require('../SystemAdapter.js');
const Geodesic = require('../Geodesic.js');

/** @returns {SystemAdapter} a SystemAdapter with no live streams, wrapping a fresh Hilbert vector */
function makeAdapter(systemId)
{
  const v = new Hilbert().init({ shape: [2] }, [1, 0]);
  return new SystemAdapter().init(v, { systemId, writable: null, readable: null, errable: null });
}

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Geodesic', () =>
  {
    runner.test('init throws when left or right is missing or not adapter-shaped', () =>
    {
      const a = makeAdapter('sys-a');
      assert.throws(() => new Geodesic().init({}), /left must be a SystemAdapter/);
      assert.throws(() => new Geodesic().init({ left: a }), /right must be a SystemAdapter/);
      assert.throws(() => new Geodesic().init({ left: {}, right: a }), /left must be a SystemAdapter/);
      assert.throws(() => new Geodesic().init({ left: a, right: { lastState: () => null } }), /right must be a SystemAdapter/);
    });

    runner.test('init throws when left and right are the same systemId', () =>
    {
      const a = makeAdapter('sys-a');
      const aAgain = makeAdapter('sys-a');
      assert.throws(() => new Geodesic().init({ left: a, right: aAgain }), /must be different systems/);
    });

    runner.test('init succeeds with two distinct adapters and stores them as .left/.right', () =>
    {
      const a = makeAdapter('sys-a');
      const b = makeAdapter('sys-b');
      const g = new Geodesic().init({ left: a, right: b });
      assert.strictEqual(g.left, a);
      assert.strictEqual(g.right, b);
    });

    runner.test('isReady is false until both endpoints have received a state message', () =>
    {
      const a = makeAdapter('sys-a');
      const b = makeAdapter('sys-b');
      const g = new Geodesic().init({ left: a, right: b });
      assert.strictEqual(g.isReady(), false);

      a._lastState = { type: 'state', step: 0, data: [1, 0] };
      assert.strictEqual(g.isReady(), false, 'still false with only one side populated');

      b._lastState = { type: 'state', step: 0, data: [0, 1] };
      assert.strictEqual(g.isReady(), true);
    });

    runner.test('leftState()/rightState() delegate directly to the adapters\' lastState()', () =>
    {
      const a = makeAdapter('sys-a');
      const b = makeAdapter('sys-b');
      const g = new Geodesic().init({ left: a, right: b });
      assert.strictEqual(g.leftState(), null);
      assert.strictEqual(g.rightState(), null);

      const stateMsg = { type: 'state', step: 3, data: [5, 6] };
      a._lastState = stateMsg;
      assert.strictEqual(g.leftState(), stateMsg);
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
