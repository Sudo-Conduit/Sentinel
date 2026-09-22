// finaltable.mjs -- run final.mjs N times in N processes and take the
// per-cell median.
//
// Separate processes on purpose. The +/-8% figure this whole directory is
// calibrated against was measured that way (eight invocations of one binary,
// each already a median of five), and two of the three results retracted in
// this project were in-process artefacts: a sequential path measured before
// a Promise.all path on the same hot JIT, and a tail length passed as a
// runtime bound. Re-running inside one process measures a warmer JIT, not a
// faster kernel.
//
//   node finaltable.mjs --runs 7 [--reps 3] [--out results/final.json]
//
// Prints the markdown table and the spread. The spread column is not
// decoration: a delta smaller than it is not a result.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i === -1 ? d : process.argv[i + 1]; };
const RUNS = Number(arg('runs', 7));
const REPS = arg('reps', '3');
const OUT = arg('out', null);

const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = spawnSync(process.execPath,
    ['final.mjs', '--reps', REPS, '--jsreps', '1'],
    { cwd: new URL('.', import.meta.url).pathname, encoding: 'utf8',
      maxBuffer: 1 << 26 });
  if (r.status !== 0) { process.stderr.write(r.stderr || ''); process.exit(1); }
  runs.push(JSON.parse(r.stdout));
  process.stderr.write(`run ${i + 1}/${RUNS}\n`);
}

const median = a => { const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1]; };
const spread = a => { const s = [...a].sort((x, y) => x - y);
  return 100 * (s[s.length - 1] - s[0]) / s[0]; };

const pick = (i, f) => runs.map(r => f(r.rows[i]));
const peak = median(runs.map(r => r.peak));
const peakAcc = runs[0].peakAcc;
const out = { peak, peakAcc, runs: RUNS, reps: Number(REPS), rows: [] };

for (let i = 0; i < runs[0].rows.length; i++) {
  const base = runs[0].rows[i];
  const has8 = runs.every(r => r.rows[i].q8);
  const cell = f => ({ gf: median(pick(i, f)), spread: spread(pick(i, f)) });
  out.rows.push({
    B: base.B, K: base.K, N: base.N, E: base.E,
    rowsPerExpert: base.rowsPerExpert, weightMB: base.weightMB,
    js: cell(r => r.js.gf),
    dense: cell(r => r.dense.gf),
    blas: cell(r => r.blas.gf),
    wasm: cell(r => r.wasm.gf),
    wasmReal: median(pick(i, r => r.wasm.real)),
    wasmName: base.wasm.name,
    wasmNames: [...new Set(runs.map(r => r.rows[i].wasm.name))],
    q8: has8 ? cell(r => r.q8.gf) : null,
    q8Real: has8 ? median(pick(i, r => r.q8.real)) : null,
    err: Math.max(...runs.flatMap(r =>
      [r.rows[i].dense.err, r.rows[i].blas.err, r.rows[i].wasm.err,
       r.rows[i].q8 ? r.rows[i].q8.err : 0])),
  });
}

const f1 = x => x.toFixed(1);
const head = ['B', 'K=N', 'E', 'rows/E', 'W MB', 'pure JS', 'BLAS dense',
              'BLAS DMM', 'WASM fp32', 'WASM int8', 'best', 'real GF',
              '% ceil', 'DMM/dense', 'spread'];
const body = out.rows.map(r => [
  String(r.B), String(r.K), String(r.E), String(r.rowsPerExpert),
  String(r.weightMB),
  f1(r.js.gf), f1(r.dense.gf), f1(r.blas.gf), f1(r.wasm.gf),
  r.q8 ? f1(r.q8.gf) : '-',
  (r.q8 && r.q8.gf > r.wasm.gf) ? 'dmm8' : r.wasmName,
  f1(Math.max(r.wasmReal, r.q8Real || 0)),
  Math.round(100 * Math.max(r.wasmReal, r.q8Real || 0) / peak) + '%',
  (r.blas.gf / r.dense.gf).toFixed(1) + 'x',
  '±' + Math.round(Math.max(r.wasm.spread, r.blas.spread) / 2) + '%',
]);
const w = head.map((_, c) => Math.max(head[c].length, ...body.map(r => r[c].length)));
const fmt = r => '| ' + r.map((s, c) => s.padEnd(w[c])).join(' | ') + ' |';
console.log('\n' + fmt(head));
console.log(fmt(head.map((_, c) => '-'.repeat(w[c]))));
for (const r of body) console.log(fmt(r));

console.log(`\nmedian of ${RUNS} processes, each a median of ${REPS} in-process reps.`);
console.log(`f32x4 ceiling ${f1(peak)} GF/core (peak.wasm, ACC=${peakAcc}).`);
console.log(`worst error against the pure-JS reference: `
  + Math.max(...out.rows.map(r => r.err)).toExponential(1));
const flip = out.rows.filter(r => r.wasmNames.length > 1);
if (flip.length) console.log('kernel choice not stable across runs on: '
  + flip.map(r => `B=${r.B} K=${r.K} E=${r.E} (${r.wasmNames.join('/')})`).join(', '));

if (OUT) { fs.writeFileSync(new URL('./' + OUT, import.meta.url),
  JSON.stringify(out, null, 2)); console.log('wrote ' + OUT); }
