#!/usr/bin/env node
// Sweep every available matmul engine across rows-per-block and print the
// table. Total rows are held fixed, so every cell does identical arithmetic
// and the only variable is how short the blocks are -- which is exactly what
// the routed op changes when E goes up.
//
//   node engines.js [--tot 720] [--k 2048] [--n 2048] [--reps 5] [--runs 5]
//
// Each cell is the median of --runs invocations, each of which is itself the
// best of --reps. This box is +/-15% run-to-run; the median is load-bearing.

const { execFileSync } = require('child_process');
const path = require('path');

const BIN = path.join(__dirname, 'engines');
const ENV = { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' };

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? dflt : Number(process.argv[i + 1]);
}

const TOT  = arg('tot', 720);
const K    = arg('k', 2048);
const N    = arg('n', 2048);
const REPS = arg('reps', 5);
const RUNS = arg('runs', 5);

const RPBS = [720, 90, 45, 16, 12, 6, 3, 1].filter(r => r <= TOT);

function caps() {
  const out = execFileSync(BIN, ['caps'], { env: ENV }).toString().trim();
  const m = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('#')) { m.note = line.slice(1).trim(); continue; }
    const [k, v] = line.split(' ');
    m[k] = v === '1';
  }
  return m;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function measure(eng, rpb) {
  const vals = [];
  for (let r = 0; r < RUNS; r++) {
    const out = execFileSync(BIN, [eng, TOT, K, N, rpb, REPS].map(String),
                             { env: ENV }).toString().trim();
    if (out === 'n/a') return null;
    vals.push(Number(out));
  }
  return median(vals);
}

const have = caps();
const ENGINES = [
  { id: 'code', label: 'code',  unit: 'GOPS int8' },
  { id: 'vnni', label: 'VNNI',  unit: 'GOPS int8' },
  { id: 'blas', label: 'BLAS',  unit: 'GFLOPS fp32' },
  { id: 'blasb', label: 'BLAS batch', unit: 'GFLOPS fp32' },
  { id: 'amx',  label: 'AMX',   unit: 'GOPS int8' },
].filter(e => have[e.id]);

console.log(`engines: ${ENGINES.map(e => e.label).join(', ')}` +
            (have.amx ? '' : '   (no AMX-INT8 on this cpu)'));
if (have.note) console.log(have.note);
console.log(`shape: ${TOT} rows total, K=${K}, N=${N}, single thread, ` +
            `median of ${RUNS} x best-of-${REPS}\n`);

const rows = [];
for (const rpb of RPBS) {
  const cells = {};
  for (const e of ENGINES) cells[e.id] = measure(e.id, rpb);
  rows.push({ rpb, cells });
  process.stderr.write(`  measured rows/block=${rpb}\n`);
}

const base = rows[0].cells;   // rows/block = TOT, i.e. one dense block

const head = ['rows/block', 'E implied', ...ENGINES.map(e => e.label)];
const sep  = head.map(() => '---');
const body = rows.map(({ rpb, cells }) => [
  String(rpb),
  String(Math.ceil(TOT / rpb)),
  ...ENGINES.map(e => {
    const v = cells[e.id];
    if (v == null) return 'n/a';
    const pct = base[e.id] ? Math.round(100 * v / base[e.id]) : 0;
    return `${v.toFixed(1)}  (${pct}%)`;
  }),
]);

const widths = head.map((_, c) =>
  Math.max(head[c].length, ...body.map(r => r[c].length)));
const fmt = r => '| ' + r.map((s, c) => s.padEnd(widths[c])).join(' | ') + ' |';

console.log(fmt(head));
console.log(fmt(sep.map((s, c) => s.padEnd(widths[c], '-'))));
for (const r of body) console.log(fmt(r));

console.log('\nunits: ' + ENGINES.map(e => `${e.label} = ${e.unit}`).join(', ') +
            '. Percentages are each engine against its own one-block rate --');
console.log('that is the comparable number across engines, not the absolute rate.');
