// ─── Technic — build machines from beams, axles, gears, pulleys, belts and ropes ───
// Author: Will Fobbs
// Company: Pooled Impact
// Confidential & Proprietary — Not for distribution
//
// Mechanism Lab v2. v1 (research/spline-patch/v1/Mechanism.js) proved the method on one
// fixed scene: plain bases that expose a few dispatch hooks, every physical effect an
// ExtendX mixin that joins them, and a hand calculation checked against the simulation.
// v2 keeps the method and opens the scene up: the user builds the machine.
//
// Two layers, kept apart on purpose:
//
//   MODEL    what was built. A flat list of parts on a 3D hole grid (x, y, z in Technic
//            units: 1 = one hole pitch = 8 mm; y is up, z runs toward the viewer). Plain
//            data, serialisable, the same for every view. Side and isometric are two
//            cameras on it, nothing more.
//
//   MACHINE  what moves. compile(model) reads the model, works out which parts are
//            joined (gears on a shared axle turn together, gears whose pitch circles
//            touch on one layer mesh, a belt ties two pulleys, a rope ties a drum to a
//            load) and builds the simulation from ExtendX-composed objects:
//
//              Dof    one degree of freedom: an axle assembly (angle), a rack (slide), a
//                     free brick (height). Mixins: Bearing (friction where the axle runs
//                     in a beam), Motor (speed servo with a torque limit), Weight (gravity
//                     on a load), Contact (a load rests on what is below it), Guide (a
//                     rack's travel stops).
//              Joint  a relation between Dofs. Mixins: Mesh (gear–gear, gear–rack), Belt
//                     (pulley–pulley, open or crossed, optional slip), Rope (drum–load,
//                     pulls only, jams at the drum).
//              Machine  Gravity (a uniform field) and the solver.
//
// Every constraint is linear in the Dof velocities, so each substep is one small linear
// complementarity problem: rows J·v = b with bounds on each row's impulse. It is solved
// directly (active set over dense Gaussian elimination), not by iterating, so a long gear
// train with a heavy load on the end converges exactly instead of sagging. Over-
// constrained trains (a loop whose ratios disagree) are regularised and simply lock,
// which is what a jammed gearbox does.

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

  // ── Catalogue ────────────────────────────────────────────────────────
  // Gear pitch radius = teeth / 16 holes, so every standard pair meshes at a distance the
  // hole grid can reach (8+24 = 2 holes, 8+40 = 3, 24+24 = 3, 16+16 = 2 ...).
  const GEARS = { 8: { mass: 0.0006 }, 16: { mass: 0.0015 }, 24: { mass: 0.0025 }, 40: { mass: 0.006 } };
  const PULLEYS = { s: { r: 0.5, mass: 0.0008, label: 'small' }, m: { r: 1, mass: 0.0015, label: 'medium' }, l: { r: 1.5, mass: 0.003, label: 'large' } };
  const MESH_TOL = 0.06;           // holes
  const DEFAULTS = {
    motor: { rpm: 60, torque: 0.1 },        // N·m stall torque
    bearingFriction: 0.0002,                // N·m per axle held in a beam
    rackMass: 0.01,
    axleMass: 0.001,
  };

  function radiusOf(p) {
    if (p.type === 'gear') return p.teeth / 16;
    if (p.type === 'pulley') return PULLEYS[p.size].r;
    return 0;
  }
  const isWheel = p => p.type === 'gear' || p.type === 'pulley' || p.type === 'motor';

  // Cells a part occupies on its own layer (axis-aligned, in holes, centre-based).
  function extent(p) {
    switch (p.type) {
      case 'beam': return p.dir === 'y'
        ? { x0: p.x - 0.45, x1: p.x + 0.45, y0: p.y - 0.5, y1: p.y + p.len - 0.5, z0: p.z - 0.45, z1: p.z + 0.45 }
        : { x0: p.x - 0.5, x1: p.x + p.len - 0.5, y0: p.y - 0.45, y1: p.y + 0.45, z0: p.z - 0.45, z1: p.z + 0.45 };
      case 'brick': return { x0: p.x - 0.5, x1: p.x + p.w - 0.5, y0: p.y - 0.5, y1: p.y + p.h - 0.5, z0: p.z - 0.5, z1: p.z + (p.d || 1) - 0.5 };
      case 'rack': return { x0: p.x - 0.5, x1: p.x + p.len - 0.5, y0: p.y - 0.5, y1: p.y + 0.5, z0: p.z - 0.3, z1: p.z + 0.3 };
      case 'motor': return { x0: p.x - 1, x1: p.x + 1, y0: p.y - 1, y1: p.y + 1, z0: p.z - 0.45, z1: p.z + 0.45 };
      default: return null;
    }
  }

  // Holes a structural part offers to an axle running along z.
  function holes(p) {
    const out = [];
    if (p.type === 'beam') {
      for (let i = 0; i < p.len; i++) out.push(p.dir === 'y' ? [p.x, p.y + i, p.z] : [p.x + i, p.y, p.z]);
    } else if (p.type === 'brick' && p.anchored !== false) {
      for (let i = 0; i < p.w; i++) for (let j = 0; j < p.h; j++) for (let k = 0; k < (p.d || 1); k++) out.push([p.x + i, p.y + j, p.z + k]);
    }
    return out;
  }

  // ── Model helpers ────────────────────────────────────────────────────

  function emptyModel() { return { version: 2, parts: [], nextId: 1 }; }

  function addPart(model, part) {
    const p = Object.assign({ id: model.nextId++ }, part);
    model.parts.push(p);
    return p;
  }

  function byId(model, id) { return model.parts.find(p => p.id === id) || null; }

  function removePart(model, id) {
    const doomed = new Set([id]);
    // Anything that hangs off a removed part goes with it.
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of model.parts) {
        if (doomed.has(p.id)) continue;
        if ((p.type === 'belt' && (doomed.has(p.a) || doomed.has(p.b))) || (p.type === 'rope' && (doomed.has(p.drum) || doomed.has(p.load)))) {
          doomed.add(p.id); grew = true;
        }
      }
    }
    model.parts = model.parts.filter(p => !doomed.has(p.id));
    return doomed;
  }

  function axleAt(model, x, y, z) {
    return model.parts.find(p => p.type === 'axle' && p.x === x && p.y === y && z >= p.z && z < p.z + p.len) || null;
  }

  // ── Analysis: model → structure (shared by compile, the hand calculation and drawing) ──

  function analyze(model) {
    const parts = model.parts, issues = [];
    const anchored = parts.filter(p => p.type === 'beam' || (p.type === 'brick' && p.anchored !== false));
    const holeSet = new Set();
    for (const s of anchored) for (const h of holes(s)) holeSet.add(h.join(','));

    // Axle assemblies.
    const axles = parts.filter(p => p.type === 'axle').map(a => {
      let held = 0;
      for (let k = a.z; k < a.z + a.len; k++) if (holeSet.has([a.x, a.y, k].join(','))) held++;
      return { axle: a, members: [], held, supported: held > 0 };
    });
    const assemblyOf = new Map();
    for (const w of parts.filter(isWheel)) {
      const as = axles.find(A => A.axle.x === w.x && A.axle.y === w.y && w.z >= A.axle.z && w.z < A.axle.z + A.axle.len);
      if (!as) { issues.push({ id: w.id, level: 'warn', text: `${label(w)} has no axle through it` }); continue; }
      as.members.push(w); assemblyOf.set(w.id, as);
    }
    for (const as of axles) {
      if (!as.supported && as.members.length) issues.push({ id: as.axle.id, level: 'warn', text: `${label(as.axle)} is not held by a beam or brick, so it cannot turn` });
      const seen = new Map();
      for (const m of as.members) {
        if (seen.has(m.z)) issues.push({ id: m.id, level: 'error', text: `${label(m)} and ${label(seen.get(m.z))} sit on the same spot` });
        seen.set(m.z, m);
      }
    }

    // Gear meshes and wheel collisions on each layer.
    const meshes = [];
    const wheels = parts.filter(p => (p.type === 'gear' || p.type === 'pulley') && assemblyOf.has(p.id));
    for (let i = 0; i < wheels.length; i++) for (let j = i + 1; j < wheels.length; j++) {
      const a = wheels[i], b = wheels[j];
      if (a.z !== b.z || assemblyOf.get(a.id) === assemblyOf.get(b.id)) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y), sum = radiusOf(a) + radiusOf(b);
      const both = a.type === 'gear' && b.type === 'gear';
      if (both && Math.abs(d - sum) < MESH_TOL) meshes.push({ kind: 'gear', a, b, d });
      else if (d < sum + (both ? 0.12 : 0) - MESH_TOL) issues.push({ id: b.id, level: 'error', text: `${label(a)} and ${label(b)} overlap without meshing` });
    }

    // Racks: a gear meshes when its pitch circle touches the rack's pitch line.
    const racks = parts.filter(p => p.type === 'rack').map(r => ({ rack: r, meshes: [] }));
    for (const R of racks) {
      const r = R.rack;
      for (const g of wheels) {
        if (g.type !== 'gear' || g.z !== r.z) continue;
        const rg = radiusOf(g), within = g.x >= r.x - 0.01 && g.x <= r.x + r.len - 0.99;
        if (!within) continue;
        if (Math.abs(g.y - rg - (r.y + 0.5)) < MESH_TOL) R.meshes.push({ gear: g, side: -1 });      // rack below the gear
        else if (Math.abs(g.y + rg - (r.y - 0.5)) < MESH_TOL) R.meshes.push({ gear: g, side: 1 });  // rack above
      }
      if (R.meshes.length) meshes.push(...R.meshes.map(m => ({ kind: 'rack', a: m.gear, rack: r, side: m.side })));
    }

    // Belts.
    const belts = parts.filter(p => p.type === 'belt').map(b => {
      const a = byId(model, b.a), c = byId(model, b.b);
      const ok = a && c && a.type === 'pulley' && c.type === 'pulley' && a.z === c.z && assemblyOf.has(a.id) && assemblyOf.has(c.id) && assemblyOf.get(a.id) !== assemblyOf.get(c.id);
      if (!ok) issues.push({ id: b.id, level: 'warn', text: 'Belt needs two pulleys on different axles, on the same layer' });
      return { belt: b, a, b: c, ok };
    });

    // Free bricks: loads. Each rests on the highest anchored top beneath it, or the ground.
    const loads = parts.filter(p => p.type === 'brick' && p.anchored === false).map(L => {
      const e = extent(L);
      let floor = -0.5;
      for (const s of anchored) {
        const f = extent(s);
        if (f.x1 <= e.x0 + 1e-6 || f.x0 >= e.x1 - 1e-6 || f.z1 <= e.z0 + 1e-6 || f.z0 >= e.z1 - 1e-6) continue;
        if (f.y1 <= e.y0 + 1e-6 && f.y1 > floor) floor = f.y1;
      }
      for (const R of racks) {
        const f = extent(R.rack);
        if (f.x1 <= e.x0 || f.x0 >= e.x1 || f.z1 <= e.z0 || f.z0 >= e.z1) continue;
        if (f.y1 <= e.y0 + 1e-6 && f.y1 > floor) floor = f.y1;
      }
      return { load: L, floor };
    });

    // Ropes.
    const ropes = parts.filter(p => p.type === 'rope').map(r => {
      const drum = byId(model, r.drum), load = byId(model, r.load);
      const ok = drum && load && (drum.type === 'pulley' || drum.type === 'gear') && assemblyOf.has(drum.id) && load.type === 'brick' && load.anchored === false;
      if (!ok) { issues.push({ id: r.id, level: 'warn', text: 'Rope needs a pulley on an axle and a free brick' }); return { rope: r, ok: false }; }
      const cx = load.x + (load.w - 1) / 2, side = cx >= drum.x ? 1 : -1;
      const top = load.y + load.h - 0.5;
      return { rope: r, drum, load, side, ok: true, attachX: drum.x + side * radiusOf(drum), top };
    });

    return { axles, assemblyOf, meshes, racks, belts, loads, ropes, issues };
  }

  function label(p) {
    if (!p) return '?';
    switch (p.type) {
      case 'gear': return `${p.teeth}t gear #${p.id}`;
      case 'pulley': return `${PULLEYS[p.size].label} pulley #${p.id}`;
      case 'axle': return `axle #${p.id}`;
      case 'beam': return `beam ${p.len} #${p.id}`;
      case 'brick': return p.anchored === false ? `weight ${p.mass} kg #${p.id}` : `brick #${p.id}`;
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
      this.lastRows = [];
    }

    // Dispatch hook: field acceleration (m/s²), Gravity adds to it.
    fieldAt() { return [0, 0, 0]; }

    step(dt) {
      const n = Math.max(1, Math.ceil(dt / this.substep - 1e-9)), h = dt / n;
      for (let i = 0; i < n; i++) this.substepOnce(h);
      return this;
    }

    substepOnce(h) {
      const dofs = this.dofs;
      dofs.forEach((d, i) => { d.index = i; });
      for (const d of dofs) {
        const f = d.forces(this) || 0;
        if (d.inertia > 0) d.v += h * f / d.inertia;
      }
      const rows = [];
      for (const d of dofs) d.rows(this, h, rows);
      for (const j of this.joints) j.rows(this, h, rows);
      solveRows(rows, dofs, this.warm || (this.warm = new Map()));
      for (const row of rows) {
        for (const [d, c] of row.terms) if (d.inertia > 0) d.v += c * row.lambda / d.inertia;
        if (row.owner) row.owner.lastImpulse[row.tag] = row.lambda / h;
      }
      for (const d of dofs) d.q += h * d.v;
      this.lastRows = rows;
      this.t += h;
    }

    // Kinetic, gravity and total energy, each term through the layers present.
    energy() {
      let kinetic = 0, potential = 0;
      for (const d of this.dofs) {
        kinetic += 0.5 * d.inertia * d.v * d.v;
        potential += d.potential(this) || 0;
      }
      return { kinetic, potential, total: kinetic + potential };
    }

    find(name) { return this.dofs.concat(this.joints).find(x => x.name === name) || null; }
  }

  class Dof {
    constructor(opts = {}) {
      this.name = opts.name;
      this.kind = opts.kind;            // 'rotor' | 'slider' | 'load'
      this.q = 0;                        // rad or m, from the model's rest state
      this.v = 0;
      this.inertia = opts.inertia;       // kg·m² or kg
      this.dir = opts.dir || [0, 0, 0];  // for sliders and loads: unit direction of +q
      this.partIds = opts.partIds || [];
      this.lastImpulse = {};
      // Inside an ExtendX layer `this` is a forwarding proxy, so rows must name the real
      // instance: the solver couples rows by identity (===) on their dofs.
      this.self = this;
    }
    forces(machine) { return 0; }
    rows(machine, h, out) {}
    potential(machine) { return 0; }
  }

  class Joint {
    constructor(opts = {}) {
      this.name = opts.name;
      this.kind = opts.kind;
      this.terms = opts.terms || [];     // [[dof, coefficient]], C = Σ c·q − C0
      this.C0 = opts.C0 || 0;
      this.partIds = opts.partIds || [];
      this.lastImpulse = {};
      this.self = this;
    }
    C() { let s = -this.C0; for (const [d, c] of this.terms) s += c * d.q; return s; }
    rows(machine, h, out) {}
  }

  const BETA = 0.2, INF = Infinity;

  // ── Machine mixins ───────────────────────────────────────────────────

  const Gravity = {
    mixinId: 'technic.Gravity',
    init(opts = {}) { this.g = opts.g === undefined ? G : opts.g; },
    fieldAt(next) {
      const below = next();
      return [below[0], below[1] - this.g, below[2]];
    },
  };

  // ── Dof mixins ───────────────────────────────────────────────────────

  // Gravity on a load or a vertical rack: F = m·(g·dir), U = −m·(g·dir)·q.
  const Weight = {
    mixinId: 'technic.Weight',
    forces(machine, next) {
      const g = machine.fieldAt();
      return this.inertia * (g[0] * this.dir[0] + g[1] * this.dir[1] + g[2] * this.dir[2]) + next();
    },
    potential(machine, next) {
      const g = machine.fieldAt();
      return -this.inertia * (g[0] * this.dir[0] + g[1] * this.dir[1] + g[2] * this.dir[2]) * this.q + next();
    },
  };

  // A load rests on whatever is beneath it: q ≥ floor (pushes only).
  const Contact = {
    mixinId: 'technic.Contact',
    rows(machine, h, out, next) {
      const gap = this.q - this.floor;
      if (gap < 0.002) out.push({ owner: this.self, tag: 'contact', terms: [[this.self, 1]], b: gap < 0 ? -BETA * gap / h : -gap / h, lo: 0, hi: INF, key: this.name + ':contact' });
      return next();
    },
  };

  // Friction where an axle runs in a beam: a torque up to τf opposing the spin.
  const Bearing = {
    mixinId: 'technic.Bearing',
    rows(machine, h, out, next) {
      if (this.friction > 0) out.push({ owner: this.self, tag: 'friction', terms: [[this.self, 1]], b: 0, lo: -this.friction * h, hi: this.friction * h, key: this.name + ':friction' });
      return next();
    },
  };

  // Speed servo with a torque limit: drives ω toward the set speed with at most ±τmax.
  const Motor = {
    mixinId: 'technic.Motor',
    rows(machine, h, out, next) {
      if (this.motor) {
        const w = this.motor.rpm * TAU / 60, t = this.motor.torque;
        out.push({ owner: this.self, tag: 'motor', terms: [[this.self, 1]], b: w, lo: -t * h, hi: t * h, key: this.name + ':motor' });
      }
      return next();
    },
  };

  // A rack's travel: it stops where the gear would run off its teeth.
  const Guide = {
    mixinId: 'technic.Guide',
    rows(machine, h, out, next) {
      const lo = this.q - this.qmin, hi = this.qmax - this.q;
      if (lo < 0.002) out.push({ owner: this.self, tag: 'stop', terms: [[this.self, 1]], b: lo < 0 ? -BETA * lo / h : -lo / h, lo: 0, hi: INF, key: this.name + ':stopLo' });
      if (hi < 0.002) out.push({ owner: this.self, tag: 'stop', terms: [[this.self, -1]], b: hi < 0 ? -BETA * hi / h : -hi / h, lo: 0, hi: INF, key: this.name + ':stopHi' });
      return next();
    },
  };

  // ── Joint mixins ─────────────────────────────────────────────────────

  // Gears: pitch-line speeds match. C = Σ c·q is held at its starting value.
  const Mesh = {
    mixinId: 'technic.Mesh',
    rows(machine, h, out, next) {
      out.push({ owner: this.self, tag: 'mesh', terms: this.terms, b: -BETA * this.C() / h, lo: -INF, hi: INF, key: this.name });
      return next();
    },
  };

  // Belt: like a mesh, same direction (crossed: opposite). With slip > 0 the belt can
  // carry at most that much force before it slips.
  const Belt = {
    mixinId: 'technic.Belt',
    rows(machine, h, out, next) {
      const s = this.slip > 0 ? this.slip * h : INF;
      // A slipping belt has no fixed phase to return to, so no position correction.
      out.push({ owner: this.self, tag: 'belt', terms: this.terms, b: s === INF ? -BETA * this.C() / h : 0, lo: -s, hi: s, key: this.name });
      return next();
    },
  };

  // Rope from a drum down to a load: it pulls only, and the load jams against the drum
  // when the rope is wound all the way in. C = length violation (> 0: over-stretched).
  const Rope = {
    mixinId: 'technic.Rope',
    rows(machine, h, out, next) {
      const C = this.C();
      if (C > -0.002) out.push({ owner: this.self, tag: 'tension', terms: this.terms, b: C > 0 ? -BETA * C / h : -C / h, lo: -INF, hi: 0, key: this.name + ':taut' });
      // Wound in: rope length = L0 − side·r·θ must stay ≥ minLength.
      const len = this.length(), room = len - this.minLength;
      if (room < 0.002) out.push({ owner: this.self, tag: 'jam', terms: [[this.drum, -this.side * this.r]], b: room < 0 ? -BETA * room / h : -room / h, lo: 0, hi: INF, key: this.name + ':jam' });
      return next();
    },
  };

  const MIXINS = { Gravity, Weight, Contact, Bearing, Motor, Guide, Mesh, Belt, Rope };

  // ── Solver: bounded rows, active set over a dense direct solve ─────────

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

    // state: 0 free, -1 at lo, +1 at hi. Warm-started by row key.
    const state = new Int8Array(n), lam = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const w = warm.get(rows[i].key);
      state[i] = w === undefined ? 0 : w;
      if (state[i] === -1 && !Number.isFinite(rows[i].lo)) state[i] = 0;
      if (state[i] === 1 && !Number.isFinite(rows[i].hi)) state[i] = 0;
    }
    // Principal pivoting, one row at a time: solve with the current free set, then move
    // the single worst offender (a free row past its bound, else a clamped row whose
    // residual says it wants back in). Changing several at once can cycle.
    const solveFree = () => {
      const free = [];
      for (let i = 0; i < n; i++) {
        if (state[i] === -1) lam[i] = rows[i].lo; else if (state[i] === 1) lam[i] = rows[i].hi; else free.push(i);
      }
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
        const over = (lam[i] - rows[i].hi) / Math.sqrt(A[i][i]), under = (rows[i].lo - lam[i]) / Math.sqrt(A[i][i]);
        if (over > worstBy) { worst = i; worstBy = over; to = 1; }
        if (under > worstBy) { worst = i; worstBy = under; to = -1; }
      }
      if (worst < 0) {
        for (let i = 0; i < n; i++) {
          if (state[i] === 0) continue;
          let w = -r[i];
          for (let j = 0; j < n; j++) w += A[i][j] * lam[j];
          const bad = (state[i] === -1 ? -w : w) / Math.sqrt(A[i][i]);
          if (bad > Math.max(worstBy, 1e-12 * (Math.abs(r[i]) + 1e-9) / Math.sqrt(A[i][i]))) { worst = i; worstBy = bad; to = 0; }
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
      for (let i = c + 1; i < m; i++) {
        const f = M[i][c] / piv;
        if (!f) continue;
        for (let k = c; k <= m; k++) M[i][k] -= f * M[c][k];
      }
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

  function compile(model, opts = {}) {
    const an = analyze(model);
    const machine = new Machine({ g: opts.g === undefined ? G : opts.g, substep: opts.substep });
    const dofOf = new Map();           // part id → dof (axle members map to their axle's dof)
    const phase = new Map();           // gear id → tooth phase (cosmetic)

    for (const as of an.axles) {
      if (!as.supported) continue;
      let I = DEFAULTS.axleMass * (0.0024 * 0.0024) / 2;
      let motor = null;
      for (const m of as.members) {
        if (m.type === 'motor') { motor = { rpm: m.rpm, torque: m.torque, id: m.id }; I += 4e-6; continue; }
        const r = radiusOf(m) * U, mass = m.type === 'gear' ? GEARS[m.teeth].mass : PULLEYS[m.size].mass;
        I += 0.5 * mass * r * r;
      }
      const d = new Rotor({ name: `axle#${as.axle.id}`, kind: 'rotor', inertia: I, partIds: [as.axle.id, ...as.members.map(m => m.id)] });
      d.friction = DEFAULTS.bearingFriction * Math.min(2, as.held);
      d.motor = motor;
      d.axle = as.axle;
      machine.dofs.push(d);
      dofOf.set(as.axle.id, d);
      for (const m of as.members) dofOf.set(m.id, d);
    }

    for (const L of an.loads) {
      const p = L.load;
      const d = new Load({ name: `weight#${p.id}`, kind: 'load', inertia: p.mass, dir: [0, 1, 0], partIds: [p.id] });
      d.base = (p.y - 0.5) * U;   // model bottom, m; q is the rise above it
      d.floor = (L.floor - (p.y - 0.5)) * U;
      d.part = p;
      machine.dofs.push(d);
      dofOf.set(p.id, d);
    }

    for (const R of an.racks) {
      const p = R.rack;
      const d = new Slider({ name: `rack#${p.id}`, kind: 'slider', inertia: DEFAULTS.rackMass * p.len / 8, dir: [1, 0, 0], partIds: [p.id] });
      // Travel keeps every meshing gear on the teeth: x ≤ gear.x ≤ x + len − 1.
      let qmin = -INF, qmax = INF;
      for (const m of R.meshes) {
        qmin = Math.max(qmin, (m.gear.x - (p.x + p.len - 1)) * U);
        qmax = Math.min(qmax, (m.gear.x - p.x) * U);
      }
      if (!R.meshes.length) { qmin = 0; qmax = 0; }
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
        // Contact below the gear (side −1): pitch speed +r·ω along +x; above: −r·ω.
        const coef = m.side === -1 ? -radiusOf(m.a) * U : radiusOf(m.a) * U;
        machine.joints.push(new GearMesh({ name: `mesh#${m.a.id}-${m.rack.id}`, kind: 'rack', terms: [[dr, 1], [da, coef]], partIds: [m.a.id, m.rack.id] }));
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
      const r = radiusOf(Rp.drum) * U, L0 = (Rp.drum.y - Rp.top) * U;
      // length = L0 − side·r·θ ; distance = L0 − q_load ; C = distance − length = side·r·θ − q_load.
      const j = new RopeLine({ name: `rope#${Rp.rope.id}`, kind: 'rope', terms: [[dd, Rp.side * r], [dl, -1]], C0: 0, partIds: [Rp.rope.id, Rp.drum.id, Rp.load.id] });
      j.drum = dd; j.side = Rp.side; j.r = r; j.L0 = L0; j.minLength = Math.max(0.5 * U, 0);
      j.length = function () { return this.L0 - this.side * this.r * this.drum.q; };
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
          const rb = radiusOf(b), phi = Math.atan2(b.y - a.y, b.x - a.x), pitch = TAU / 16;
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
  //
  // Speeds follow from the ratios alone: a mesh reverses direction and scales by r_a/r_b,
  // an open belt keeps it, a rack turns r·ω into a slide, a rope lifts at r·ω. The motor
  // torque needed is the power balance τ·ω_m = Σ m·g·v (loads) + Σ τf·|ω| (bearings). If
  // that exceeds the motor's limit it stalls. A loop whose ratios disagree jams.

  function predict(model, machine) {
    const an = machine.analysis;
    const dofs = machine.dofs, dofOf = machine.dofOf;
    const edges = new Map(dofs.map(d => [d, []]));
    const link = (a, b, k) => { edges.get(a).push([b, k]); edges.get(b).push([a, 1 / k]); };
    for (const j of machine.joints) {
      if (j.kind === 'rope') continue;
      const [[a, ca], [b, cb]] = j.terms;
      if (ca === 0 || cb === 0) continue;
      link(a, b, -ca / cb);      // ca·va + cb·vb = 0 ⇒ vb = −(ca/cb)·va
    }
    const ropes = machine.joints.filter(j => j.kind === 'rope');
    const motors = dofs.filter(d => d.motor);
    const result = { components: [], byDof: new Map() };
    const done = new Set();

    for (const m of motors) {
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
      const otherMotors = [...k.keys()].filter(d => d !== m && d.motor);
      const w = m.motor.rpm * TAU / 60;
      for (const o of otherMotors) if (Math.abs(o.motor.rpm * TAU / 60 - w * k.get(o)) > 1e-6) jam = true;

      // Loads lifted through ropes: v = side·r·ω_drum (only while that is upward).
      let torque = 0, liftNote = [];
      for (const rp of ropes) {
        const drum = rp.drum, load = rp.terms[1][0];
        if (!k.has(drum)) continue;
        const kl = rp.side * rp.r * k.get(drum) * Math.sign(w || 1);
        if (kl > 0) {
          k.set(load, rp.side * rp.r * k.get(drum));
          torque += load.inertia * G * Math.abs(rp.r * k.get(drum));
          liftNote.push(load);
        } else {
          k.set(load, 0);
        }
      }
      for (const [d, kd] of k) if (d.kind === 'rotor' && d.friction > 0) torque += d.friction * Math.abs(kd);
      const stall = torque > m.motor.torque + 1e-12;
      const comp = { motor: m, ratios: k, jam, stall, torqueNeeded: torque, torqueMax: m.motor.torque, speed: w };
      result.components.push(comp);
      for (const [d, kd] of k) {
        done.add(d);
        const v = jam || stall ? 0 : w * kd;
        result.byDof.set(d, { v, ratio: kd, comp });
      }
    }
    for (const d of dofs) if (!result.byDof.has(d)) result.byDof.set(d, { v: 0, ratio: 0, comp: null });
    return result;
  }

  // Simulated speed per dof over the last `window` seconds.
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

  // ── Presets ──────────────────────────────────────────────────────────

  function build(fn) { const m = emptyModel(); fn((part) => addPart(m, part)); return m; }

  const PRESETS = {
    'gear-train': {
      title: 'Gear train 1:15',
      note: 'An 8-tooth gear drives a 40 (1:5), then an 8 on the same axle drives a 24 (1:3). Two meshes: the output turns the same way as the motor, 15 times slower and 15 times stronger.',
      model: () => build(add => {
        add({ type: 'beam', x: 0, y: 4, z: 1, len: 11, dir: 'x' });
        add({ type: 'axle', x: 1, y: 4, z: 0, len: 4 });
        add({ type: 'axle', x: 4, y: 4, z: 1, len: 3 });
        add({ type: 'axle', x: 6, y: 4, z: 1, len: 3 });
        add({ type: 'motor', x: 1, y: 4, z: 0, rpm: 60, torque: 0.1 });
        add({ type: 'gear', x: 1, y: 4, z: 2, teeth: 8 });
        add({ type: 'gear', x: 4, y: 4, z: 2, teeth: 40 });
        add({ type: 'gear', x: 4, y: 4, z: 3, teeth: 8 });
        add({ type: 'gear', x: 6, y: 4, z: 3, teeth: 24 });
        add({ type: 'brick', x: 0, y: 0, z: 1, w: 11, h: 1, anchored: true });
        add({ type: 'beam', x: 0, y: 1, z: 1, len: 3, dir: 'y' });
        add({ type: 'beam', x: 10, y: 1, z: 1, len: 3, dir: 'y' });
      }),
    },
    'winch': {
      title: 'Winch',
      note: 'The motor turns an 8-tooth gear into a 40 (1:5). A large pulley on the 40’s axle winds a rope and lifts a 0.5 kg weight off the ground until it reaches the drum.',
      model: () => build(add => {
        add({ type: 'beam', x: 0, y: 9, z: 1, len: 9, dir: 'x' });
        add({ type: 'beam', x: 0, y: 1, z: 1, len: 8, dir: 'y' });
        add({ type: 'beam', x: 8, y: 1, z: 1, len: 8, dir: 'y' });
        add({ type: 'axle', x: 1, y: 9, z: 0, len: 3 });
        add({ type: 'axle', x: 4, y: 9, z: 1, len: 3 });
        add({ type: 'motor', x: 1, y: 9, z: 0, rpm: -60, torque: 0.1 });
        add({ type: 'gear', x: 1, y: 9, z: 2, teeth: 8 });
        add({ type: 'gear', x: 4, y: 9, z: 2, teeth: 40 });
        const drum = add({ type: 'pulley', x: 4, y: 9, z: 3, size: 'l' });
        const load = add({ type: 'brick', x: 5, y: 0, z: 3, w: 2, h: 2, anchored: false, mass: 0.5 });
        add({ type: 'rope', drum: drum.id, load: load.id });
      }),
    },
    'stalled-winch': {
      title: 'Winch without reduction',
      note: 'The same winch with the motor driving the drum directly and a 1 kg weight. Lifting it needs 0.118 N·m at the drum, more than the motor’s 0.1 N·m, so it stalls. Add gearing and it lifts.',
      model: () => build(add => {
        add({ type: 'beam', x: 0, y: 9, z: 1, len: 9, dir: 'x' });
        add({ type: 'beam', x: 0, y: 1, z: 1, len: 8, dir: 'y' });
        add({ type: 'beam', x: 8, y: 1, z: 1, len: 8, dir: 'y' });
        add({ type: 'axle', x: 4, y: 9, z: 0, len: 4 });
        add({ type: 'motor', x: 4, y: 9, z: 0, rpm: 60, torque: 0.1 });
        const drum = add({ type: 'pulley', x: 4, y: 9, z: 3, size: 'l' });
        const load = add({ type: 'brick', x: 5, y: 0, z: 3, w: 2, h: 2, anchored: false, mass: 1 });
        add({ type: 'rope', drum: drum.id, load: load.id });
      }),
    },
    'belts': {
      title: 'Belt drive',
      note: 'An open belt keeps the direction and steps a small pulley up to a large one (1:3). A crossed belt reverses it.',
      model: () => build(add => {
        add({ type: 'beam', x: 0, y: 5, z: 1, len: 13, dir: 'x' });
        add({ type: 'axle', x: 1, y: 5, z: 0, len: 3 });
        add({ type: 'axle', x: 6, y: 5, z: 1, len: 3 });
        add({ type: 'axle', x: 11, y: 5, z: 1, len: 3 });
        add({ type: 'motor', x: 1, y: 5, z: 0, rpm: 90, torque: 0.1 });
        const a = add({ type: 'pulley', x: 1, y: 5, z: 2, size: 's' });
        const b = add({ type: 'pulley', x: 6, y: 5, z: 2, size: 'l' });
        const c = add({ type: 'pulley', x: 6, y: 5, z: 3, size: 'm' });
        const d = add({ type: 'pulley', x: 11, y: 5, z: 3, size: 'm' });
        add({ type: 'belt', a: a.id, b: b.id, crossed: false });
        add({ type: 'belt', a: c.id, b: d.id, crossed: true });
      }),
    },
    'rack': {
      title: 'Rack and pinion',
      note: 'An 8-tooth pinion drives a 10-long rack. Each turn moves it 2π × 0.5 holes ≈ 25 mm. It stops when the pinion reaches the rack’s end.',
      model: () => build(add => {
        add({ type: 'beam', x: 0, y: 4, z: 1, len: 13, dir: 'x' });
        add({ type: 'axle', x: 6, y: 4, z: 0, len: 3 });
        add({ type: 'motor', x: 6, y: 4, z: 0, rpm: -20, torque: 0.1 });
        add({ type: 'gear', x: 6, y: 4, z: 2, teeth: 8 });
        add({ type: 'rack', x: 2, y: 3, z: 2, len: 10 });
      }),
    },
    'idlers': {
      title: 'Idler gears',
      note: 'Three 24-tooth gears in a row. The middle one only carries the motion: the output turns at the same speed as the input, in the same direction.',
      model: () => build(add => {
        add({ type: 'beam', x: 0, y: 4, z: 1, len: 11, dir: 'x' });
        for (const x of [1, 4, 7]) add({ type: 'axle', x, y: 4, z: x === 1 ? 0 : 1, len: x === 1 ? 3 : 2 });
        add({ type: 'motor', x: 1, y: 4, z: 0, rpm: 45, torque: 0.1 });
        for (const x of [1, 4, 7]) add({ type: 'gear', x, y: 4, z: 2, teeth: 24 });
      }),
    },
    'jam': {
      title: 'Belt against gears',
      note: 'Three 16-tooth gears tie the outer axles in the same direction at 1:1. A belt from a small to a large pulley tries to make the outer axle turn three times slower. Both cannot hold, so the train locks.',
      model: () => build(add => {
        add({ type: 'beam', x: 0, y: 4, z: 1, len: 9, dir: 'x' });
        add({ type: 'axle', x: 1, y: 4, z: 0, len: 4 });
        add({ type: 'axle', x: 3, y: 4, z: 1, len: 2 });
        add({ type: 'axle', x: 5, y: 4, z: 1, len: 3 });
        add({ type: 'motor', x: 1, y: 4, z: 0, rpm: 30, torque: 0.1 });
        for (const x of [1, 3, 5]) add({ type: 'gear', x, y: 4, z: 2, teeth: 16 });
        const a = add({ type: 'pulley', x: 1, y: 4, z: 3, size: 's' });
        const b = add({ type: 'pulley', x: 5, y: 4, z: 3, size: 'l' });
        add({ type: 'belt', a: a.id, b: b.id, crossed: false });
      }),
    },
  };

  return {
    ExtendX, U, G, GEARS, PULLEYS, DEFAULTS, MIXINS,
    MachineBase, Dof, Joint,
    classes: { Machine, Rotor, Load, Slider, GearMesh, BeltDrive, RopeLine },
    emptyModel, addPart, removePart, byId, axleAt, radiusOf, extent, holes, label, isWheel,
    analyze, compile, predict, record, measure, solveRows,
    PRESETS,
  };
}));
