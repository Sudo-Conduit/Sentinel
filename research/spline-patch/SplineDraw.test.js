// ─── Spline Draw — checks ──────────────────────────────────────────────
// Run: node research/spline-patch/SplineDraw.test.js

'use strict';
const SP = require('./SplinePatch.js');
const SD = require('./SplineDraw.js');
const { sub, dot, len } = SP.vec;

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}

const blank = () => SP.createModel({ cps: [], splines: [] });
const kinds = m => SP.findPatches(m, SP.buildGraph(m)).reduce((k, p) => { k[p.ring.length] = (k[p.ring.length] || 0) + 1; return k; }, {});
const front = SD.PLANES.front;

// n×n grid of CPs drawn in a plane, joined by row and column splines.
function drawGrid(m, n, plane, step) {
  const id = (i, j) => i + j * n, base = m.cps.length;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) SD.addCP(m, SD.from2D((i - (n - 1) / 2) * step, (j - (n - 1) / 2) * step, 0, plane));
  for (let j = 0; j < n; j++) SD.addSpline(m, Array.from({ length: n }, (_, i) => base + id(i, j)));
  for (let i = 0; i < n; i++) SD.addSpline(m, Array.from({ length: n }, (_, j) => base + id(i, j)));
}

function seamAngle(model, subdiv) {
  const t = SP.tessellate(model, { subdiv, weldNormals: false }), per = (subdiv + 1) ** 2, P = t.positions, N = t.normals;
  const buckets = new Map();
  let worst = 0;
  for (let v = 0; v < P.length / 3; v++) {
    const key = [0, 1, 2].map(c => Math.round(P[3 * v + c] * 1e4)).join(','), grid = Math.floor(v / per);
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

// ── Planes ──
{
  let ok = true;
  for (const pl of Object.values(SD.PLANES)) {
    const p = [0.3, -1.2, 2.5], [a, b] = SD.to2D(p, pl), back = SD.from2D(a, b, SD.depthOf(p, pl), pl);
    ok = ok && len(sub(back, p)) < 1e-12;
  }
  check('to2D / from2D round-trip in all three planes', ok);
}

// ── Drawing ──
{
  const m = blank();
  const ids = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => SD.addCP(m, SD.from2D(a, b, 0, front)));
  const si = SD.addSpline(m, [ids[0]]);
  const r = [ids[1], ids[2], ids[3], ids[3], ids[0]].map(id => SD.appendToSpline(m, si, id));
  check('stroke: repeat click ignored, clicking the start closes the loop', r.join() === 'added,added,added,ignored,closed', r.join());
  check('closed 4-loop drawn by clicks is a 4-point patch', kinds(m)[4] === 1);

  // Split the patch the A:M way: a CP on two opposite edges, joined by a new spline.
  const before = SP.evalBez(SP.edgeBez(SP.buildGraph(m), ids[0], ids[1]), 0.5);
  const a = SD.insertCP(m, ids[0], ids[1], 0.5);
  check('inserted CP lies on the original curve', len(sub(m.cps[a].pos, before)) < 1e-12);
  check('quad with an extra CP on one side is no longer a patch', !kinds(m)[4]);
  const b = SD.insertCP(m, ids[2], ids[3], 0.5);
  SD.addSpline(m, [a, b]);
  check('spline across the loop splits it into two 4-point patches', kinds(m)[4] === 2, JSON.stringify(kinds(m)));

  const g = blank();
  drawGrid(g, 3, front, 1);
  check('3×3 drawn grid → 4 patches', kinds(g)[4] === 4);
  SD.removeCP(g, 4);
  const refs = g.splines.flatMap(s => s.cps);
  check('removing a CP re-indexes the rest', g.cps.length === 8 && refs.every(id => id >= 0 && id < 8) && g.cps.every((c, i) => c.id === i));
  check('removing the centre CP joins its neighbours', g.splines.some(s => s.cps.join() === '3,4'), JSON.stringify(g.splines.map(s => s.cps)));

  const o = blank();
  SD.addCP(o, [0, 0, 0]); SD.addCP(o, [1, 0, 0]); SD.addCP(o, [2, 0, 0]);
  SD.addSpline(o, [1, 2]);
  SD.removeOrphans(o);
  check('orphan CPs are dropped', o.cps.length === 2 && o.splines[0].cps.join() === '0,1');
}

// ── Lift: inflate ──
{
  const m = blank();
  drawGrid(m, 5, front, 0.75);
  const moved = SD.inflate(m, front, 1.2);
  const depth = m.cps.map(c => SD.depthOf(c.pos, front));
  const rim = [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24];
  check('inflate leaves the outline in the plane', rim.every(i => Math.abs(depth[i]) < 1e-12));
  check('inflate raises the middle by the full amount', Math.abs(depth[12] - 1.2) < 1e-9 && moved === 9, `centre ${depth[12].toFixed(3)}, moved ${moved}`);
  check('inflate keeps the patch set (16 quads)', kinds(m)[4] === 16);
  const sa = seamAngle(m, 6);
  check('inflated surface is smooth across seams (< 1°)', sa < 1, `${sa.toFixed(3)}°`);
}

// ── Lift: extrude ──
{
  const m = blank();
  const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => SD.addCP(m, SD.from2D(a, b, 0, SD.PLANES.top)));
  const si = SD.addSpline(m, ids, true);
  const copy = SD.extrude(m, si, [0, 1.5, 0]);
  check('extruding a closed square makes a tube of 4 quads (+ 2 caps)', kinds(m)[4] === 6, JSON.stringify(kinds(m)));
  SD.extrude(m, copy, [0, 1.5, 0]);
  check('extruding the copy again adds a band; the middle ring is not capped', kinds(m)[4] === 10, JSON.stringify(kinds(m)));
}

// ── Lift: lathe ──
{
  // Half-circle profile from pole to pole → a closed sphere.
  const m = blank();
  const prof = [];
  for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 - (k / 4) * Math.PI; prof.push(SD.addCP(m, SD.from2D(Math.cos(a), Math.sin(a), 0, front))); }
  const si = SD.addSpline(m, prof);
  SD.lathe(m, si, front, 8, 0);
  const k = kinds(m);
  check('lathe 8: sphere of 16 quads + 16 pole triangles', k[4] === 16 && k[3] === 16 && m.cps.length === 2 + 3 * 8, JSON.stringify(k) + `, ${m.cps.length} CPs`);
  check('lathe 8: opposite profiles join through the poles (4 meridians + 3 rings)', m.splines.length === 7 && m.splines.slice(0, 4).every(s => s.closed && s.cps.length === 8));
  const t = SP.tessellate(m, { subdiv: 6 });
  let worstR = 0, inward = 0;
  for (let i = 0; i < t.positions.length; i += 3) {
    const p = [t.positions[i], t.positions[i + 1], t.positions[i + 2]];
    worstR = Math.max(worstR, Math.abs(len(p) - 1));
    if (dot(p, [t.normals[i], t.normals[i + 1], t.normals[i + 2]]) < 0) inward++;
  }
  check('lathed sphere stays near radius 1 (< 6%)', worstR < 0.06, `worst ${(worstR * 100).toFixed(1)}%`);
  check('lathed sphere normals face outward', inward === 0, `${inward} inward`);
  const sa = seamAngle(m, 6);
  check('lathed sphere is smooth, poles included (< 3°)', sa < 3, `${sa.toFixed(2)}°`);

  // Odd segment count: profiles stay separate, still closes.
  const o = blank();
  const p2 = [];
  for (let j = 0; j <= 4; j++) { const a = Math.PI / 2 - (j / 4) * Math.PI; p2.push(SD.addCP(o, SD.from2D(Math.cos(a), Math.sin(a), 0, front))); }
  SD.lathe(o, SD.addSpline(o, p2), front, 5, 0);
  const ko = kinds(o);
  check('lathe 5: 10 quads + 10 pole triangles', ko[4] === 10 && ko[3] === 10, JSON.stringify(ko));

  // Closed profile off the axis → torus.
  const tor = blank();
  const ring = [];
  for (let j = 0; j < 4; j++) { const a = (j / 4) * 2 * Math.PI; ring.push(SD.addCP(tor, SD.from2D(2 + 0.6 * Math.cos(a), 0.6 * Math.sin(a), 0, front))); }
  SD.lathe(tor, SD.addSpline(tor, ring, true), front, 6, 0);
  check('lathe of a closed off-axis loop → torus of 24 quads, no ring membranes', kinds(tor)[4] === 24, JSON.stringify(kinds(tor)));
}

// ── SVG ──
{
  const sq = SD.parseSvgPath('M0 0 L10 0 L10 10 L0 10 Z');
  check('svg: absolute square', sq.length === 1 && sq[0].closed && sq[0].points.length === 4);
  const rel = SD.parseSvgPath('m0 0 l10 0 0 10 -10 0 z');
  check('svg: relative commands with implicit repeats', rel[0].points.map(p => p.join(',')).join(' ') === '0,0 10,0 10,10 0,10' && rel[0].closed);
  const hv = SD.parseSvgPath('M1 1 H5 V4 h-2 v-1');
  check('svg: H/V/h/v', hv[0].points.map(p => p.join(',')).join(' ') === '1,1 5,1 5,4 3,4 3,3');
  const cu = SD.parseSvgPath('M0 0 C0 10 10 10 10 0', 2);
  check('svg: cubic with a midpoint sample', cu[0].points.length === 3 && Math.abs(cu[0].points[1][1] - 7.5) < 1e-9, JSON.stringify(cu[0].points));
  const sm = SD.parseSvgPath('M0 0 C0 5 5 5 5 0 S10 -5 10 0 Q15 5 20 0 T30 0');
  check('svg: S / Q / T reach the right end points', sm[0].points.map(p => p.join(',')).join(' ') === '0,0 5,0 10,0 20,0 30,0');
  const two = SD.parseSvgPath('M0 0 L1 0 M5 5 L6 6 L5 6 Z');
  check('svg: two subpaths', two.length === 2 && !two[0].closed && two[1].closed);
  const back = SD.parseSvgPath('M0 0 L4 0 L4 4 L0 0');
  check('svg: path returning to its start counts as closed', back[0].closed && back[0].points.length === 3);
  const junk = SD.parseSvgPath('M 1 2 Z 3 4 5 ? L');
  check('svg: malformed input does not hang', Array.isArray(junk));

  const m = blank();
  SD.importSvgPaths(m, SD.parseSvgPath('M0 0 L100 0 L100 100 L0 100 Z M100 0 L200 0 L200 100 L100 100'), front, 4);
  check('svg import: touching paths share CPs', m.cps.length === 6, `${m.cps.length} CPs`);
  const top = m.cps.map(c => SD.to2D(c.pos, front)[1]);
  check('svg import: y is flipped (SVG down → up)', Math.abs(Math.max(...top) - 1) < 1e-9 && Math.abs(Math.min(...top) + 1) < 1e-9);
  check('svg import: closed square + open bracket close into two quads', kinds(m)[4] === 2, JSON.stringify(kinds(m)));

  const pebble = SP.createModel(SP.presets.pebble());
  const svg = SD.exportSvg(pebble, front);
  const fills = (svg.match(/<path d="M[^"]*Z"\/>/g) || []).length;
  check('svg export: one filled path per patch plus a stroke path', svg.startsWith('<svg') && fills === 12 && /stroke-width/.test(svg), `${fills} fills`);
  const round = SD.parseSvgPath(svg.match(/<path d="([^"]*)" fill="none"/)[1]);
  // Segments whose ends coincide in this view (3 of the pebble's ring edges, seen edge-on) collapse.
  const visible = [...SP.buildGraph(pebble).edges.values()].filter(e => len(sub(SD.to2D(e.bez[0], front).concat(0), SD.to2D(e.bez[3], front).concat(0))) > 1e-9).length;
  check('svg export: stroke path parses back (one subpath per visible spline segment)', round.length === visible, `${round.length} of ${visible}`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
