// ─── Spline Patch — checks ─────────────────────────────────────────────
// Run: node research/spline-patch/SplinePatch.test.js

'use strict';
const SP = require('./SplinePatch.js');
const { sub, dot, len, norm } = SP.vec;

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}

const load = name => SP.createModel(SP.presets[name]());
const kinds = patches => patches.reduce((m, p) => { m[p.ring.length] = (m[p.ring.length] || 0) + 1; return m; }, {});

// Worst angle (degrees) between normals of coincident vertices that belong to different
// sub-patch grids — i.e. how well neighbouring patches meet along their seams.
function seamAngle(tess, subdiv) {
  const per = (subdiv + 1) * (subdiv + 1), P = tess.positions, N = tess.normals;
  const buckets = new Map();
  let worst = 0;
  for (let v = 0; v < P.length / 3; v++) {
    const key = [P[3 * v], P[3 * v + 1], P[3 * v + 2]].map(x => Math.round(x * 1e4)).join(',');
    const grid = Math.floor(v / per);
    for (const o of buckets.get(key) || []) {
      if (o.grid === grid) continue;
      const c = Math.max(-1, Math.min(1, N[3 * v] * N[3 * o.v] + N[3 * v + 1] * N[3 * o.v + 1] + N[3 * v + 2] * N[3 * o.v + 2]));
      worst = Math.max(worst, Math.acos(c) * 180 / Math.PI);
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ v, grid });
  }
  return worst;
}

// ── Patch detection ──
{
  const sheet = load('sheet'), pebble = load('pebble'), drum = load('drum');
  const ks = kinds(SP.findPatches(sheet, SP.buildGraph(sheet)));
  check('sheet: 25 four-point patches', ks[4] === 25 && Object.keys(ks).length === 1, JSON.stringify(ks));
  const kp = kinds(SP.findPatches(pebble, SP.buildGraph(pebble)));
  check('pebble: 10 four-point + 2 five-point patches', kp[4] === 10 && kp[5] === 2 && !kp[3], JSON.stringify(kp));
  const kd = kinds(SP.findPatches(drum, SP.buildGraph(drum)));
  check('drum: 6 three-point patches (6-ring rim ignored)', kd[3] === 6 && Object.keys(kd).length === 1, JSON.stringify(kd));
  const cand = SP.fiveCandidates(pebble, SP.buildGraph(pebble));
  check('pebble: 3 five-point candidates (top, waist, bottom rings)', cand.length === 3, String(cand.length));
}

// Triangle + quad sharing an edge: the 5-loop around both has a chord and is not a patch.
{
  const m = SP.createModel({
    cps: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0]],
    splines: [{ cps: [0, 1, 2] }, { cps: [3, 4] }, { cps: [0, 3] }, { cps: [1, 4, 2] }],
  });
  const g = SP.buildGraph(m);
  const ks = kinds(SP.findPatches(m, g));
  check('tri + quad: one of each, no outline patch', ks[3] === 1 && ks[4] === 1, JSON.stringify(ks));
  check('tri + quad: outline is not a 5-point candidate', SP.fiveCandidates(m, g).length === 0);
}

// ── Surface shape ──
{
  // Flat grid stays flat.
  const spec = SP.presets.sheet();
  spec.cps.forEach(c => { c.pos[2] = 0; });
  const flat = SP.tessellate(SP.createModel(spec), { subdiv: 6 });
  let maxZ = 0;
  for (let i = 2; i < flat.positions.length; i += 3) maxZ = Math.max(maxZ, Math.abs(flat.positions[i]));
  check('planar cage → planar surface', maxZ < 1e-6, `max |z| = ${maxZ.toExponential(2)}`);

  // Boundary of every patch interpolates its CPs.
  const sheet = load('sheet');
  const t = SP.tessellate(sheet, { subdiv: 4, weldNormals: false });
  let miss = 0;
  for (const cp of sheet.cps) {
    let best = Infinity;
    for (let i = 0; i < t.positions.length; i += 3) best = Math.min(best, len(sub(cp.pos, [t.positions[i], t.positions[i + 1], t.positions[i + 2]])));
    miss = Math.max(miss, best);
  }
  check('surface passes through every CP', miss < 1e-6, `worst gap ${miss.toExponential(2)}`);

  const sa = seamAngle(t, 4);
  check('sheet seams are smooth (< 1°)', sa < 1, `${sa.toFixed(3)}°`);

  const pebble = load('pebble');
  const tp = SP.tessellate(pebble, { subdiv: 8, weldNormals: false });
  const pa = seamAngle(tp, 8);
  check('pebble seams, 5-point caps included (< 4°)', pa < 4, `${pa.toFixed(2)}°`);

  const drum = load('drum');
  const da = seamAngle(SP.tessellate(drum, { subdiv: 8, weldNormals: false }), 8);
  check('drum seams, 3-point patches (< 1°)', da < 1, `${da.toFixed(2)}°`);

  // Closed body: normals point away from the centre.
  let inward = 0;
  for (let i = 0; i < tp.positions.length; i += 3) {
    const p = [tp.positions[i], tp.positions[i + 1], tp.positions[i + 2]];
    if (dot(p, [tp.normals[i], tp.normals[i + 1], tp.normals[i + 2]]) < 0) inward++;
  }
  check('pebble normals all face outward', inward === 0, `${inward} inward`);

  // The 5-point cap bulges above its rim instead of lying flat.
  let top = -Infinity;
  for (let i = 1; i < tp.positions.length; i += 3) top = Math.max(top, tp.positions[i]);
  check('pebble cap domes above its rim (y > 1.15)', top > 1.2, `top y = ${top.toFixed(3)}`);

  // Bias: magnitude 0 on a CP makes its tangent vanish (a sharp point).
  const m = load('sheet');
  m.cps[14].bias.mag = 0;
  const g = SP.buildGraph(m);
  const out = SP.edgeBez(g, 14, 15);
  check('magnitude 0 collapses the handle onto the CP', len(sub(out[1], m.cps[14].pos)) < 1e-12);
}

// ── Dynamics ──
{
  // Undisturbed pose is at rest.
  const m = load('pebble');
  const sim = SP.createSim(m, { gravity: 0 });
  const before = m.cps.map(c => c.pos.slice());
  for (let i = 0; i < 60; i++) SP.stepSim(m, sim, 1 / 60);
  const drift = Math.max(...m.cps.map((c, i) => len(sub(c.pos, before[i]))));
  check('rest pose stays put with no forces', drift < 1e-9, drift.toExponential(2));

  // A poke rings down under damping.
  sim.vel[0] = [0, 4, 0];
  const e0 = SP.kineticEnergy(m, sim);
  for (let i = 0; i < 600; i++) SP.stepSim(m, sim, 1 / 60);
  const e1 = SP.kineticEnergy(m, sim);
  check('poke energy decays', e1 < e0 * 0.01, `${e0.toFixed(3)} → ${e1.toExponential(2)}`);

  // Pebble dropped on the floor comes to rest above it and keeps its shape.
  const p = load('pebble');
  const ps = SP.createSim(p, SP.presets.pebble().sim);
  let finite = true;
  for (let i = 0; i < 600; i++) { SP.stepSim(p, ps, 1 / 60); finite = finite && p.cps.every(c => c.pos.every(Number.isFinite)); }
  const minY = Math.min(...p.cps.map(c => c.pos[1]));
  const width = len(sub(p.cps[5].pos, p.cps[7].pos)) / len(sub(load('pebble').cps[5].pos, load('pebble').cps[7].pos));
  check('dropped pebble settles on the floor', finite && minY >= -2.2 - 1e-9 && SP.kineticEnergy(p, ps) < 0.05, `min y ${minY.toFixed(3)}`);
  check('dropped pebble keeps its shape (waist width within 15%)', Math.abs(width - 1) < 0.15, width.toFixed(3));

  // Hanging sheet: pinned row fixed, rest of it sags and stays bounded.
  const s = load('sheet');
  const ss = SP.createSim(s, SP.presets.sheet().sim);
  const pin0 = s.cps[0].pos.slice(), low0 = s.cps[35].pos[1];
  for (let i = 0; i < 300; i++) SP.stepSim(s, ss, 1 / 60);
  check('pinned CP does not move', len(sub(s.cps[0].pos, pin0)) < 1e-12);
  check('free corner sags under gravity, bounded', s.cps[35].pos[1] < low0 && s.cps[35].pos[1] > low0 - 2, `${low0.toFixed(2)} → ${s.cps[35].pos[1].toFixed(2)}`);

  // Driven drum: the hub responds to the rim's motion.
  const d = load('drum');
  const ds = SP.createSim(d, SP.presets.drum().sim);
  let hubMax = 0;
  for (let i = 0; i < 600; i++) { SP.stepSim(d, ds, 1 / 60); hubMax = Math.max(hubMax, Math.abs(d.cps[0].pos[1])); }
  check('driven rim sets the hub moving', hubMax > 0.05 && hubMax < 5, `hub |y| max ${hubMax.toFixed(3)}`);
}

// ── Round trip ──
{
  const m = load('pebble');
  const back = SP.createModel(JSON.parse(JSON.stringify(SP.toJSON(m))));
  check('JSON round trip keeps the patch set', SP.findPatches(back, SP.buildGraph(back)).length === 12);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
