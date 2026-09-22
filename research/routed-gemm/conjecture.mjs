// Roadmap conjecture 1: (a) CPU DMM beats BLAS in calculated GFLOPS,
//                       (b) WASM beats CPU DMM.
//
// Three contenders, one dataset, one metric:
//
//   dense-equivalent GFLOPS = 2*B*E*K*N / time
//
// i.e. the arithmetic a dense MoE MUST perform to produce this answer, over
// the time each path actually took. For the dense baseline that is its real
// rate; for the routed paths it is what they deliver by not doing the work.
//
// SINGLE THREAD throughout. BLAS multithreads by default and the WASM module
// has no threads at all (zero imports, so no pthread_create), so a threaded
// baseline would be measuring core count, not the conjecture. The threaded
// BLAS number is printed separately as context, never as the comparison.
//
// Two mechanisms could make (b) true, and they are separable:
//   1. call boundary -- CPU DMM crosses FFI once per expert (E times per
//      forward pass); WASM crosses once total and loops inside.
//   2. the gather -- BLAS needs a contiguous block, so the routed path must
//      copy each expert's rows together. A hand-written kernel indexes rows
//      in place and never copies. That is a real advantage of the custom
//      kernel, not a rigged comparison, but it should be named.
// Both are measured below rather than asserted.
//
//   node conjecture.mjs [--reps 5]

import fs from 'fs';
import koffi from 'koffi';

const BLAS_SO = process.env.BLAS_SO
  || '/usr/local/lib/python3.11/dist-packages/numpy.libs/libscipy_openblas64_-32a4b2a6.so';

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i === -1 ? d : Number(process.argv[i + 1]);
};
const REPS = arg('reps', 5);

// ── BLAS ────────────────────────────────────────────────────────────────
const lib = koffi.load(BLAS_SO);
let sgemm = null, IW = null;
for (const [sym, w] of [['scipy_cblas_sgemm64_', 'int64'], ['cblas_sgemm64_', 'int64'],
                        ['cblas_sgemm', 'int']]) {
  try {
    sgemm = lib.func(`void ${sym}(${w},${w},${w},${w},${w},${w},float,float*,${w},`
                   + `float*,${w},float,_Inout_ float*,${w})`);
    IW = w; break;
  } catch { /* next */ }
}
if (!sgemm) throw new Error('no cblas_sgemm in ' + BLAS_SO);
for (const n of ['scipy_openblas_set_num_threads64_', 'openblas_set_num_threads64_',
                 'openblas_set_num_threads']) {
  try { lib.func(`void ${n}(int)`)(1); break; } catch { /* next */ }
}
const ROW = 101, NT = 111;
const gemm = (m, n, k, A, lda, B, ldb, C, ldc) =>
  sgemm(ROW, NT, NT, m, n, k, 1.0, A, lda, B, ldb, 0.0, C, ldc);

// ── the WASM module: zero imports, one call ─────────────────────────────
const wasmMod = new WebAssembly.Module(fs.readFileSync(new URL('./dmm.wasm', import.meta.url)));

function wasmSetup(B, K, N, E, X, W, route) {
  const inst = new WebAssembly.Instance(wasmMod, {});
  const mem = inst.exports.memory;

  // Everything goes ABOVE __heap_base. The module's own statics (g_rows,
  // g_start, g_fill) and its shadow stack live below it, and writing the
  // operands at a low fixed offset silently clobbers them -- which is
  // exactly what an earlier version of this harness did. The small
  // hand-checked case was too small to reach them and passed anyway; the
  // 1.47MB X did not, and produced a result whose error equalled the result
  // scale. Ask the module where its memory starts rather than assuming.
  const heapBase = inst.exports.__heap_base ? inst.exports.__heap_base.value : 0;
  if (!heapBase) throw new Error('dmm.wasm must export __heap_base');

  let off = (heapBase + 63) & ~63;
  const base = off;
  const need = base + (B * K + E * K * N + B * N + B * N) * 4 + B * 4 + 4096;
  if (mem.buffer.byteLength < need) {
    throw new Error(`wasm memory ${mem.buffer.byteLength} < needed ${need}`);
  }
  const hdrOff = off; off += 64;
  const put = (arr) => { const o = off; off += arr.byteLength; off = (off + 63) & ~63; return o; };
  const xOff = put(X);
  const wOff = off; for (const w of W) { off += w.byteLength; } off = (off + 63) & ~63;
  const rtOff = put(route);
  const yOff = off; off += B * N * 4; off = (off + 63) & ~63;
  const sOff = off; off += B * N * 4;

  const f32 = new Float32Array(mem.buffer);
  const i32 = new Int32Array(mem.buffer);
  f32.set(X, xOff / 4);
  let wc = wOff / 4;
  for (const w of W) { f32.set(w, wc); wc += w.length; }
  i32.set(route, rtOff / 4);
  i32.set([B, K, N, E, xOff, wOff, rtOff, yOff, sOff], hdrOff / 4);

  return { inst, mem, yOff, sOff, hdrOff };
}

// ── timing ──────────────────────────────────────────────────────────────
function time(fn, reps) {
  fn();
  let best = Infinity;
  for (let r = 0; r < reps; r++) {
    const t0 = process.hrtime.bigint();
    fn();
    const d = Number(process.hrtime.bigint() - t0) / 1e9;
    if (d < best) best = d;
  }
  return best;
}
// Max absolute error normalized by the RESULT SCALE, not per-element.
//
// Per-element relative error is the wrong metric for a matmul whose outputs
// straddle zero: with X and W both centred on 0, some dot products land near
// zero and dividing by them manufactures huge "errors" from nothing. Measured
// on this data: max |abs err| 1.07e-6 against a result scale of 1.22, yet one
// element whose reference is -2.97e-3 reports 1.57e-4 relative. That element
// is not wrong, it is small.
const worstRel = (a, b) => {
  let maxAbs = 0, scale = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > maxAbs) maxAbs = d;
    const m = Math.abs(b[i]);
    if (m > scale) scale = m;
  }
  return maxAbs / (scale || 1);
};

// ── one shape ───────────────────────────────────────────────────────────
function measure(B, K, N, E) {
  const X = new Float32Array(B * K);
  for (let i = 0; i < X.length; i++) X[i] = ((i * 37) % 1000) / 1000 - 0.5;
  const W = [];
  for (let e = 0; e < E; e++) {
    const w = new Float32Array(K * N);
    for (let i = 0; i < w.length; i++) w[i] = ((i + e * 7919) % 997) / 997 - 0.5;
    W.push(w);
  }
  const route = new Int32Array(B);
  for (let b = 0; b < B; b++) route[b] = (b * 31 + 7) % E;

  const rowsOf = [];
  { const c = new Int32Array(E);
    for (let b = 0; b < B; b++) c[route[b]]++;
    for (let e = 0; e < E; e++) rowsOf.push(new Int32Array(c[e]));
    const f = new Int32Array(E);
    for (let b = 0; b < B; b++) rowsOf[route[b]][f[route[b]]++] = b; }

  // 1. BLAS dense -- every expert for every row, then select
  const Ydense = new Float32Array(B * N), scratch = new Float32Array(B * N);
  const blasDense = () => {
    for (let e = 0; e < E; e++) {
      gemm(B, N, K, X, K, W[e], N, scratch, N);
      for (let b = 0; b < B; b++)
        if (route[b] === e) Ydense.set(scratch.subarray(b * N, b * N + N), b * N);
    }
  };

  // 2. CPU DMM -- gather, one BLAS call per expert, scatter
  const Ycpu = new Float32Array(B * N);
  const gathered = new Float32Array(B * K), out = new Float32Array(B * N);
  const cpuDmm = () => {
    let off = 0;
    for (let e = 0; e < E; e++) {
      const rows = rowsOf[e];
      if (!rows.length) continue;
      for (let r = 0; r < rows.length; r++)
        gathered.set(X.subarray(rows[r] * K, rows[r] * K + K), (off + r) * K);
      const Ae = gathered.subarray(off * K, (off + rows.length) * K);
      const Ce = out.subarray(off * N, (off + rows.length) * N);
      gemm(rows.length, N, K, Ae, K, W[e], N, Ce, N);
      for (let r = 0; r < rows.length; r++)
        Ycpu.set(Ce.subarray(r * N, r * N + N), rows[r] * N);
      off += rows.length;
    }
  };

  // 3. WASM DMM -- one call, loops inside, no gather
  const { inst, mem, yOff, hdrOff } = wasmSetup(B, K, N, E, X, W, route);
  const wasmDmm = () => {
    const rc = inst.exports.run(hdrOff, 36);
    if (rc !== B) throw new Error('dmm.wasm run() returned ' + rc + ', expected ' + B);
  };

  const tDense = time(blasDense, REPS);
  const tCpu   = time(cpuDmm, REPS);
  const tWasm  = time(wasmDmm, REPS);

  const Ywasm = new Float32Array(mem.buffer, yOff, B * N);
  const errCpu  = worstRel(Ycpu, Ydense);
  const errWasm = worstRel(Ywasm, Ydense);

  // FFI overhead: E empty-ish BLAS calls vs one, same count as the routed path
  const tiny = new Float32Array(16);
  const nCalls = rowsOf.filter(r => r.length).length;
  const tFfi = time(() => { for (let i = 0; i < nCalls; i++) gemm(1, 4, 4, tiny, 4, tiny, 4, tiny, 4); }, REPS);

  const denseFlops = 2 * B * E * K * N;
  const g = t => denseFlops / t / 1e9;
  return {
    B, K, N, E, rowsPerExpert: B / E, nCalls,
    dense: { ms: tDense * 1000, gf: g(tDense) },
    cpu:   { ms: tCpu * 1000,   gf: g(tCpu),  err: errCpu },
    wasm:  { ms: tWasm * 1000,  gf: g(tWasm), err: errWasm },
    ffiMs: tFfi * 1000,
  };
}

// ── run ─────────────────────────────────────────────────────────────────
console.log(`blas   : ${BLAS_SO.split('/').pop()} (${IW}), single-threaded`);
console.log(`wasm   : dmm.wasm, zero imports, f32x4, single-threaded`);
console.log(`metric : dense-equivalent GFLOPS = 2*B*E*K*N / time, best of ${REPS}\n`);

const SHAPES = [
  [720, 512, 512, 8],
  [720, 512, 512, 32],
  [720, 512, 512, 64],
  [720, 256, 256, 64],
  [2048, 512, 512, 8],
];

const head = ['B', 'K=N', 'E', 'rows/exp', 'BLAS dense', 'CPU DMM', 'WASM DMM', 'a) DMM/BLAS', 'b) WASM/CPU', 'FFI cost', 'err vs dense'];
const rows = [];
for (const [B, K, N, E] of SHAPES) {
  const r = measure(B, K, N, E);
  const ok = (r.cpu.err < 1e-5 && r.wasm.err < 1e-5) ? '' : '  MISMATCH';
  rows.push([
    String(r.B), String(r.K), String(r.E), String(r.rowsPerExpert),
    r.dense.gf.toFixed(1), r.cpu.gf.toFixed(1), r.wasm.gf.toFixed(1),
    (r.cpu.gf / r.dense.gf).toFixed(2) + 'x',
    (r.wasm.gf / r.cpu.gf).toFixed(2) + 'x',
    r.ffiMs.toFixed(2)+'ms', 'cpu '+r.cpu.err.toExponential(1)+' wasm '+r.wasm.err.toExponential(1)+ok,
  ]);
  process.stderr.write(`  measured E=${E} K=N=${K} B=${B}\n`);
}

const w = head.map((_, c) => Math.max(head[c].length, ...rows.map(r => r[c].length)));
const fmt = r => '| ' + r.map((s, c) => s.padEnd(w[c])).join(' | ') + ' |';
console.log(fmt(head));
console.log(fmt(head.map((_, c) => '-'.repeat(w[c]))));
for (const r of rows) console.log(fmt(r));
console.log('\nGFLOPS columns are dense-equivalent. "FFI cost" is the time for the same');
console.log('number of BLAS calls the routed path makes, on trivial matrices -- the');
console.log('boundary crossing alone, with the arithmetic removed.');
