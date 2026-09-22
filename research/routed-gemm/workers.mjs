// Conjecture 1b, settled: N zero-import WASM instances over route slices,
// joined with Promise.all, against single-threaded BLAS CPU DMM.
//
// The walk is order-free -- Y[b] = X[b] * W[route[b]] has no cross-row
// dependency, no reduction, no shared accumulator -- so slicing needs no
// synchronisation of any kind. No pthread, no SharedArrayBuffer, no atomics,
// no locks. Each worker owns a contiguous run of rows, builds its own
// instance, and returns. Promise.all is the join and that is the entire
// concurrency design.
//
// The modules stay zero-import, which is the point: parallelism lives in the
// host, not in the kernel, so the same slice that goes to a local Worker can
// go to a WebRTC peer unchanged.
//
//   node workers.mjs [--b 720] [--k 256] [--n 256] [--e 64] [--slices 4]

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import { fileURLToPath } from 'url';

const HERE = fileURLToPath(import.meta.url);
const WASM = new URL('./dmm.wasm', import.meta.url);

// Deterministic and identical on both sides, so a worker reconstructs its
// own operands instead of being sent 17MB. Mirrors the real case where
// weights are already resident, and keeps transfer out of the timing.
const xAt = (b, k, K) => (((b * K + k) * 37) % 1000) / 1000 - 0.5;
const wAt = (e, i) => ((i + e * 7919) % 997) / 997 - 0.5;
const routeAt = (b, E) => (b * 31 + 7) % E;

function runSlice({ row0, rows, K, N, E, reps }) {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(WASM)), {});
  const mem = inst.exports.memory;
  const al = o => (o + 63) & ~63;

  let off = al(inst.exports.__heap_base.value);
  const hdr = off; off += 64;
  const xOff = off; off = al(off + rows * K * 4);
  const wOff = off; off = al(off + E * K * N * 4);
  const rtOff = off; off = al(off + rows * 4);
  const yOff = off; off = al(off + rows * N * 4);
  const sOff = off; off = al(off + rows * N * 4);
  if (mem.buffer.byteLength < off) throw new Error('wasm memory too small: need ' + off);

  const f32 = new Float32Array(mem.buffer), i32 = new Int32Array(mem.buffer);
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < K; k++) f32[xOff / 4 + r * K + k] = xAt(row0 + r, k, K);
  for (let e = 0; e < E; e++)
    for (let i = 0; i < K * N; i++) f32[wOff / 4 + e * K * N + i] = wAt(e, i);
  for (let r = 0; r < rows; r++) i32[rtOff / 4 + r] = routeAt(row0 + r, E);
  i32.set([rows, K, N, E, xOff, wOff, rtOff, yOff, sOff], hdr / 4);

  const one = () => {
    const s = process.hrtime.bigint();
    if (inst.exports.run(hdr, 36) !== rows) throw new Error('run() rc');
    return Number(process.hrtime.bigint() - s) / 1e9;
  };
  one();                                  // warm; excluded
  let best = Infinity;
  for (let r = 0; r < reps; r++) { const d = one(); if (d < best) best = d; }

  return { best, y: new Float32Array(mem.buffer, yOff, rows * N).slice() };
}

if (!isMainThread) {
  const r = runSlice(workerData);
  parentPort.postMessage({ best: r.best, y: r.y }, [r.y.buffer]);
} else {
  const arg = (n, d) => {
    const i = process.argv.indexOf('--' + n);
    return i === -1 ? d : Number(process.argv[i + 1]);
  };
  const B = arg('b', 720), K = arg('k', 256), N = arg('n', 256);
  const E = arg('e', 64), SLICES = arg('slices', 4), REPS = arg('reps', 5);

  // Reference: one slice covering everything, in-process.
  const ref = runSlice({ row0: 0, rows: B, K, N, E, reps: REPS });

  console.log(`shape  : B=${B} K=${K} N=${N} E=${E}  (${B / E} rows/expert)`);
  console.log(`modules: dmm.wasm, zero imports, one instance per slice`);
  console.log(`join   : Promise.all, no locks, no shared memory, no atomics\n`);
  console.log(`1 slice (in-process): ${(ref.best * 1000).toFixed(2)} ms  `
    + `${(2 * B * E * K * N / ref.best / 1e9).toFixed(1)} GF-equiv`);

  const spawn = (row0, rows) => new Promise((res, rej) => {
    const w = new Worker(HERE, { workerData: { row0, rows, K, N, E, reps: REPS } });
    w.on('message', m => { w.terminate(); res(m); });
    w.on('error', rej);
  });

  for (const S of [2, 4, 8].filter(s => s <= SLICES * 2 && B % s === 0)) {
    const per = B / S;
    const t0 = process.hrtime.bigint();
    const parts = await Promise.all(
      Array.from({ length: S }, (_, i) => spawn(i * per, per)));
    const wall = Number(process.hrtime.bigint() - t0) / 1e9;

    // Slowest slice's own best -- the steady-state cost once workers exist,
    // with spawn and module compile excluded. Wall time is reported too so
    // the startup cost is visible rather than hidden.
    const slowest = Math.max(...parts.map(p => p.best));

    let bad = 0;
    for (let i = 0; i < S; i++)
      for (let j = 0; j < per * N; j++)
        if (Math.abs(parts[i].y[j] - ref.y[i * per * N + j]) > 1e-3) bad++;

    console.log(`${String(S).padStart(2)} slices          : `
      + `${(slowest * 1000).toFixed(2)} ms  `
      + `${(2 * B * E * K * N / slowest / 1e9).toFixed(1)} GF-equiv  `
      + `(${(ref.best / slowest).toFixed(2)}x)  `
      + `wall incl. spawn ${(wall * 1000).toFixed(0)} ms  `
      + (bad ? `${bad} MISMATCHES` : 'exact'));
  }
}
