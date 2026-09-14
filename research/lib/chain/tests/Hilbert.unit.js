/**
 * @file research/lib/chain/tests/Hilbert.unit.js
 * @author Will Fobbs
 * @description Comprehensive Hilbert coverage: sesquilinear inner product
 *              (real and complex dtype), norm/normalize/isNormalized,
 *              isOrthogonalTo, distance, projectOnto, rank/dimension
 *              validation, per-instance mixin toggling, and the
 *              ExtendX-injected-trailing-`next`-argument regression that
 *              silently broke isNormalized()/isOrthogonalTo()'s optional
 *              epsilon parameter.
 */
const assert = require('assert');
const Tensor = require('../Tensor.js');
const Complex = require('../Complex.js');
const Hilbert = require('../Hilbert.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Hilbert', () =>
  {
    runner.test('real dtype: innerProduct reduces to the ordinary dot product', () =>
    {
      const v1 = new Hilbert().init({ shape: [3] }, [1, 2, 3]);
      const v2 = new Hilbert().init({ shape: [3] }, [4, 5, 6]);
      assert.strictEqual(v1.innerProduct(v2), 32);
    });

    runner.test('norm: ||(3,4)|| = 5', () =>
    {
      const v = new Hilbert().init({ shape: [2] }, [3, 4]);
      assert.strictEqual(v.norm(), 5);
    });

    runner.test('complex dtype: orthonormal basis |0>,|1> have unit norm and zero inner product', () =>
    {
      const ket0 = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [1, 0]);
      const ket1 = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [0, 1]);
      assert.strictEqual(ket0.norm(), 1);
      assert.strictEqual(ket1.norm(), 1);
      const ip = ket0.innerProduct(ket1);
      assert.strictEqual(ip.re, 0);
      assert.strictEqual(ip.im, 0);
    });

    runner.test('sesquilinearity: <psi,phi> = conj(<phi,psi>) for genuinely complex amplitudes', () =>
    {
      // Chosen so <psi,phi> is genuinely nonzero (3-1i, verified by hand) —
      // an example landing on exactly (0,0) would compare a computed -0
      // (from negating 0 in conjugate()) against a literal 0 via
      // assert.strictEqual's Object.is semantics, where Object.is(0,-0)
      // is false even though 0 === -0 is true. Not a Hilbert bug, just a
      // reason to pick a non-degenerate example here.
      const psi = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 1, im: 1 }, { re: 2, im: 0 }]);
      const phi = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 3, im: 0 }, { re: 0, im: 1 }]);
      const ip1 = psi.innerProduct(phi);
      const ip2 = phi.innerProduct(psi);
      assert.strictEqual(ip1.re, 3);
      assert.strictEqual(ip1.im, -1);
      assert.strictEqual(ip1.re, ip2.conjugate().re);
      assert.strictEqual(ip1.im, ip2.conjugate().im);
    });

    runner.test('innerProduct requires two rank-1 tensors', () =>
    {
      const v = new Hilbert().init({ shape: [3] }, [1, 2, 3]);
      const mat = new Hilbert().init({ shape: [2, 2] }, [1, 2, 3, 4]);
      assert.throws(() => mat.innerProduct(v), /rank-1 tensor/);
    });

    runner.test('innerProduct requires matching dimension', () =>
    {
      const v3 = new Hilbert().init({ shape: [3] }, [1, 2, 3]);
      const v2 = new Hilbert().init({ shape: [2] }, [1, 2]);
      assert.throws(() => v3.innerProduct(v2), /dimension mismatch/);
    });

    runner.test('normalize produces a unit-norm Hilbert instance', () =>
    {
      const raw = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 3, im: 0 }, { re: 4, im: 0 }]);
      const unit = raw.normalize();
      assert.ok(unit instanceof Hilbert);
      assert.strictEqual(unit.norm(), 1);
    });

    runner.test('normalize throws on a zero vector', () =>
    {
      assert.throws(() => new Hilbert().init({ shape: [2] }, [0, 0]).normalize(), /zero vector/);
    });

    runner.test('isNormalized: true after normalize(), false before', () =>
    {
      const raw = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 3, im: 0 }, { re: 4, im: 0 }]);
      assert.strictEqual(raw.isNormalized(), false);
      assert.strictEqual(raw.normalize().isNormalized(), true);
    });

    runner.test('isNormalized: called with ZERO arguments must still apply the epsilon default correctly', () =>
    {
      // Regression: ExtendX's dispatcher appends its own `next` callback as
      // a trailing argument to every dispatched call, so a naive
      // `epsilon === undefined` check sees the injected function instead
      // and silently breaks. This must resolve the same as an explicit
      // default epsilon would.
      const unit = new Hilbert().init({ shape: [2] }, [1, 0]);
      assert.strictEqual(unit.isNormalized(), true);
      assert.strictEqual(unit.isNormalized(1e-9), true);
    });

    runner.test('isOrthogonalTo: orthonormal basis vectors are orthogonal, a vector is never orthogonal to itself', () =>
    {
      const ket0 = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [1, 0]);
      const ket1 = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [0, 1]);
      assert.strictEqual(ket0.isOrthogonalTo(ket1), true);
      assert.strictEqual(ket0.isOrthogonalTo(ket0), false);
    });

    runner.test('isOrthogonalTo: called with only ONE argument must still apply the epsilon default correctly', () =>
    {
      // Same injected-`next` hazard as isNormalized() above, for
      // isOrthogonalTo's SECOND (trailing) parameter specifically.
      const ket0 = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [1, 0]);
      const ket1 = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [0, 1]);
      assert.strictEqual(ket0.isOrthogonalTo(ket1), true);
      assert.strictEqual(ket0.isOrthogonalTo(ket1, 1e-9), true);
    });

    runner.test('distance: ||(0,0) - (3,4)|| = 5', () =>
    {
      const a = new Hilbert().init({ shape: [2] }, [0, 0]);
      const b = new Hilbert().init({ shape: [2] }, [3, 4]);
      assert.strictEqual(a.distance(b), 5);
    });

    runner.test('distance promotes to complex dtype when one operand is real and the other complex', () =>
    {
      const real = new Hilbert().init({ shape: [2] }, [0, 0]);
      const cplx = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 3, im: 0 }, { re: 4, im: 0 }]);
      assert.strictEqual(real.distance(cplx), 5); // must not throw / produce NaN
    });

    runner.test('projectOnto: projecting (1,1) onto the |0> basis vector isolates its x-component', () =>
    {
      const ket0 = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [1, 0]);
      const state = new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [{ re: 1, im: 0 }, { re: 1, im: 0 }]);
      const proj = state.projectOnto(ket0);
      const data = proj.toFlat().data;
      assert.strictEqual(data[0].re, 1);
      assert.strictEqual(data[1].re, 0);
    });

    runner.test('projectOnto gives the same result for a basis vector and any positive scaling of it', () =>
    {
      // The ⟨e,e⟩ denominator is exactly what makes projectOnto work for a
      // non-normalized basisVector: scaling e by k scales both the
      // numerator ⟨e,ψ⟩ (by k) and the denominator ⟨e,e⟩ (by k^2), so the
      // coefficient shrinks by 1/k while basisVector.scale(coeff) grows by
      // k — they cancel, and the returned vector is identical either way.
      const psi = new Hilbert().init({ shape: [2] }, [2, 3]);
      const basis = new Hilbert().init({ shape: [2] }, [1, 0]);
      const scaledBasis = new Hilbert().init({ shape: [2] }, [5, 0]);
      assert.deepStrictEqual(psi.projectOnto(basis).toFlat().data, psi.projectOnto(scaledBasis).toFlat().data);
      assert.deepStrictEqual(psi.projectOnto(basis).toFlat().data, [2, 0]);
    });

    runner.test('projectOnto throws on a zero basis vector', () =>
    {
      const ket0 = new Hilbert().init({ shape: [2] }, [1, 0]);
      const zero = new Hilbert().init({ shape: [2] }, [0, 0]);
      assert.throws(() => ket0.projectOnto(zero), /zero vector/);
    });

    runner.test('each operation is independently toggleable per instance', () =>
    {
      const a = new Hilbert().init({ shape: [2] }, [3, 4]);
      const b = new Hilbert().init({ shape: [2] }, [3, 4]);
      b.disableLayer(Hilbert.OPERATIONS.norm);
      assert.strictEqual(b.norm(), undefined);
      assert.strictEqual(a.norm(), 5, 'disabling on one instance must not affect another');
    });

    runner.test('values getter returns the flat coordinate view', () =>
    {
      const v = new Hilbert().init({ shape: [3] }, [1, 2, 3]);
      assert.deepStrictEqual(v.values, { data: [1, 2, 3], shape: [3], strides: [1] });
    });

    runner.test('base Tensor algebra (rank/isVector/scale) still works through Hilbert', () =>
    {
      const v = new Hilbert().init({ shape: [3] }, [1, 2, 3]);
      assert.strictEqual(v.rank(), 1);
      assert.ok(v.isVector());
      const scaled = v.scale(2);
      assert.ok(scaled instanceof Hilbert);
      assert.strictEqual(scaled.norm(), v.scale(2).norm());
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
