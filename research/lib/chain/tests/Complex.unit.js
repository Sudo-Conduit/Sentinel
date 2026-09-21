/**
 * @file research/lib/chain/tests/Complex.unit.js
 * @author Will Fobbs
 * @description Comprehensive Complex coverage: arithmetic, from(), equals, toString.
 */
const assert = require('assert');
const Complex = require('../Complex.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Complex', () =>
  {
    runner.test('init sets re/im, defaults to 0', () =>
    {
      const z = new Complex().init(3, 4);
      assert.strictEqual(z.re, 3);
      assert.strictEqual(z.im, 4);
      const zero = new Complex().init();
      assert.strictEqual(zero.re, 0);
      assert.strictEqual(zero.im, 0);
    });

    runner.test('from() coerces a plain number to (n, 0)', () =>
    {
      const z = Complex.from(5);
      assert.strictEqual(z.re, 5);
      assert.strictEqual(z.im, 0);
    });

    runner.test('from() coerces a {re,im} plain object', () =>
    {
      const z = Complex.from({ re: 1, im: 2 });
      assert.strictEqual(z.re, 1);
      assert.strictEqual(z.im, 2);
    });

    runner.test('from() passes an existing Complex through unchanged (same reference)', () =>
    {
      const z = new Complex().init(1, 1);
      assert.strictEqual(Complex.from(z), z);
    });

    runner.test('from() throws on an uncoercible value', () =>
    {
      assert.throws(() => Complex.from('not a number'), /cannot coerce/);
    });

    runner.test('add', () =>
    {
      const r = new Complex().init(1, 2).add(new Complex().init(3, -1));
      assert.strictEqual(r.re, 4);
      assert.strictEqual(r.im, 1);
    });

    runner.test('subtract', () =>
    {
      const r = new Complex().init(1, 2).subtract(new Complex().init(3, -1));
      assert.strictEqual(r.re, -2);
      assert.strictEqual(r.im, 3);
    });

    runner.test('multiply: (1+2i)(3-1i) = 5+5i', () =>
    {
      const r = new Complex().init(1, 2).multiply(new Complex().init(3, -1));
      assert.strictEqual(r.re, 5);
      assert.strictEqual(r.im, 5);
    });

    runner.test('add/subtract/multiply accept a plain number operand', () =>
    {
      const z = new Complex().init(2, 3);
      assert.strictEqual(z.add(5).re, 7);
      assert.strictEqual(z.multiply(2).im, 6);
    });

    runner.test('conjugate negates the imaginary part', () =>
    {
      const c = new Complex().init(3, 4).conjugate();
      assert.strictEqual(c.re, 3);
      assert.strictEqual(c.im, -4);
    });

    runner.test('abs (modulus): |3+4i| = 5', () =>
    {
      assert.strictEqual(new Complex().init(3, 4).abs(), 5);
    });

    runner.test('equals', () =>
    {
      assert.ok(new Complex().init(1, 1).equals(new Complex().init(1, 1)));
      assert.ok(!new Complex().init(1, 1).equals(new Complex().init(1, 2)));
      assert.ok(new Complex().init(5, 0).equals(5)); // equals coerces via from()
    });

    runner.test('toString formats re+im/re-im/re-only/im-only', () =>
    {
      assert.strictEqual(new Complex().init(3, 4).toString(), '3+4i');
      assert.strictEqual(new Complex().init(3, -4).toString(), '3-4i');
      assert.strictEqual(new Complex().init(5, 0).toString(), '5');
      assert.strictEqual(new Complex().init(0, 4).toString(), '4i');
    });

    runner.test('operations are non-mutating (return a new instance)', () =>
    {
      const a = new Complex().init(1, 1);
      const b = a.add(new Complex().init(1, 1));
      assert.strictEqual(a.re, 1);
      assert.strictEqual(a.im, 1);
      assert.notStrictEqual(a, b);
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
