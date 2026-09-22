// Head to head: pure JS, BLAS, WASM -- all computing the same routed
// diagonal on the same data, every result verified against the same
// reference before it is timed.
//
// Pure JS is the baseline worth having: it is what the stack costs with no
// FFI, no WASM, no native library -- just the language. Everything else is
// measured as a multiple of it.
//
// JS gets its best reasonable form, not a strawman: both loop orders are
// run and the faster is reported, the same courtesy the WASM side got.
//
// BLAS appears twice on purpose. "BLAS dense" is the honest cost of a naive
// MoE -- every expert against every token, then select -- which is what the
// routed diagonal is an alternative TO. "BLAS DMM" is BLAS used well, one
// gather + one GEMM per expert. Conjecture (a) is the gap between them.
//
// Metric throughout: dense-equivalent GFLOPS = 2*B*E*K*N / time, the
// arithmetic a dense MoE must perform to produce this answer.
//
//   node headtohead.mjs [--reps 3]

import fs from 'fs';
import koffi from 'koffi';

const BLAS_SO = process.env.BLAS_SO
  || '/usr/local/lib/python3.11/dist-packages/numpy.libs/libscipy_openblas64_-32a4b2a6.so';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i === -1 ? d : Number(process.argv[i + 1]); };
const REPS = arg('reps', 3);

// ── BLAS ────────────────────────────────────────────────────────────────
const lib = koffi.load(BLAS_SO);
let sgemm = null;
for (const [s, w] of [['scipy_cblas_sgemm64_', 'int64'], ['cblas_sgemm64_', 'int64'],
                      ['cblas_sgemm', 'int']]) {
  try { sgemm = lib.func(`void ${s}(${w},${w},${w},${w},${w},${w},float,float*,${w},`
      + `float*,${w},float,_Inout_ float*,${w})`); break; } catch { /* next */ }
}
for (const n of ['scipy_openblas_set_num_threads64_', 'openblas_set_num_threads64_',
                 'openblas_set_num_threads']) { try { lib.func(`void ${n}(int)`)(1); break; } catch {} }
const gemm = (m, n, k, A, lda, Bm, ldb, C, ldc) =>
  sgemm(101, 111, 111, m, n, k, 1.0, A, lda, Bm, ldb, 0.0, C, ldc);

// ── WASM variants; best per shape is reported and named ────────────────
const VARIANTS = ['f_1_8.wasm', 'f_2_2.wasm', 'av4.wasm', 'dmm.wasm']
  .filter(f => fs.existsSync(new URL('./' + f, import.meta.url)));

function wasmRun(file, B, K, N, E, X, W, route, reps) {
  const inst = new WebAssembly.Instance(
    new WebAssembly.Module(fs.readFileSync(new URL('./' + file, import.meta.url))), {});
  const mem = inst.exports.memory, al = o => (o + 63) & ~63;
  let off = al(inst.exports.__heap_base.value);
  const hdr = off; off += 64;
  const xOff = off; off = al(off + B * K * 4);
  const wOff = off; off = al(off + E * K * N * 4);
  const rtOff = off; off = al(off + B * 4);
  const yOff = off; off = al(off + B * N * 4);
  const sOff = off; off = al(off + B * N * 4);
  if (mem.buffer.byteLength < off) return null;
  const f32 = new Float32Array(mem.buffer), i32 = new Int32Array(mem.buffer);
  f32.set(X, xOff / 4);
  let wc = wOff / 4; for (const w of W) { f32.set(w, wc); wc += w.length; }
  i32.set(route, rtOff / 4);
  i32.set([B, K, N, E, xOff, wOff, rtOff, yOff, sOff], hdr / 4);
  const one = () => { const s = process.hrtime.bigint();
    if (inst.exports.run(hdr, 36) !== B) throw new Error('rc');
    return Number(process.hrtime.bigint() - s) / 1e9; };
  one(); const ts = []; for (let r = 0; r < reps; r++) ts.push(one());
  ts.sort((a, b) => a - b);
  return { t: ts[Math.floor(reps / 2)], y: new Float32Array(mem.buffer, yOff, B * N).slice() };
}

// ── timing / error ──────────────────────────────────────────────────────
function med(fn, reps) { fn(); const ts = [];
  for (let r = 0; r < reps; r++) { const s = process.hrtime.bigint(); fn();
    ts.push(Number(process.hrtime.bigint() - s) / 1e9); }
  ts.sort((a, b) => a - b); return ts[Math.floor(reps / 2)]; }
function err(a, b) { let m = 0, s = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d; const v = Math.abs(b[i]); if (v > s) s = v; }
  return m / (s || 1); }

function measure(B, K, N, E) {
  const X = new Float32Array(B * K);
  for (let i = 0; i < X.length; i++) X[i] = ((i * 37) % 1000) / 1000 - 0.5;
  const W = [];
  for (let e = 0; e < E; e++) { const w = new Float32Array(K * N);
    for (let i = 0; i < w.length; i++) w[i] = ((i + e * 7919) % 997) / 997 - 0.5; W.push(w); }
  const route = new Int32Array(B);
  for (let b = 0; b < B; b++) route[b] = (b * 31 + 7) % E;
  const rowsOf = []; { const c = new Int32Array(E);
    for (let b = 0; b < B; b++) c[route[b]]++;
    for (let e = 0; e < E; e++) rowsOf.push(new Int32Array(c[e]));
    const f = new Int32Array(E);
    for (let b = 0; b < B; b++) rowsOf[route[b]][f[route[b]]++] = b; }

  // ── pure JS, both loop orders; the faster one is "pure JS" ───────────
  const Yjs = new Float32Array(B * N);
  const jsKInner = () => {                       // j outer, k inner
    for (let e = 0; e < E; e++) { const w = W[e];
      for (const b of rowsOf[e]) { const xo = b * K, yo = b * N;
        for (let j = 0; j < N; j++) { let a = 0;
          for (let k = 0; k < K; k++) a += X[xo + k] * w[k * N + j];
          Yjs[yo + j] = a; } } } };
  const jsKOuter = () => {                       // k outer, j inner
    for (let e = 0; e < E; e++) { const w = W[e];
      for (const b of rowsOf[e]) { const xo = b * K, yo = b * N;
        Yjs.fill(0, yo, yo + N);
        for (let k = 0; k < K; k++) { const a = X[xo + k], wo = k * N;
          for (let j = 0; j < N; j++) Yjs[yo + j] += a * w[wo + j]; } } } };
  const tKI = med(jsKInner, REPS), tKO = med(jsKOuter, REPS);
  const tJs = Math.min(tKI, tKO);
  (tKI < tKO ? jsKInner : jsKOuter)();
  const ref = Yjs.slice();                       // JS is the reference

  // ── BLAS dense: every expert for every row, then select ──────────────
  const Yd = new Float32Array(B * N), sc = new Float32Array(B * N);
  const tDense = med(() => { for (let e = 0; e < E; e++) {
      gemm(B, N, K, X, K, W[e], N, sc, N);
      for (let b = 0; b < B; b++) if (route[b] === e)
        Yd.set(sc.subarray(b * N, b * N + N), b * N); } }, REPS);

  // ── BLAS DMM: gather, one GEMM per expert, scatter ───────────────────
  const Yb = new Float32Array(B * N);
  const gath = new Float32Array(B * K), out = new Float32Array(B * N);
  const tBlas = med(() => { let o = 0;
    for (let e = 0; e < E; e++) { const rs = rowsOf[e]; if (!rs.length) continue;
      for (let r = 0; r < rs.length; r++)
        gath.set(X.subarray(rs[r] * K, rs[r] * K + K), (o + r) * K);
      const Ce = out.subarray(o * N, (o + rs.length) * N);
      gemm(rs.length, N, K, gath.subarray(o * K, (o + rs.length) * K), K, W[e], N, Ce, N);
      for (let r = 0; r < rs.length; r++)
        Yb.set(Ce.subarray(r * N, r * N + N), rs[r] * N);
      o += rs.length; } }, REPS);

  // ── WASM: best variant ───────────────────────────────────────────────
  let best = null;
  for (const v of VARIANTS) {
    const r = wasmRun(v, B, K, N, E, X, W, route, REPS);
    if (r && (!best || r.t < best.t)) best = { ...r, name: v.replace('.wasm', '') };
  }

  const F = 2 * B * E * K * N, gf = t => F / t / 1e9;
  return {
    B, K, N, E,
    js:    { gf: gf(tJs), form: tKI < tKO ? 'k-inner' : 'k-outer' },
    dense: { gf: gf(tDense), err: err(Yd, ref) },
    blas:  { gf: gf(tBlas), err: err(Yb, ref) },
    wasm:  { gf: gf(best.t), err: err(best.y, ref), name: best.name },
  };
}

const SHAPES = [[720,512,512,8],[720,512,512,64],[720,256,256,64],[2048,512,512,8]];
const rows = [];
for (const [B,K,N,E] of SHAPES) { rows.push(measure(B,K,N,E));
  process.stderr.write(`  measured B=${B} K=N=${K} E=${E}\n`); }

const head = ['B','K=N','E','pure JS','BLAS dense','BLAS DMM','WASM DMM','best wasm',
              'BLAS/JS','WASM/JS','DMM/dense'];
const body = rows.map(r => [
  String(r.B), String(r.K), String(r.E),
  r.js.gf.toFixed(1), r.dense.gf.toFixed(1), r.blas.gf.toFixed(1), r.wasm.gf.toFixed(1),
  r.wasm.name,
  (r.blas.gf / r.js.gf).toFixed(0) + 'x',
  (r.wasm.gf / r.js.gf).toFixed(0) + 'x',
  (r.blas.gf / r.dense.gf).toFixed(1) + 'x',
]);
const w = head.map((_, c) => Math.max(head[c].length, ...body.map(r => r[c].length)));
const fmt = r => '| ' + r.map((s, c) => s.padEnd(w[c])).join(' | ') + ' |';
console.log('\n' + fmt(head));
console.log(fmt(head.map((_, c) => '-'.repeat(w[c]))));
for (const r of body) console.log(fmt(r));

console.log('\ndense-equivalent GFLOPS = 2*B*E*K*N / time. Pure JS is the baseline.');
console.log('JS loop form chosen per shape: ' + rows.map(r => r.js.form).join(', '));
const worst = Math.max(...rows.flatMap(r => [r.dense.err, r.blas.err, r.wasm.err]));
console.log(`all paths verified against the pure-JS result, worst error ${worst.toExponential(1)}`);
