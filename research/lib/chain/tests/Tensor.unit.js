/**
 * @file research/lib/chain/tests/Tensor.unit.js
 * @author Will Fobbs
 * @description Comprehensive Tensor coverage: R1/R2 resolution, get/set,
 *              nesting views, iteration, arithmetic, contraction/outer,
 *              reshape/transpose, classification/algebra, complex dtype,
 *              and the deterministic size-estimate guard.
 */
const assert = require('assert');
const Tensor = require('../Tensor.js');
const Complex = require('../Complex.js');
const Data = require('../Data.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Tensor: R1/R2 resolution', () =>
  {
    runner.test('R2 as a Data dependency, explicit shape + field', () =>
    {
      const d = new Data().init([{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }], { type: Data.SOURCE_TYPES.JSON_ARRAY });
      const t = new Tensor().init({ shape: [2, 2], field: 'x' }, d);
      assert.deepStrictEqual(t.shape, [2, 2]);
      assert.strictEqual(t.get(1, 0), 3);
    });

    runner.test('R2 as a flat array: rank-1 shape inferred', () =>
    {
      const t = new Tensor().init({}, [1, 0, 1]);
      assert.deepStrictEqual(t.shape, [3]);
      assert.deepStrictEqual(t.toFlat().data, [1, 0, 1]);
    });

    runner.test('R2 as a nested array: shape inferred from nesting', () =>
    {
      const t = new Tensor().init({}, [[1, 2], [3, 4]]);
      assert.deepStrictEqual(t.shape, [2, 2]);
      assert.deepStrictEqual(t.toFlat().data, [1, 2, 3, 4]);
      assert.deepStrictEqual(t.toNested(), [[1, 2], [3, 4]]);
    });

    runner.test('ragged nested array throws', () =>
    {
      assert.throws(() => new Tensor().init({}, [[1, 2], [3]]), /ragged/);
    });

    runner.test('unsupported R2 type throws', () =>
    {
      assert.throws(() => new Tensor().init({}, 42), /Data instance, a flat array, or a nested array/);
    });

    runner.test('shape/size mismatch throws', () =>
    {
      assert.throws(() => new Tensor().init({ shape: [3, 3] }, [1, 2, 3]), /does not match/);
    });

    runner.test('missing R2 throws', () =>
    {
      assert.throws(() => new Tensor().init({}, null), /R2 \(data\) is required/);
    });

    runner.test('UNORDERED requires R1.compare, CUSTOM requires R1.indexFn', () =>
    {
      assert.throws(() => new Tensor().init({ order: Tensor.ORDERS.UNORDERED }, [3, 1, 2]), /requires R1\.compare/);
      assert.throws(() => new Tensor().init({ order: Tensor.ORDERS.CUSTOM }, [3, 1, 2]), /requires R1\.indexFn/);
    });

    runner.test('UNORDERED sorts rows via R1.compare before indexing', () =>
    {
      const t = new Tensor().init({ order: Tensor.ORDERS.UNORDERED, compare: (a, b) => a - b }, [3, 1, 2]);
      assert.deepStrictEqual(t.toFlat().data, [1, 2, 3]);
    });

    runner.test('CUSTOM sorts rows by indexFn(row, i, rows)', () =>
    {
      const t = new Tensor().init({ order: Tensor.ORDERS.CUSTOM, indexFn: (row) => row }, [3, 1, 2]);
      assert.deepStrictEqual(t.toFlat().data, [1, 2, 3]);
    });

    runner.test('CUSTOM indexFn receives the full (row, i, rows) signature', () =>
    {
      // key = rows.length - i: reverses purely by position, ignoring row value
      const t = new Tensor().init({ order: Tensor.ORDERS.CUSTOM, indexFn: (row, i, rows) => rows.length - i }, [10, 20, 30]);
      assert.deepStrictEqual(t.toFlat().data, [30, 20, 10]);
    });

    runner.test('CUSTOM sort is stable: ties keep their relative order', () =>
    {
      const rows = [{ k: 1, n: 10 }, { k: 1, n: 20 }, { k: 0, n: 30 }];
      const t = new Tensor().init({ order: Tensor.ORDERS.CUSTOM, indexFn: (r) => r.k, field: 'n' }, rows);
      assert.deepStrictEqual(t.toFlat().data, [30, 10, 20]);
    });

    runner.test('extracting a non-numeric field throws instead of silently producing NaN', () =>
    {
      assert.throws(
        () => new Tensor().init({ field: 'v' }, [{ v: 'not-a-number' }]),
        /is not a numeric scalar/
      );
    });

    runner.test('CUSTOM/UNORDERED also reorder a nested array\'s OUTER axis, not just flat R2', () =>
    {
      const custom = new Tensor().init({ order: Tensor.ORDERS.CUSTOM, indexFn: (row) => row[0] }, [[3, 1], [1, 9], [2, 4]]);
      assert.deepStrictEqual(custom.toNested(), [[1, 9], [2, 4], [3, 1]]);

      const unordered = new Tensor().init({ order: Tensor.ORDERS.UNORDERED, compare: (a, b) => b[0] - a[0] }, [[3, 1], [1, 9], [2, 4]]);
      assert.deepStrictEqual(unordered.toNested(), [[3, 1], [2, 4], [1, 9]]);
    });

    runner.test('default ORDERED leaves a nested array\'s row order unchanged', () =>
    {
      const t = new Tensor().init({}, [[1, 2], [3, 4]]);
      assert.deepStrictEqual(t.toNested(), [[1, 2], [3, 4]]);
    });

    runner.test('re-init reshapes/re-sources the same instance', () =>
    {
      const t = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      t.init({ shape: [4] }, [9, 8, 7, 6]);
      assert.deepStrictEqual(t.shape, [4]);
      assert.deepStrictEqual(t.toFlat().data, [9, 8, 7, 6]);
    });
  });

  runner.suite('Tensor: get/set/rank/size', () =>
  {
    runner.test('get/set round trip', () =>
    {
      const t = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      t.set(0, 1, 99);
      assert.strictEqual(t.get(0, 1), 99);
    });

    runner.test('get/set reject the wrong number of indices', () =>
    {
      const t = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      assert.throws(() => t.get(0), /expected 2 indices/);
      assert.throws(() => t.set(0, 1), /expected 2 indices/);
    });

    runner.test('rank/size', () =>
    {
      const t = new Tensor().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]);
      assert.strictEqual(t.rank(), 2);
      assert.strictEqual(t.size(), 6);
    });
  });

  runner.suite('Tensor: nesting views', () =>
  {
    runner.test('toVonNeumannNested builds hereditary containment, not sibling nesting', () =>
    {
      const t = new Tensor().init({ shape: [3] }, [1, 0, 1]);
      assert.deepStrictEqual(t.toVonNeumannNested(), [[[[], 1], 0], 1]);
    });

    runner.test('ordinal() matches the set-theoretic construction ord(n)=ord(n-1)++[ord(n-1)]', () =>
    {
      assert.deepStrictEqual(Tensor.ordinal(0), []);
      assert.deepStrictEqual(Tensor.ordinal(1), [[]]);
      assert.deepStrictEqual(Tensor.ordinal(3), [[], [[]], [[], [[]]]]);
    });

    runner.test('ordinal() rejects negative/non-integer n', () =>
    {
      assert.throws(() => Tensor.ordinal(-1), /non-negative integer/);
      assert.throws(() => Tensor.ordinal(1.5), /non-negative integer/);
    });
  });

  runner.suite('Tensor: iteration', () =>
  {
    runner.test('forEach visits every element with correct multi-indices, in order', () =>
    {
      const t = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      const seen = [];
      t.forEach((v, idx) => seen.push(idx.join(',') + ':' + v));
      assert.deepStrictEqual(seen, ['0,0:1', '0,1:2', '1,0:3', '1,1:4']);
    });

    runner.test('map returns a NEW same-shape tensor, original untouched', () =>
    {
      const t = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      const doubled = t.map((v) => v * 2);
      assert.deepStrictEqual(doubled.toFlat().data, [2, 4, 6, 8]);
      assert.deepStrictEqual(doubled.shape, [2, 2]);
      assert.deepStrictEqual(t.toFlat().data, [1, 2, 3, 4]);
      assert.notStrictEqual(doubled, t);
    });

    runner.test('entries() yields [indices, value] pairs', () =>
    {
      const t = new Tensor().init({ shape: [2] }, [5, 6]);
      assert.deepStrictEqual([...t.entries()], [[[0], 5], [[1], 6]]);
    });
  });

  runner.suite('Tensor: elementwise arithmetic', () =>
  {
    runner.test('add / subtract', () =>
    {
      const a = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      const b = new Tensor().init({ shape: [2, 2] }, [10, 20, 30, 40]);
      assert.deepStrictEqual(a.add(b).toFlat().data, [11, 22, 33, 44]);
      assert.deepStrictEqual(b.subtract(a).toFlat().data, [9, 18, 27, 36]);
    });

    runner.test('scale', () =>
    {
      assert.deepStrictEqual(new Tensor().init({ shape: [2] }, [1, 2]).scale(3).toFlat().data, [3, 6]);
    });

    runner.test('add/subtract throw on a shape mismatch', () =>
    {
      const a = new Tensor().init({ shape: [2] }, [1, 2]);
      const b = new Tensor().init({ shape: [3] }, [1, 2, 3]);
      assert.throws(() => a.add(b), /shape mismatch/);
      assert.throws(() => a.subtract(b), /shape mismatch/);
    });
  });

  runner.suite('Tensor: outer product / contraction', () =>
  {
    runner.test('outer product: shape concatenation and pairwise products', () =>
    {
      const v1 = new Tensor().init({ shape: [3] }, [1, 2, 3]);
      const v2 = new Tensor().init({ shape: [3] }, [4, 5, 6]);
      const o = v1.outer(v2);
      assert.deepStrictEqual(o.shape, [3, 3]);
      assert.strictEqual(o.get(0, 1), 5);
      assert.strictEqual(o.get(2, 2), 18);
    });

    runner.test('dot product (full rank-1 contraction) collapses to a rank-0 tensor', () =>
    {
      const v1 = new Tensor().init({ shape: [3] }, [1, 2, 3]);
      const v2 = new Tensor().init({ shape: [3] }, [4, 5, 6]);
      const dot = v1.contract(v2);
      assert.deepStrictEqual(dot.shape, []);
      assert.strictEqual(dot.toFlat().data[0], 32);
    });

    runner.test('matrix multiply via contract(other, 1, 0), checked against hand computation', () =>
    {
      const m1 = new Tensor().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]);
      const m2 = new Tensor().init({ shape: [3, 2] }, [7, 8, 9, 10, 11, 12]);
      const mm = m1.contract(m2, 1, 0);
      assert.deepStrictEqual(mm.shape, [2, 2]);
      assert.deepStrictEqual(mm.toFlat().data, [58, 64, 139, 154]);
    });

    runner.test('contract throws on a contracted-dimension mismatch', () =>
    {
      const a = new Tensor().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]);
      const b = new Tensor().init({ shape: [4, 2] }, [1, 2, 3, 4, 5, 6, 7, 8]);
      assert.throws(() => a.contract(b, 1, 0), /dimension mismatch/);
    });
  });

  runner.suite('Tensor: reshape / transpose', () =>
  {
    runner.test('reshape preserves flat data under a new shape', () =>
    {
      const t = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      const r = t.reshape([4]);
      assert.deepStrictEqual(r.shape, [4]);
      assert.deepStrictEqual(r.toFlat().data, [1, 2, 3, 4]);
    });

    runner.test('reshape throws on a total-size mismatch', () =>
    {
      assert.throws(() => new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]).reshape([3]), /does not match size/);
    });

    runner.test('transpose materializes the permuted data (row-major invariant holds)', () =>
    {
      const t = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      assert.deepStrictEqual(t.transpose([1, 0]).toNested(), [[1, 3], [2, 4]]);
    });

    runner.test('transpose defaults to reversing every axis', () =>
    {
      const t = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      assert.deepStrictEqual(t.transpose().toFlat().data, t.transpose([1, 0]).toFlat().data);
    });

    runner.test('transpose rejects a non-permutation', () =>
    {
      const t = new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      assert.throws(() => t.transpose([0, 0]), /must be a permutation/);
    });
  });

  runner.suite('Tensor: classification & algebra', () =>
  {
    runner.test('isScalar / isVector / isMatrix', () =>
    {
      assert.ok(new Tensor().init({ shape: [] }, [7]).isScalar());
      assert.ok(new Tensor().init({ shape: [3] }, [1, 2, 3]).isVector());
      assert.ok(new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]).isMatrix());
    });

    runner.test('isSquare true/false', () =>
    {
      assert.ok(new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]).isSquare());
      assert.ok(!new Tensor().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]).isSquare());
    });

    runner.test('trace of a square matrix', () =>
    {
      const m = new Tensor().init({ shape: [3, 3] }, [1, 2, 3, 2, 5, 6, 3, 6, 9]);
      assert.strictEqual(m.trace(), 15);
    });

    runner.test('trace/diagonal() throw on a non-square tensor (a real error — no diagonal exists)', () =>
    {
      const r = new Tensor().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]);
      assert.throws(() => r.trace(), /square rank-2/);
      assert.throws(() => r.diagonal(), /square rank-2/);
    });

    runner.test('diagonal() extraction', () =>
    {
      const m = new Tensor().init({ shape: [3, 3] }, [1, 2, 3, 2, 5, 6, 3, 6, 9]);
      assert.deepStrictEqual(m.diagonal(), [1, 5, 9]);
    });

    runner.test('isDiagonal true/false, false (not thrown) on non-square', () =>
    {
      assert.ok(new Tensor().init({ shape: [3, 3] }, [2, 0, 0, 0, 5, 0, 0, 0, 9]).isDiagonal());
      assert.ok(!new Tensor().init({ shape: [3, 3] }, [1, 2, 3, 2, 5, 6, 3, 6, 9]).isDiagonal());
      assert.strictEqual(new Tensor().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]).isDiagonal(), false);
    });

    runner.test('isSymmetric true/false, false (not thrown) on non-square', () =>
    {
      assert.ok(new Tensor().init({ shape: [2, 2] }, [1, 2, 2, 4]).isSymmetric());
      assert.ok(!new Tensor().init({ shape: [2, 2] }, [1, 2, 3, 4]).isSymmetric());
      assert.strictEqual(new Tensor().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]).isSymmetric(), false);
    });

    runner.test('isZero', () =>
    {
      assert.ok(new Tensor().init({ shape: [2, 2] }, [0, 0, 0, 0]).isZero());
      assert.ok(!new Tensor().init({ shape: [2, 2] }, [0, 0, 0, 1]).isZero());
    });

    runner.test('report() includes matrix-only fields only at rank 2, symmetric/diagonal/trace only when square', () =>
    {
      const v = new Tensor().init({ shape: [3] }, [1, 2, 3]);
      assert.strictEqual(v.report().square, undefined);

      const rect = new Tensor().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]);
      const rr = rect.report();
      assert.strictEqual(rr.square, false);
      assert.strictEqual(rr.symmetric, undefined);

      const m = new Tensor().init({ shape: [2, 2] }, [2, 0, 0, 3]);
      const rm = m.report();
      assert.strictEqual(rm.square, true);
      assert.strictEqual(rm.diagonal, true);
      assert.strictEqual(rm.trace, 5);
    });
  });

  runner.suite('Tensor: complex dtype', () =>
  {
    runner.test('extraction coerces number / {re,im} / Complex uniformly', () =>
    {
      const t = new Tensor().init(
        { shape: [3], dtype: Tensor.DTYPES.COMPLEX },
        [3, { re: 1, im: 2 }, new Complex().init(0, -1)]
      );
      const data = t.toFlat().data;
      assert.ok(data[0] instanceof Complex);
      assert.strictEqual(data[0].re, 3);
      assert.strictEqual(data[0].im, 0);
      assert.strictEqual(data[1].re, 1);
      assert.strictEqual(data[1].im, 2);
      assert.strictEqual(data[2].im, -1);
    });

    runner.test('trace sums Complex values: (1+1i)+(2-1i) = 3', () =>
    {
      const m = new Tensor().init(
        { shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX },
        [{ re: 1, im: 1 }, 0, 0, { re: 2, im: -1 }]
      );
      const tr = m.trace();
      assert.strictEqual(tr.re, 3);
      assert.strictEqual(tr.im, 0);
    });

    runner.test('isDiagonal treats a bare 0 as a zero Complex', () =>
    {
      const m = new Tensor().init(
        { shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX },
        [{ re: 1, im: 1 }, 0, 0, { re: 2, im: -1 }]
      );
      assert.ok(m.isDiagonal());
    });

    runner.test('outer/contract promote to complex dtype when either operand is complex', () =>
    {
      const real = new Tensor().init({ shape: [2] }, [1, 2]);
      const cplx = new Tensor().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 1, im: 1 }, { re: 0, im: 1 }]);
      assert.strictEqual(real.outer(cplx).dtype, Tensor.DTYPES.COMPLEX);
      assert.strictEqual(real.contract(cplx).dtype, Tensor.DTYPES.COMPLEX);
    });
  });

  runner.suite('Tensor: deterministic size estimates', () =>
  {
    runner.test('bytesPerElement: 8 real, 16 complex', () =>
    {
      assert.strictEqual(new Tensor().init({ shape: [2] }, [1, 2]).bytesPerElement(), 8);
      assert.strictEqual(new Tensor().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [1, 2]).bytesPerElement(), 16);
    });

    runner.test('denseSizeMB is deterministic (identical across repeated calls)', () =>
    {
      const m = new Tensor().init({ shape: [3, 3] }, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      assert.strictEqual(m.denseSizeMB(), m.denseSizeMB());
    });

    runner.test('a 1000x1000 real matrix: dense/diagonal ratio is exactly n', () =>
    {
      const dense = Tensor.estimateDenseSizeMB([1000, 1000], Tensor.DTYPES.REAL, Infinity);
      const diagMB = (1000 * 8) / (1024 * 1024);
      assert.ok(Math.abs(dense / diagMB - 1000) < 1e-9);
    });

    runner.test('diagonalElementCount uses min(rows,cols) for a rectangular matrix', () =>
    {
      const r = new Tensor().init({ shape: [2, 5] }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      assert.strictEqual(r.diagonalElementCount(), 2);
    });

    runner.test('diagonalElementCount/diagonalSizeMB throw on a non-matrix', () =>
    {
      const v = new Tensor().init({ shape: [5] }, [1, 2, 3, 4, 5]);
      assert.throws(() => v.diagonalElementCount(), /rank-2 tensor/);
      assert.throws(() => v.diagonalSizeMB(), /rank-2 tensor/);
    });

    runner.test('static estimateDenseSizeMB: default 2048 MB guard rejects an oversized shape', () =>
    {
      assert.throws(
        () => Tensor.estimateDenseSizeMB([65536, 65536], Tensor.DTYPES.COMPLEX),
        /exceeding the 2048 MB limit/
      );
    });

    runner.test('static estimateDenseSizeMB: an explicit larger maxMB is honored', () =>
    {
      const mb = Tensor.estimateDenseSizeMB([65536, 65536], Tensor.DTYPES.COMPLEX, 100000);
      assert.ok(Math.abs(mb - 65536) < 1e-6);
    });

    runner.test('static estimateDenseSizeMB: Infinity bypasses the guard entirely', () =>
    {
      assert.doesNotThrow(() => Tensor.estimateDenseSizeMB([65536, 65536], Tensor.DTYPES.COMPLEX, Infinity));
    });

    runner.test('instance denseSizeMB() never throws, even on an already-materialized huge-shape tensor', () =>
    {
      const t = new Tensor();
      t.dtype = Tensor.DTYPES.REAL;
      t.shape = [1000, 1000];
      t._flat = [];
      assert.doesNotThrow(() => t.denseSizeMB());
    });

    runner.test('MAX_DENSE_MB_DEFAULT is 2048', () =>
    {
      assert.strictEqual(Tensor.MAX_DENSE_MB_DEFAULT, 2048);
    });
  });
}

if (require.main === module)
{
  const TestRunner = require('./TestRunner.js');
  const runner = new TestRunner();
  register(runner);
  const result = runner.run();
  process.exitCode = result.failed > 0 ? 1 : 0;
}

module.exports = register;
