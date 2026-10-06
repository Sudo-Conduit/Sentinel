// ─── Spline Draw (SD) — 2D authoring for spline-patch cages ───────────
// Author: Will Fobbs
// Company: Pooled Impact
// Confidential & Proprietary — Not for distribution
//
// The flat side of the modeler. A cage is drawn in one of three orthographic planes
// (front / top / side), exactly like a vector drawing, and then lifted into 3D:
//
//   • inflate — the outline stays put and the inside rises along a quarter-circle profile,
//   • extrude — a spline is copied out of the plane and joined to its copy,
//   • lathe   — a profile spline is revolved about the plane's vertical axis.
//
// Also SVG in and out: SVG path anchors become CPs, and the cage projects back to SVG
// as exact cubic Béziers (an orthographic projection of a Bézier is a Bézier).
//
// Pure functions over the SplinePatch model; no DOM, no three.js.

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./SplinePatch'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./SplinePatch.js'));
  } else {
    root.SplineDraw = factory(root.SplinePatch);
  }
}(typeof self !== 'undefined' ? self : this, function (SP) {

  'use strict';

  const { add, sub, scale, dot, len, rotate } = SP.vec;

  // ── Planes ───────────────────────────────────────────────────────────
  // u = screen right, v = screen up, n = u × v (toward the viewer) = the "depth" axis.

  const PLANES = {
    front: { key: 'front', name: 'Front', u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
    top: { key: 'top', name: 'Top', u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
    side: { key: 'side', name: 'Side', u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
  };

  const to2D = (p, pl) => [dot(p, pl.u), dot(p, pl.v)];
  const depthOf = (p, pl) => dot(p, pl.n);
  const from2D = (a, b, depth, pl) => add(add(scale(pl.u, a), scale(pl.v, b)), scale(pl.n, depth));

  function distToSeg2(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return { d: Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t), t };
  }

  // ── Editing ──────────────────────────────────────────────────────────

  function addCP(model, pos, bias) {
    const id = model.cps.length;
    model.cps.push({ id, pos: pos.slice(), bias: Object.assign({ mag: 1, alpha: 0, gamma: 0 }, bias), pinned: false });
    return id;
  }

  function addSpline(model, ids, closed) {
    model.splines.push({ cps: ids.slice(), closed: !!closed });
    return model.splines.length - 1;
  }

  // Extend an open spline by one CP. Picking its first CP again (with at least 3 CPs)
  // closes the loop. Returns 'added', 'closed' or 'ignored'.
  function appendToSpline(model, si, id) {
    const s = model.splines[si], ids = s.cps;
    if (s.closed || ids[ids.length - 1] === id) return 'ignored';
    if (id === ids[0]) {
      if (ids.length < 3) return 'ignored';
      s.closed = true;
      return 'closed';
    }
    ids.push(id);
    return 'added';
  }

  // New CP on segment a–b at parameter t (a→b), threaded into every spline that runs
  // a, b consecutively. The curve keeps (nearly) its shape: the CP sits on it.
  function insertCP(model, a, b, t) {
    const bez = SP.edgeBez(SP.buildGraph(model), a, b);
    if (!bez) return -1;
    const id = addCP(model, SP.evalBez(bez, t));
    for (const s of model.splines) {
      const ids = s.cps, n = ids.length;
      for (let k = 0; k < n; k++) {
        if (k === n - 1 && !s.closed) break;
        const x = ids[k], y = ids[(k + 1) % n];
        if ((x === a && y === b) || (x === b && y === a)) { ids.splice(k + 1, 0, id); break; }
      }
    }
    return id;
  }

  // Delete a CP. Each spline through it joins the CP's two neighbours (as in A:M); splines
  // left with fewer than 2 CPs go, and ids above it shift down by one.
  function removeCP(model, id) {
    for (const s of model.splines) {
      s.cps = s.cps.filter(x => x !== id).filter((x, i, arr) => i === 0 || x !== arr[i - 1]);
      if (s.closed && s.cps.length > 1 && s.cps[0] === s.cps[s.cps.length - 1]) s.cps.pop();
      if (s.closed && s.cps.length < 3) s.closed = false;
    }
    model.splines = model.splines.filter(s => s.cps.length >= 2);
    model.fivePatches = model.fivePatches.filter(r => !r.includes(id));
    model.cps.splice(id, 1);
    const shift = x => (x > id ? x - 1 : x);
    for (const s of model.splines) s.cps = s.cps.map(shift);
    model.fivePatches = model.fivePatches.map(r => r.map(shift));
    model.cps.forEach((c, i) => { c.id = i; });
  }

  // Drop CPs that no spline uses (e.g. the first click of an abandoned stroke).
  function removeOrphans(model) {
    const used = new Set(model.splines.flatMap(s => (s.cps.length >= 2 ? s.cps : [])));
    for (let id = model.cps.length - 1; id >= 0; id--) if (!used.has(id)) removeCP(model, id);
  }

  // ── Lifting into 3D ──────────────────────────────────────────────────

  // Edges with fewer than two patches on them: the open outline of the cage.
  function boundaryEdges(model) {
    const g = SP.buildGraph(model), patches = SP.findPatches(model, g), count = new Map();
    for (const p of patches) {
      p.ring.forEach((a, k) => {
        const key = SP.edgeKey(a, p.ring[(k + 1) % p.ring.length]);
        count.set(key, (count.get(key) || 0) + 1);
      });
    }
    return [...g.edges.values()].filter(e => (count.get(SP.edgeKey(e.a, e.b)) || 0) < 2);
  }

  // Push CPs out of the plane by a quarter-circle of their in-plane distance to the outline:
  // the outline stays where it is and the CPs farthest from it rise by `amount`.
  // Returns how many CPs moved.
  function inflate(model, plane, amount) {
    const edges = boundaryEdges(model);
    if (!edges.length) return 0;
    const segs = [];
    for (const e of edges) {
      let prev = to2D(e.bez[0], plane);
      for (let i = 1; i <= 8; i++) {
        const p = to2D(SP.evalBez(e.bez, i / 8), plane);
        segs.push([prev, p]);
        prev = p;
      }
    }
    const outline = new Set(edges.flatMap(e => [e.a, e.b]));
    const dist = model.cps.map((c, i) => {
      if (outline.has(i)) return 0;
      const p = to2D(c.pos, plane);
      return segs.reduce((m, [a, b]) => Math.min(m, distToSeg2(p, a, b).d), Infinity);
    });
    const max = Math.max(0, ...dist.filter(Number.isFinite));
    if (max < 1e-9) return 0;
    let moved = 0;
    model.cps.forEach((c, i) => {
      if (!(dist[i] > 0) || !Number.isFinite(dist[i])) return;
      const x = dist[i] / max;
      c.pos = add(c.pos, scale(plane.n, amount * Math.sqrt(1 - (1 - x) * (1 - x))));
      moved++;
    });
    return moved;
  }

  // Copy spline si by `offset` and join every CP to its copy with a straight spline: a wall
  // of 4-point patches. Returns the copy's spline index (extrude it again to keep going).
  function extrude(model, si, offset) {
    const src = model.splines[si], copy = new Map();
    for (const id of src.cps) {
      if (!copy.has(id)) copy.set(id, addCP(model, add(model.cps[id].pos, offset), model.cps[id].bias));
    }
    const out = addSpline(model, src.cps.map(id => copy.get(id)), src.closed);
    for (const [a, b] of copy) addSpline(model, [a, b]);
    return out;
  }

  // Revolve spline si about the plane's vertical axis (the line u = axisU, depth 0) into
  // `segments` profiles joined by closed rings. CPs on the axis are shared by every profile,
  // so poles close with 3-point patches; with an even segment count, opposite profiles are
  // joined into one spline through the pole so it stays smooth there.
  function lathe(model, si, plane, segments, axisU) {
    segments = Math.max(3, segments | 0);
    const src = model.splines[si], ids = [...new Set(src.cps)];
    const origin = scale(plane.u, axisU || 0);
    const radius = id => { const p = sub(model.cps[id].pos, origin); return len(sub(p, scale(plane.v, dot(p, plane.v)))); };
    const span = Math.max(1e-9, ...ids.map(radius));
    const onAxis = id => radius(id) < span * 1e-4;
    const copies = [new Map(ids.map(id => [id, id]))];
    for (let k = 1; k < segments; k++) {
      const ang = (2 * Math.PI * k) / segments, m = new Map();
      for (const id of ids) {
        m.set(id, onAxis(id) ? id : addCP(model, add(origin, rotate(sub(model.cps[id].pos, origin), plane.v, ang)), model.cps[id].bias));
      }
      copies.push(m);
    }
    const profile = k => src.cps.map(id => copies[k].get(id));
    const first = src.cps[0], last = src.cps[src.cps.length - 1];
    const poleStart = !src.closed && onAxis(first), poleEnd = !src.closed && onAxis(last);
    const profiles = [];
    if ((poleStart || poleEnd) && segments % 2 === 0) {
      const half = segments / 2;
      for (let k = 0; k < half; k++) {
        const A = profile(k), B = profile(k + half).reverse();
        if (poleStart && poleEnd) profiles.push({ cps: A.concat(B.slice(1, -1)), closed: true });
        else if (poleEnd) profiles.push({ cps: A.concat(B.slice(1)), closed: false });
        else profiles.push({ cps: B.concat(A.slice(1)), closed: false });
      }
    } else {
      for (let k = 0; k < segments; k++) profiles.push({ cps: profile(k), closed: src.closed });
    }
    model.splines[si] = profiles[0];
    for (const p of profiles.slice(1)) model.splines.push(p);
    for (const id of ids) if (!onAxis(id)) addSpline(model, copies.map(m => m.get(id)), true);
    return profiles.length;
  }

  // ── SVG ──────────────────────────────────────────────────────────────

  // Subpaths of an SVG path `d` as anchor points: [{ points: [[x, y]...], closed }].
  // Curves contribute their end anchor, plus steps-1 points along the curve when steps > 1
  // (anchors alone lose curvature the Catmull-Rom splines can't recover). Arcs are taken
  // as their end points.
  function parseSvgPath(d, steps) {
    steps = Math.max(1, steps | 0 || 1);
    const toks = String(d).match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    const isNum = i => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
    const out = [];
    let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, cur = null, lastC = null, lastQ = null;
    const num = () => parseFloat(toks[i++]);
    const begin = (px, py) => { cur = { points: [[px, py]], closed: false }; out.push(cur); };
    const lineTo = (px, py) => { if (!cur) begin(x, y); cur.points.push([px, py]); };
    const cubicTo = (x1, y1, x2, y2, px, py) => {
      for (let s = 1; s < steps; s++) {
        const t = s / steps, m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, e = t * t * t;
        lineTo(a * x + b * x1 + c * x2 + e * px, a * y + b * y1 + c * y2 + e * py);
      }
      lineTo(px, py);
    };
    while (i < toks.length) {
      if (!isNum(i)) cmd = toks[i++];
      else if (!cmd || cmd === 'z' || cmd === 'Z') { i++; continue; }
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
      let nextC = null, nextQ = null;
      if (C !== 'Z' && !isNum(i)) continue;
      switch (C) {
        case 'M':
          x = ox + num(); y = oy + num();
          begin(x, y); sx = x; sy = y;
          cmd = rel ? 'l' : 'L';
          break;
        case 'L': x = ox + num(); y = oy + num(); lineTo(x, y); break;
        case 'H': x = ox + num(); lineTo(x, y); break;
        case 'V': y = oy + num(); lineTo(x, y); break;
        case 'C': {
          const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), px = ox + num(), py = oy + num();
          cubicTo(x1, y1, x2, y2, px, py); nextC = [x2, y2]; x = px; y = py;
          break;
        }
        case 'S': {
          const x1 = lastC ? 2 * x - lastC[0] : x, y1 = lastC ? 2 * y - lastC[1] : y;
          const x2 = ox + num(), y2 = oy + num(), px = ox + num(), py = oy + num();
          cubicTo(x1, y1, x2, y2, px, py); nextC = [x2, y2]; x = px; y = py;
          break;
        }
        case 'Q': case 'T': {
          const q = C === 'Q' ? [ox + num(), oy + num()] : (lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y]);
          const px = ox + num(), py = oy + num();
          cubicTo(x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), px + (2 / 3) * (q[0] - px), py + (2 / 3) * (q[1] - py), px, py);
          nextQ = q; x = px; y = py;
          break;
        }
        case 'A':
          num(); num(); num(); num(); num();
          x = ox + num(); y = oy + num(); lineTo(x, y);
          break;
        case 'Z':
          if (cur) cur.closed = true;
          cur = null; x = sx; y = sy;
          break;
        default:
          i++;
      }
      lastC = nextC; lastQ = nextQ;
    }
    const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
    return out.map(sp => {
      const pts = sp.points.filter((p, k, arr) => k === 0 || !same(p, arr[k - 1]));
      let closed = sp.closed;
      if (pts.length > 2 && same(pts[0], pts[pts.length - 1])) { pts.pop(); closed = true; }
      return { points: pts, closed: closed && pts.length >= 3 };
    }).filter(sp => sp.points.length >= 2);
  }

  // Add SVG subpaths to the model in a drawing plane, scaled to `size` units across and
  // centred on the origin (SVG's y runs down, so it is flipped). Coincident anchors from
  // different subpaths become one CP, so touching paths connect into one cage.
  function importSvgPaths(model, paths, plane, size) {
    const all = paths.flatMap(p => p.points);
    if (!all.length) return 0;
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const k = (size || 4) / Math.max(1e-9, maxX - minX, maxY - minY);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const ids = new Map();
    const idFor = ([x, y]) => {
      const key = Math.round(x * 1e4) + ',' + Math.round(y * 1e4);
      if (!ids.has(key)) ids.set(key, addCP(model, from2D((x - cx) * k, -(y - cy) * k, 0, plane)));
      return ids.get(key);
    };
    let n = 0;
    for (const p of paths) {
      const cps = p.points.map(idFor).filter((id, j, arr) => j === 0 || id !== arr[j - 1]);
      if (cps.length >= 2) { addSpline(model, cps, p.closed && cps.length >= 3); n++; }
    }
    return n;
  }

  // The cage seen through a drawing plane, as SVG: patches filled, splines stroked.
  function exportSvg(model, plane, opts) {
    opts = Object.assign({ unit: 100, stroke: '#1a1a1a', fill: '#9cc3e6', fillOpacity: 0.35, pad: 0.25 }, opts);
    const g = SP.buildGraph(model), patches = SP.findPatches(model, g), U = opts.unit;
    const P = p => { const [a, b] = to2D(p, plane); return [a * U, -b * U]; };
    const f = v => +v.toFixed(3);
    const seg = bez => { const [, b, c, d] = bez.map(P); return `C${f(b[0])} ${f(b[1])} ${f(c[0])} ${f(c[1])} ${f(d[0])} ${f(d[1])}`; };
    const pts = [...g.edges.values()].flatMap(e => e.bez.map(P));
    if (!pts.length) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
    const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
    const minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
    const pad = opts.pad * U, w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
    const fills = patches.map(p => {
      const start = P(model.cps[p.ring[0]].pos);
      const body = p.ring.map((a, k) => seg(SP.edgeBez(g, a, p.ring[(k + 1) % p.ring.length]))).join(' ');
      return `<path d="M${f(start[0])} ${f(start[1])} ${body} Z"/>`;
    }).join('\n    ');
    const strokes = [...g.edges.values()].map(e => { const s = P(e.bez[0]); return `M${f(s[0])} ${f(s[1])} ${seg(e.bez)}`; }).join(' ');
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(minX - pad)} ${f(minY - pad)} ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}">`,
      `  <g fill="${opts.fill}" fill-opacity="${opts.fillOpacity}" stroke="none">`,
      `    ${fills}`,
      '  </g>',
      `  <path d="${strokes}" fill="none" stroke="${opts.stroke}" stroke-width="${f(U * 0.02)}" stroke-linecap="round"/>`,
      '</svg>',
    ].join('\n');
  }

  return {
    PLANES, to2D, depthOf, from2D, distToSeg2,
    addCP, addSpline, appendToSpline, insertCP, removeCP, removeOrphans,
    boundaryEdges, inflate, extrude, lathe,
    parseSvgPath, importSvgPaths, exportSvg,
  };
}));
