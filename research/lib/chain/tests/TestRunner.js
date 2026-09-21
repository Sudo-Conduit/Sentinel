/**
 * @file research/lib/chain/tests/TestRunner.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Minimal, dependency-free test harness: suite()/test()/run().
 *              No external test framework — matches "assume no dependencies
 *              in classes unless authorized"; assertions come from Node's
 *              built-in `assert` module, used by the *.unit.js files, not
 *              by this runner itself.
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory();
  }
  else
  {
    root.Chain = root.Chain || {};
    root.Chain.TestRunner = factory();
  }
}(typeof self !== 'undefined' ? self : this, function ()
{
  'use strict';

  class TestRunner
  {
    static name = 'TestRunner';
    static author = 'Will Fobbs';
    static version = '1.0.0';
    static description = 'Minimal dependency-free suite()/test()/run() harness for the chain test files.';

    constructor()
    {
      this.suites = [];
      this._current = null;
    }

    /**
     * @param {string} name
     * @param {Function} fn - runs immediately; any test() calls inside register into this suite
     * @returns {TestRunner} this, for chaining
     */
    suite(name, fn)
    {
      const s = { name, cases: [] };
      this.suites.push(s);
      const prev = this._current;
      this._current = s;
      fn();
      this._current = prev;
      return this;
    }

    /**
     * @param {string} name
     * @param {Function} fn - throws (e.g. via assert) to fail
     */
    test(name, fn)
    {
      if (!this._current)
      {
        throw new Error('TestRunner.test: "' + name + '" must be called inside suite()');
      }
      this._current.cases.push({ name, fn });
    }

    /**
     * Async so a test function returning a Promise (e.g. exercising
     * WeightedGraphMixin's async walk()) is actually awaited — `await`
     * on a plain synchronous return value resolves immediately, so this
     * is fully backward compatible with every existing sync test.
     * @returns {Promise<{passed:number, failed:number, total:number}>}
     */
    async run()
    {
      let passed = 0;
      let failed = 0;
      for (const s of this.suites)
      {
        console.log('\n' + s.name);
        for (const c of s.cases)
        {
          try
          {
            await c.fn();
            passed += 1;
            console.log('  ✓ ' + c.name);
          }
          catch (e)
          {
            failed += 1;
            console.log('  ✗ ' + c.name + '\n      ' + e.message);
          }
        }
      }
      console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
      return { passed, failed, total: passed + failed };
    }
  }

  return TestRunner;
}));
