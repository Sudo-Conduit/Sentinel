// ─── Mechanism — "Lego for science": physics as composable ExtendX mixins ───
// Author: Will Fobbs
// Company: Pooled Impact
// Confidential & Proprietary — Not for distribution
//
// Three plain base classes — World, Body, Link — each expose a few dispatch hooks
// (forces, constrain, potential, energy, fieldAt, interact) and do nothing else.
// Every physical effect is a mixin that joins those hooks through ExtendX:
//
//   World:  Gravity (a uniform field g), Collisions (impulses between Collider bodies)
//   Body:   Weight (mass × field: W = m·g), Drag, Grounded (frictionless floor, μ = 0),
//           Collider (circle or box shape)
//   Link:   Spring (Hooke, optionally compression- or tension-only), Damper, Rod (rigid,
//           massless, exact length)
//
//   const Bob = ExtendX.extend(Body, Weight, Collider);
//   bob.explain('forces')        → "forces: mech.Weight -> <base>"
//   bob.disableLayer(Weight)     → this bob no longer feels gravity (or stores its PE)
//
// Energy is tallied through the same chains, so switching a layer off removes both its
// force and its energy term: the books stay balanced whatever is composed.
//
// Integration: semi-implicit Euler in fixed substeps; rods are projected (position and
// velocity) after each substep, then collisions, then body contacts.
//
// Kits assemble a ready-made problem with its closed-form answer alongside, so the
// simulation can be checked against the hand calculation.

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../../pooledimpact/mountainshift/v2/ExtendX'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../pooledimpact/mountainshift/v2/ExtendX.js'));
  } else {
    root.Mechanism = factory(root.ExtendX);
  }
}(typeof self !== 'undefined' ? self : this, function (ExtendX) {

  'use strict';

  // ── 2D vectors ───────────────────────────────────────────────────────
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const scale = (a, s) => [a[0] * s, a[1] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const len = a => Math.hypot(a[0], a[1]);

  // ── Bases ────────────────────────────────────────────────────────────

  class World {
    constructor(opts = {}) {
      this.name = opts.name || 'world';
      this.bodies = [];
      this.links = [];
      this.t = 0;
      this.substep = opts.substep || 1e-4;
      this.iterations = opts.iterations || 2;
      this.events = [];
    }

    add(...things) {
      for (const x of things) (x instanceof Link ? this.links : this.bodies).push(x);
      return this;
    }

    // Dispatch hook: acceleration of the field at a point (Gravity adds to it).
    fieldAt(pos) { return [0, 0]; }

    // Dispatch hook: world-level contacts after each substep (Collisions joins it).
    interact(h) {}

    step(dt) {
      const n = Math.max(1, Math.ceil(dt / this.substep - 1e-9)), h = dt / n;
      for (let i = 0; i < n; i++) this.substepOnce(h);
      return this;
    }

    substepOnce(h) {
      for (const b of this.bodies) b.F = [0, 0];
      for (const b of this.bodies) if (b.invMass > 0) b.forces(this, b.F);
      for (const l of this.links) l.forces(this);
      for (const b of this.bodies) {
        // A kinematic body moves at the velocity it was given, whatever pushes on it.
        if (b.kinematic) { b.pos = add(b.pos, scale(b.vel, h)); continue; }
        if (!(b.invMass > 0)) continue;
        b.vel = add(b.vel, scale(b.F, h * b.invMass));
        b.pos = add(b.pos, scale(b.vel, h));
      }
      for (let k = 0; k < this.iterations; k++) for (const l of this.links) l.constrain(this, h);
      this.interact(h);
      for (const b of this.bodies) if (!b.kinematic) b.constrain(this, h);
      this.t += h;
    }

    // { kinetic, potential, elastic, total } — each term summed through the layers present.
    energy() {
      let kinetic = 0, potential = 0, elastic = 0;
      for (const b of this.bodies) {
        if (b.invMass > 0) kinetic += 0.5 * b.mass * dot(b.vel, b.vel);
        potential += b.potential(this) || 0;
      }
      for (const l of this.links) elastic += l.energy(this) || 0;
      return { kinetic, potential, elastic, total: kinetic + potential + elastic };
    }

    find(name) { return this.bodies.concat(this.links).find(x => x.name === name) || null; }
  }

  class Body {
    constructor(opts = {}) {
      this.name = opts.name || 'body';
      this.pos = (opts.pos || [0, 0]).slice();
      this.vel = (opts.vel || [0, 0]).slice();
      this.mass = opts.mass === undefined ? 1 : opts.mass;
      this.fixed = !!opts.fixed;
      // Kinematic: driven from outside (e.g. by keyframes). Infinite mass to everything it
      // touches, but it moves, and its velocity counts in impacts and dampers.
      this.kinematic = !!opts.kinematic;
      this.F = [0, 0];
    }

    get invMass() { return this.fixed || this.kinematic || !(this.mass > 0) ? 0 : 1 / this.mass; }

    // Dispatch hooks. Each layer adds its contribution and calls next().
    forces(world, F) { return F; }
    constrain(world, h) {}
    potential(world) { return 0; }
  }

  class Link {
    constructor(opts = {}) {
      this.name = opts.name || 'link';
      this.a = opts.a;
      this.b = opts.b || null;
      this.anchor = (opts.anchor || [0, 0]).slice();
      this.offsetA = (opts.offsetA || [0, 0]).slice();
      this.offsetB = (opts.offsetB || [0, 0]).slice();
      this.rest = opts.rest === undefined ? this.length() : opts.rest;
    }

    endA() { return add(this.a.pos, this.offsetA); }
    endB() { return this.b ? add(this.b.pos, this.offsetB) : this.anchor.slice(); }
    length() { return len(sub(this.endB(), this.endA())); }

    // Push f (along a→b) onto the two ends: +f on a, −f on b.
    pull(f, n) {
      this.a.F = add(this.a.F, scale(n, f));
      if (this.b) this.b.F = sub(this.b.F, scale(n, f));
    }

    // Dispatch hooks.
    forces(world) {}
    constrain(world, h) {}
    energy(world) { return 0; }
  }

  // ── World mixins ─────────────────────────────────────────────────────

  const Gravity = {
    mixinId: 'mech.Gravity',
    init(opts = {}) { this.g = opts.g === undefined ? 9.81 : opts.g; },
    fieldAt(pos, next) {
      const below = next();
      return [below[0], below[1] - this.g];
    },
  };

  // Shapes: { type: 'circle', r } or { type: 'box', w, h }, centred on the body.
  function contact(a, b) {
    const sa = a.shape, sb = b.shape;
    if (sa.type === 'circle' && sb.type === 'circle') {
      const d = sub(b.pos, a.pos), dist = len(d), depth = sa.r + sb.r - dist;
      return depth > 0 && dist > 1e-12 ? { n: scale(d, 1 / dist), depth } : null;
    }
    if (sa.type === 'box' && sb.type === 'circle') {
      const c = contact(b, a);
      return c ? { n: scale(c.n, -1), depth: c.depth } : null;
    }
    if (sa.type === 'circle' && sb.type === 'box') {
      const hw = sb.w / 2, hh = sb.h / 2;
      const q = [Math.max(b.pos[0] - hw, Math.min(a.pos[0], b.pos[0] + hw)), Math.max(b.pos[1] - hh, Math.min(a.pos[1], b.pos[1] + hh))];
      const d = sub(q, a.pos), dist = len(d);
      if (dist >= sa.r) return null;
      if (dist > 1e-12) return { n: scale(d, 1 / dist), depth: sa.r - dist };
      // Centre inside the box: push out along the shallower axis.
      const dx = hw - Math.abs(a.pos[0] - b.pos[0]), dy = hh - Math.abs(a.pos[1] - b.pos[1]);
      return dx < dy
        ? { n: [b.pos[0] > a.pos[0] ? 1 : -1, 0], depth: dx + sa.r }
        : { n: [0, b.pos[1] > a.pos[1] ? 1 : -1], depth: dy + sa.r };
    }
    const dx = (sa.w + sb.w) / 2 - Math.abs(b.pos[0] - a.pos[0]);
    const dy = (sa.h + sb.h) / 2 - Math.abs(b.pos[1] - a.pos[1]);
    if (dx <= 0 || dy <= 0) return null;
    return dx < dy ? { n: [b.pos[0] >= a.pos[0] ? 1 : -1, 0], depth: dx } : { n: [0, b.pos[1] >= a.pos[1] ? 1 : -1], depth: dy };
  }

  const Collisions = {
    mixinId: 'mech.Collisions',
    init(opts = {}) { this.restitution = opts.restitution === undefined ? 1 : opts.restitution; },
    interact(h, next) {
      const bs = this.bodies.filter(b => b.shape);
      for (let i = 0; i < bs.length; i++) {
        for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i], b = bs[j];
          if (this.ignorePair && this.ignorePair(a, b)) continue;
          const c = contact(a, b);
          if (!c) continue;
          const wa = a.invMass, wb = b.invMass, w = wa + wb;
          if (!(w > 0)) continue;
          a.pos = sub(a.pos, scale(c.n, c.depth * wa / w));
          b.pos = add(b.pos, scale(c.n, c.depth * wb / w));
          const rel = dot(sub(b.vel, a.vel), c.n);
          if (rel >= 0) continue;
          const before = { a: a.vel.slice(), b: b.vel.slice() };
          const J = -(1 + this.restitution) * rel / w;
          a.vel = sub(a.vel, scale(c.n, J * wa));
          b.vel = add(b.vel, scale(c.n, J * wb));
          this.events.push({ t: this.t, a: a.name, b: b.name, impulse: J, before, after: { a: a.vel.slice(), b: b.vel.slice() } });
        }
      }
      return next();
    },
  };

  // ── Body mixins ──────────────────────────────────────────────────────

  // Weight: the body's mass couples to the world's field. W = m·g, U = −m·g·x.
  const Weight = {
    mixinId: 'mech.Weight',
    forces(world, F, next) {
      const g = world.fieldAt(this.pos);
      F[0] += this.mass * g[0];
      F[1] += this.mass * g[1];
      return next();
    },
    potential(world, next) {
      return -this.mass * dot(world.fieldAt(this.pos), this.pos) + next();
    },
  };

  // Linear air drag, F = −k·v.
  const Drag = {
    mixinId: 'mech.Drag',
    init(opts = {}) { this.drag = opts.drag === undefined ? 0.1 : opts.drag; },
    forces(world, F, next) {
      F[0] -= this.drag * this.vel[0];
      F[1] -= this.drag * this.vel[1];
      return next();
    },
  };

  // Rests on a frictionless floor (μ = 0): never sinks below it, slides freely along it.
  const Grounded = {
    mixinId: 'mech.Grounded',
    init(opts = {}) {
      this.floor = opts.floor || 0;
      this.footing = opts.size ? opts.size[1] / 2 : opts.radius || 0;
    },
    constrain(world, h, next) {
      const lowest = this.floor + this.footing;
      if (this.pos[1] < lowest) {
        this.pos = [this.pos[0], lowest];
        if (this.vel[1] < 0) this.vel = [this.vel[0], 0];
      }
      return next();
    },
  };

  // Gives the body a shape for Collisions: opts.radius → circle, opts.size [w, h] → box.
  const Collider = {
    mixinId: 'mech.Collider',
    init(opts = {}) {
      this.shape = opts.size ? { type: 'box', w: opts.size[0], h: opts.size[1] } : { type: 'circle', r: opts.radius || 0.05 };
    },
  };

  // ── Link mixins ──────────────────────────────────────────────────────

  // Hooke spring, F = c·(L − L₀). mode 'compression' acts only when squeezed (a bumper),
  // 'tension' only when stretched (a rope-like elastic), 'both' otherwise.
  const Spring = {
    mixinId: 'mech.Spring',
    init(opts = {}) {
      this.stiffness = opts.stiffness === undefined ? 100 : opts.stiffness;
      this.mode = opts.mode || 'both';
      this.maxCompression = 0;
      this.maxExtension = 0;
    },
    stretch() {
      const ext = this.length() - this.rest;
      if ((this.mode === 'compression' && ext > 0) || (this.mode === 'tension' && ext < 0)) return 0;
      return ext;
    },
    forces(world, next) {
      const d = sub(this.endB(), this.endA()), L = len(d);
      const ext = this.stretch();
      if (L > 1e-12 && ext) this.pull(this.stiffness * ext, scale(d, 1 / L));
      if (-ext > this.maxCompression) this.maxCompression = -ext;
      if (ext > this.maxExtension) this.maxExtension = ext;
      return next();
    },
    energy(world, next) {
      const ext = this.stretch();
      return 0.5 * this.stiffness * ext * ext + next();
    },
  };

  // Viscous damper along the link, F = d·(relative velocity along it).
  const Damper = {
    mixinId: 'mech.Damper',
    init(opts = {}) { this.damping = opts.damping === undefined ? 1 : opts.damping; },
    forces(world, next) {
      const d = sub(this.endB(), this.endA()), L = len(d);
      if (L > 1e-12) {
        const n = scale(d, 1 / L), vb = this.b ? this.b.vel : [0, 0];
        this.pull(this.damping * dot(sub(vb, this.a.vel), n), n);
      }
      return next();
    },
  };

  // Rigid massless rod: holds the length exactly by projecting positions and removing
  // the relative velocity along it, split by inverse mass (an anchor is immovable).
  const Rod = {
    mixinId: 'mech.Rod',
    constrain(world, h, next) {
      const d = sub(this.endB(), this.endA()), L = len(d);
      const wa = this.a.invMass, wb = this.b ? this.b.invMass : 0, w = wa + wb;
      if (L > 1e-12 && w > 0) {
        const n = scale(d, 1 / L), err = L - this.rest;
        this.a.pos = add(this.a.pos, scale(n, err * wa / w));
        if (this.b) this.b.pos = sub(this.b.pos, scale(n, err * wb / w));
        const vb = this.b ? this.b.vel : [0, 0], rel = dot(sub(vb, this.a.vel), n);
        this.a.vel = add(this.a.vel, scale(n, rel * wa / w));
        if (this.b) this.b.vel = sub(this.b.vel, scale(n, rel * wb / w));
      }
      return next();
    },
  };

  const MIXINS = { Gravity, Collisions, Weight, Drag, Grounded, Collider, Spring, Damper, Rod };

  // ── Kits ─────────────────────────────────────────────────────────────

  const Lab = ExtendX.extend(World, Gravity, Collisions);
  const Bob = ExtendX.extend(Body, Weight, Collider);
  const Block = ExtendX.extend(Body, Weight, Grounded, Collider);
  const RodLink = ExtendX.extend(Link, Rod);
  const Bumper = ExtendX.extend(Link, Spring);

  const PENDULUM_DEFAULTS = {
    l: 1.2,          // rod length ℓ (pivot to bob centre), m
    phi0: 60,        // release angle φ₀ from vertical, degrees
    m1: 1,           // bob mass, kg
    m2: 2,           // block mass, kg
    c: 400,          // spring stiffness, N/m
    e: 1,            // coefficient of restitution (1 = elastic)
    g: 9.81,         // m/s²
    gap: 1.0,        // B → C: block's right face at rest to the spring plate, m
    springLength: 0.5,
    r: 0.08,         // bob radius, m
    blockSize: [0.4, 0.24],
  };

  // Pendulum → block → spring. The bob swings down from φ₀ on a massless rod, strikes the
  // block at the bottom of its arc (point B), the block slides on a frictionless floor and
  // compresses the spring at C by Δx.
  function pendulumBlockSpring(p) {
    p = Object.assign({}, PENDULUM_DEFAULTS, p);
    const phi = p.phi0 * Math.PI / 180, [bw, bh] = p.blockSize;
    const A = [0, p.r + p.l];                         // pivot: bob hangs with its centre at height r
    const world = new Lab({ g: p.g, restitution: p.e, substep: p.substep });
    const bob = new Bob({ name: 'bob', mass: p.m1, radius: p.r, pos: [A[0] - p.l * Math.sin(phi), A[1] - p.l * Math.cos(phi)] });
    const block = new Block({ name: 'block', mass: p.m2, size: p.blockSize, pos: [p.r + bw / 2, bh / 2] });
    const rod = new RodLink({ name: 'rod', a: bob, anchor: A, rest: p.l });
    const xC = p.r + bw + p.gap;
    const spring = new Bumper({ name: 'spring', a: block, offsetA: [bw / 2, 0], anchor: [xC + p.springLength, bh / 2], rest: p.springLength, stiffness: p.c, mode: 'compression' });
    world.add(bob, block, rod, spring);
    return { world, params: p, points: { A, B: [0, 0], C: [xC, 0], D: [xC + p.springLength, 0] } };
  }

  // The hand calculation for the same problem.
  //   v₁ = √(2gℓ(1 − cos φ₀))              bob speed at the bottom
  //   v₂ = (1 + e)·m₁·v₁ / (m₁ + m₂)       block speed after impact
  //   v₁' = (m₁ − e·m₂)·v₁ / (m₁ + m₂)     bob velocity after impact (negative = rebounds)
  //   Δx = v₂·√(m₂ / c)                    spring compression (block KE → spring PE)
  function pendulumAnalytic(p) {
    p = Object.assign({}, PENDULUM_DEFAULTS, p);
    const phi = p.phi0 * Math.PI / 180;
    const v1 = Math.sqrt(2 * p.g * p.l * (1 - Math.cos(phi)));
    const v2 = (1 + p.e) * p.m1 * v1 / (p.m1 + p.m2);
    const v1After = (p.m1 - p.e * p.m2) * v1 / (p.m1 + p.m2);
    const dx = v2 * Math.sqrt(p.m2 / p.c);
    return { v1, v2, v1After, dx };
  }

  // Simulated counterparts, read from the first bob–block impact and the spring's peak.
  function pendulumMeasure(kit) {
    const w = kit.world, hit = w.events.find(ev => (ev.a === 'bob' && ev.b === 'block') || (ev.a === 'block' && ev.b === 'bob'));
    const spring = w.find('spring');
    if (!hit) return { impact: false, dx: spring.maxCompression };
    const bobKey = hit.a === 'bob' ? 'a' : 'b', blockKey = bobKey === 'a' ? 'b' : 'a';
    return {
      impact: true,
      t: hit.t,
      v1: len(hit.before[bobKey]),
      v2: hit.after[blockKey][0],
      v1After: hit.after[bobKey][0],
      dx: spring.maxCompression,
    };
  }

  return {
    World, Body, Link, ExtendX,
    MIXINS, Gravity, Collisions, Weight, Drag, Grounded, Collider, Spring, Damper, Rod,
    compose: (Base, ...mixins) => ExtendX.extend(Base, ...mixins),
    classes: { Lab, Bob, Block, RodLink, Bumper },
    contact,
    kits: { pendulumBlockSpring },
    analytic: { pendulumBlockSpring: pendulumAnalytic },
    measure: { pendulumBlockSpring: pendulumMeasure },
    PENDULUM_DEFAULTS,
  };
}));
