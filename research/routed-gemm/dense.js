#!/usr/bin/env node
// Dense M x K x N across the tile/vector engines, at a fixed set of shapes,
// on all cores. Prints "median / best" GOPS per cell so the numbers line up
// against a history of dense measurements taken elsewhere.
//
//   node dense.js [--threads 4] [--runs 3] [--record]
//
// Each cell is <runs> separate invocations of `dense`, each of which is
// itself <reps> timed repetitions. The cell is the median of the invocation
// medians and the best of the invocation bests -- separate processes because
// that is how the +/-8% run-to-run figure for this box was established, and
// three results in this project had to be retracted for being in-process
// warmup rather than speed.
//
// reps scales with the shape: 1x576x576 is 0.66 MFLOP and finishes in
// microseconds, so it needs hundreds of repetitions before the timer means
// anything; 4096^3 is 137 GFLOP and five is plenty.

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BIN = path.join(__dirname, 'dense');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i === -1 ? d : Number(process.argv[i + 1]); };
const T = arg('threads', os.cpus().length);
const RUNS = arg('runs', 3);

const SHAPES = [
  [1, 576, 576], [32, 576, 576], [1024, 576, 576],
  [2048, 1024, 1024], [4096, 2048, 2048], [4096, 4096, 4096],
];

const ENGINES = [
  { id: 'amx',   label: `AMX-INT8 (${T}-core)`,           unit: 'GOPS' },
  { id: 'vnnip', label: `VNNI panel-packed (${T}-core)`,  unit: 'GOPS' },
  { id: 'vnni',  label: `VNNI row-packed (${T}-core)`,    unit: 'GOPS' },
  { id: 'bf16',  label: `AMX-BF16 (${T}-core, reference)`, unit: 'GFLOPS' },
  { id: 'blas',  label: `BLAS fp32 (${T}-core)`,          unit: 'GFLOPS' },
];

function caps() {
  const m = {};
  for (const line of execFileSync(BIN, ['caps']).toString().trim().split('\n')) {
    if (line.startsWith('#')) { m.note = line.slice(1).trim(); continue; }
    const [k, v] = line.split(' '); m[k] = v === '1';
  }
  return m;
}

const reps = (M, K, N) => {
  const ops = 2 * M * K * N;
  return Math.max(5, Math.min(500, Math.round(5e9 / ops)));
};

function measure(eng, M, K, N) {
  const meds = [], bests = [];
  for (let r = 0; r < RUNS; r++) {
    const out = execFileSync(BIN,
      [eng, M, K, N, T, reps(M, K, N)].map(String)).toString().trim();
    if (out === 'n/a') return null;
    const [med, best] = out.split(/\s+/).map(Number);
    meds.push(med); bests.push(best);
  }
  meds.sort((a, b) => a - b);
  return { med: meds[meds.length >> 1], best: Math.max(...bests),
           spread: 100 * (meds[meds.length - 1] - meds[0]) / meds[0] };
}

const have = caps();
const use = ENGINES.filter(e => have[e.id]);
console.log(`engines: ${use.map(e => e.id).join(', ')}`
  + (have.amx ? '' : '   (no AMX-INT8 on this cpu)'));
if (have.note) console.log(have.note);

// Correctness before speed, at a shape small enough to reference in plain C.
// An engine that is fast and wrong is the failure mode register blocking and
// tile geometry actually have.
process.stdout.write('\n' + execFileSync(BIN,
  ['verify', '192', '576', '576', String(T)]).toString());

const rows = [];
for (const [M, K, N] of SHAPES) {
  const cells = {};
  for (const e of use) cells[e.id] = measure(e.id, M, K, N);
  rows.push({ M, K, N, reps: reps(M, K, N), cells });
  process.stderr.write(`  measured ${M}x${K}x${N}\n`);
}

const cell = c => c ? `${c.med.toFixed(1)} / ${c.best.toFixed(1)}` : 'n/a';
const head = ['shape', ...use.map(e => e.label)];
const body = rows.map(r =>
  [`${r.M}x${r.K}x${r.N}`, ...use.map(e => cell(r.cells[e.id]))]);
const w = head.map((_, c) => Math.max(head[c].length, ...body.map(r => r[c].length)));
const fmt = r => '| ' + r.map((s, c) => s.padEnd(w[c])).join(' | ') + ' |';
console.log('\n' + fmt(head));
console.log(fmt(head.map((_, c) => '-'.repeat(w[c]))));
for (const r of body) console.log(fmt(r));

console.log(`\nmedian / best, each over ${RUNS} processes x per-shape reps `
  + `(${rows.map(r => r.reps).join(', ')}).`);
console.log('int8 columns are GOPS; bf16 and BLAS are GFLOPS. 2*M*K*N either way.');
const worst = Math.max(...rows.flatMap(r =>
  use.map(e => r.cells[e.id] ? r.cells[e.id].spread : 0)));
console.log(`worst spread across invocation medians: ${worst.toFixed(0)}%`);

if (process.argv.includes('--record')) {
  const ci = fs.readFileSync('/proc/cpuinfo', 'utf8');
  const model = (ci.match(/^model name\s*:\s*(.+)$/m) || [, 'unknown'])[1].trim();
  const flags = new Set(((ci.match(/^flags\s*:\s*(.+)$/m) || [, ''])[1]).split(/\s+/));
  const host = { model, cores: os.cpus().length, threads: T,
    features: ['avx512f', 'avx512_vnni', 'amx_tile', 'amx_int8', 'amx_bf16']
      .filter(f => flags.has(f)) };
  const slug = (model + '_' + host.features.join('-')).toLowerCase()
    .replace(/\(r\)|\(tm\)/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 80);
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'dense-' + slug + '.json');
  fs.writeFileSync(file, JSON.stringify({
    host, recorded: new Date().toISOString(), blas: have.note || null,
    runs: RUNS, engines: use, rows }, null, 2) + '\n');
  console.log(`\nrecorded -> results/${path.basename(file)}`);
}
