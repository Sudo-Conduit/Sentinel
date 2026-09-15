/**
 * @file research/lib/chain/tests/Torus.unit.js
 * @author Will Fobbs
 * @description Coverage for Torus as a stateless projection: wrap/circDist/
 *              shortestDir topology primitives, row/col/index round-trips,
 *              componentCount's coprime-vs-not distinction (verified
 *              against the actual diagonal-walk behavior, not just gcd()
 *              in isolation), project()'s duck-typed source extraction
 *              (plain array, Tensor-like, {data}), its refusal to
 *              normalize anything, and the empty===infinity seam
 *              (wrap(1)===wrap(0)).
 */
const assert = require('assert');
const Tensor = require('../Tensor.js');
const Torus = require('../Torus.js');

/** @param {Torus} torus @returns {number[]} the sequence of flat indices visited by the diagonal walk (row+1 mod p, col+1 mod q) until it returns to 0, or after p*q steps if it never does */
function walkDiagonal(torus)
{
  const visited = [];
  let r = 0, c = 0;
  const maxSteps = torus.p * torus.q;
  for (let i = 0; i < maxSteps; i++)
  {
    visited.push(torus.index(r, c));
    r = (r + 1) % torus.p;
    c = (c + 1) % torus.q;
    if (r === 0 && c === 0 && i > 0)
    {
      break;
    }
  }
  return visited;
}

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Torus', () =>
  {
    runner.test('wrap: 0 and 1 are the same point (empty === infinity seam)', () =>
    {
      assert.strictEqual(Torus.wrap(1), Torus.wrap(0));
      assert.strictEqual(Torus.wrap(1), 0);
    });

    runner.test('wrap: negative values wrap into [0,1)', () =>
    {
      assert.ok(Math.abs(Torus.wrap(-0.25) - 0.75) < 1e-12);
      assert.ok(Math.abs(Torus.wrap(1.25) - 0.25) < 1e-12);
    });

    runner.test('circDist: shortest distance never exceeds 0.5, wraps correctly across the seam', () =>
    {
      assert.ok(Math.abs(Torus.circDist(0.1, 0.9) - 0.2) < 1e-12); // shorter path wraps through 0
      assert.ok(Math.abs(Torus.circDist(0.1, 0.3) - 0.2) < 1e-12);
      assert.strictEqual(Torus.circDist(0, 1), 0); // same point
    });

    runner.test('shortestDir: signed direction stays in [-0.5, 0.5] and wraps the short way', () =>
    {
      assert.ok(Math.abs(Torus.shortestDir(0.1, 0.9) - (-0.2)) < 1e-12); // shorter to go backward through 0
      assert.ok(Math.abs(Torus.shortestDir(0.9, 0.1) - 0.2) < 1e-12);
      assert.ok(Math.abs(Torus.shortestDir(0.2, 0.5) - 0.3) < 1e-12);
    });

    runner.test('row/col/index round-trip for every flat index in a 9x8 grid', () =>
    {
      for (let i = 0; i < 72; i++)
      {
        const r = Torus.row(i, 8);
        const c = Torus.col(i, 8);
        assert.strictEqual(Torus.index(r, c, 8), i);
      }
      assert.strictEqual(Torus.row(0, 8), 0);
      assert.strictEqual(Torus.col(0, 8), 0);
      assert.strictEqual(Torus.row(71, 8), 8);
      assert.strictEqual(Torus.col(71, 8), 7);
    });

    runner.test('componentCount: coprime (9,8) gives 1, the diagonal walk visits all 72 points exactly once', () =>
    {
      const t98 = new Torus().init({ p: 9, q: 8 });
      assert.strictEqual(t98.componentCount(), 1);
      assert.strictEqual(t98.isClosed(), true);
      const visited = walkDiagonal(t98);
      assert.strictEqual(visited.length, 72);
      assert.strictEqual(new Set(visited).size, 72, 'every point visited exactly once');
    });

    runner.test('componentCount: non-coprime (4,6) gives gcd=2, the diagonal walk splits into 2 disjoint cycles', () =>
    {
      const t = new Torus().init({ p: 4, q: 6 });
      assert.strictEqual(t.componentCount(), 2);
      assert.strictEqual(t.isClosed(), false);
      const visited = walkDiagonal(t);
      assert.strictEqual(visited.length, 12, 'one component of a 24-point grid split into gcd=2 cycles is 12 points');
      assert.notStrictEqual(visited.length, 24, 'must NOT cover the whole grid -- that is exactly what componentCount=2 predicts');
    });

    runner.test('init throws on non-positive-integer p or q', () =>
    {
      assert.throws(() => new Torus().init({ p: 0, q: 8 }), /positive integers/);
      assert.throws(() => new Torus().init({ p: 9, q: -1 }), /positive integers/);
      assert.throws(() => new Torus().init({ p: 9.5, q: 8 }), /positive integers/);
      assert.throws(() => new Torus().init({}), /positive integers/);
    });

    runner.test('project: accepts a plain array source', () =>
    {
      const t = new Torus().init({ p: 2, q: 3 });
      const result = t.project([1, 2, 3, 4, 5, 6]);
      assert.deepStrictEqual(result.shape, [2, 3]);
      assert.deepStrictEqual(result.nested, [[1, 2, 3], [4, 5, 6]]);
      assert.strictEqual(result.data.length, 6);
    });

    runner.test('project: accepts a Tensor-like source via .toFlat().data', () =>
    {
      const tensor = new Tensor().init({ shape: [6] }, [1, 2, 3, 4, 5, 6]);
      const t = new Torus().init({ p: 2, q: 3 });
      const result = t.project(tensor);
      assert.deepStrictEqual(result.nested, [[1, 2, 3], [4, 5, 6]]);
    });

    runner.test('project: accepts an object exposing {data: [...]}', () =>
    {
      const t = new Torus().init({ p: 2, q: 2 });
      const result = t.project({ data: [9, 8, 7, 6] });
      assert.deepStrictEqual(result.nested, [[9, 8], [7, 6]]);
    });

    runner.test('project: throws on a source with the wrong element count -- never silently pads or truncates', () =>
    {
      const t = new Torus().init({ p: 9, q: 8 });
      assert.throws(() => t.project([1, 2, 3]), /expected p\*q = 72/);
    });

    runner.test('project: throws TypeError on an unrecognized source shape', () =>
    {
      const t = new Torus().init({ p: 2, q: 2 });
      assert.throws(() => t.project(42), /must be an array/);
      assert.throws(() => t.project(null), /must be an array/);
    });

    runner.test('project: performs zero normalization -- passes values through completely unchanged, including a non-unity sum', () =>
    {
      const t = new Torus().init({ p: 1, q: 4 });
      const raw = [5, -3, 100, 0.001]; // deliberately does NOT sum to 1 or have unit norm
      const result = t.project(raw);
      assert.deepStrictEqual(result.data, raw);
      assert.deepStrictEqual(result.nested, [[5, -3, 100, 0.001]]);
    });

    runner.test('the static functions and the instance methods agree for the same (p,q)', () =>
    {
      const t = new Torus().init({ p: 9, q: 8 });
      for (let i = 0; i < 72; i++)
      {
        assert.strictEqual(t.row(i), Torus.row(i, 8));
        assert.strictEqual(t.col(i), Torus.col(i, 8));
      }
      assert.strictEqual(t.componentCount(), Torus.componentCount(9, 8));
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
