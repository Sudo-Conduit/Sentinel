/**
 * @file research/lib/chain/tests/SystemAdapter.unit.js
 * @author Will Fobbs
 * @description Coverage for the Geodesic Protocol's adapter half: meta/state/
 *              control envelope shape, seq/step counters, complex-dtype
 *              pass-through with zero transformation, line buffering across
 *              chunk boundaries, malformed-line handling (dropped, reported
 *              to the error stream, never thrown), and the fact that nothing
 *              but valid protocol messages ever reaches the writable stream.
 */
const assert = require('assert');
const Tensor = require('../Tensor.js');
const Hilbert = require('../Hilbert.js');
const SystemAdapter = require('../SystemAdapter.js');

/** @returns {{writable:object, readable:object, errable:object, lines:function():string[], errLines:function():string[], feed:function(string):void}} an in-memory stream trio */
function makeStreams()
{
  const out = [];
  const err = [];
  const handlers = {};
  const writable = { write: (s) => { out.push(s); } };
  const errable = { write: (s) => { err.push(s); } };
  const readable = { on: (event, fn) => { handlers[event] = fn; } };
  return {
    writable,
    readable,
    errable,
    lines: () => out.join('').split('\n').filter((l) => l.length > 0),
    errLines: () => err.join('').split('\n').filter((l) => l.length > 0),
    feed: (chunk) => { if (handlers.data) { handlers.data(chunk); } },
  };
}

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('SystemAdapter', () =>
  {
    runner.test('init throws without a valid system or a systemId', () =>
    {
      assert.throws(() => new SystemAdapter().init(null, { systemId: 'a' }), /must expose/);
      assert.throws(() => new SystemAdapter().init({}, { systemId: 'a' }), /must expose/);
      const v = new Hilbert().init({ shape: [2] }, [1, 0]);
      assert.throws(() => new SystemAdapter().init(v, {}), /systemId is required/);
    });

    runner.test('emitMeta writes exactly one meta envelope with shape/dtype/kind', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [1, 0]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', writable: streams.writable });
      adapter.emitMeta();
      const lines = streams.lines();
      assert.strictEqual(lines.length, 1);
      const msg = JSON.parse(lines[0]);
      assert.strictEqual(msg.type, 'meta');
      assert.strictEqual(msg.systemId, 'sys-a');
      assert.deepStrictEqual(msg.shape, [2]);
      assert.strictEqual(msg.dtype, Tensor.DTYPES.COMPLEX);
      assert.strictEqual(msg.kind, 'Hilbert');
      assert.strictEqual(msg.v, SystemAdapter.PROTOCOL_VERSION);
    });

    runner.test('opts.kind overrides the auto-detected constructor name', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [2] }, [1, 0]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', kind: 'CustomKind', writable: streams.writable });
      adapter.emitMeta();
      assert.strictEqual(JSON.parse(streams.lines()[0]).kind, 'CustomKind');
    });

    runner.test('emitState passes complex-dtype data through with zero transformation ({re,im} as-is)', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 0.5, im: 0.25 }, { re: 0, im: -1 }]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', writable: streams.writable });
      adapter.emitState();
      const msg = JSON.parse(streams.lines()[0]);
      assert.strictEqual(msg.type, 'state');
      // v.toFlat().data holds live Complex instances; msg.data is the JSON
      // round-trip of the exact same {re,im} values with no repacking —
      // compare the values, not the prototypes.
      assert.deepStrictEqual(msg.data, v.toFlat().data.map((c) => ({ re: c.re, im: c.im })));
      assert.strictEqual(msg.data[0].re, 0.5);
      assert.strictEqual(msg.data[0].im, 0.25);
    });

    runner.test('emitState on a real-dtype system emits plain numbers, not {re,im}', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [3] }, [1, 2, 3]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', writable: streams.writable });
      adapter.emitState();
      const msg = JSON.parse(streams.lines()[0]);
      assert.deepStrictEqual(msg.data, [1, 2, 3]);
    });

    runner.test('seq increments once per emitted message regardless of type; step increments only on emitState', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [2] }, [1, 0]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', writable: streams.writable });
      adapter.emitMeta();
      adapter.emitState();
      adapter.emitState();
      adapter.emitEof();
      const msgs = streams.lines().map((l) => JSON.parse(l));
      assert.deepStrictEqual(msgs.map((m) => m.seq), [0, 1, 2, 3]);
      assert.strictEqual(msgs[1].step, 0);
      assert.strictEqual(msgs[2].step, 1);
    });

    runner.test('emitEof writes a control message with action "eof"', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', writable: streams.writable });
      adapter.emitEof();
      const msg = JSON.parse(streams.lines()[0]);
      assert.strictEqual(msg.type, 'control');
      assert.strictEqual(msg.action, 'eof');
    });

    runner.test('onMessage receives a state message and lastState() reflects it', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', readable: streams.readable, errable: streams.errable });
      assert.strictEqual(adapter.lastState(), null);
      const received = [];
      adapter.onMessage((m) => received.push(m));
      streams.feed(JSON.stringify({ v: 1, type: 'meta', systemId: 'sys-b', seq: 0, ts: 0, shape: [1], dtype: 'real', kind: 'Hilbert' }) + '\n');
      streams.feed(JSON.stringify({ v: 1, type: 'state', systemId: 'sys-b', seq: 1, ts: 1, step: 0, data: [42] }) + '\n');
      assert.strictEqual(received.length, 2);
      assert.strictEqual(adapter.lastState().data[0], 42);
    });

    runner.test('a state line split across two chunks is still parsed correctly (line buffering)', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', readable: streams.readable, errable: streams.errable });
      const received = [];
      adapter.onMessage((m) => received.push(m));
      const full = JSON.stringify({ v: 1, type: 'state', systemId: 'sys-b', seq: 0, ts: 0, step: 0, data: [7] }) + '\n';
      const cut = Math.floor(full.length / 2);
      streams.feed(full.slice(0, cut));
      assert.strictEqual(received.length, 0, 'must not parse a partial line');
      streams.feed(full.slice(cut));
      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0].data[0], 7);
    });

    runner.test('a malformed line (invalid JSON) is dropped and reported to the error stream, not thrown', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', readable: streams.readable, errable: streams.errable });
      const received = [];
      adapter.onMessage((m) => received.push(m));
      assert.doesNotThrow(() => streams.feed('not json at all\n'));
      assert.strictEqual(received.length, 0);
      assert.strictEqual(streams.errLines().length, 1);
      assert.ok(JSON.parse(streams.errLines()[0]).message.includes('malformed line'));
    });

    runner.test('a line missing v/type is dropped and reported, without breaking subsequent lines', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', readable: streams.readable, errable: streams.errable });
      const received = [];
      adapter.onMessage((m) => received.push(m));
      streams.feed(JSON.stringify({ foo: 'bar' }) + '\n');
      streams.feed(JSON.stringify({ v: 1, type: 'state', systemId: 'sys-b', seq: 0, ts: 0, step: 0, data: [1] }) + '\n');
      assert.strictEqual(streams.errLines().length, 1);
      assert.strictEqual(received.length, 1);
    });

    runner.test('an unsupported protocol version is dropped and reported, never processed', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', readable: streams.readable, errable: streams.errable });
      const received = [];
      adapter.onMessage((m) => received.push(m));
      streams.feed(JSON.stringify({ v: 99, type: 'state', systemId: 'sys-b', seq: 0, ts: 0, step: 0, data: [1] }) + '\n');
      assert.strictEqual(received.length, 0);
      assert.ok(JSON.parse(streams.errLines()[0]).message.includes('unsupported protocol version'));
    });

    runner.test('blank lines between messages are silently ignored (no error reported)', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', readable: streams.readable, errable: streams.errable });
      const received = [];
      adapter.onMessage((m) => received.push(m));
      streams.feed('\n\n' + JSON.stringify({ v: 1, type: 'state', systemId: 'sys-b', seq: 0, ts: 0, step: 0, data: [1] }) + '\n\n');
      assert.strictEqual(received.length, 1);
      assert.strictEqual(streams.errLines().length, 0);
    });

    runner.test('multiple onMessage handlers all fire, in registration order', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', readable: streams.readable, errable: streams.errable });
      const order = [];
      adapter.onMessage(() => order.push('first'));
      adapter.onMessage(() => order.push('second'));
      streams.feed(JSON.stringify({ v: 1, type: 'state', systemId: 'sys-b', seq: 0, ts: 0, step: 0, data: [1] }) + '\n');
      assert.deepStrictEqual(order, ['first', 'second']);
    });

    runner.test('nothing but the requested messages is ever written to the writable stream', () =>
    {
      const streams = makeStreams();
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', writable: streams.writable });
      adapter.emitMeta();
      adapter.emitState();
      const lines = streams.lines();
      assert.strictEqual(lines.length, 2);
      lines.forEach((l) => assert.doesNotThrow(() => JSON.parse(l), 'every line must be valid JSON, nothing else interleaved'));
    });

    runner.test('adapter works with no writable/readable/errable configured (silently no-ops rather than throwing)', () =>
    {
      const v = new Hilbert().init({ shape: [1] }, [1]);
      const adapter = new SystemAdapter().init(v, { systemId: 'sys-a', writable: null, readable: null, errable: null });
      assert.doesNotThrow(() => adapter.emitMeta());
      assert.doesNotThrow(() => adapter.emitState());
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
