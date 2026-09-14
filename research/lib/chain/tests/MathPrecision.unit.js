/**
 * @file research/lib/chain/tests/MathPrecision.unit.js
 * @author Will Fobbs
 * @description Coverage for Math.fround(x, type): backward compatibility
 *              (type omitted matches the preserved native function
 *              exactly, for many values, not just one), F16 against
 *              well-documented IEEE 754 half-precision reference values
 *              (max finite 65504, 1.0 exact, overflow to Infinity,
 *              underflow to zero), F8_E4M3/F8_E5M2/F4_E2M1 against their
 *              documented max-finite values (448 / 57344 / 6 respectively
 *              -- independently known constants, not derived from this
 *              file's own formula), sign/zero/NaN/Infinity handling
 *              across every format, and 1.0's exact round-trip in every
 *              format (it needs zero mantissa bits, so it must be exact
 *              even in F4_E2M1).
 */
const assert = require('assert');
const MathPrecision = require('../MathPrecision.js');

const P = MathPrecision.PRECISION;

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('MathPrecision', () =>
  {
    runner.test('Math.fround(x) with no type is byte-identical to the preserved native function, across many values', () =>
    {
      const native = Math.fround.__native;
      const samples = [0, -0, 1, -1, 0.1, 123.456, 1e10, -1e-10, Math.PI, NaN, Infinity, -Infinity];
      for (const x of samples)
      {
        const expected = native(x);
        const actual = Math.fround(x);
        if (Number.isNaN(expected))
        {
          assert.ok(Number.isNaN(actual), 'NaN input must produce NaN output');
        }
        else
        {
          assert.strictEqual(actual, expected, 'mismatch for x=' + x);
        }
      }
    });

    runner.test('Math.fround(x, PRECISION.F32) is identical to Math.fround(x)', () =>
    {
      assert.strictEqual(Math.fround(1.23456789, P.F32), Math.fround(1.23456789));
    });

    runner.test('every format: 1.0 round-trips exactly (needs zero mantissa bits)', () =>
    {
      assert.strictEqual(Math.fround(1.0, P.F16), 1.0);
      assert.strictEqual(Math.fround(1.0, P.F8_E4M3), 1.0);
      assert.strictEqual(Math.fround(1.0, P.F8_E5M2), 1.0);
      assert.strictEqual(Math.fround(1.0, P.F4_E2M1), 1.0);
    });

    runner.test('every format: zero and negative zero are preserved exactly', () =>
    {
      for (const type of [P.F16, P.F8_E4M3, P.F8_E5M2, P.F4_E2M1])
      {
        assert.strictEqual(Math.fround(0, type), 0);
        assert.ok(Object.is(Math.fround(-0, type), -0), type + ': -0 must stay -0');
      }
    });

    runner.test('every format: NaN in, NaN out', () =>
    {
      for (const type of [P.F16, P.F8_E4M3, P.F8_E5M2, P.F4_E2M1])
      {
        assert.ok(Number.isNaN(Math.fround(NaN, type)));
      }
    });

    runner.test('every format: sign is preserved on ordinary values', () =>
    {
      for (const type of [P.F16, P.F8_E4M3, P.F8_E5M2, P.F4_E2M1])
      {
        assert.ok(Math.fround(2.0, type) > 0, type);
        assert.ok(Math.fround(-2.0, type) < 0, type);
      }
    });

    runner.test('F16: max finite is exactly 65504 (documented IEEE 754 half-precision constant)', () =>
    {
      assert.strictEqual(Math.fround(65504, P.F16), 65504);
      assert.strictEqual(Math.fround(65520, P.F16), Infinity, 'rounds up past max finite -> Infinity (F16 has Inf)');
      assert.strictEqual(Math.fround(100000, P.F16), Infinity);
    });

    runner.test('F16: underflows to zero below the smallest subnormal', () =>
    {
      assert.strictEqual(Math.fround(1e-10, P.F16), 0);
    });

    runner.test('F8_E4M3: max finite is exactly 448 (documented OCP constant, NOT the naive 480 the generic formula alone would give)', () =>
    {
      assert.strictEqual(Math.fround(448, P.F8_E4M3), 448);
      assert.strictEqual(Math.fround(1000, P.F8_E4M3), 448, 'no Inf -- saturates at max finite instead');
      assert.strictEqual(Math.fround(Infinity, P.F8_E4M3), 448);
    });

    runner.test('F8_E5M2: max finite is exactly 57344 (documented OCP constant), has Inf', () =>
    {
      assert.strictEqual(Math.fround(57344, P.F8_E5M2), 57344);
      assert.strictEqual(Math.fround(100000, P.F8_E5M2), Infinity, 'E5M2 has real Inf, unlike E4M3');
    });

    runner.test('F4_E2M1: max finite is exactly 6 (documented MXFP4 constant), no Inf', () =>
    {
      assert.strictEqual(Math.fround(6, P.F4_E2M1), 6);
      assert.strictEqual(Math.fround(100, P.F4_E2M1), 6, 'saturates, no Inf');
    });

    runner.test('unknown precision type throws TypeError', () =>
    {
      assert.throws(() => Math.fround(1.0, 'not-a-real-format'), /unknown precision type/);
    });

    runner.test('quantize() and Math.fround(x,type) agree -- same function, two entry points', () =>
    {
      assert.strictEqual(MathPrecision.quantize(123.456, P.F16), Math.fround(123.456, P.F16));
    });

    runner.test('loading MathPrecision twice does not double-wrap Math.fround', () =>
    {
      delete require.cache[require.resolve('../MathPrecision.js')];
      const before = Math.fround;
      require('../MathPrecision.js');
      assert.strictEqual(Math.fround, before, 'second require must not install a new wrapper around the already-extended function');
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
