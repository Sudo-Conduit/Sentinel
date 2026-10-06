// ─── Spline Patch (SP) — Hash-style 3/4/5-point patch surfaces + CP dynamics ───
// Author: Will Fobbs
// Company: Pooled Impact
// Confidential & Proprietary — Not for distribution
//
// A model is a network of control points (CPs) joined by splines, in the spirit of
// Animation:Master. Splines pass *through* every CP; a CP shared by two splines is where
// they cross. Faces are never declared: any closed loop of 3 or 4 spline segments becomes
// a patch automatically, and 5-point patches are flagged explicitly (as in A:M), because
// odd rings show up all over a spline cage and most of them are not meant to be surfaces.
//
// Surfacing:
//   • every spline segment → a cubic Bézier (Catmull-Rom tangents, scaled/rotated by the
//     CP's magnitude / alpha / gamma bias),
//   • a 4-point patch → a Gregory quad whose cross-boundary derivatives are built per edge
//     from the corner handles, so neighbouring patches meet with matching normals,
//   • a 3- or 5-point patch → split into n quads around a lifted centre point, each
//     surfaced the same way.
//
// Dynamics: each CP is a unit mass; spline segments, skip-one "bend" links and patch
// diagonals are springs whose rest lengths are the pose at the moment the sim starts.
// Pinned CPs can be driven sinusoidally, so a disturbance can be watched travelling
// through the network.
//
// Pure math, no three.js dependency: the viewer turns the arrays into BufferGeometry.

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SplinePatch = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  'use strict';

  // ── Vectors (plain [x, y, z] arrays) ─────────────────────────────────

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.sqrt(dot(a, a));
  const norm = a => { const l = len(a); return l < 1e-12 ? [0, 0, 0] : scale(a, 1 / l); };
  const lerp = (a, b, t) => madd(a, sub(b, a), t);
  // Component of v perpendicular to the unit vector axis.
  const reject = (v, axis) => madd(v, axis, -dot(v, axis));
  const DEG = Math.PI / 180;

  // Rodrigues rotation of v about axis by ang radians.
  function rotate(v, axis, ang) {
    const k = norm(axis);
    if (!ang || !len(k)) return v.slice();
    const c = Math.cos(ang), s = Math.sin(ang);
    return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
  }

  const edgeKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  // How "straight" a patch corner is, from the cosine of the angle between its two edge
  // handles: 0 up to ~145°, ramping to 1 by ~170°. Only near-straight corners (a smooth
  // spline running through, like a 5-point cap's rim) need the inward-direction fix-up;
  // switching it on earlier makes ordinary obtuse/acute neighbours disagree at their seam.
  const straightness = cos => Math.min(1, Math.max(0, (-cos - 0.82) / 0.16));

  function centroid(model, ids) {
    let c = [0, 0, 0];
    for (const id of ids) c = add(c, model.cps[id].pos);
    return scale(c, 1 / Math.max(1, ids.length));
  }

  // ── Model ────────────────────────────────────────────────────────────
  // spec.cps: [x,y,z] or { pos, bias:{mag,alpha,gamma}, pinned }
  // spec.splines: { cps:[ids], closed }   spec.fivePatches: [[ids]]

  function createModel(spec) {
    return {
      cps: spec.cps.map((c, i) => ({
        id: i,
        pos: (c.pos || c).slice(),
        bias: Object.assign({ mag: 1, alpha: 0, gamma: 0 }, c.bias),
        pinned: !!c.pinned,
      })),
      splines: spec.splines.map(s => ({ cps: s.cps.slice(), closed: !!s.closed })),
      fivePatches: (spec.fivePatches || []).map(r => r.slice()),
    };
  }

  function toJSON(model) {
    return {
      cps: model.cps.map(c => ({ pos: c.pos.slice(), bias: Object.assign({}, c.bias), pinned: c.pinned })),
      splines: model.splines.map(s => ({ cps: s.cps.slice(), closed: s.closed })),
      fivePatches: model.fivePatches.map(r => r.slice()),
    };
  }

  // ── Splines → Bézier edges ───────────────────────────────────────────

  // Tangent at every CP of a spline. Interior CPs use the Catmull-Rom chord; open ends use
  // the one-sided chord. Bias: magnitude scales, gamma swings the tangent within the plane
  // of its neighbours, alpha tilts it out of that plane.
  function splineTangents(model, spline) {
    const ids = spline.cps, n = ids.length, P = k => model.cps[ids[k]].pos;
    const T = [];
    for (let k = 0; k < n; k++) {
      const hasPrev = k > 0 || spline.closed, hasNext = k < n - 1 || spline.closed;
      const p = P(k), pp = hasPrev ? P((k - 1 + n) % n) : null, pn = hasNext ? P((k + 1) % n) : null;
      let t;
      if (pp && pn) t = scale(sub(pn, pp), 0.5);
      else if (pn) t = sub(pn, p);
      else if (pp) t = sub(p, pp);
      else t = [0, 0, 0];
      const b = model.cps[ids[k]].bias;
      if (pp && pn && (b.gamma || b.alpha)) {
        let axis = norm(cross(sub(p, pp), sub(pn, p)));
        if (!len(axis)) axis = norm(cross(t, Math.abs(norm(t)[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
        t = rotate(t, axis, b.gamma * DEG);
        t = rotate(t, cross(t, axis), b.alpha * DEG);
      }
      T.push(scale(t, b.mag));
    }
    return T;
  }

  // The spline network as a graph: one cubic Bézier per segment plus CP adjacency.
  function buildGraph(model) {
    const edges = new Map(), adj = model.cps.map(() => new Set());
    model.splines.forEach((s, si) => {
      const ids = s.cps, n = ids.length;
      if (n < 2) return;
      const T = splineTangents(model, s);
      const segs = s.closed ? n : n - 1;
      for (let k = 0; k < segs; k++) {
        const k2 = (k + 1) % n, a = ids[k], b = ids[k2];
        const key = edgeKey(a, b);
        if (a === b || edges.has(key)) continue;
        const pa = model.cps[a].pos, pb = model.cps[b].pos;
        edges.set(key, { a, b, spline: si, bez: [pa.slice(), madd(pa, T[k], 1 / 3), madd(pb, T[k2], -1 / 3), pb.slice()] });
        adj[a].add(b);
        adj[b].add(a);
      }
    });
    return { edges, adj };
  }

  // Bézier of the segment a→b, oriented from a to b.
  function edgeBez(g, a, b) {
    const e = g.edges.get(edgeKey(a, b));
    if (!e) return null;
    return e.a === a ? e.bez : e.bez.slice().reverse();
  }

  // ── Patch detection ──────────────────────────────────────────────────

  // Simple cycles of length minLen..maxLen, each reported once.
  function findCycles(adj, minLen, maxLen) {
    const out = [], seen = new Set();
    for (let s = 0; s < adj.length; s++) {
      const path = [s], onPath = new Set([s]);
      const dfs = v => {
        for (const w of adj[v]) {
          if (w === s) {
            // path[1] < last: report each cycle in one direction only.
            if (path.length >= minLen && path[1] < path[path.length - 1]) {
              const key = path.slice().sort((x, y) => x - y).join(',');
              if (!seen.has(key)) { seen.add(key); out.push(path.slice()); }
            }
          } else if (w > s && !onPath.has(w) && path.length < maxLen) {
            path.push(w); onPath.add(w);
            dfs(w);
            path.pop(); onPath.delete(w);
          }
        }
      };
      dfs(s);
    }
    return out;
  }

  // A loop with a chord (e.g. the outline of a triangle + quad pair) is not a patch.
  function isChordless(adj, ring) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (adj[ring[i]].has(ring[j])) return false;
      }
    }
    return true;
  }

  function ringIsClosed(g, ring) {
    return ring.length >= 3 && ring.every((a, i) => g.edges.has(edgeKey(a, ring[(i + 1) % ring.length])));
  }

  const ringKey = ring => ring.slice().sort((x, y) => x - y).join(',');

  function findPatches(model, g) {
    const patches = [], keys = new Set();
    for (const ring of findCycles(g.adj, 3, 4)) {
      if (isChordless(g.adj, ring)) { patches.push({ ring, auto: true }); keys.add(ringKey(ring)); }
    }
    for (const ring of model.fivePatches) {
      if (ringIsClosed(g, ring) && !keys.has(ringKey(ring))) { patches.push({ ring: ring.slice() }); keys.add(ringKey(ring)); }
    }
    dropMembranes(patches);
    return orientPatches(model, patches.map(p => ({ ring: p.ring })));
  }

  // A 3- or 4-CP ring inside a tube (a ring of an extrusion, the profile rings of a lathed
  // torus) closes into a loop too, but it is a membrane across the inside: every one of its
  // edges already borders two other patches. Drop those, one at a time, until the surface
  // is manifold again. Flagged 5-point patches are the user's call and always stay.
  function dropMembranes(patches) {
    const edgesOf = ring => ring.map((a, k) => edgeKey(a, ring[(k + 1) % ring.length]));
    for (;;) {
      const count = new Map();
      for (const p of patches) for (const k of edgesOf(p.ring)) count.set(k, (count.get(k) || 0) + 1);
      const i = patches.findIndex(p => p.auto && edgesOf(p.ring).every(k => count.get(k) >= 3));
      if (i < 0) return;
      patches.splice(i, 1);
    }
  }

  // Chordless 5-loops that could be flagged as 5-point patches.
  function fiveCandidates(model, g) {
    return findCycles(g.adj, 5, 5).filter(r => isChordless(g.adj, r));
  }

  function newellNormal(model, ring) {
    const n = [0, 0, 0];
    for (let i = 0; i < ring.length; i++) {
      const a = model.cps[ring[i]].pos, b = model.cps[ring[(i + 1) % ring.length]].pos;
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return n;
  }

  // Neighbouring patches must run their shared edge in opposite directions; then each
  // connected surface is flipped so its normals point away from its centre.
  function orientPatches(model, patches) {
    const byEdge = new Map();
    patches.forEach((p, i) => p.ring.forEach((a, k) => {
      const key = edgeKey(a, p.ring[(k + 1) % p.ring.length]);
      if (!byEdge.has(key)) byEdge.set(key, []);
      byEdge.get(key).push(i);
    }));
    const runsForward = (ring, a, b) => ring.some((x, k) => x === a && ring[(k + 1) % ring.length] === b);
    const done = new Array(patches.length).fill(false);
    for (let s = 0; s < patches.length; s++) {
      if (done[s]) continue;
      const comp = [s];
      done[s] = true;
      for (let qi = 0; qi < comp.length; qi++) {
        const ring = patches[comp[qi]].ring, n = ring.length;
        for (let k = 0; k < n; k++) {
          const a = ring[k], b = ring[(k + 1) % n];
          for (const j of byEdge.get(edgeKey(a, b))) {
            if (done[j]) continue;
            if (runsForward(patches[j].ring, a, b)) patches[j].ring.reverse();
            done[j] = true;
            comp.push(j);
          }
        }
      }
      const c = centroid(model, [...new Set(comp.flatMap(i => patches[i].ring))]);
      let score = 0;
      for (const i of comp) score += dot(newellNormal(model, patches[i].ring), sub(centroid(model, patches[i].ring), c));
      if (score < 0) for (const i of comp) patches[i].ring.reverse();
    }
    return patches;
  }

  // ── Béziers ──────────────────────────────────────────────────────────

  function splitBez(b, t) {
    const ab = lerp(b[0], b[1], t), bc = lerp(b[1], b[2], t), cd = lerp(b[2], b[3], t);
    const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
    return [[b[0].slice(), ab, abc, m], [m.slice(), bcd, cd, b[3].slice()]];
  }

  function bern(t) { const s = 1 - t; return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]; }
  function dbern(t) { const s = 1 - t; return [-3 * s * s, 3 * s * s - 6 * s * t, 6 * s * t - 3 * t * t, 3 * t * t]; }

  function evalBez(b, t) {
    const w = bern(t);
    return [0, 1, 2].map(c => b[0][c] * w[0] + b[1][c] * w[1] + b[2][c] * w[2] + b[3][c] * w[3]);
  }

  // ── Surfacing ────────────────────────────────────────────────────────

  // Unit direction in which the surface leaves the boundary into the patch at corner k.
  // When another spline runs through the corner from outside the patch, its tangent
  // (reversed) is that direction. That keeps a 5-point cap, whose boundary is usually one
  // smooth closed spline, flush with the quads around it.
  function cornerCross(model, g, ring, k, inwardRef) {
    const n = ring.length, a = ring[k], prev = ring[(k - 1 + n) % n], next = ring[(k + 1) % n];
    const pa = model.cps[a].pos;
    const hOut = sub(edgeBez(g, a, next)[1], pa), hIn = sub(edgeBez(g, a, prev)[1], pa);
    const t = norm(sub(norm(hOut), norm(hIn)));
    let x = [0, 0, 0];
    for (const o of g.adj[a]) {
      if (o === prev || o === next) continue;
      x = madd(x, reject(sub(edgeBez(g, a, o)[1], pa), t), -1);
    }
    if (len(x) < 1e-9) x = reject(add(hIn, hOut), t);
    if (len(x) < 1e-9) x = reject(sub(inwardRef, pa), t);
    if (dot(x, sub(inwardRef, pa)) < 0) x = scale(x, -1);
    return norm(x);
  }

  // Gregory quad from 4 Béziers chained q0→q1→q2→q3→q0. u runs q0→q1, v runs q0→q3.
  //
  // A plain bicubic has one interior point per corner, shared by both edges that meet
  // there, so it cannot give each edge the cross-derivative its neighbour expects. A
  // Gregory patch keeps two per corner (one per edge) and blends them rationally, so each
  // edge's cross-derivative can be built on its own:
  //   cross(t) = α(t)·e'(t) + w(t)
  // where the corner cross vectors (the handle of the other edge at each end) are split into
  // a part along the edge (α) and a transverse part (w), and both are interpolated linearly
  // along the edge. Two patches whose corner vectors mirror each other across the edge
  // then meet with matching normals all along it, however the edge curves.
  //
  // Where a corner's two boundary handles are nearly opposite (a smooth boundary, e.g. the
  // rim CPs of a 5-point cap) the transverse part would vanish, so the inward cross
  // direction X[corner] supplies it.
  function gregoryQuad(E, X) {
    const b = [[], [], [], []];
    for (let i = 0; i < 4; i++) {
      b[i][0] = E[0][i];
      b[3][i] = E[1][i];
      b[3 - i][3] = E[2][i];
      b[0][3 - i] = E[3][i];
    }
    const xterm = E.map((e, j) => {
      const q = e[0], a = sub(e[1], q), h = sub(E[(j + 3) % 4][2], q), la = len(a), lh = len(h);
      if (!X || !X[j] || la < 1e-12 || lh < 1e-12) return [0, 0, 0];
      return scale(X[j], straightness(dot(a, h) / (la * lh)) * (la + lh));
    });
    // Interior pair [near start, near end] for each edge.
    const inner = E.map((e, j) => {
      const j1 = (j + 1) % 4;
      const c0 = add(sub(E[(j + 3) % 4][2], e[0]), xterm[j]);
      const c3 = add(sub(E[j1][1], e[3]), xterm[j1]);
      const d0 = sub(e[1], e[0]), d1 = sub(e[2], e[1]), d2 = sub(e[3], e[2]);
      const a0 = dot(d0, d0) > 1e-18 ? dot(c0, d0) / dot(d0, d0) : 0;
      const a3 = dot(d2, d2) > 1e-18 ? dot(c3, d2) / dot(d2, d2) : 0;
      const w0 = madd(c0, d0, -a0), w3 = madd(c3, d2, -a3);
      // Cubic Bernstein coefficients of α(t)·e'(t)/3 + w(t) at t = 1/3 and 2/3.
      const k1 = add(add(scale(d1, 2 * a0 / 3), scale(d0, a3 / 3)), scale(add(scale(w0, 2), w3), 1 / 3));
      const k2 = add(add(scale(d2, a0 / 3), scale(d1, 2 * a3 / 3)), scale(add(w0, scale(w3, 2)), 1 / 3));
      return [add(e[1], k1), add(e[2], k2)];
    });
    // [i, j, u-edge version, v-edge version, s(u,v), t(u,v), ∂s/∂u, ∂t/∂v]: the point is
    // (s·A + t·B)/(s + t), which is A on the u-edge and B on the v-edge through that corner.
    const corners = [
      [1, 1, inner[0][0], inner[3][1], (u, v) => u, (u, v) => v, 1, 1],
      [2, 1, inner[0][1], inner[1][0], (u, v) => 1 - u, (u, v) => v, -1, 1],
      [2, 2, inner[2][0], inner[1][1], (u, v) => 1 - u, (u, v) => 1 - v, -1, -1],
      [1, 2, inner[2][1], inner[3][0], (u, v) => u, (u, v) => 1 - v, 1, -1],
    ];
    return { b, corners };
  }

  // Point, partials and twist of a Gregory quad.
  function evalQuad(q, u, v) {
    const b = q.b.map(r => r.slice()), dB = [];
    for (const [i, j, A, B, sf, tf, dsu, dtv] of q.corners) {
      const s = sf(u, v), t = tf(u, v), st = s + t;
      if (st < 1e-12) { b[i][j] = lerp(A, B, 0.5); continue; }
      b[i][j] = scale(add(scale(A, s), scale(B, t)), 1 / st);
      const AB = sub(A, B), k = 1 / (st * st);
      dB.push([i, j, scale(AB, dsu * t * k), scale(AB, -dtv * s * k)]);
    }
    const e = evalNet(b, u, v), Bu = bern(u), Bv = bern(v);
    for (const [i, j, gu, gv] of dB) {
      const w = Bu[i] * Bv[j];
      e.du = madd(e.du, gu, w);
      e.dv = madd(e.dv, gv, w);
    }
    return e;
  }

  function evalNet(b, u, v) {
    const Bu = bern(u), Bv = bern(v), Du = dbern(u), Dv = dbern(v);
    const p = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0], duv = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const q = b[i][j], w = Bu[i] * Bv[j], wu = Du[i] * Bv[j], wv = Bu[i] * Dv[j], wuv = Du[i] * Dv[j];
        for (let c = 0; c < 3; c++) { p[c] += q[c] * w; du[c] += q[c] * wu; dv[c] += q[c] * wv; duv[c] += q[c] * wuv; }
      }
    }
    return { p, du, dv, duv };
  }

  // Surface normal. At a corner whose two edges leave in the same line (the rim CPs of a
  // 5-point cap) du × dv vanishes; there the normal is taken as the limit along the u-edge,
  // where dv is that edge's cross-derivative (the inward direction X).
  function quadNormal(q, u, v) {
    const e = evalQuad(q, u, v);
    let n = cross(e.du, e.dv);
    if (len(n) < 1e-9 * Math.max(1e-12, len(e.du) * len(e.dv))) {
      const e2 = evalQuad(q, u < 0.5 ? u + 1e-6 : u - 1e-6, v);
      n = cross(e2.du, e2.dv);
    }
    return { p: e.p, n: norm(n) };
  }

  // A patch → one or more Gregory quads. Each carries, per corner, weights over the
  // patch's ring CPs so per-CP values (strain, speed) can be interpolated across it.
  function surfacePatch(model, g, patch) {
    const ring = patch.ring, n = ring.length;
    const ref = centroid(model, ring);
    const X = ring.map((_, k) => cornerCross(model, g, ring, k, ref));
    const E = ring.map((a, k) => edgeBez(g, a, ring[(k + 1) % n]));
    const unit = k => ring.map((_, i) => (i === k ? 1 : 0));
    if (n === 4) return [{ quad: gregoryQuad(E, X), w: [unit(0), unit(1), unit(2), unit(3)] }];

    // n-gon: split each edge at its midpoint and join the midpoints to a centre point that
    // is lifted along the surface normal by how steeply the boundary turns inward.
    const halves = E.map(e => splitBez(e, 0.5));
    const m = halves.map(h => h[1][0]);
    const along = m.map((mk, k) => norm(sub(halves[k][1][1], mk)));
    // Cross direction at each end of edge k: the neighbouring in-patch edge's handle (as
    // the quad zero-twist uses), handing over to X where that corner is smooth (~180°).
    const P = id => model.cps[id].pos;
    const endCross = (corner, other, k) => {
      const pa = P(ring[corner]), h = sub(edgeBez(g, ring[corner], ring[other])[1], pa);
      const e = sub(E[k][corner === k ? 1 : 2], pa);
      const f = straightness(dot(norm(h), norm(e)));
      return add(scale(norm(reject(h, norm(e))), 1 - f), scale(X[corner], f));
    };
    const xs = m.map((mk, k) => {
      const k1 = (k + 1) % n;
      let x = reject(add(endCross(k, (k - 1 + n) % n, k), endCross(k1, (k1 + 1) % n, k)), along[k]);
      if (len(x) < 1e-9) x = reject(sub(ref, mk), along[k]);
      if (dot(x, sub(ref, mk)) < 0) x = scale(x, -1);
      return norm(x);
    });
    const c0 = scale(m.reduce(add, [0, 0, 0]), 1 / n);
    const nc = norm(m.reduce((acc, _, k) => add(acc, cross(along[k], xs[k])), [0, 0, 0]));
    const lift = m.reduce((h, mk, k) => h + dot(xs[k], nc) * len(sub(mk, c0)) * 0.5, 0) / n;
    const c = madd(c0, nc, lift);
    // The spoke leaves m_k with a handle sized from edge k's chord (≈ a third of the
    // regular n-gon's inradius), not from this patch's own centre distance: two patches
    // sharing edge k then agree on the cross-derivative there and meet smoothly.
    const inradius = 1 / (2 * Math.tan(Math.PI / n));
    const spokes = m.map((mk, k) => {
      const d = len(sub(c, mk)), chord = len(sub(E[k][3], E[k][0]));
      return [mk.slice(), madd(mk, xs[k], chord * inradius / 3), madd(c, norm(reject(sub(mk, c), nc)), d / 3), c.slice()];
    });
    const centreW = ring.map(() => 1 / n);
    const midW = k => ring.map((_, i) => (i === k || i === (k + 1) % n ? 0.5 : 0));
    const quads = [];
    for (let k = 0; k < n; k++) {
      const kp = (k - 1 + n) % n;
      const Eq = [halves[k][0], spokes[k], spokes[kp].slice().reverse(), halves[kp][1]];
      quads.push({ quad: gregoryQuad(Eq, [X[k], null, null, null]), w: [unit(k), midW(k), centreW, midW(kp)] });
    }
    return quads;
  }

  // Whole model → triangle mesh. opts.subdiv: grid size per (sub)patch; opts.scalars:
  // optional per-CP values, interpolated into result.values; opts.weldNormals: false keeps
  // each patch's own normals at seams (used by the continuity checks).
  function tessellate(model, opts) {
    opts = opts || {};
    const N = Math.max(1, opts.subdiv | 0 || 8), scalars = opts.scalars || null;
    const g = buildGraph(model), patches = findPatches(model, g);
    const pos = [], nrm = [], val = [], idx = [];
    for (const patch of patches) {
      for (const q of surfacePatch(model, g, patch)) {
        const base = pos.length / 3;
        const cv = scalars ? q.w.map(w => w.reduce((s, wi, i) => s + wi * (scalars[patch.ring[i]] || 0), 0)) : null;
        for (let j = 0; j <= N; j++) {
          for (let i = 0; i <= N; i++) {
            const u = i / N, v = j / N, { p, n: nn } = quadNormal(q.quad, u, v);
            pos.push(p[0], p[1], p[2]);
            nrm.push(nn[0], nn[1], nn[2]);
            if (cv) val.push((1 - u) * (1 - v) * cv[0] + u * (1 - v) * cv[1] + u * v * cv[2] + (1 - u) * v * cv[3]);
          }
        }
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
            idx.push(a, b, d, a, d, c);
          }
        }
      }
    }
    if (opts.weldNormals !== false) weldNormals(pos, nrm);
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(nrm),
      values: scalars ? new Float32Array(val) : null,
      indices: new Uint32Array(idx),
      patches,
      graph: g,
    };
  }

  // Average the normals of coincident vertices (patch seams, the spokes of 3/5-point
  // patches) so shading runs smoothly across them. Geometry is untouched.
  function weldNormals(pos, nrm) {
    const groups = new Map();
    for (let v = 0; v < pos.length / 3; v++) {
      const key = Math.round(pos[3 * v] * 1e5) + ',' + Math.round(pos[3 * v + 1] * 1e5) + ',' + Math.round(pos[3 * v + 2] * 1e5);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    for (const vs of groups.values()) {
      if (vs.length < 2) continue;
      let n = [0, 0, 0];
      for (const v of vs) n = add(n, [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]]);
      n = norm(n);
      if (!len(n)) continue;
      for (const v of vs) { nrm[3 * v] = n[0]; nrm[3 * v + 1] = n[1]; nrm[3 * v + 2] = n[2]; }
    }
  }

  // Line-segment pairs tracing every spline segment, for drawing the cage.
  function edgeSamples(g, steps) {
    const out = [];
    for (const e of g.edges.values()) {
      let prev = e.bez[0];
      for (let i = 1; i <= steps; i++) {
        const p = evalBez(e.bez, i / steps);
        out.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]);
        prev = p;
      }
    }
    return new Float32Array(out);
  }

  // ── Dynamics ─────────────────────────────────────────────────────────

  const SIM_DEFAULTS = {
    stiffness: 80, damping: 0.8, drag: 0.15, gravity: 0, floor: null,
    driveAmp: 0, driveFreq: 0.5, driveAxis: [0, 1, 0], substeps: 10,
  };

  // Rest lengths are taken from the current pose.
  function createSim(model, params) {
    const g = buildGraph(model), patches = findPatches(model, g);
    const springs = [], have = new Set();
    const link = (a, b, kind) => {
      const key = edgeKey(a, b);
      if (a === b || have.has(key)) return;
      have.add(key);
      springs.push({ a, b, kind, rest: Math.max(1e-6, len(sub(model.cps[a].pos, model.cps[b].pos))) });
    };
    for (const e of g.edges.values()) link(e.a, e.b, 'edge');
    for (const s of model.splines) {
      const ids = s.cps, n = ids.length;
      for (let k = 0; k < n; k++) {
        if (!s.closed && (k === 0 || k === n - 1)) continue;
        link(ids[(k - 1 + n) % n], ids[(k + 1) % n], 'bend');
      }
    }
    for (const p of patches) {
      for (let i = 0; i < p.ring.length; i++) for (let j = i + 2; j < p.ring.length; j++) link(p.ring[i], p.ring[j], 'shear');
    }
    return {
      t: 0,
      params: Object.assign({}, SIM_DEFAULTS, params),
      springs,
      anchor: model.cps.map(c => c.pos.slice()),
      vel: model.cps.map(() => [0, 0, 0]),
      strain: model.cps.map(() => 0),
      speed: model.cps.map(() => 0),
    };
  }

  // Advance dt seconds. held: Set of CP ids the user is dragging (kept where they are).
  function stepSim(model, sim, dt, held) {
    const P = sim.params, cps = model.cps, steps = Math.max(1, P.substeps | 0), h = dt / steps;
    for (let s = 0; s < steps; s++) {
      sim.t += h;
      const F = cps.map(() => [0, -P.gravity, 0]);
      for (const sp of sim.springs) {
        const d = sub(cps[sp.b].pos, cps[sp.a].pos), L = len(d);
        if (L < 1e-9) continue;
        const dir = scale(d, 1 / L);
        const f = P.stiffness * (L - sp.rest) / sp.rest + P.damping * dot(sub(sim.vel[sp.b], sim.vel[sp.a]), dir);
        F[sp.a] = madd(F[sp.a], dir, f);
        F[sp.b] = madd(F[sp.b], dir, -f);
      }
      const drive = P.driveAmp * Math.sin(2 * Math.PI * P.driveFreq * sim.t);
      for (let i = 0; i < cps.length; i++) {
        const c = cps[i];
        if (held && held.has(i)) { sim.vel[i] = [0, 0, 0]; continue; }
        if (c.pinned) {
          const target = madd(sim.anchor[i], P.driveAxis, drive);
          sim.vel[i] = scale(sub(target, c.pos), 1 / h);
          c.pos = target;
          continue;
        }
        const v = scale(madd(sim.vel[i], F[i], h), 1 - P.drag * h);
        let p = madd(c.pos, v, h);
        if (P.floor !== null && P.floor !== undefined && p[1] < P.floor) {
          p = [p[0], P.floor, p[2]];
          v[1] = -v[1] * 0.3; v[0] *= 0.9; v[2] *= 0.9;
        }
        sim.vel[i] = v;
        c.pos = p;
      }
    }
    // Per-CP readouts: mean relative spring stretch, and speed.
    const sum = cps.map(() => 0), cnt = cps.map(() => 0);
    for (const sp of sim.springs) {
      const e = Math.abs(len(sub(cps[sp.b].pos, cps[sp.a].pos)) - sp.rest) / sp.rest;
      sum[sp.a] += e; sum[sp.b] += e; cnt[sp.a]++; cnt[sp.b]++;
    }
    sim.strain = sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
    sim.speed = sim.vel.map(len);
    return sim;
  }

  function kineticEnergy(model, sim) {
    return model.cps.reduce((e, c, i) => (c.pinned ? e : e + 0.5 * dot(sim.vel[i], sim.vel[i])), 0);
  }

  // ── Presets ──────────────────────────────────────────────────────────

  const presets = {
    // 6×6 cage of 4-point patches hanging from its pinned top row.
    sheet() {
      const nx = 6, ny = 6, cps = [], splines = [];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x = (i - (nx - 1) / 2) * 0.8, y = 2 - j * 0.8;
          cps.push({ pos: [x, y, 0.35 * Math.sin(x * 1.3) * Math.cos(y * 0.9)], pinned: j === 0 });
        }
      }
      for (let j = 0; j < ny; j++) splines.push({ cps: Array.from({ length: nx }, (_, i) => j * nx + i) });
      for (let i = 0; i < nx; i++) splines.push({ cps: Array.from({ length: ny }, (_, j) => j * nx + i) });
      return { name: 'Sheet', cps, splines, sim: { gravity: 9.8, stiffness: 160, damping: 1.2 } };
    },

    // Closed body: two 5-point caps joined by two bands of 4-point patches.
    pebble() {
      const rings = [[0.8, 1.15], [1.5, 0], [0.8, -1.15]], cps = [], splines = [];
      rings.forEach(([r, y]) => {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * 2 * Math.PI;
          cps.push({ pos: [r * Math.cos(a), y, r * Math.sin(a)] });
        }
      });
      const id = (ri, i) => ri * 5 + (i % 5);
      const loop = ri => [0, 1, 2, 3, 4].map(i => id(ri, i));
      for (let ri = 0; ri < 3; ri++) splines.push({ cps: loop(ri), closed: true });
      for (let i = 0; i < 5; i++) splines.push({ cps: [id(0, i), id(1, i), id(2, i)] });
      return {
        name: 'Pebble', cps, splines, fivePatches: [loop(0), loop(2)],
        sim: { gravity: 9.8, floor: -2.2, stiffness: 120, damping: 1.5 },
      };
    },

    // Saddle drum: six 3-point patches around a hub, rim pinned and driven up and down.
    drum() {
      const cps = [{ pos: [0, 0, 0] }], splines = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 2 * Math.PI;
        cps.push({ pos: [1.8 * Math.cos(a), 0.6 * Math.cos(2 * a), 1.8 * Math.sin(a)], pinned: true });
      }
      for (let i = 0; i < 3; i++) splines.push({ cps: [1 + i, 0, 4 + i] });
      splines.push({ cps: [1, 2, 3, 4, 5, 6], closed: true });
      return { name: 'Drum', cps, splines, sim: { stiffness: 40, damping: 0.2, drag: 0.05, driveAmp: 0.25, driveFreq: 0.8 } };
    },
  };

  return {
    vec: { add, sub, scale, madd, dot, cross, len, norm, lerp, rotate },
    edgeKey, createModel, toJSON,
    splineTangents, buildGraph, edgeBez,
    findCycles, isChordless, findPatches, fiveCandidates, ringKey,
    splitBez, evalBez, gregoryQuad, evalQuad, quadNormal, surfacePatch, tessellate, edgeSamples,
    SIM_DEFAULTS, createSim, stepSim, kineticEnergy,
    presets,
  };
}));
