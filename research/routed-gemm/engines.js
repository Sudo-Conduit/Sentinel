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
const fs = require('fs');
const os = require('os');

// Shared by the live sweep and by --table replaying recorded runs.
function render(engines, rows, tot) {
  const base = rows[0].cells;           // rows/block = tot, one dense block
  const head = ['rows/block', 'E implied', ...engines.map(e => e.label)];
  const body = rows.map(({ rpb, cells }) => [
    String(rpb),
    String(Math.ceil(tot / rpb)),
    ...engines.map(e => {
      const v = cells[e.id];
      if (v == null) return 'n/a';
      if (typeof v === 'object') return v.failed;
      const b = base[e.id];
      const pct = typeof b === 'number' && b ? Math.round(100 * v / b) : null;
      return pct == null ? v.toFixed(1) : `${v.toFixed(1)}  (${pct}%)`;
    }),
  ]);
  const w = head.map((_, c) => Math.max(head[c].length, ...body.map(r => r[c].length)));
  const fmt = r => '| ' + r.map((s, c) => s.padEnd(w[c])).join(' | ') + ' |';
  return [
    fmt(head),
    fmt(head.map((_, c) => '-'.repeat(w[c]))),
    ...body.map(fmt),
    '',
    'units: ' + engines.map(e => `${e.label} = ${e.unit}`).join(', ') + '.',
    'Percentages are each engine against its OWN one-block rate -- that is the',
    'number comparable across engines, not the absolute rate.',
  ];
}

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
    let out;
    try {
      out = execFileSync(BIN, [eng, TOT, K, N, rpb, REPS].map(String),
                         { env: ENV, stdio: ['ignore', 'pipe', 'ignore'] })
              .toString().trim();
    } catch (e) {
      // Don't let one backend dying take the sweep with it. OpenBLAS's
      // sgemm_batch segfaults on small m*n*k (m=3 at K=N=512 reproducibly;
      // m=6 is fine, and the same 240 groups at K=N=2048 is fine) -- that is
      // a bug in the library, not in the measurement, so record it as such.
      process.stderr.write(
        `  ${eng} rows/block=${rpb}: ${e.signal || 'exit ' + e.status}\n`);
      return { failed: e.signal || `exit ${e.status}` };
    }
    if (out === 'n/a') return null;
    vals.push(Number(out));
  }
  return median(vals);
}

// ---- host fingerprint --------------------------------------------------
// These containers are ephemeral and the CPU is not the same one twice --
// AMX shows up on some and not others. So a measurement is only worth taking
// if it survives the box: --record writes it under results/ keyed by the CPU
// it ran on, and --table merges everything ever recorded. Landing on an AMX
// box then costs one command, and the column is kept.
function host() {
  const ci = fs.readFileSync('/proc/cpuinfo', 'utf8');
  const model = (ci.match(/^model name\s*:\s*(.+)$/m) || [, 'unknown'])[1].trim();
  const flags = new Set(((ci.match(/^flags\s*:\s*(.+)$/m) || [, ''])[1]).split(/\s+/));
  const want = ['avx512f', 'avx512_vnni', 'amx_tile', 'amx_int8', 'amx_bf16'];
  return {
    model,
    features: want.filter(f => flags.has(f)),
    cores: os.cpus().length,
    virtual: flags.has('hypervisor'),
  };
}

function slug(h) {
  const s = (h.model + '_' + h.features.join('-')).toLowerCase()
    .replace(/\(r\)|\(tm\)/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s.slice(0, 80);
}

const RESULTS = path.join(__dirname, 'results');

if (process.argv.includes('--table')) {
  if (!fs.existsSync(RESULTS)) { console.log('no results recorded yet'); process.exit(0); }
  for (const f of fs.readdirSync(RESULTS).filter(f => f.endsWith('.json')).sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'));
    console.log(`\n### ${r.host.model}${r.host.virtual ? ' (virtualized)' : ''}`);
    console.log(`${r.host.features.join(', ') || 'no avx512/amx'} · ` +
                `${r.host.cores} cores · recorded ${r.recorded.slice(0, 10)}`);
    console.log(`shape: ${r.shape.tot} rows, K=${r.shape.k}, N=${r.shape.n}, ` +
                `single thread\n`);
    console.log(render(r.engines, r.rows, r.shape.tot).join('\n'));
  }
  process.exit(0);
}

// The blocked columns are the WASM finding ported: the original vnni and amx
// kernels hold ONE accumulator block, so every weight load feeds one row (or
// one tile) and the load-to-MAC ratio never improves. `cap` is which
// capability bit gates the column, since `engines caps` reports the ISA, not
// the register blocking.
const have = caps();
const ENGINES = [
  { id: 'code',      label: 'code',       unit: 'GOPS int8',   cap: 'code' },
  { id: 'vnni',      label: 'VNNI 1x4',   unit: 'GOPS int8',   cap: 'vnni' },
  { id: 'vnni:6:4',  label: 'VNNI 6x4',   unit: 'GOPS int8',   cap: 'vnni' },
  { id: 'vnni:auto', label: 'VNNI auto',  unit: 'GOPS int8',   cap: 'vnni' },
  { id: 'blas',      label: 'BLAS',       unit: 'GFLOPS fp32', cap: 'blas' },
  { id: 'blasb',     label: 'BLAS batch', unit: 'GFLOPS fp32', cap: 'blasb' },
  { id: 'amx',       label: 'AMX 1x1',    unit: 'GOPS int8',   cap: 'amx' },
  { id: 'amx:2:2',   label: 'AMX 2x2',    unit: 'GOPS int8',   cap: 'amx' },
  { id: 'amx:auto',  label: 'AMX auto',   unit: 'GOPS int8',   cap: 'amx' },
].filter(e => have[e.cap]);

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

console.log(render(ENGINES, rows, TOT).join('\n'));

if (process.argv.includes('--record')) {
  const h = host();
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, slug(h) + '.json');
  fs.writeFileSync(file, JSON.stringify({
    host: h,
    recorded: new Date().toISOString(),
    blas: have.note || null,
    shape: { tot: TOT, k: K, n: N, reps: REPS, runs: RUNS },
    engines: ENGINES,
    rows,
  }, null, 2) + '\n');
  console.log(`\nrecorded -> results/${path.basename(file)}`);
  console.log('commit it -- the box is ephemeral, the measurement should not be.');
}
