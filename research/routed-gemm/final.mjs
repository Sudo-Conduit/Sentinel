// final.mjs -- the CPU-side table, measured once per process.
//
// Everything in this directory that was ever reported as a delta under ~15%
// turned out to be noise: this box moves +/-8% run to run (762-894 over eight
// invocations of ONE binary, each already a median of five, load average
// 0.17). So a single invocation of this file is not a result. It emits JSON;
// `finaltable.mjs` runs it seven times and takes the per-cell median. That is
// the only form of this table worth quoting.
//
//   node final.mjs --shape 720,512,512,8 --json
//   node finaltable.mjs --runs 7            <- what you actually want
//
// Columns, and why each one is here:
//
//   pure JS      what the stack costs with no FFI, no WASM, no native
//                library. Both loop orders are run and the faster reported,
//                the same courtesy every other path gets.
//   BLAS dense   the honest cost of a naive MoE: every expert against every
//                token, then select. This is what the routed diagonal is an
//                alternative TO, so conjecture (a) is this column against
//                the next one.
//   BLAS DMM     BLAS used well -- gather, one GEMM per expert, scatter.
//   WASM fp32    best zero-import kernel, named.
//   WASM int8    same kernel with int8 weights and one fp32 scale per
//                expert, which is a footprint change and not a numerics
//                claim -- the reference dequantises the SAME values, so the
//                error column measures arithmetic, not quantisation.
//   real GF      2*B*K*N/t, the arithmetic actually performed. The
//                dense-equivalent columns are 2*B*E*K*N/t, what a dense MoE
//                must perform to produce the same answer.
//   % ceiling    real GF against the measured f32x4 single-core ceiling from
//                peak.wasm, measured in this same process.

import fs from 'fs';
import koffi from 'koffi';

const here = f => new URL('./' + f, import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i === -1 ? d : process.argv[i + 1]; };
const REPS = Number(arg('reps', 5));
const JSREPS = Number(arg('jsreps', 1));   // JS is the most stable path here

// ── the ceiling, measured in this process, swept ────────────────────────
//
// peak.wasm at its old fixed ACC=8 reported 25-28 GF and kernels came in at
// 121% of it. A ceiling a kernel exceeds is not a ceiling. The probe has a
// two-op recurrence (wasm128 has no FMA, so it must write `a = a + a*m`)
// and eight chains did not cover it; sweeping ACC shows the probe saturating
// at 12 chains and 35.0 GF, which is 40% above the number every "% of
// ceiling" in this directory was previously divided by.
function ceiling() {
  const INNER = 1000, LANES = 4, iters = 20000;
  const files = fs.readdirSync(new URL('.', import.meta.url))
    .filter(f => /^peak_\d+\.wasm$/.test(f));
  const set = files.length ? files : ['peak.wasm'];
  let best = 0, at = null;
  for (const f of set) {
    const acc = Number((f.match(/peak_(\d+)/) || [0, 8])[1]);
    const inst = new WebAssembly.Instance(
      new WebAssembly.Module(fs.readFileSync(here(f))), {});
    inst.exports.peak(200);
    const ts = [];
    for (let r = 0; r < 3; r++) {
      const s = process.hrtime.bigint(); inst.exports.peak(iters);
      ts.push(Number(process.hrtime.bigint() - s) / 1e9);
    }
    ts.sort((a, b) => a - b);
    const gf = 2 * acc * INNER * LANES * iters / ts[0] / 1e9;
    if (gf > best) { best = gf; at = acc; }
  }
  return { gf: best, acc: at };
}

// ── BLAS, dlopen'd: whichever library is already on the machine ─────────
const BLAS_SO = process.env.BLAS_SO
  || '/usr/local/lib/python3.11/dist-packages/numpy.libs/libscipy_openblas64_-32a4b2a6.so';
const lib = koffi.load(BLAS_SO);
let sgemm = null;
for (const [s, w] of [['scipy_cblas_sgemm64_', 'int64'], ['cblas_sgemm64_', 'int64'],
                      ['cblas_sgemm', 'int']]) {
  try { sgemm = lib.func(`void ${s}(${w},${w},${w},${w},${w},${w},float,float*,${w},`
      + `float*,${w},float,_Inout_ float*,${w})`); break; } catch { /* next */ }
}
for (const n of ['scipy_openblas_set_num_threads64_', 'openblas_set_num_threads64_',
                 'openblas_set_num_threads'])
  { try { lib.func(`void ${n}(int)`)(1); break; } catch {} }
const gemm = (m, n, k, A, lda, Bm, ldb, C, ldc) =>
  sgemm(101, 111, 111, m, n, k, 1.0, A, lda, Bm, ldb, 0.0, C, ldc);

// ── candidates. The grid is gitignored build output, so `make sweep`
//    first -- a stale f_<ROWS>_<VEC> is a silently wrong row. ───────────
const FP32 = ['dmm.wasm', 'av4.wasm', 'f_1_8.wasm', 'f_2_2.wasm', 'f_2_4.wasm',
              'f_4_2.wasm', 'f_4_4.wasm'].filter(f => fs.existsSync(here(f)));
const FM = fs.readdirSync(new URL('.', import.meta.url))
  .filter(f => /^fm_.*\.wasm$/.test(f));

function layout(inst, sizes) {
  const al = o => (o + 63) & ~63;
  let off = al(inst.exports.__heap_base.value);
  const out = { hdr: off }; off += 64;
  for (const [k, bytes] of sizes) { out[k] = off; off = al(off + bytes); }
  out.end = off;
  return out;
}

function runWasm32(file, S, X, W, route) {
  const { B, K, N, E } = S;
  const inst = new WebAssembly.Instance(
    new WebAssembly.Module(fs.readFileSync(here(file))), {});
  const L = layout(inst, [['x', B*K*4], ['w', E*K*N*4], ['rt', B*4],
                          ['y', B*N*4], ['s', B*N*4]]);
  if (inst.exports.memory.buffer.byteLength < L.end) return null;
  const f32 = new Float32Array(inst.exports.memory.buffer);
  const i32 = new Int32Array(inst.exports.memory.buffer);
  f32.set(X, L.x / 4);
  let c = L.w / 4; for (const w of W) { f32.set(w, c); c += w.length; }
  i32.set(route, L.rt / 4);
  i32.set([B, K, N, E, L.x, L.w, L.rt, L.y, L.s], L.hdr / 4);
  const one = () => { const s = process.hrtime.bigint();
    if (inst.exports.run(L.hdr, 36) !== B) throw new Error(file + ': rc');
    return Number(process.hrtime.bigint() - s) / 1e9; };
  one();
  const ts = []; for (let r = 0; r < REPS; r++) ts.push(one());
  ts.sort((a, b) => a - b);
  return { t: ts[REPS >> 1],
           y: new Float32Array(inst.exports.memory.buffer, L.y, B*N).slice() };
}

function runWasm8(file, S, X, W8, route, scale) {
  const { B, K, N, E } = S;
  const inst = new WebAssembly.Instance(
    new WebAssembly.Module(fs.readFileSync(here(file))), {});
  const L = layout(inst, [['x', B*K*4], ['w', E*K*N], ['rt', B*4], ['y', B*N*4]]);
  if (inst.exports.memory.buffer.byteLength < L.end) return null;
  const buf = inst.exports.memory.buffer;
  new Float32Array(buf).set(X, L.x / 4);
  const i8 = new Int8Array(buf); let c = L.w;
  for (const w of W8) { i8.set(w, c); c += w.length; }
  const i32 = new Int32Array(buf);
  i32.set(route, L.rt / 4);
  const sc = new Int32Array(new Float32Array([scale]).buffer)[0];
  i32.set([B, K, N, E, L.x, L.w, L.rt, L.y, 0, sc], L.hdr / 4);
  const one = () => { const s = process.hrtime.bigint();
    if (inst.exports.run(L.hdr, 44) !== B) throw new Error(file + ': rc');
    return Number(process.hrtime.bigint() - s) / 1e9; };
  one();
  const ts = []; for (let r = 0; r < REPS; r++) ts.push(one());
  ts.sort((a, b) => a - b);
  return { t: ts[REPS >> 1],
           y: new Float32Array(buf, L.y, B*N).slice() };
}

const med = (fn, reps) => { fn(); const ts = [];
  for (let r = 0; r < reps; r++) { const s = process.hrtime.bigint(); fn();
    ts.push(Number(process.hrtime.bigint() - s) / 1e9); }
  ts.sort((a, b) => a - b); return ts[reps >> 1]; };

// Relative to the SCALE of the result, not per element: these outputs
// straddle zero, so a per-element relative error is unbounded wherever the
// true value is near zero and says nothing about the kernel.
const err = (a, b) => { let m = 0, s = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d; const v = Math.abs(b[i]); if (v > s) s = v; }
  return m / (s || 1); };

function measure(S, peak) {
  const { B, K, N, E } = S;
  const X = new Float32Array(B * K);
  for (let i = 0; i < X.length; i++) X[i] = ((i * 37) % 1000) / 1000 - 0.5;
  const W = [], W8 = [], SCALE = 1 / 127;
  for (let e = 0; e < E; e++) {
    const w8 = new Int8Array(K * N), w = new Float32Array(K * N);
    for (let i = 0; i < w8.length; i++) {
      w8[i] = ((i + e * 7919) % 199) - 99;
      w[i] = ((i + e * 7919) % 997) / 997 - 0.5;
    }
    W.push(w); W8.push(w8);
  }
  const route = new Int32Array(B);
  for (let b = 0; b < B; b++) route[b] = (b * 31 + 7) % E;
  const rowsOf = []; { const c = new Int32Array(E);
    for (let b = 0; b < B; b++) c[route[b]]++;
    for (let e = 0; e < E; e++) rowsOf.push(new Int32Array(c[e]));
    const f = new Int32Array(E);
    for (let b = 0; b < B; b++) rowsOf[route[b]][f[route[b]]++] = b; }

  const Yjs = new Float32Array(B * N);
  const jsKInner = () => {
    for (let e = 0; e < E; e++) { const w = W[e];
      for (const b of rowsOf[e]) { const xo = b*K, yo = b*N;
        for (let j = 0; j < N; j++) { let a = 0;
          for (let k = 0; k < K; k++) a += X[xo+k] * w[k*N+j];
          Yjs[yo+j] = a; } } } };
  const jsKOuter = () => {
    for (let e = 0; e < E; e++) { const w = W[e];
      for (const b of rowsOf[e]) { const xo = b*K, yo = b*N;
        Yjs.fill(0, yo, yo+N);
        for (let k = 0; k < K; k++) { const a = X[xo+k], wo = k*N;
          for (let j = 0; j < N; j++) Yjs[yo+j] += a * w[wo+j]; } } } };
  const tKI = med(jsKInner, JSREPS), tKO = med(jsKOuter, JSREPS);
  const tJs = Math.min(tKI, tKO);
  (tKI < tKO ? jsKInner : jsKOuter)();
  const ref = Yjs.slice();

  const Yd = new Float32Array(B*N), sc = new Float32Array(B*N);
  const tDense = med(() => { for (let e = 0; e < E; e++) {
      gemm(B, N, K, X, K, W[e], N, sc, N);
      for (let b = 0; b < B; b++) if (route[b] === e)
        Yd.set(sc.subarray(b*N, b*N+N), b*N); } }, REPS);

  const Yb = new Float32Array(B*N);
  const gath = new Float32Array(B*K), out = new Float32Array(B*N);
  const tBlas = med(() => { let o = 0;
    for (let e = 0; e < E; e++) { const rs = rowsOf[e]; if (!rs.length) continue;
      for (let r = 0; r < rs.length; r++)
        gath.set(X.subarray(rs[r]*K, rs[r]*K+K), (o+r)*K);
      const Ce = out.subarray(o*N, (o+rs.length)*N);
      gemm(rs.length, N, K, gath.subarray(o*K, (o+rs.length)*K), K, W[e], N, Ce, N);
      for (let r = 0; r < rs.length; r++) Yb.set(Ce.subarray(r*N, r*N+N), rs[r]*N);
      o += rs.length; } }, REPS);

  let best = null;
  for (const v of [...FP32, ...FM]) {
    const r = runWasm32(v, S, X, W, route);
    if (r && (!best || r.t < best.t)) best = { ...r, name: v.replace('.wasm', '') };
  }

  // int8 reference: the same dequantised weights, computed in JS on one row
  // per expert. Comparing against the fp32 W would measure quantisation
  // error, which is a model question, not a kernel question.
  let q8 = null;
  if (fs.existsSync(here('dmm8.wasm'))) {
    const r = runWasm8('dmm8.wasm', S, X, W8, route, SCALE);
    if (r) {
      let m = 0, s = 0;
      for (let b = 0; b < B; b += Math.max(1, B >> 5)) {
        const w8 = W8[route[b]];
        for (let j = 0; j < Math.min(N, 64); j++) {
          let a = 0; for (let k = 0; k < K; k++) a += X[b*K+k] * w8[k*N+j];
          a *= SCALE;
          const d = Math.abs(r.y[b*N+j] - a);
          if (d > m) m = d; if (Math.abs(a) > s) s = Math.abs(a);
        }
      }
      q8 = { t: r.t, err: m / (s || 1) };
    }
  }

  const F = 2*B*E*K*N, R = 2*B*K*N;
  const g = t => F/t/1e9, rg = t => R/t/1e9;
  return { B, K, N, E, peak,
    rowsPerExpert: +(B/E).toFixed(1),
    weightMB: +(E*K*N*4/1048576).toFixed(1),
    js:    { gf: g(tJs), real: rg(tJs), form: tKI < tKO ? 'k-inner' : 'k-outer' },
    dense: { gf: g(tDense), real: rg(tDense), err: err(Yd, ref) },
    blas:  { gf: g(tBlas), real: rg(tBlas), err: err(Yb, ref) },
    wasm:  { gf: g(best.t), real: rg(best.t), err: err(best.y, ref),
             name: best.name, pct: 100*rg(best.t)/peak },
    q8: q8 ? { gf: g(q8.t), real: rg(q8.t), err: q8.err, pct: 100*rg(q8.t)/peak }
           : null,
  };
}

const SHAPES = (arg('shape', null)
  ? [arg('shape').split(',').map(Number)]
  : [[720,512,512,8], [720,512,512,64], [720,256,256,64],
     [2048,512,512,8], [4096,512,512,8], [512,1024,1024,8]]);

const C = ceiling();
const peak = C.gf;
const rows = [];
for (const [B,K,N,E] of SHAPES) {
  rows.push(measure({B,K,N,E}, peak));
  process.stderr.write(`  B=${B} K=N=${K} E=${E}\n`);
}
console.log(JSON.stringify({ peak, peakAcc: C.acc, rows }));
