#!/usr/bin/env node
// routed-node.js -- the routed-diagonal op with NO C of our own.
//
// The op is two things: a selection and a matmul. Only the selection is ours.
//   selection -> index arithmetic, which is Node's job
//   matmul    -> a GEMM already compiled and sitting on the box, reached
//                through koffi, which is the FFI's job
//
// So there is nothing here to build. No gcc, no .so of ours, no node-gyp, no
// second language in the repo. `node routed-node.js` is the whole toolchain.
//
//   Y[b] = X[b] * W[route[b]]
//
// dense:  E full GEMMs of B rows, then throw (E-1)/E of the result away.
// routed: gather the rows each expert actually owns, one GEMM per expert
//         sized to those rows, scatter back. Same answer, E times less work.
//
// Backends, in preference order, whichever is on the machine:
//   mkl-int8  cblas_gemm_s8u8s32 -- MKL dispatches this to VNNI and to AMX
//             internally, so the int8 tile engines are reachable with no C
//             at all. Gated behind a known-answer self-check (see below).
//   blas-fp32 cblas_sgemm -- OpenBLAS or MKL, either one.
//
//   node routed-node.js [--b 720] [--k 512] [--n 512] [--e 8] [--reps 5]
//                       [--fp32]   force the fp32 path even if MKL is present
//                       [--json]   write routed-node.json

const koffi = require('koffi');
const fs = require('fs');

// ---- 64-byte aligned typed arrays --------------------------------------
// ArrayBuffer only -- no Buffer. Buffer is Node-only and the target runtime
// for this work is WebLLM in a browser, where it does not exist. Nothing
// below this line is Node-specific except the koffi call itself.
//
// Backing stores land at addr % 64 == 32 here, which straddles a cache line
// on every 512-bit load; research/gemm-node measured ~2x for exactly that.
// So over-allocate and take a view at the next 64-byte boundary. V8 puts
// ArrayBuffer backing stores off-heap and never relocates them, so the
// address stays valid for the life of the buffer.
const ALIGN = 64;

function aligned(Ctor, n) {
  const ab = new ArrayBuffer(n * Ctor.BYTES_PER_ELEMENT + ALIGN);
  const off = (ALIGN - Number(koffi.address(new Uint8Array(ab)) % BigInt(ALIGN)))
              % ALIGN;
  return new Ctor(ab, off, n);
}

// ---- find a GEMM already on the machine --------------------------------
const CANDIDATES = [
  process.env.BLAS_SO,
  'libmkl_rt.so.2', 'libmkl_rt.so', 'libmkl_rt.so.1',
  '/usr/local/lib/python3.11/dist-packages/numpy.libs/'
    + 'libscipy_openblas64_-32a4b2a6.so',
  'libopenblas.so.0', 'libopenblas.so', 'libblas.so.3',
].filter(Boolean);

// ILP64 builds (numpy/scipy wheels) prefix scipy_ and suffix 64_; MKL and
// distro OpenBLAS use the plain names. The only thing that reaches this file
// is the integer width in the signature.
const SGEMM_VARIANTS = [
  { sym: 'scipy_cblas_sgemm64_', int: 'int64' },
  { sym: 'cblas_sgemm64_',       int: 'int64' },
  { sym: 'cblas_sgemm',          int: 'int'   },
];

const ROW_MAJOR = 101, NO_TRANS = 111, FIX_OFFSET = 171;

function loadGemm(wantInt8) {
  for (const path of CANDIDATES) {
    let lib;
    try { lib = koffi.load(path); } catch { continue; }

    let sgemm = null, width = null, sym = null;
    for (const v of SGEMM_VARIANTS) {
      try {
        const I = v.int;
        sgemm = lib.func(`void ${v.sym}(${I},${I},${I},${I},${I},${I},`
          + `float,float*,${I},float*,${I},float,_Inout_ float*,${I})`);
        width = I; sym = v.sym;
        break;
      } catch { /* not in this build */ }
    }
    if (!sgemm) continue;

    let s8 = null;
    if (wantInt8) {
      // MKL only. C = alpha*(A+ao)*(B+bo) + beta*C + co, A is s8, B is u8.
      try {
        s8 = lib.func('void cblas_gemm_s8u8s32(int,int,int,int,int,int,int,'
          + 'float,void*,int,int8,void*,int,int8,float,'
          + '_Inout_ int32*,int,int32*)');
      } catch { /* not MKL, or too old */ }
    }
    return { path, sym, width, sgemm, s8 };
  }
  throw new Error('no BLAS found; set BLAS_SO=<path to libopenblas.so or libmkl_rt.so>');
}

// MKL's int8 path cannot be exercised on a box without MKL, so it does not
// get trusted on the strength of having compiled. Prove it against a pure-JS
// reference on a tiny case first; a backend that fails this is dropped, not
// used and hoped for.
function selfCheckInt8(g) {
  const m = 5, k = 8, n = 4;                 // deliberately not tile-shaped
  const A = aligned(Int8Array, m * k);
  const Bs = new Int8Array(k * n);
  for (let i = 0; i < A.length; i++) A[i] = ((i * 37) % 251) - 125;
  for (let i = 0; i < Bs.length; i++) Bs[i] = ((i * 53) % 241) - 120;

  // B must be u8 for this entry point, so store w+128 and let bo=-128 undo it.
  const Bu = aligned(Uint8Array, k * n);
  for (let i = 0; i < Bs.length; i++) Bu[i] = Bs[i] + 128;

  const C = aligned(Int32Array, m * n);
  const co = new Int32Array(1);
  g.s8(ROW_MAJOR, NO_TRANS, NO_TRANS, FIX_OFFSET, m, n, k,
       1.0, A, k, 0, Bu, n, -128, 0.0, C, n, co);

  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let p = 0; p < k; p++) acc += A[i * k + p] * Bs[p * n + j];
      if (C[i * n + j] !== acc) return `C[${i},${j}]=${C[i * n + j]} want ${acc}`;
    }
  return null;
}

// ---- args ---------------------------------------------------------------
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? dflt : Number(process.argv[i + 1]);
}
const B = arg('b', 720), K = arg('k', 512), N = arg('n', 512);
const E = arg('e', 8), REPS = arg('reps', 5);

const g = loadGemm(!process.argv.includes('--fp32'));
let mode = 'blas-fp32', why = null;
if (g.s8) {
  const bad = selfCheckInt8(g);
  if (bad) { why = `mkl-int8 self-check FAILED (${bad}) -- falling back`; }
  else mode = 'mkl-int8';
}

// ---- data ---------------------------------------------------------------
const int8 = mode === 'mkl-int8';
const XT = int8 ? Int8Array : Float32Array;
const YT = int8 ? Int32Array : Float32Array;

const X = aligned(XT, B * K);
for (let i = 0; i < X.length; i++)
  X[i] = int8 ? ((i * 37) % 201) - 100 : (i * 2654435761 % 1000) / 1000 - 0.5;

// weights: one K x N matrix per expert
const W = [], Wu = [];
for (let e = 0; e < E; e++) {
  const w = aligned(int8 ? Int8Array : Float32Array, K * N);
  for (let i = 0; i < w.length; i++)
    w[i] = int8 ? (((i + e * 7919) % 199) - 99) : ((i + e * 7919) % 997) / 997 - 0.5;
  W.push(w);
  if (int8) {
    const u = aligned(Uint8Array, K * N);
    for (let i = 0; i < w.length; i++) u[i] = w[i] + 128;
    Wu.push(u);
  }
}

const route = new Int32Array(B);
for (let b = 0; b < B; b++) route[b] = (b * 31 + 7) % E;

const co = new Int32Array(1);
function gemm(m, A, lda, e, C, ldc) {
  if (int8)
    g.s8(ROW_MAJOR, NO_TRANS, NO_TRANS, FIX_OFFSET, m, N, K,
         1.0, A, lda, 0, Wu[e], N, -128, 0.0, C, ldc, co);
  else
    g.sgemm(ROW_MAJOR, NO_TRANS, NO_TRANS, m, N, K,
            1.0, A, lda, W[e], N, 0.0, C, ldc);
}

// ---- the selection: this is the entire part of the op that is ours ------
// Group token indices by the expert each routed to. That grouping IS the
// diagonal of the (token x expert) grid -- one cell per row, never the grid.
function buildRoute(route, E) {
  const counts = new Int32Array(E);
  for (let b = 0; b < route.length; b++) counts[route[b]]++;
  const rowsOf = [];
  for (let e = 0; e < E; e++) rowsOf.push(new Int32Array(counts[e]));
  const fill = new Int32Array(E);
  for (let b = 0; b < route.length; b++) rowsOf[route[b]][fill[route[b]]++] = b;
  return rowsOf;
}
const rowsOf = buildRoute(route, E);

// ---- dense: every expert for every token, then select -------------------
const Ydense = aligned(YT, B * N);
const scratch = aligned(YT, B * N);

function dense() {
  for (let e = 0; e < E; e++) {
    gemm(B, X, K, e, scratch, N);
    for (let b = 0; b < B; b++)
      if (route[b] === e) Ydense.set(scratch.subarray(b * N, b * N + N), b * N);
  }
}

// ---- routed: gather, one GEMM per expert, scatter -----------------------
const Yrouted = aligned(YT, B * N);
const gathered = aligned(XT, B * K);
const out = aligned(YT, B * N);

function routed() {
  let off = 0;
  for (let e = 0; e < E; e++) {
    const rows = rowsOf[e];
    if (rows.length === 0) continue;
    for (let r = 0; r < rows.length; r++)
      gathered.set(X.subarray(rows[r] * K, rows[r] * K + K), (off + r) * K);

    const Ae = gathered.subarray(off * K, (off + rows.length) * K);
    const Ce = out.subarray(off * N, (off + rows.length) * N);
    gemm(rows.length, Ae, K, e, Ce, N);

    for (let r = 0; r < rows.length; r++)
      Yrouted.set(Ce.subarray(r * N, r * N + N), rows[r] * N);
    off += rows.length;
  }
}

// ---- run ----------------------------------------------------------------
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

console.log(`library : ${g.path}`);
console.log(`mode    : ${mode}  (${int8 ? 'cblas_gemm_s8u8s32' : g.sym}, ${g.width})`);
if (why) console.log(`note    : ${why}`);
console.log(`shape   : B=${B} K=${K} N=${N} E=${E}, ${B / E} rows/expert`);
console.log(`build   : none -- koffi + node, no compile step\n`);

const td = time(dense, REPS);
const tr = time(routed, REPS);

let worst = 0;
for (let i = 0; i < B * N; i++) {
  const d = Math.abs(Yrouted[i] - Ydense[i]);
  const s = Math.abs(Ydense[i]) || 1;
  if (d / s > worst) worst = d / s;
}

const denseOps = 2 * B * E * K * N;
const f = x => x.toFixed(1).padStart(9);
console.log(`dense   : ${f(td * 1000)} ms  ${f(denseOps / td / 1e9)} G${int8 ? 'OPS' : 'FLOPS'}`);
console.log(`routed  : ${f(tr * 1000)} ms  ${f(denseOps / tr / 1e9)} dense-equivalent`);
console.log(`speedup : ${(td / tr).toFixed(1)}x       max rel err ${worst.toExponential(1)}`
  + (worst < (int8 ? 1e-12 : 1e-4) ? '  (match)' : '  (MISMATCH)'));

if (process.argv.includes('--json')) {
  fs.writeFileSync('routed-node.json', JSON.stringify({
    library: g.path, mode, shape: { B, K, N, E },
    dense_ms: td * 1000, routed_ms: tr * 1000,
    speedup: td / tr, max_rel_err: worst,
  }, null, 2) + '\n');
}
