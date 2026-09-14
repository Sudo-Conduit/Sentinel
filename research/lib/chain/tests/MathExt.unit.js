/**
 * @file research/lib/chain/tests/MathExt.unit.js
 * @author Will Fobbs
 * @description Coverage for Math.ext/Math.init: default install, the
 *              ExtendX.override()-style collision policy (throws unless
 *              overrides:true), idempotent re-require, and the
 *              stable-name requirement.
 */
const assert = require('assert');
require('../MathExt.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('MathExt', () =>
  {
    runner.test('Math.init and Math.ext exist after requiring MathExt.js', () =>
    {
      assert.strictEqual(typeof Math.init, 'function');
      assert.strictEqual(typeof Math.ext, 'object');
    });

    runner.test('Math.init installs a default instance at Math.ext[name]', () =>
    {
      class Foo
      {
        static extName = 'FooTestGroup';
        constructor() {}
        init() { return this; }
        ping() { return 'pong'; }
      }
      const instance = Math.init(Foo);
      assert.strictEqual(Math.ext.FooTestGroup, instance);
      assert.strictEqual(Math.ext.FooTestGroup.ping(), 'pong');
    });

    runner.test('registering the same name twice throws without overrides:true', () =>
    {
      class Bar
      {
        static extName = 'BarTestGroup';
        constructor() {}
        init() { return this; }
      }
      Math.init(Bar);
      assert.throws(() => Math.init(Bar), /already registered/);
    });

    runner.test('overrides:true allows a deliberate replacement', () =>
    {
      class Baz
      {
        static extName = 'BazTestGroup';
        constructor() {}
        init() { return this; }
        value() { return 1; }
      }
      class BazV2
      {
        static extName = 'BazTestGroup';
        constructor() {}
        init() { return this; }
        value() { return 2; }
      }
      Math.init(Baz);
      assert.strictEqual(Math.ext.BazTestGroup.value(), 1);
      Math.init(BazV2, { overrides: true });
      assert.strictEqual(Math.ext.BazTestGroup.value(), 2);
    });

    runner.test('a class with no extName and no function name throws', () =>
    {
      const Anon = (function () { return function () {}; }());
      Object.defineProperty(Anon, 'name', { value: '' });
      assert.throws(() => Math.init(Anon), /needs a stable name/);
    });

    runner.test('config is passed through to init()', () =>
    {
      class Configurable
      {
        static extName = 'ConfigurableTestGroup';
        constructor() {}
        init(config) { this.config = config; return this; }
      }
      Math.init(Configurable, { config: { seed: 42 } });
      assert.deepStrictEqual(Math.ext.ConfigurableTestGroup.config, { seed: 42 });
    });

    runner.test('requiring MathExt.js twice does not replace an already-working Math.init', () =>
    {
      const before = Math.init;
      delete require.cache[require.resolve('../MathExt.js')];
      require('../MathExt.js');
      assert.strictEqual(Math.init, before);
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
