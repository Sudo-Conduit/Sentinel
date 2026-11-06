// ─── Technic v3 — machines from beams, bricks, pins, axles, gears, pulleys, belts, ropes ───
// Author: Will Fobbs
// Company: Pooled Impact
// Confidential & Proprietary — Not for distribution
//
// Mechanism Lab v3. v2 (research/spline-patch/v2/) built machines on one fixed layer
// orientation and treated every beam as bolted to the world. v3 changes two things:
//
//   ORIENTATION  Every part points along a real axis. Beams run along x, y or z with
//                their holes facing another axis; axles, pins, gears, pulleys and motors
//                turn about x, y or z. The model is one 3D build; side, front, top and
//                free views are cameras on it, and building happens on a work plane that
//                faces the camera.
//
//   CONNECTION   Nothing is held up by being placed. Parts join the way Technic parts do:
//                  pins     join two parts whose holes line up on neighbouring cells
//                  axles    join every part whose hole they pass through (round holes:
//                           the part can still swing about the axle)
//                  studs    join a brick to the brick it sits on, and a brick on the
//                           ground to the baseplate
//                A rigid cluster is parts joined by studs or by two separate connector
//                lines. A cluster is fixed when it reaches the grounded frame through
//                studs or two separate lines; with one line it swings on a hinge; with
//                none it is loose. Only fixed parts can be bearings or hold a motor.
//
// Everything below the model (compile → ExtendX-composed Dofs and Joints, the direct
// solver, the hand calculation) is v2's, generalised from "about z" to "about any axis".

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./ExtendX'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./ExtendX.js'));
  } else {
    root.Technic = factory(root.ExtendX);
  }
}(typeof self !== 'undefined' ? self : this, function (ExtendX) {

  'use strict';

  const U = 0.008;                 // metres per hole pitch
  const G = 9.81;
  const TAU = Math.PI * 2;

  // ── Axes ─────────────────────────────────────────────────────────────
  const IDX = { x: 0, y: 1, z: 2 };
  const VEC = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  // In-plane frame for something turning about n, right-handed: u × v = n.
  const FRAME = { z: ['x', 'y'], x: ['y', 'z'], y: ['z', 'x'] };
  const other = (a, b) => ['x', 'y', 'z'].find(k => k !== a && k !== b);
  const P3 = p => [p.x, p.y, p.z];
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const key3 = c => c.join(',');
  const cellAlong = (c, a, k) => { const o = c.slice(); o[IDX[a]] += k; return o; };
  // A connector line: its axis plus where it crosses the plane perpendicular to it.
  const lineKey = (c, a) => { const [u, v] = FRAME[a]; return a + '@' + c[IDX[u]] + ',' + c[IDX[v]]; };

  // ── Catalogue ────────────────────────────────────────────────────────
  // Gear pitch radius = teeth / 16 holes, so standard pairs mesh at grid distances.
  const GEARS = { 8: { mass: 0.0006 }, 16: { mass: 0.0015 }, 24: { mass: 0.0025 }, 40: { mass: 0.006 } };
  const PULLEYS = { s: { r: 0.5, mass: 0.0008, label: 'small' }, m: { r: 1, mass: 0.0015, label: 'medium' }, l: { r: 1.5, mass: 0.003, label: 'large' } };
  const MESH_TOL = 0.06;
  const DEFAULTS = { bearingFriction: 0.0002, rackMass: 0.01, axleMass: 0.001 };

  function radiusOf(p) {
    if (p.type === 'gear') return p.teeth / 16;
    if (p.type === 'pulley') return PULLEYS[p.size].r;
    return 0;
  }
  const isWheel = p => p.type === 'gear' || p.type === 'pulley' || p.type === 'motor';
  const isWeight = p => p.type === 'brick' && p.free;
  const isStructure = p => p.type === 'beam' || (p.type === 'brick' && !p.free) || p.type === 'motor';
  const isConnector = p => p.type === 'pin' || p.type === 'axle';

  // ── Normalising (also migrates v2 models) ─────────────────────────────
  function normalize(p) {
    switch (p.type) {
      case 'beam':
        p.dir = p.dir || 'x';
        if (!p.holes || p.holes === p.dir) p.holes = p.dir === 'z' ? 'x' : 'z';
        break;
      case 'brick':
        if (p.anchored === false) p.free = true;
        delete p.anchored;
        p.free = !!p.free;
        p.d = p.d || 1;
        if (p.holes === undefined) p.holes = p.free ? null : (p.d === 1 ? 'z' : p.w === 1 ? 'x' : null);
        if (p.free && !(p.mass > 0)) p.mass = 0.5;
        break;
      case 'axle': case 'pin': case 'gear': case 'pulley': case 'motor':
        p.axis = p.axis || 'z';
        if (p.type === 'pin') p.len = p.len || 2;
        break;
      case 'rack':
        p.dir = p.dir || 'x';
        p.axis = p.axis || (p.dir === 'z' ? 'x' : 'z');
        break;
    }
    return p;
  }
  function migrate(model) {
    model.parts.forEach(normalize);
    model.version = 3;
    model.nextId = Math.max(model.nextId || 1, ...model.parts.map(p => p.id + 1), 1);
    return model;
  }

  // ── Geometry: cells, extents, holes ──────────────────────────────────

  // Integer cells a part fills (structure, racks, weights and connectors).
  function cells(p) {
    const out = [], o = P3(p);
    switch (p.type) {
      case 'beam': case 'rack': case 'axle': case 'pin': {
        const a = p.type === 'axle' || p.type === 'pin' ? p.axis : p.dir;
        for (let i = 0; i < p.len; i++) out.push(cellAlong(o, a, i));
        break;
      }
      case 'brick':
        for (let i = 0; i < p.w; i++) for (let j = 0; j < p.h; j++) for (let k = 0; k < p.d; k++) out.push([p.x + i, p.y + j, p.z + k]);
        break;
      case 'motor': {
        const [u, v] = FRAME[p.axis];
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(cellAlong(cellAlong(o, u, i), v, j));
        break;
      }
      default: out.push(o);
    }
    return out;
  }

  // Axis-aligned box (float) around a part, for drawing, picking and support.
  function extent(p) {
    const half = [0.5, 0.5, 0.5];
    if (p.type === 'beam') { half[IDX[p.holes]] = 0.45; half[IDX[other(p.dir, p.holes)]] = 0.45; }
    if (p.type === 'rack') { half[IDX[p.axis]] = 0.3; }
    if (p.type === 'motor') { half[IDX[p.axis]] = 0.45; }
    if (p.type === 'axle' || p.type === 'pin') { const r = p.type === 'axle' ? 0.16 : 0.22; for (const a of 'xyz') if (a !== p.axis) half[IDX[a]] = r; }
    if (p.type === 'gear' || p.type === 'pulley') {
      const r = radiusOf(p) + (p.type === 'gear' ? 0.11 : 0);
      for (const a of 'xyz') half[IDX[a]] = a === p.axis ? 0.2 : r;
      return { x0: p.x - half[0], x1: p.x + half[0], y0: p.y - half[1], y1: p.y + half[1], z0: p.z - half[2], z1: p.z + half[2] };
    }
    const cs = cells(p);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const c of cs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c[i] - half[i]); hi[i] = Math.max(hi[i], c[i] + half[i]); }
    if (p.type === 'axle' || p.type === 'pin') { const i = IDX[p.axis]; lo[i] -= 0.5 - half[i]; hi[i] += 0.5 - half[i]; }
    return { x0: lo[0], x1: hi[0], y0: lo[1], y1: hi[1], z0: lo[2], z1: hi[2] };
  }

  // Holes a part offers to a pin or an axle: [{ c: cell, axis }].
  function holes(p) {
    if (p.type === 'beam') return cells(p).map(c => ({ c, axis: p.holes }));
    if (p.type === 'brick' && !p.free && p.holes) return cells(p).map(c => ({ c, axis: p.holes }));
    if (p.type === 'motor') {
      // Pin holes at the middle of each side of the housing.
      const [u, v] = FRAME[p.axis], o = P3(p);
      return [cellAlong(o, u, 1), cellAlong(o, u, -1), cellAlong(o, v, 1), cellAlong(o, v, -1)].map(c => ({ c, axis: p.axis }));
    }
    return [];
  }

  // ── Model helpers ────────────────────────────────────────────────────

  function emptyModel() { return { version: 3, parts: [], nextId: 1 }; }
  function addPart(model, part) { const p = normalize(Object.assign({ id: model.nextId++ }, part)); model.parts.push(p); return p; }
  function byId(model, id) { return model.parts.find(p => p.id === id) || null; }

  function removePart(model, id) {
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of model.parts) {
        if (doomed.has(p.id)) continue;
        if ((p.type === 'belt' && (doomed.has(p.a) || doomed.has(p.b))) || (p.type === 'rope' && (doomed.has(p.drum) || doomed.has(p.load)))) { doomed.add(p.id); grew = true; }
      }
    }
    model.parts = model.parts.filter(p => !doomed.has(p.id));
    return doomed;
  }

  // The axle through cell c along axis a, if any.
  function axleAt(model, c, a) {
    return model.parts.find(p => p.type === 'axle' && p.axis === a && cells(p).some(q => key3(q) === key3(c))) || null;
  }

  // ── Connections ──────────────────────────────────────────────────────

  function connections(model) {
    const parts = model.parts;
    const structure = parts.filter(isStructure);
    const holeMap = new Map();                      // 'x,y,z|axis' → part
    for (const s of structure) for (const h of holes(s)) holeMap.set(key3(h.c) + '|' + h.axis, s);

    // Pair links: lines (connector lines through both) and studs.
    const links = new Map();                        // part → Map(part → { lines:Set, studs:n, via:Set(connector ids) })
    const link = (a, b) => {
      if (!links.has(a)) links.set(a, new Map());
      if (!links.get(a).has(b)) links.get(a).set(b, { lines: new Set(), studs: 0, via: new Set() });
      return links.get(a).get(b);
    };
    const connectorParts = new Map();               // connector id → parts it passes through
    for (const c of parts.filter(isConnector)) {
      const through = [];
      for (const cell of cells(c)) {
        const s = holeMap.get(key3(cell) + '|' + c.axis);
        if (s && !through.includes(s)) through.push(s);
      }
      connectorParts.set(c.id, through);
      const line = lineKey(P3(c), c.axis);
      for (let i = 0; i < through.length; i++) for (let j = i + 1; j < through.length; j++) {
        for (const [a, b] of [[through[i], through[j]], [through[j], through[i]]]) { const l = link(a, b); l.lines.add(line); l.via.add(c.id); }
      }
    }
    // Studs: a brick sits on the brick below when their footprints overlap.
    const bricks = parts.filter(p => p.type === 'brick' && !p.free);
    for (const a of bricks) for (const b of bricks) {
      if (a === b || a.y + a.h !== b.y) continue;   // b sits on a
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
      if (ox > 0 && oz > 0) { link(a, b).studs += ox * oz; link(b, a).studs += ox * oz; }
    }

    // Rigid clusters: studs, or two separate lines between the same pair.
    const parent = new Map(structure.map(s => [s, s]));
    const find = s => { while (parent.get(s) !== s) { parent.set(s, parent.get(parent.get(s))); s = parent.get(s); } return s; };
    for (const [a, m] of links) for (const [b, l] of m) if (l.studs > 0 || l.lines.size >= 2) parent.set(find(a), find(b));
    const clusters = new Map();
    for (const s of structure) { const r = find(s); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(s); }

    // Grounded: a brick resting on the ground plugs into the baseplate.
    const status = new Map();                       // part → 'fixed' | 'hinged' | 'loose'
    const fixed = new Set();
    for (const [, members] of clusters) if (members.some(s => s.type === 'brick' && s.y === 0)) members.forEach(s => fixed.add(s));
    let grew = true;
    while (grew) {
      grew = false;
      for (const [, members] of clusters) {
        if (fixed.has(members[0])) continue;
        const lines = new Set();
        let studs = 0;
        for (const s of members) for (const [t, l] of (links.get(s) || new Map())) if (fixed.has(t)) { l.lines.forEach(x => lines.add(x)); studs += l.studs; }
        if (studs > 0 || lines.size >= 2) { members.forEach(s => fixed.add(s)); grew = true; }
      }
    }
    const hingeLine = new Map();
    for (const [, members] of clusters) {
      if (fixed.has(members[0])) { members.forEach(s => status.set(s, 'fixed')); continue; }
      const lines = new Set();
      for (const s of members) for (const [t, l] of (links.get(s) || new Map())) if (fixed.has(t)) l.lines.forEach(x => lines.add(x));
      const st = lines.size === 1 ? 'hinged' : 'loose';
      members.forEach(s => { status.set(s, st); if (st === 'hinged') hingeLine.set(s, [...lines][0]); });
    }
    const clusterOf = new Map();
    for (const [, members] of clusters) members.forEach(s => clusterOf.set(s, members));
    return { status, links, clusterOf, holeMap, connectorParts, fixed, hingeLine };
  }

  // Pins to add so `part` joins the parts beside it: holes that line up on neighbouring
  // cells along the hole axis, up to two per neighbour (two separate lines make it rigid),
  // choosing the pair farthest apart. Existing pins and axles count.
  function autoPins(model, part) {
    if (!isStructure(part)) return [];
    const con = connections(model);
    const occupied = new Set();
    for (const c of model.parts.filter(isConnector)) for (const cell of cells(c)) occupied.add(key3(cell) + '|' + c.axis);
    const byNeighbour = new Map();
    for (const h of holes(part)) {
      if (occupied.has(key3(h.c) + '|' + h.axis)) continue;
      for (const s of [1, -1]) {
        const n = cellAlong(h.c, h.axis, s), q = con.holeMap.get(key3(n) + '|' + h.axis);
        if (!q || q === part || occupied.has(key3(n) + '|' + h.axis)) continue;
        if (!byNeighbour.has(q)) byNeighbour.set(q, []);
        byNeighbour.get(q).push({ a: h.c, b: n, axis: h.axis });
      }
    }
    const pins = [];
    for (const [q, cands] of byNeighbour) {
      const have = (con.links.get(part) && con.links.get(part).get(q)) || { lines: new Set(), studs: 0 };
      if (have.studs > 0) continue;
      const need = Math.max(0, 2 - have.lines.size);
      if (!need) continue;
      let best = [cands[0]];
      if (need >= 2 && cands.length > 1) {
        let far = -1;
        for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
          if (lineKey(cands[i].a, cands[i].axis) === lineKey(cands[j].a, cands[j].axis)) continue;
          const d = Math.hypot(...sub3(cands[i].a, cands[j].a));
          if (d > far) { far = d; best = [cands[i], cands[j]]; }
        }
      }
      for (const c of best.slice(0, need)) {
        const start = c.a[IDX[c.axis]] < c.b[IDX[c.axis]] ? c.a : c.b;
        pins.push({ type: 'pin', x: start[0], y: start[1], z: start[2], axis: c.axis, len: 2 });
      }
    }
    return pins;
  }

  // ── Collision ────────────────────────────────────────────────────────
  //
  // Every part has a real shape: boxes for beams, bricks, weights, racks and motors,
  // discs for gears (to the tooth tips) and pulleys, thin rods for axles and pins. Two
  // parts may not share space, with three Technic exceptions: a connector may pass
  // through a part only where that part has a hole along it (or a gear or pulley it
  // carries, or the motor that drives it); meshing gears touch at their pitch circles;
  // a gear meshing a rack touches the rack. Faces that merely touch do not collide.

  const SKIN = 0.02;
  function solids(p) {
    if (p.type === 'gear' || p.type === 'pulley') return [{ k: 'cyl', c: P3(p), axis: p.axis, r: radiusOf(p) + (p.type === 'gear' ? 0.11 : 0), h: 0.2 }];
    if (p.type === 'axle' || p.type === 'pin') {
      const cs = cells(p), c = cs[0].map((v, i) => (v + cs[cs.length - 1][i]) / 2);
      return [{ k: 'cyl', c, axis: p.axis, r: p.type === 'axle' ? 0.16 : 0.22, h: p.len / 2 }];
    }
    if (p.x === undefined) return [];
    const e = extent(p);
    return [{ k: 'box', lo: [e.x0 + SKIN, e.y0 + SKIN, e.z0 + SKIN], hi: [e.x1 - SKIN, e.y1 - SKIN, e.z1 - SKIN] }];
  }
  function boxOf(sd) {
    if (sd.k === 'box') return sd;
    const lo = [], hi = [];
    for (let i = 0; i < 3; i++) { const ext = i === IDX[sd.axis] ? sd.h : sd.r; lo[i] = sd.c[i] - ext + SKIN; hi[i] = sd.c[i] + ext - SKIN; }
    return { k: 'box', lo, hi };
  }
  const boxBox = (a, b) => [0, 1, 2].every(i => a.lo[i] < b.hi[i] && b.lo[i] < a.hi[i]);
  function cylBox(c, b) {
    const ia = IDX[c.axis];
    if (!(c.c[ia] - c.h + SKIN < b.hi[ia] && b.lo[ia] < c.c[ia] + c.h - SKIN)) return false;
    let d2 = 0;
    for (let i = 0; i < 3; i++) { if (i === ia) continue; const q = Math.max(b.lo[i], Math.min(c.c[i], b.hi[i])); d2 += (q - c.c[i]) ** 2; }
    return d2 < (c.r - SKIN) ** 2;
  }
  function shapesHit(a, b) {
    if (a.k === 'box' && b.k === 'box') return boxBox(a, b);
    if (a.k === 'cyl' && b.k === 'box') return cylBox(a, b);
    if (a.k === 'box' && b.k === 'cyl') return cylBox(b, a);
    if (a.axis === b.axis) {
      const ia = IDX[a.axis];
      if (!(a.c[ia] - a.h + SKIN < b.c[ia] + b.h && b.c[ia] - b.h + SKIN < a.c[ia] + a.h)) return false;
      let d2 = 0;
      for (let i = 0; i < 3; i++) if (i !== ia) d2 += (a.c[i] - b.c[i]) ** 2;
      return d2 < (a.r + b.r - SKIN) ** 2;
    }
    return cylBox(a, boxOf(b)) && cylBox(b, boxOf(a));
  }
  const onLine = (conn, q) => q.axis === conn.axis && lineKey(P3(q), q.axis) === lineKey(P3(conn), conn.axis);

  // Why parts a and b may not sit where they are, or '' if they may.
  function clash(a, b) {
    if (a === b || !solids(a).length || !solids(b).length) return '';
    if (isConnector(b) && !isConnector(a)) [a, b] = [b, a];
    if (isConnector(a)) {
      if (isConnector(b)) {
        if (a.axis === b.axis && onLine(a, b)) {
          const ca = new Set(cells(a).map(key3));
          return cells(b).some(c => ca.has(key3(c))) ? 'share a hole' : '';
        }
        return shapesHit(solids(a)[0], solids(b)[0]) ? 'cross' : '';
      }
      if (isWheel(b) && onLine(a, b)) return '';                 // carries it / drives it
      if (isStructure(b)) {
        const own = new Set(cells(b).map(key3)), hole = new Set(holes(b).filter(h => h.axis === a.axis).map(h => key3(h.c)));
        if (b.type === 'motor' && onLine(a, b)) hole.add(key3(P3(b)));
        const inside = cells(a).filter(c => own.has(key3(c)));
        if (inside.some(c => !hole.has(key3(c)))) return 'meet where there is no hole';
        return '';
      }
      return shapesHit(solids(a)[0], solids(b)[0]) ? 'collide' : '';
    }
    // Gear meshes: same axis and layer, pitch circles touching.
    if ((a.type === 'gear' || a.type === 'pulley') && (b.type === 'gear' || b.type === 'pulley') && a.axis === b.axis && P3(a)[IDX[a.axis]] === P3(b)[IDX[b.axis]]) {
      const d = Math.hypot(...sub3(P3(a), P3(b))), sum = radiusOf(a) + radiusOf(b), both = a.type === 'gear' && b.type === 'gear';
      if (both && Math.abs(d - sum) < MESH_TOL) return '';
      return d < sum + (both ? 0.12 : 0) - MESH_TOL ? 'overlap without meshing' : '';
    }
    if (b.type === 'rack' && a.type === 'gear') [a, b] = [b, a];
    if (a.type === 'rack' && b.type === 'gear' && b.axis === a.axis && P3(b)[IDX[a.axis]] === P3(a)[IDX[a.axis]]) {
      const L = VEC[a.dir], Tn = cross3(VEC[a.axis], L), d = sub3(P3(b), P3(a)), off = Math.abs(dot3(d, Tn)), al = dot3(d, L);
      if (Math.abs(off - (radiusOf(b) + 0.5)) < MESH_TOL && al >= -0.01 && al <= a.len - 0.99) return '';
    }
    for (const sa of solids(a)) for (const sb of solids(b)) if (shapesHit(sa, sb)) return 'occupy the same space';
    return '';
  }
  // Every part that `part` collides with: [{ part, why }].
  function collisionsWith(model, part, ignore) {
    const out = [];
    for (const q of model.parts) {
      if (q === part || (ignore && ignore.has(q))) continue;
      const why = clash(part, q);
      if (why) out.push({ part: q, why });
    }
    return out;
  }
  function allCollisions(model) {
    const out = [], ps = model.parts.filter(p => solids(p).length);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const why = clash(ps[i], ps[j]);
      if (why) out.push({ a: ps[i], b: ps[j], why });
    }
    return out;
  }

  // How far box b can travel along axis i in direction sgn before touching shape sd.
  function sweep(b, i, sgn, sd) {
    const others = [0, 1, 2].filter(k => k !== i);
    if (sd.k === 'box') {
      if (!others.every(k => b.lo[k] < sd.hi[k] && sd.lo[k] < b.hi[k])) return Infinity;
      const d = sgn > 0 ? sd.lo[i] - b.hi[i] : b.lo[i] - sd.hi[i];
      return d >= -1e-6 ? Math.max(0, d) : Infinity;
    }
    const ia = IDX[sd.axis];
    if (ia === i) return sweep(b, i, sgn, boxOf(sd));
    // Moving within the disc's plane: the disc's chord above the box decides.
    if (!(b.lo[ia] < sd.c[ia] + sd.h && sd.c[ia] - sd.h < b.hi[ia])) return Infinity;
    const o = others.find(k => k !== ia), q = Math.max(b.lo[o], Math.min(sd.c[o], b.hi[o])), off = q - sd.c[o];
    if (Math.abs(off) >= sd.r) return Infinity;
    const half = Math.sqrt(sd.r * sd.r - off * off);
    const d = sgn > 0 ? (sd.c[i] - half) - b.hi[i] : b.lo[i] - (sd.c[i] + half);
    return d >= -1e-6 ? Math.max(0, d) : Infinity;
  }
  function freeTravel(model, part, axis, sgn, ignore) {
    const b = solids(part)[0];
    let best = Infinity;
    for (const q of model.parts) {
      if (q === part || (ignore && ignore.has(q))) continue;
      for (const sd of solids(q)) best = Math.min(best, sweep(b, IDX[axis], sgn, sd));
    }
    return best;
  }

  // ── Analysis: model → what turns, what meshes, what is wrong ─────────

  function analyze(model) {
    const parts = model.parts, issues = [];
    const con = connections(model);
    const fixedHole = new Set();
    for (const s of con.fixed) for (const h of holes(s)) fixedHole.add(key3(h.c) + '|' + h.axis);

    const collisions = allCollisions(model);
    for (const c of collisions) issues.push({ id: c.b.id, level: 'error', text: `${label(c.a)} and ${label(c.b)} ${c.why}` });

    for (const [s, st] of con.status) {
      if (st === 'loose') issues.push({ id: s.id, level: 'error', text: `${label(s)} is not connected to the frame. Pin it to a fixed part or stand it on a brick` });
      if (st === 'hinged') issues.push({ id: s.id, level: 'warn', text: `${label(s)} hangs on one pin or axle, so it can swing. Add a second pin in another hole to fix it` });
    }

    // Axle assemblies.
    const axles = parts.filter(p => p.type === 'axle').map(a => {
      const held = cells(a).filter(c => fixedHole.has(key3(c) + '|' + a.axis)).length;
      return { axle: a, members: [], held, supported: held > 0, motor: null };
    });
    const assemblyOf = new Map();
    for (const w of parts.filter(isWheel)) {
      const as = axles.find(A => A.axle.axis === w.axis && cells(A.axle).some(c => key3(c) === key3(P3(w))));
      if (!as) { issues.push({ id: w.id, level: 'warn', text: `${label(w)} has no axle through it` }); continue; }
      as.members.push(w); assemblyOf.set(w.id, as);
      if (w.type === 'motor') as.motor = w;
    }
    for (const as of axles) {
      if (!as.supported && as.members.some(m => m.type !== 'motor')) issues.push({ id: as.axle.id, level: 'warn', text: `${label(as.axle)} does not pass through a hole in a fixed part, so it cannot turn` });
      const seen = new Map();
      for (const m of as.members) {
        const k = P3(m)[IDX[m.axis]];
        if (seen.has(k)) issues.push({ id: m.id, level: 'error', text: `${label(m)} and ${label(seen.get(k))} sit on the same spot` });
        seen.set(k, m);
      }
      if (as.motor && con.status.get(as.motor) !== 'fixed') issues.push({ id: as.motor.id, level: 'error', text: `${label(as.motor)} is not pinned to the frame, so it would turn itself instead of the axle. Pin two of its side holes to a fixed beam` });
    }

    // Gear meshes and wheel collisions: same axis, same layer along it.
    const meshes = [];
    const wheels = parts.filter(p => (p.type === 'gear' || p.type === 'pulley') && assemblyOf.has(p.id));
    for (let i = 0; i < wheels.length; i++) for (let j = i + 1; j < wheels.length; j++) {
      const a = wheels[i], b = wheels[j];
      if (a.axis !== b.axis || P3(a)[IDX[a.axis]] !== P3(b)[IDX[b.axis]] || assemblyOf.get(a.id) === assemblyOf.get(b.id)) continue;
      const d = Math.hypot(...sub3(P3(b), P3(a))), sum = radiusOf(a) + radiusOf(b);
      const both = a.type === 'gear' && b.type === 'gear';
      if (both && Math.abs(d - sum) < MESH_TOL) meshes.push({ kind: 'gear', a, b, d });
      else if (d < sum + (both ? 0.12 : 0) - MESH_TOL) issues.push({ id: b.id, level: 'error', text: `${label(a)} and ${label(b)} overlap without meshing` });
    }

    // Racks: a gear on the rack's plane meshes when its pitch circle touches a toothed edge.
    const racks = parts.filter(p => p.type === 'rack').map(r => {
      const R = { rack: r, meshes: [] }, L = VEC[r.dir], n = VEC[r.axis], T = cross3(n, L), o = P3(r);
      for (const g of wheels) {
        if (g.type !== 'gear' || g.axis !== r.axis || P3(g)[IDX[r.axis]] !== o[IDX[r.axis]]) continue;
        const d = sub3(P3(g), o), along = dot3(d, L), off = dot3(d, T), rg = radiusOf(g);
        if (along < -0.01 || along > r.len - 0.99) continue;
        if (Math.abs(off - (rg + 0.5)) < MESH_TOL) R.meshes.push({ gear: g, sigma: 1, along });
        else if (Math.abs(off + (rg + 0.5)) < MESH_TOL) R.meshes.push({ gear: g, sigma: -1, along });
      }
      meshes.push(...R.meshes.map(m => ({ kind: 'rack', a: m.gear, rack: r, sigma: m.sigma })));
      return R;
    });

    // Belts: two pulleys on parallel axes, on the same layer along them.
    const belts = parts.filter(p => p.type === 'belt').map(b => {
      const a = byId(model, b.a), c = byId(model, b.b);
      const ok = a && c && a.type === 'pulley' && c.type === 'pulley' && a.axis === c.axis && P3(a)[IDX[a.axis]] === P3(c)[IDX[c.axis]] && assemblyOf.has(a.id) && assemblyOf.has(c.id) && assemblyOf.get(a.id) !== assemblyOf.get(c.id);
      if (!ok) issues.push({ id: b.id, level: 'warn', text: 'A belt needs two pulleys on different, parallel axles, on the same layer' });
      return { belt: b, a, b: c, ok };
    });

    // Weights move up and down between whatever is below them (or the ground) and
    // whatever is above them: both found by sweeping the weight's box.
    const loads = parts.filter(isWeight).map(L => {
      const e = extent(L), ignore = new Set(parts.filter(p => p.type === 'rope' && p.load === L.id));
      const down = Math.min(freeTravel(model, L, 'y', -1, ignore), e.y0 + 0.5);
      const up = freeTravel(model, L, 'y', 1, ignore);
      return { load: L, floor: e.y0 - down, down, up };
    });

    // Ropes: from a pulley on a level axle down to a weight.
    const ropes = parts.filter(p => p.type === 'rope').map(r => {
      const drum = byId(model, r.drum), load = byId(model, r.load);
      const ok = drum && load && (drum.type === 'pulley' || drum.type === 'gear') && drum.axis !== 'y' && assemblyOf.has(drum.id) && isWeight(load);
      if (!ok) { issues.push({ id: r.id, level: 'warn', text: 'A rope needs a pulley on a level axle and a weight' }); return { rope: r, ok: false }; }
      const h = cross3(VEC.y, VEC[drum.axis]), c = [load.x + (load.w - 1) / 2, 0, load.z + (load.d - 1) / 2];
      const sigma = dot3(sub3(c, P3(drum)), h) >= 0 ? 1 : -1;
      return { rope: r, drum, load, sigma, h, ok: true, top: load.y + load.h - 0.5 };
    });

    return { con, axles, assemblyOf, meshes, racks, belts, loads, ropes, issues };
  }

  function label(p) {
    if (!p) return '?';
    switch (p.type) {
      case 'gear': return `${p.teeth}t gear #${p.id}`;
      case 'pulley': return `${PULLEYS[p.size].label} pulley #${p.id}`;
      case 'axle': return `axle #${p.id}`;
      case 'pin': return `pin #${p.id}`;
      case 'beam': return `beam ${p.len} #${p.id}`;
      case 'brick': return p.free ? `weight ${p.mass} kg #${p.id}` : `brick #${p.id}`;
      case 'motor': return `motor #${p.id}`;
      case 'rack': return `rack ${p.len} #${p.id}`;
      case 'belt': return `${p.crossed ? 'crossed ' : ''}belt #${p.id}`;
      case 'rope': return `rope #${p.id}`;
      default: return `${p.type} #${p.id}`;
    }
  }

  // ── Bases ────────────────────────────────────────────────────────────

  class MachineBase {
    constructor(opts = {}) {
      this.name = 'machine';
      this.dofs = [];
      this.joints = [];
      this.t = 0;
      this.substep = opts.substep || 1 / 600;
    }
    fieldAt() { return [0, 0, 0]; }
    step(dt) {
      const n = Math.max(1, Math.ceil(dt / this.substep - 1e-9)), h = dt / n;
      for (let i = 0; i < n; i++) this.substepOnce(h);
      return this;
    }
    substepOnce(h) {
      const dofs = this.dofs;
      dofs.forEach((d, i) => { d.index = i; });
      for (const d of dofs) { const f = d.forces(this) || 0; if (d.inertia > 0) d.v += h * f / d.inertia; }
      const rows = [];
      for (const d of dofs) d.rows(this, h, rows);
      for (const j of this.joints) j.rows(this, h, rows);
      // Layers push `this`, which inside ExtendX is a frame proxy. The solver couples
      // rows by identity, so name the real instances (ExtendX.unwrap, v1.6.3).
      for (const row of rows) {
        row.owner = ExtendX.unwrap(row.owner);
        row.terms = row.terms.map(([d, c]) => [ExtendX.unwrap(d), c]);
      }
      solveRows(rows, dofs, this.warm || (this.warm = new Map()));
      for (const d of dofs) d.lastImpulse = {};
      for (const j of this.joints) j.lastImpulse = {};
      for (const row of rows) {
        for (const [d, c] of row.terms) if (d.inertia > 0) d.v += c * row.lambda / d.inertia;
        if (row.owner) row.owner.lastImpulse[row.tag] = (row.owner.lastImpulse[row.tag] || 0) + row.lambda / h;
      }
      for (const d of dofs) d.q += h * d.v;
      this.t += h;
    }
    energy() {
      let kinetic = 0, potential = 0;
      for (const d of this.dofs) { kinetic += 0.5 * d.inertia * d.v * d.v; potential += d.potential(this) || 0; }
      return { kinetic, potential, total: kinetic + potential };
    }
    find(name) { return this.dofs.concat(this.joints).find(x => x.name === name) || null; }
  }

  class Dof {
    constructor(opts = {}) {
      this.name = opts.name;
      this.kind = opts.kind;            // 'rotor' | 'slider' | 'load'
      this.q = 0;
      this.v = 0;
      this.inertia = opts.inertia;
      this.dir = opts.dir || [0, 0, 0];
      this.partIds = opts.partIds || [];
      this.lastImpulse = {};
    }
    forces(machine) { return 0; }
    rows(machine, h, out) {}
    potential(machine) { return 0; }
  }

  class Joint {
    constructor(opts = {}) {
      this.name = opts.name;
      this.kind = opts.kind;
      this.terms = opts.terms || [];
      this.C0 = opts.C0 || 0;
      this.partIds = opts.partIds || [];
      this.lastImpulse = {};
    }
    C() { let s = -this.C0; for (const [d, c] of this.terms) s += c * d.q; return s; }
    rows(machine, h, out) {}
  }

  const BETA = 0.2, INF = Infinity;

  // ── Mixins (unchanged in kind from v2) ───────────────────────────────

  const Gravity = {
    mixinId: 'technic.Gravity',
    init(opts = {}) { this.g = opts.g === undefined ? G : opts.g; },
    fieldAt(next) { const b = next(); return [b[0], b[1] - this.g, b[2]]; },
  };
  const Weight = {
    mixinId: 'technic.Weight',
    forces(machine, next) { return this.inertia * dot3(machine.fieldAt(), this.dir) + next(); },
    potential(machine, next) { return -this.inertia * dot3(machine.fieldAt(), this.dir) * this.q + next(); },
  };
  const Contact = {
    mixinId: 'technic.Contact',
    rows(machine, h, out, next) {
      const gap = this.q - this.floor;
      if (gap < 0.002) out.push({ owner: this, tag: 'contact', terms: [[this, 1]], b: gap < 0 ? -BETA * gap / h : -gap / h, lo: 0, hi: INF, key: this.name + ':contact' });
      // And it stops against whatever is above it.
      const room = this.ceiling - this.q;
      if (room < 0.002) out.push({ owner: this, tag: 'contact', terms: [[this, -1]], b: room < 0 ? -BETA * room / h : -room / h, lo: 0, hi: INF, key: this.name + ':ceiling' });
      return next();
    },
  };
  const Bearing = {
    mixinId: 'technic.Bearing',
    rows(machine, h, out, next) {
      if (this.friction > 0) out.push({ owner: this, tag: 'friction', terms: [[this, 1]], b: 0, lo: -this.friction * h, hi: this.friction * h, key: this.name + ':friction' });
      return next();
    },
  };
  const Motor = {
    mixinId: 'technic.Motor',
    rows(machine, h, out, next) {
      if (this.motor) out.push({ owner: this, tag: 'motor', terms: [[this, 1]], b: this.motor.rpm * TAU / 60, lo: -this.motor.torque * h, hi: this.motor.torque * h, key: this.name + ':motor' });
      return next();
    },
  };
  const Guide = {
    mixinId: 'technic.Guide',
    rows(machine, h, out, next) {
      const lo = this.q - this.qmin, hi = this.qmax - this.q;
      if (lo < 0.002) out.push({ owner: this, tag: 'stop', terms: [[this, 1]], b: lo < 0 ? -BETA * lo / h : -lo / h, lo: 0, hi: INF, key: this.name + ':stopLo' });
      if (hi < 0.002) out.push({ owner: this, tag: 'stop', terms: [[this, -1]], b: hi < 0 ? -BETA * hi / h : -hi / h, lo: 0, hi: INF, key: this.name + ':stopHi' });
      return next();
    },
  };
  const Mesh = {
    mixinId: 'technic.Mesh',
    rows(machine, h, out, next) {
      out.push({ owner: this, tag: 'mesh', terms: this.terms, b: -BETA * this.C() / h, lo: -INF, hi: INF, key: this.name });
      return next();
    },
  };
  const Belt = {
    mixinId: 'technic.Belt',
    rows(machine, h, out, next) {
      const s = this.slip > 0 ? this.slip * h : INF;
      out.push({ owner: this, tag: 'belt', terms: this.terms, b: s === INF ? -BETA * this.C() / h : 0, lo: -s, hi: s, key: this.name });
      return next();
    },
  };
  const Rope = {
    mixinId: 'technic.Rope',
    rows(machine, h, out, next) {
      const C = this.C();
      if (C > -0.002) out.push({ owner: this, tag: 'tension', terms: this.terms, b: C > 0 ? -BETA * C / h : -C / h, lo: -INF, hi: 0, key: this.name + ':taut' });
      const room = this.length() - this.minLength;
      if (room < 0.002) out.push({ owner: this, tag: 'jam', terms: [[this.drum, -this.sigma * this.r]], b: room < 0 ? -BETA * room / h : -room / h, lo: 0, hi: INF, key: this.name + ':jam' });
      return next();
    },
  };
  const MIXINS = { Gravity, Weight, Contact, Bearing, Motor, Guide, Mesh, Belt, Rope };

  // ── Solver: bounded rows, principal pivoting over a dense direct solve ─

  function solveRows(rows, dofs, warm) {
    const n = rows.length;
    if (!n) return;
    const invM = d => (d.inertia > 0 ? 1 / d.inertia : 0);
    const A = Array.from({ length: n }, () => new Float64Array(n));
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let jv = 0;
      for (const [d, c] of rows[i].terms) jv += c * d.v;
      r[i] = rows[i].b - jv;
      for (let j = i; j < n; j++) {
        let s = 0;
        for (const [di, ci] of rows[i].terms) for (const [dj, cj] of rows[j].terms) if (di === dj) s += ci * cj * invM(di);
        A[i][j] = A[j][i] = s;
      }
    }
    let scale = 0;
    for (let i = 0; i < n; i++) scale = Math.max(scale, A[i][i]);
    for (let i = 0; i < n; i++) A[i][i] += 1e-9 * scale + 1e-14;
    const state = new Int8Array(n), lam = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const w = warm.get(rows[i].key);
      state[i] = w === undefined ? 0 : w;
      if (state[i] === -1 && !Number.isFinite(rows[i].lo)) state[i] = 0;
      if (state[i] === 1 && !Number.isFinite(rows[i].hi)) state[i] = 0;
    }
    const solveFree = () => {
      const free = [];
      for (let i = 0; i < n; i++) { if (state[i] === -1) lam[i] = rows[i].lo; else if (state[i] === 1) lam[i] = rows[i].hi; else free.push(i); }
      if (!free.length) return free;
      const m = free.length, M = Array.from({ length: m }, () => new Float64Array(m + 1));
      for (let a = 0; a < m; a++) {
        const i = free[a];
        let rhs = r[i];
        for (let j = 0; j < n; j++) if (state[j] !== 0) rhs -= A[i][j] * lam[j];
        for (let b = 0; b < m; b++) M[a][b] = A[i][free[b]];
        M[a][m] = rhs;
      }
      const x = gauss(M, m);
      free.forEach((i, a) => { lam[i] = x[a]; });
      return free;
    };
    for (let iter = 0; iter < 4 * n + 10; iter++) {
      const free = solveFree();
      let worst = -1, worstBy = 0, to = 0;
      for (const i of free) {
        const sd = Math.sqrt(A[i][i]), over = (lam[i] - rows[i].hi) / sd, under = (rows[i].lo - lam[i]) / sd;
        if (over > worstBy) { worst = i; worstBy = over; to = 1; }
        if (under > worstBy) { worst = i; worstBy = under; to = -1; }
      }
      if (worst < 0) {
        for (let i = 0; i < n; i++) {
          if (state[i] === 0) continue;
          let w = -r[i];
          for (let j = 0; j < n; j++) w += A[i][j] * lam[j];
          const sd = Math.sqrt(A[i][i]), bad = (state[i] === -1 ? -w : w) / sd;
          if (bad > Math.max(worstBy, 1e-12 * (Math.abs(r[i]) + 1e-9) / sd)) { worst = i; worstBy = bad; to = 0; }
        }
      }
      if (worst < 0) break;
      state[worst] = to;
    }
    solveFree();
    warm.clear();
    for (let i = 0; i < n; i++) { rows[i].lambda = lam[i]; warm.set(rows[i].key, state[i]); }
  }

  function gauss(M, m) {
    for (let c = 0; c < m; c++) {
      let p = c;
      for (let i = c + 1; i < m; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
      if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
      const piv = M[c][c];
      if (Math.abs(piv) < 1e-300) continue;
      for (let i = c + 1; i < m; i++) { const f = M[i][c] / piv; if (!f) continue; for (let k = c; k <= m; k++) M[i][k] -= f * M[c][k]; }
    }
    const x = new Float64Array(m);
    for (let i = m - 1; i >= 0; i--) {
      let s = M[i][m];
      for (let k = i + 1; k < m; k++) s -= M[i][k] * x[k];
      x[i] = Math.abs(M[i][i]) < 1e-300 ? 0 : s / M[i][i];
    }
    return x;
  }

  // ── Compile: model → machine ──────────────────────────────────────────

  const Machine = ExtendX.extend(MachineBase, Gravity);
  const Rotor = ExtendX.extend(Dof, Bearing, Motor);
  const Load = ExtendX.extend(Dof, Weight, Contact);
  const Slider = ExtendX.extend(Dof, Weight, Guide);
  const GearMesh = ExtendX.extend(Joint, Mesh);
  const BeltDrive = ExtendX.extend(Joint, Belt);
  const RopeLine = ExtendX.extend(Joint, Rope);

  // In-plane angle of point p about a wheel at c turning about axis a.
  function planeAngle(c, p, a) { const [u, v] = FRAME[a], d = sub3(p, c); return Math.atan2(d[IDX[v]], d[IDX[u]]); }

  function compile(model, opts = {}) {
    const an = analyze(model);
    const machine = new Machine({ g: opts.g === undefined ? G : opts.g, substep: opts.substep });
    const dofOf = new Map(), phase = new Map();

    for (const as of an.axles) {
      if (!as.supported) continue;
      let I = DEFAULTS.axleMass * (0.0024 * 0.0024) / 2, motor = null;
      for (const m of as.members) {
        if (m.type === 'motor') {
          if (an.con.status.get(m) === 'fixed') motor = { rpm: m.rpm, torque: m.torque, id: m.id };
          I += 4e-6; continue;
        }
        const r = radiusOf(m) * U, mass = m.type === 'gear' ? GEARS[m.teeth].mass : PULLEYS[m.size].mass;
        I += 0.5 * mass * r * r;
      }
      const d = new Rotor({ name: `axle#${as.axle.id}`, kind: 'rotor', inertia: I, partIds: [as.axle.id, ...as.members.map(m => m.id)] });
      d.friction = DEFAULTS.bearingFriction * Math.min(2, as.held);
      d.motor = motor; d.axle = as.axle;
      machine.dofs.push(d);
      dofOf.set(as.axle.id, d);
      for (const m of as.members) dofOf.set(m.id, d);
    }

    for (const L of an.loads) {
      const p = L.load;
      const d = new Load({ name: `weight#${p.id}`, kind: 'load', inertia: p.mass, dir: [0, 1, 0], partIds: [p.id] });
      d.floor = -L.down * U; d.ceiling = L.up * U; d.part = p;
      machine.dofs.push(d);
      dofOf.set(p.id, d);
    }

    for (const R of an.racks) {
      const p = R.rack;
      const d = new Slider({ name: `rack#${p.id}`, kind: 'slider', inertia: DEFAULTS.rackMass * p.len / 8, dir: VEC[p.dir], partIds: [p.id] });
      let qmin = -INF, qmax = INF;
      for (const m of R.meshes) {
        const along = dot3(sub3(P3(m.gear), P3(p)), VEC[p.dir]);
        qmin = Math.max(qmin, (along - (p.len - 1)) * U);
        qmax = Math.min(qmax, along * U);
      }
      if (!R.meshes.length) { qmin = 0; qmax = 0; }
      // Nothing in the rack's path: it stops where it would hit a part.
      const ignore = new Set(R.meshes.map(m => m.gear));
      qmin = Math.max(qmin, -freeTravel(model, p, p.dir, -1, ignore) * U);
      qmax = Math.min(qmax, freeTravel(model, p, p.dir, 1, ignore) * U);
      d.qmin = qmin; d.qmax = qmax; d.part = p;
      machine.dofs.push(d);
      dofOf.set(p.id, d);
    }

    for (const m of an.meshes) {
      const da = dofOf.get(m.a.id);
      if (m.kind === 'gear') {
        const db = dofOf.get(m.b.id);
        if (!da || !db) continue;
        machine.joints.push(new GearMesh({ name: `mesh#${m.a.id}-${m.b.id}`, kind: 'gear', terms: [[da, radiusOf(m.a) * U], [db, radiusOf(m.b) * U]], partIds: [m.a.id, m.b.id] }));
      } else {
        const dr = dofOf.get(m.rack.id);
        if (!da || !dr) continue;
        // Contact at d = −σ·r·T; surface speed ω·n×d = σ·r·ω·L, so q̇ − σ·r·ω = 0.
        machine.joints.push(new GearMesh({ name: `mesh#${m.a.id}-${m.rack.id}`, kind: 'rack', terms: [[dr, 1], [da, -m.sigma * radiusOf(m.a) * U]], partIds: [m.a.id, m.rack.id] }));
      }
    }

    for (const B of an.belts) {
      if (!B.ok) continue;
      const da = dofOf.get(B.a.id), db = dofOf.get(B.b.id);
      if (!da || !db) continue;
      const j = new BeltDrive({ name: `belt#${B.belt.id}`, kind: 'belt', terms: [[da, radiusOf(B.a) * U], [db, (B.belt.crossed ? 1 : -1) * radiusOf(B.b) * U]], partIds: [B.belt.id, B.a.id, B.b.id] });
      j.slip = B.belt.slip || 0;
      machine.joints.push(j);
    }

    for (const Rp of an.ropes) {
      if (!Rp.ok) continue;
      const dd = dofOf.get(Rp.drum.id), dl = dofOf.get(Rp.load.id);
      if (!dd || !dl) continue;
      // Rope leaves the drum at d = σ·r·h with h = y × n, so the lift speed is σ·r·ω.
      const r = radiusOf(Rp.drum) * U, L0 = (Rp.drum.y - Rp.top) * U;
      const j = new RopeLine({ name: `rope#${Rp.rope.id}`, kind: 'rope', terms: [[dd, Rp.sigma * r], [dl, -1]], partIds: [Rp.rope.id, Rp.drum.id, Rp.load.id] });
      j.drum = dd; j.sigma = Rp.sigma; j.r = r; j.L0 = L0; j.minLength = 0.5 * U;
      j.length = function () { return this.L0 - this.sigma * this.r * this.drum.q; };
      machine.joints.push(j);
    }

    // Tooth phases so meshing teeth interleave (cosmetic only).
    const gears = model.parts.filter(p => p.type === 'gear');
    const adj = new Map(gears.map(g => [g.id, []]));
    for (const m of an.meshes) if (m.kind === 'gear') { adj.get(m.a.id).push(m.b); adj.get(m.b.id).push(m.a); }
    for (const g of gears) {
      if (phase.has(g.id)) continue;
      phase.set(g.id, 0);
      const queue = [g];
      while (queue.length) {
        const a = queue.shift(), pa = phase.get(a.id), ra = radiusOf(a);
        for (const b of adj.get(a.id)) {
          if (phase.has(b.id)) continue;
          const rb = radiusOf(b), phi = planeAngle(P3(a), P3(b), a.axis), pitch = TAU / 16;
          phase.set(b.id, phi + Math.PI - (pitch / 2 - ra * (phi - pa)) / rb);
          queue.push(b);
        }
      }
    }

    machine.analysis = an;
    machine.dofOf = dofOf;
    machine.phase = phase;
    machine.history = [];
    return machine;
  }

  // ── Hand calculation ─────────────────────────────────────────────────

  function predict(model, machine) {
    const dofs = machine.dofs;
    const edges = new Map(dofs.map(d => [d, []]));
    for (const j of machine.joints) {
      if (j.kind === 'rope') continue;
      if (j.kind === 'belt' && j.slip > 0) continue;
      const [[a, ca], [b, cb]] = j.terms;
      if (!ca || !cb) continue;
      const k = -ca / cb;
      edges.get(a).push([b, k]); edges.get(b).push([a, 1 / k]);
    }
    const ropes = machine.joints.filter(j => j.kind === 'rope');
    const result = { components: [], byDof: new Map() };
    const done = new Set();
    for (const m of dofs.filter(d => d.motor)) {
      if (done.has(m)) continue;
      const k = new Map([[m, 1]]), queue = [m];
      let jam = false;
      while (queue.length) {
        const a = queue.shift();
        for (const [b, r] of edges.get(a)) {
          const kb = k.get(a) * r;
          if (!k.has(b)) { k.set(b, kb); queue.push(b); }
          else if (Math.abs(k.get(b) - kb) > 1e-6 * (Math.abs(kb) + 1e-9)) jam = true;
        }
      }
      const w = m.motor.rpm * TAU / 60;
      for (const o of [...k.keys()].filter(d => d !== m && d.motor)) if (Math.abs(o.motor.rpm * TAU / 60 - w * k.get(o)) > 1e-6) jam = true;
      let torque = 0;
      for (const rp of ropes) {
        if (!k.has(rp.drum)) continue;
        const load = rp.terms[1][0], kl = rp.sigma * rp.r * k.get(rp.drum);
        if (kl * Math.sign(w || 1) > 0) { k.set(load, kl); torque += load.inertia * G * Math.abs(kl); }
        else k.set(load, 0);
      }
      for (const [d, kd] of k) if (d.kind === 'rotor' && d.friction > 0) torque += d.friction * Math.abs(kd);
      const stall = torque > m.motor.torque + 1e-12;
      const comp = { motor: m, ratios: k, jam, stall, torqueNeeded: torque, torqueMax: m.motor.torque, speed: w };
      result.components.push(comp);
      for (const [d, kd] of k) { done.add(d); result.byDof.set(d, { v: jam || stall ? 0 : w * kd, ratio: kd, comp }); }
    }
    for (const d of dofs) if (!result.byDof.has(d)) result.byDof.set(d, { v: 0, ratio: 0, comp: null });
    return result;
  }

  function record(machine) {
    machine.history.push({ t: machine.t, q: machine.dofs.map(d => d.q) });
    while (machine.history.length > 2 && machine.t - machine.history[0].t > 1.5) machine.history.shift();
  }
  function measure(machine, window = 0.5) {
    const h = machine.history;
    if (h.length < 2) return machine.dofs.map(d => d.v);
    const last = h[h.length - 1];
    let first = h[0];
    for (let i = h.length - 1; i >= 0; i--) { if (last.t - h[i].t >= window) { first = h[i]; break; } }
    const dt = last.t - first.t;
    return machine.dofs.map((d, i) => (dt > 1e-6 ? (last.q[i] - first.q[i]) / dt : d.v));
  }

  // ── Presets: every frame is joined the Technic way ─────────────────────
  //
  // The standard frame: two bricks stacked on the ground (studs, so they are fixed),
  // a vertical beam pinned behind each end into both bricks (two pins: rigid), and a top
  // beam on the bricks' layer pinned to both verticals. Axles run through the top beam.

  function build(fn) {
    const m = emptyModel();
    const add = part => {
      const p = addPart(m, part);
      for (const pin of autoPins(m, p)) addPart(m, pin);
      return p;
    };
    fn(add, m);
    return m;
  }
  function frame(add, width, top, z = 2) {
    add({ type: 'brick', x: 0, y: 0, z, w: width, h: 1, d: 1, holes: 'z' });
    add({ type: 'brick', x: 0, y: 1, z, w: width, h: 1, d: 1, holes: 'z' });
    add({ type: 'beam', x: 0, y: 0, z: z - 1, len: top + 1, dir: 'y', holes: 'z' });
    add({ type: 'beam', x: width - 1, y: 0, z: z - 1, len: top + 1, dir: 'y', holes: 'z' });
    add({ type: 'beam', x: 0, y: top, z, len: width, dir: 'x', holes: 'z' });
  }

  const PRESETS = {
    'gear-train': {
      title: 'Gear train 1:15',
      note: 'An 8-tooth gear drives a 40 (1:5), then an 8 behind it on the same axle drives a 24 (1:3). The 40 sits in front so the 24’s axle never passes through it. The frame is two stacked bricks, two uprights pinned into them, and a top beam pinned across. The motor is pinned to the top beam by two side holes.',
      model: () => build(add => {
        frame(add, 12, 7);
        // The 40 sits in front (layer 4) so the 24's axle, behind it, never passes through it.
        add({ type: 'axle', x: 2, y: 7, z: 1, len: 4, axis: 'z' });
        add({ type: 'motor', x: 2, y: 7, z: 1, axis: 'z', rpm: 60, torque: 0.1 });
        add({ type: 'gear', x: 2, y: 7, z: 4, axis: 'z', teeth: 8 });
        add({ type: 'axle', x: 5, y: 7, z: 2, len: 3, axis: 'z' });
        add({ type: 'gear', x: 5, y: 7, z: 4, axis: 'z', teeth: 40 });
        add({ type: 'gear', x: 5, y: 7, z: 3, axis: 'z', teeth: 8 });
        add({ type: 'axle', x: 7, y: 7, z: 2, len: 2, axis: 'z' });
        add({ type: 'gear', x: 7, y: 7, z: 3, axis: 'z', teeth: 24 });
      }),
    },
    'winch': {
      title: 'Winch',
      note: 'The motor turns an 8-tooth gear into a 40 (1:5). A large pulley on the 40’s axle winds a rope and lifts a 0.5 kg weight off the ground until it reaches the drum.',
      model: () => build(add => {
        frame(add, 10, 10);
        add({ type: 'axle', x: 2, y: 10, z: 1, len: 3, axis: 'z' });
        add({ type: 'motor', x: 2, y: 10, z: 1, axis: 'z', rpm: -60, torque: 0.1 });
        add({ type: 'gear', x: 2, y: 10, z: 3, axis: 'z', teeth: 8 });
        add({ type: 'axle', x: 5, y: 10, z: 2, len: 3, axis: 'z' });
        add({ type: 'gear', x: 5, y: 10, z: 3, axis: 'z', teeth: 40 });
        const drum = add({ type: 'pulley', x: 5, y: 10, z: 4, axis: 'z', size: 'l' });
        const load = add({ type: 'brick', x: 6, y: 0, z: 4, w: 2, h: 2, d: 1, free: true, mass: 0.5 });
        add({ type: 'rope', drum: drum.id, load: load.id });
      }),
    },
    'stalled-winch': {
      title: 'Winch without reduction',
      note: 'The same winch with the motor on the drum’s axle and a 1 kg weight. Lifting it needs 0.118 N·m, more than the motor’s 0.1 N·m, so it stalls. Add gearing and it lifts.',
      model: () => build(add => {
        frame(add, 10, 10);
        add({ type: 'axle', x: 5, y: 10, z: 1, len: 4, axis: 'z' });
        add({ type: 'motor', x: 5, y: 10, z: 1, axis: 'z', rpm: 60, torque: 0.1 });
        const drum = add({ type: 'pulley', x: 5, y: 10, z: 4, axis: 'z', size: 'l' });
        const load = add({ type: 'brick', x: 6, y: 0, z: 4, w: 2, h: 2, d: 1, free: true, mass: 1 });
        add({ type: 'rope', drum: drum.id, load: load.id });
      }),
    },
    'turntable': {
      title: 'Turntable',
      note: 'Built flat: a brick with upward holes on the ground, a motor pinned on top of it, and two upright axles. The 8-tooth gear turns a 40 lying flat (1:5). Use the Top view to see it the way you would build it.',
      model: () => build(add => {
        add({ type: 'brick', x: 0, y: 0, z: 0, w: 9, h: 1, d: 5, holes: 'y' });
        add({ type: 'axle', x: 7, y: 0, z: 2, len: 3, axis: 'y' });
        add({ type: 'motor', x: 7, y: 1, z: 2, axis: 'y', rpm: 60, torque: 0.1 });
        add({ type: 'gear', x: 7, y: 2, z: 2, axis: 'y', teeth: 8 });
        add({ type: 'axle', x: 4, y: 0, z: 2, len: 4, axis: 'y' });
        add({ type: 'gear', x: 4, y: 2, z: 2, axis: 'y', teeth: 40 });
      }),
    },
    'belts': {
      title: 'Belt drive',
      note: 'An open belt keeps the direction and steps a small pulley up to a large one (1:3). A crossed belt reverses it.',
      model: () => build(add => {
        frame(add, 15, 6);
        add({ type: 'axle', x: 2, y: 6, z: 1, len: 3, axis: 'z' });
        add({ type: 'motor', x: 2, y: 6, z: 1, axis: 'z', rpm: 90, torque: 0.1 });
        const a = add({ type: 'pulley', x: 2, y: 6, z: 3, axis: 'z', size: 's' });
        add({ type: 'axle', x: 7, y: 6, z: 2, len: 3, axis: 'z' });
        const b = add({ type: 'pulley', x: 7, y: 6, z: 3, axis: 'z', size: 'l' });
        const c = add({ type: 'pulley', x: 7, y: 6, z: 4, axis: 'z', size: 'm' });
        add({ type: 'axle', x: 12, y: 6, z: 2, len: 3, axis: 'z' });
        const d = add({ type: 'pulley', x: 12, y: 6, z: 4, axis: 'z', size: 'm' });
        add({ type: 'belt', a: a.id, b: b.id, crossed: false });
        add({ type: 'belt', a: c.id, b: d.id, crossed: true });
      }),
    },
    'rack': {
      title: 'Rack and pinion',
      note: 'An 8-tooth pinion drives a 10-long rack. Each turn moves it 2π × 0.5 holes ≈ 25 mm. It stops when the pinion reaches the rack’s end.',
      model: () => build(add => {
        frame(add, 13, 6);
        add({ type: 'axle', x: 6, y: 6, z: 1, len: 3, axis: 'z' });
        add({ type: 'motor', x: 6, y: 6, z: 1, axis: 'z', rpm: -20, torque: 0.1 });
        add({ type: 'gear', x: 6, y: 6, z: 3, axis: 'z', teeth: 8 });
        add({ type: 'rack', x: 2, y: 5, z: 3, len: 10, dir: 'x', axis: 'z' });
      }),
    },
    'idlers': {
      title: 'Idler gears',
      note: 'Three 24-tooth gears in a row. The middle one only carries the motion: the output turns at the input’s speed, in the same direction.',
      model: () => build(add => {
        frame(add, 11, 6);
        add({ type: 'axle', x: 2, y: 6, z: 1, len: 3, axis: 'z' });
        add({ type: 'motor', x: 2, y: 6, z: 1, axis: 'z', rpm: 45, torque: 0.1 });
        for (const x of [2, 5, 8]) {
          if (x !== 2) add({ type: 'axle', x, y: 6, z: 2, len: 2, axis: 'z' });
          add({ type: 'gear', x, y: 6, z: 3, axis: 'z', teeth: 24 });
        }
      }),
    },
    'jam': {
      title: 'Belt against gears',
      note: 'Three 16-tooth gears tie the outer axles together at 1:1. A belt from a small to a large pulley asks for 3:1. Both cannot hold, so the train locks.',
      model: () => build(add => {
        frame(add, 10, 6);
        add({ type: 'axle', x: 2, y: 6, z: 1, len: 4, axis: 'z' });
        add({ type: 'motor', x: 2, y: 6, z: 1, axis: 'z', rpm: 30, torque: 0.1 });
        for (const x of [2, 4, 6]) {
          if (x !== 2) add({ type: 'axle', x, y: 6, z: 2, len: 3, axis: 'z' });
          add({ type: 'gear', x, y: 6, z: 3, axis: 'z', teeth: 16 });
        }
        const a = add({ type: 'pulley', x: 2, y: 6, z: 4, axis: 'z', size: 's' });
        const b = add({ type: 'pulley', x: 6, y: 6, z: 4, axis: 'z', size: 'l' });
        add({ type: 'belt', a: a.id, b: b.id, crossed: false });
      }),
    },
  };

  return {
    ExtendX, U, G, GEARS, PULLEYS, DEFAULTS, MIXINS, IDX, VEC, FRAME,
    MachineBase, Dof, Joint,
    classes: { Machine, Rotor, Load, Slider, GearMesh, BeltDrive, RopeLine },
    emptyModel, addPart, removePart, byId, axleAt, normalize, migrate,
    radiusOf, extent, cells, holes, label, isWheel, isWeight, isStructure, isConnector, lineKey, planeAngle,
    connections, autoPins, analyze, solids, clash, collisionsWith, allCollisions, freeTravel, compile, predict, record, measure, solveRows,
    PRESETS,
  };
}));
