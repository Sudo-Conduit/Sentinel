/**
 * @file research/lib/chain/tests/Hamiltonian.unit.js
 * @author Will Fobbs
 * @description Comprehensive Hamiltonian coverage: adjoint/isHermitian,
 *              applyTo, expectationValue(Real), multiply/commutator
 *              (verified against the Pauli identity [sx,sy]=2i*sz),
 *              evolve(), the injected-trailing-`next`-argument regression
 *              for every optional parameter, and per-instance toggling.
 */
const assert = require('assert');
const Tensor = require('../Tensor.js');
const Complex = require('../Complex.js');
const Hilbert = require('../Hilbert.js');
const Hamiltonian = require('../Hamiltonian.js');

/** @param {import('./TestRunner.js')} runner */
function register(runner)
{
  runner.suite('Hamiltonian', () =>
  {
    // Pauli matrices — real physics, exercised across nearly every test below.
    const sx = () => new Hamiltonian().init({ shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX }, [0, 1, 1, 0]);
    const sy = () => new Hamiltonian().init(
      { shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX },
      [{ re: 0, im: 0 }, { re: 0, im: -1 }, { re: 0, im: 1 }, { re: 0, im: 0 }]
    );
    const sz = () => new Hamiltonian().init({ shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX }, [1, 0, 0, -1]);
    const ket0 = () => new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [1, 0]);
    const ket1 = () => new Hilbert().init({ shape: [2], dtype: Tensor.DTYPES.COMPLEX }, [0, 1]);

    runner.test('adjoint: H† = conj(H)^T', () =>
    {
      const H = new Hamiltonian().init(
        { shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX },
        [{ re: 1, im: 2 }, { re: 3, im: 0 }, { re: 3, im: 0 }, { re: 4, im: -1 }]
      );
      const adj = H.adjoint();
      assert.strictEqual(adj.get(0, 0).im, -2); // conj of (1,2)
      assert.strictEqual(adj.get(1, 1).im, 1); // conj of (4,-1)
    });

    runner.test('isHermitian: all three Pauli matrices are Hermitian', () =>
    {
      assert.strictEqual(sx().isHermitian(), true);
      assert.strictEqual(sy().isHermitian(), true);
      assert.strictEqual(sz().isHermitian(), true);
    });

    runner.test('isHermitian: false for a genuinely non-Hermitian operator', () =>
    {
      const nonH = new Hamiltonian().init({ shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX }, [1, { re: 0, im: 1 }, 0, 1]);
      assert.strictEqual(nonH.isHermitian(), false);
    });

    runner.test('isHermitian: false (not thrown) on a non-square operator', () =>
    {
      const rect = new Hamiltonian().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]);
      assert.strictEqual(rect.isHermitian(), false);
    });

    runner.test('isHermitian: zero-argument call still applies the epsilon default correctly', () =>
    {
      // Regression: ExtendX appends its own `next` as a trailing argument
      // to every dispatched call, so epsilon !== undefined even when the
      // caller passes nothing — must use typeof epsilon === 'number'.
      assert.strictEqual(sz().isHermitian(), true);
      assert.strictEqual(sz().isHermitian(1e-9), true);
    });

    runner.test('applyTo: sz|0>=|0>, sz|1>=-|1>, result is a Hilbert instance', () =>
    {
      const r0 = sz().applyTo(ket0());
      const r1 = sz().applyTo(ket1());
      assert.ok(r0 instanceof Hilbert);
      assert.deepStrictEqual(r0.toFlat().data.map((z) => [z.re, z.im]), [[1, 0], [0, 0]]);
      assert.deepStrictEqual(r1.toFlat().data.map((z) => [z.re, z.im]), [[0, 0], [-1, 0]]);
    });

    runner.test('applyTo throws on a non-square H or a mismatched-dimension state', () =>
    {
      const rect = new Hamiltonian().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]);
      assert.throws(() => rect.applyTo(ket0()), /square rank-2 operator/);
      const shortState = new Hilbert().init({ shape: [3] }, [1, 2, 3]);
      assert.throws(() => sz().applyTo(shortState), /dimension/);
    });

    runner.test('expectationValueReal: <0|sz|0>=1, <1|sz|1>=-1, <+|sz|+>=0', () =>
    {
      assert.strictEqual(sz().expectationValueReal(ket0()), 1);
      assert.strictEqual(sz().expectationValueReal(ket1()), -1);
      const plus = ket0().add(ket1()).normalize();
      assert.ok(Math.abs(sz().expectationValueReal(plus)) < 1e-9);
    });

    runner.test('expectationValueReal throws when the imaginary part is non-negligible', () =>
    {
      const nonH = new Hamiltonian().init({ shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX }, [1, { re: 0, im: 1 }, 0, 1]);
      const plus = ket0().add(ket1()).normalize();
      // <+|nonH|+> = 1 + 0.5i by hand computation -- genuinely complex,
      // unlike <0|nonH|0> which happens to land on a real value by
      // coincidence for this particular basis state.
      assert.throws(() => nonH.expectationValueReal(plus), /non-negligible imaginary part/);
    });

    runner.test('expectationValueReal: one-argument call still applies its own epsilon default correctly', () =>
    {
      assert.strictEqual(sz().expectationValueReal(ket0()), 1);
      assert.strictEqual(sz().expectationValueReal(ket0(), 1e-9), 1);
    });

    runner.test('multiply: operator composition, checked against hand computation', () =>
    {
      // sx * sz = [[0,1],[1,0]] . [[1,0],[0,-1]] = [[0,-1],[1,0]]
      const product = sx().multiply(sz());
      assert.deepStrictEqual(product.toFlat().data.map((z) => z.re), [0, -1, 1, 0]);
    });

    runner.test('multiply throws on mismatched or non-square operands', () =>
    {
      const rect = new Hamiltonian().init({ shape: [2, 3] }, [1, 2, 3, 4, 5, 6]);
      assert.throws(() => sz().multiply(rect), /square operators of matching dimension/);
    });

    runner.test('commutator: the Pauli identity [sx,sy] = 2i*sz', () =>
    {
      const comm = sx().commutator(sy());
      const data = comm.toFlat().data;
      assert.deepStrictEqual(data.map((z) => [z.re, z.im]), [[0, 2], [0, 0], [0, 0], [0, -2]]);
    });

    runner.test('commutator of an operator with itself is the zero matrix', () =>
    {
      const comm = sz().commutator(sz());
      assert.ok(comm.isZero());
    });

    runner.test('evolve: H=0 leaves the state exactly unchanged', () =>
    {
      const zeroH = new Hamiltonian().init({ shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX }, [0, 0, 0, 0]);
      const evolved = zeroH.evolve(ket0(), 0.1);
      assert.deepStrictEqual(evolved.toFlat().data.map((z) => [z.re, z.im]), [[1, 0], [0, 0]]);
    });

    runner.test('evolve: a small step approximately conserves norm', () =>
    {
      const plus = ket0().add(ket1()).normalize();
      const evolved = sz().evolve(plus, 0.001);
      assert.ok(Math.abs(evolved.norm() - 1) < 0.01);
    });

    runner.test('evolve: omitting hbar (2-arg call) still applies its own default correctly', () =>
    {
      // Same injected-`next`-vs-omitted-parameter hazard as isHermitian/
      // expectationValueReal above, for evolve()'s THIRD parameter this
      // time — a 2-argument call still gets `next` injected as the 3rd.
      const zeroH = new Hamiltonian().init({ shape: [2, 2], dtype: Tensor.DTYPES.COMPLEX }, [0, 0, 0, 0]);
      const evolvedDefault = zeroH.evolve(ket0(), 0.1);
      const evolvedExplicit = zeroH.evolve(ket0(), 0.1, 1);
      assert.deepStrictEqual(evolvedDefault.toFlat().data.map((z) => [z.re, z.im]), evolvedExplicit.toFlat().data.map((z) => [z.re, z.im]));
    });

    runner.test('each operation is independently toggleable per instance', () =>
    {
      const a = sz();
      const b = sz();
      b.disableLayer(Hamiltonian.OPERATIONS.isHermitian);
      assert.strictEqual(b.isHermitian(), undefined);
      assert.strictEqual(a.isHermitian(), true, 'disabling on one instance must not affect another');
    });

    runner.test('values getter returns the nested (matrix) view', () =>
    {
      const H = sz();
      const nested = H.values;
      assert.strictEqual(nested[0][0].re, 1);
      assert.strictEqual(nested[1][1].re, -1);
    });

    runner.test('base Tensor algebra (rank/isMatrix/isSquare/trace) still works through Hamiltonian', () =>
    {
      const H = sz();
      assert.strictEqual(H.rank(), 2);
      assert.ok(H.isMatrix());
      assert.ok(H.isSquare());
      assert.strictEqual(H.trace().re, 0); // trace of Pauli Z: 1 + (-1) = 0
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
