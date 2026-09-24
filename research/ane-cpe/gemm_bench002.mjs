// gemm_bench002.mjs
// Usage:
//   SDOT=1 BFDOT=1 SME1=1 SME2=1 ANE=1 GPU=1 WASM=1 WEBGL=1 WEBGPU=1 node gemm_bench002.mjs
//   Any backend defaults to "on" if not set; set to 0 to disable.
//
// Same shapes, REF table, toggles, iters/warmup, and output format as
// gemm_bench.mjs. The one real change: every native engine (SME1, SME2,
// SDOT, BFDOT, ANE, GPU) is now dispatched through CPE (ComputeCore) as a
// provider, instead of some going through direct koffi calls and some
// through CPE -- that split defeated the point of having a unifying
// dispatch layer at all. One bench function (benchCpe) for all six.

import { performance } from 'node:perf_hooks';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const PROVIDERS_MJS = join(__dirname, 'cpu_gpu_providers.mjs');
const ANE_MJS       = join(__dirname, 'ane_provider.mjs');
const COMPUTE_CORE  = join(__dirname, '..', '..', 'pooledimpact', 'mountainshift', 'v2', 'ComputeCore.js');

// ---------- toggles ----------
const on = (name) => process.env[name] !== '0';
const ENABLE = {
  sme1:  on('SME1'),
  sme2:  on('SME2'),
  sdot:  on('SDOT'),
  bfdot: on('BFDOT'),
  ane:   on('ANE'),
  gpu:   on('GPU'),
  wasm:  on('WASM'),
  webgl: on('WEBGL'),
  webgpu: on('WEBGPU'),
};

// ---------- CPE: one engine, provider swapped per call; load a provider's
// dylib only if its engine is enabled, same "only if needed" discipline as
// the direct-koffi version had ----------
const ComputeCore = require(COMPUTE_CORE);
const engine = ComputeCore.create();

const need_cpu_gpu = ENABLE.sme1 || ENABLE.sme2 || ENABLE.sdot || ENABLE.bfdot || ENABLE.gpu;
const cpuGpu = need_cpu_gpu ? await import(PROVIDERS_MJS) : null;
const ane    = ENABLE.ane ? await import(ANE_MJS) : null;

const PROVIDER = {
  sme1:  cpuGpu?.SME1_PROVIDER,
  sme2:  cpuGpu?.SME2_PROVIDER,
  sdot:  cpuGpu?.SDOT_PROVIDER,
  bfdot: cpuGpu?.BFDOT_PROVIDER,
  ane:   ane?.ANE_PROVIDER,
  gpu:   cpuGpu?.GPU_PROVIDER,
};

// ---------- shapes ----------
const SHAPES = [
  { name: '1x576x576',      M: 1,    N: 576,  K: 576  },
  { name: '32x576x576',     M: 32,   N: 576,  K: 576  },
  { name: '1024x576x576',   M: 1024, N: 576,  K: 576  },
  { name: '2048x1024x1024', M: 2048, N: 1024, K: 1024 },
  { name: '4096x2048x2048', M: 4096, N: 2048, K: 2048 },
  { name: '4096x4096x4096', M: 4096, N: 4096, K: 4096 },
];

const ITERS = 3, WARMUP = 1;

// ---------- GPU reference GFLOPS from the browser harness ----------
const REF = {
  '1x576x576':      { wasm: 6.64,  webgl: 0.38,  webgpu: 1.42   },
  '32x576x576':     { wasm: 8.73,  webgl: 6.25,  webgpu: 35.39  },
  '1024x576x576':   { wasm: 9.26,  webgl: 30.84, webgpu: 190.51 },
  '2048x1024x1024': { wasm: 7.83,  webgl: 46.60, webgpu: 295.53 },
  '4096x2048x2048': { wasm: 8.00,  webgl: 65.19, webgpu: 408.40 },
  '4096x4096x4096': { wasm: 7.92,  webgl: 89.83, webgpu: 804.52 },
};

// ---------- harness ----------
function timeCall(fn) {
  for (let i = 0; i < WARMUP; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < ITERS; i++) fn();
  return (performance.now() - t0) / ITERS;
}

// ---------- one bench function for every engine, via CPE ----------
function benchCpe(provider, { M, N, K }) {
  engine.provider = provider;
  const A = engine.alloc(Float32Array, M * K).fill(1.0);
  const B = engine.alloc(Float32Array, K * N).fill(1.0);
  const ms = timeCall(() => engine.run({ op: 'matmul', m: M, n: N, k: K, A, B }));
  return { ms, gflops: (2 * M * N * K) / (ms * 1e6) };
}

// ---------- dynamic header ----------
function buildHeader() {
  const cols = [];
  if (ENABLE.sme1)  cols.push(['SME1 ms',  9], ['SME1 GF',  9]);
  if (ENABLE.sme2)  cols.push(['SME2 ms',  9], ['SME2 GF',  9]);
  if (ENABLE.sdot)  cols.push(['SDOT ms',  9], ['SDOT GF',  9]);
  if (ENABLE.bfdot) cols.push(['BFDOT ms', 10], ['BFDOT GF', 10]);
  if (ENABLE.ane)   cols.push(['ANE ms',   9], ['ANE GF',   9]);
  if (ENABLE.gpu)   cols.push(['GPU ms',   9], ['GPU GF',   9]);
  if (ENABLE.wasm)  cols.push(['WASM',      6]);
  if (ENABLE.webgl) cols.push(['WebGL',     6]);
  if (ENABLE.webgpu) cols.push(['WebGPU',   7]);

  const header = 'Shape'.padEnd(20) + ' | ' +
    cols.map(([name, w]) => name.padStart(w)).join(' | ');
  return header;
}

console.log('GEMM benchmark (via CPE)');
console.log(`${ITERS} iter, ${WARMUP} warmup`);
console.log('Toggles: ' +
  `SME1=${ENABLE.sme1?1:0} SME2=${ENABLE.sme2?1:0} ` +
  `SDOT=${ENABLE.sdot?1:0} BFDOT=${ENABLE.bfdot?1:0} ` +
  `ANE=${ENABLE.ane?1:0} GPU=${ENABLE.gpu?1:0} ` +
  `WASM=${ENABLE.wasm?1:0} WEBGL=${ENABLE.webgl?1:0} WEBGPU=${ENABLE.webgpu?1:0}\n`);

const HEADER = buildHeader();
console.log(HEADER);
console.log('-'.repeat(HEADER.length));

for (const s of SHAPES) {
  const row = [s.name.padEnd(20), ' | '];

  if (ENABLE.sme1)  { const r = benchCpe(PROVIDER.sme1,  s); row.push(r.ms.toFixed(2).padStart(9),  ' | ', r.gflops.toFixed(2).padStart(9),  ' | '); }
  if (ENABLE.sme2)  { const r = benchCpe(PROVIDER.sme2,  s); row.push(r.ms.toFixed(2).padStart(9),  ' | ', r.gflops.toFixed(2).padStart(9),  ' | '); }
  if (ENABLE.sdot)  { const r = benchCpe(PROVIDER.sdot,  s); row.push(r.ms.toFixed(2).padStart(9),  ' | ', r.gflops.toFixed(2).padStart(9),  ' | '); }
  if (ENABLE.bfdot) { const r = benchCpe(PROVIDER.bfdot, s); row.push(r.ms.toFixed(2).padStart(10), ' | ', r.gflops.toFixed(2).padStart(10), ' | '); }
  if (ENABLE.ane)   { const r = benchCpe(PROVIDER.ane,   s); row.push(r.ms.toFixed(2).padStart(9),  ' | ', r.gflops.toFixed(2).padStart(9),  ' | '); }
  if (ENABLE.gpu)   { const r = benchCpe(PROVIDER.gpu,   s); row.push(r.ms.toFixed(2).padStart(9),  ' | ', r.gflops.toFixed(2).padStart(9),  ' | '); }

  const ref = REF[s.name];
  if (ENABLE.wasm)  row.push(ref.wasm.toFixed(2).padStart(6));
  if (ENABLE.webgl) row.push(' | ', ref.webgl.toFixed(2).padStart(6));
  if (ENABLE.webgpu) row.push(' | ', ref.webgpu.toFixed(2).padStart(7));

  console.log(row.join(''));
}
