// UMD IIFE - MolecularGeometry: idealized 3D coordinates from VSEPR theory.
//
// SMILES/graph topology carries NO 3D information. There are exactly two
// honest ways to put a molecule in 3D, and this module is only the first:
//   1. IDEALIZED (this module) - mechanical, textbook VSEPR: every atom's
//      own neighbors are placed at the electron-domain-geometry angles its
//      steric number implies (109.47 deg tetrahedral, 120 deg trigonal
//      planar, etc.) using a curated real bond-length reference table.
//      Always available. Never a claim about a real measured structure.
//   2. IMPORTED/MEASURED (not built yet - deprioritized for now) - real
//      coordinates from a deposited PDB/MOL/XYZ file.
// A caller (report, viewer) MUST keep these labeled and never conflate
// them - see geometrySource on generateIdealizedCoordinates()'s result.
//
// Scope/limitation, stated plainly: this is a BFS spanning-tree placement,
// not a real conformer generator. Every atom's LOCAL geometry (the angles
// among ITS OWN bonds) is exactly VSEPR-ideal. A ring-closure bond (an
// edge that isn't part of the spanning tree - both its endpoints were
// already placed via other paths) is NOT solved for; its resulting length
// is whatever the independent tree placements happen to produce, and is
// reported/flagged, not silently assumed correct. True ring/macrocycle 3D
// closure needs real distance-geometry or force-field minimization - out
// of scope here.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./PDT', './MolecularStructure'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./PDT.js'), require('./MolecularStructure.js'));
    } else {
        root.MolecularGeometry = factory(root.PDT, root.MolecularStructure);
    }
}(typeof self !== 'undefined' ? self : this, function(PDT, MolecularStructure) {
    'use strict';
    if (!PDT) throw new Error('MolecularGeometry requires PDT');
    if (!MolecularStructure) throw new Error('MolecularGeometry requires MolecularStructure');

    // ================================================================
    // Real, cited (textbook/experimental-average) covalent bond lengths
    // in Angstroms, keyed 'A-B|order' with A<=B alphabetically. Aromatic
    // bonds get their OWN entry (real delocalized rings have one uniform
    // bond length, e.g. benzene's 1.39 A - NOT an alternating short/long
    // pattern, which is why this table is keyed off the bond's original
    // declared order, never the Kekule-concretized 1/2 split
    // MolecularStructure.js uses internally for electron bookkeeping).
    // Pairs not listed fall back to an estimate from PDT's own
    // slater_radius (see bondLength() below) - clearly flagged as
    // approximate/uncalibrated when that happens, never silently equated
    // with a real measured value.
    // ================================================================
    var BOND_LENGTH_ANGSTROM = {
        'C-C|1': 1.54, 'C-C|2': 1.34, 'C-C|3': 1.20, 'C-C|aromatic': 1.39,
        'C-H|1': 1.09,
        'C-N|1': 1.47, 'C-N|2': 1.28, 'C-N|3': 1.16, 'C-N|aromatic': 1.34,
        'C-O|1': 1.43, 'C-O|2': 1.20, 'C-O|aromatic': 1.36,
        'C-S|1': 1.82, 'C-S|2': 1.60, 'C-S|aromatic': 1.71,
        'C-F|1': 1.35, 'C-Cl|1': 1.77, 'C-Br|1': 1.94, 'C-I|1': 2.14,
        'H-N|1': 1.01, 'H-O|1': 0.96, 'H-S|1': 1.34, 'H-P|1': 1.42,
        'N-N|1': 1.45, 'N-N|2': 1.25, 'N-N|3': 1.10, 'N-N|aromatic': 1.34,
        'N-O|1': 1.40, 'N-O|2': 1.21,
        'Fe-N|1': 2.00
    };

    function bondLengthKey(a, b, order) {
        var lo = a < b ? a : b, hi = a < b ? b : a;
        return lo + '-' + hi + '|' + order;
    }

    // Fallback estimate for any pair not in the curated table above: sum
    // of both atoms' PDT.js slater_radius (Bohr-radius units, x0.529 to
    // Angstroms). This is the FVT/Slater model's own already-computed
    // atomic-size estimate - same order of magnitude as real covalent
    // radii but NOT calibrated against measured bond lengths (documented
    // limitation shared with PDT.js's own ionization-energy estimates).
    // Always flagged 'estimated', never presented as a measured value.
    var BOHR_TO_ANGSTROM = 0.529177;
    function estimateBondLength(symbolA, symbolB) {
        var elA = PDT.get(symbolA), elB = PDT.get(symbolB);
        if (!elA || !elB) return null;
        return (elA.slater_radius + elB.slater_radius) * BOHR_TO_ANGSTROM;
    }

    function bondLength(symbolA, symbolB, order) {
        var key = bondLengthKey(symbolA, symbolB, order);
        if (BOND_LENGTH_ANGSTROM[key] !== undefined) {
            return { value: BOND_LENGTH_ANGSTROM[key], source: 'reference' };
        }
        var est = estimateBondLength(symbolA, symbolB);
        if (est === null) return { value: 1.5, source: 'fallback-unknown-element' };
        return { value: Math.round(est * 1000) / 1000, source: 'estimated (uncalibrated - sum of PDT.js slater_radius, not a measured value)' };
    }

    // ================================================================
    // VSEPR direction templates - canonical unit-vector sets for each
    // steric (electron-domain) number, index 0 always the slot reserved
    // for "the bond back toward this atom's parent" in the BFS walk
    // below (for the root atom, which has no parent, index 0 is simply
    // offered to a child like any other slot).
    // ================================================================
    var SQRT3 = Math.sqrt(3), H3 = 0.8660254037844386;
    var TEMPLATES = {
        2: [[0, 0, 1], [0, 0, -1]],
        3: [[1, 0, 0], [-0.5, H3, 0], [-0.5, -H3, 0]],
        4: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(function(v) {
            return [v[0] / SQRT3, v[1] / SQRT3, v[2] / SQRT3];
        }),
        5: [[0, 0, 1], [1, 0, 0], [-0.5, H3, 0], [-0.5, -H3, 0], [0, 0, -1]],
        6: [[0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1]]
    };

    // Which template indices are lone pairs (never placed) for a given
    // (stericNumber, lonePairs) pair, always protecting index 0. Chosen
    // per real VSEPR preference rules, not arbitrarily: trigonal
    // bipyramidal (5) removes EQUATORIAL positions first (lone pairs
    // minimize 90 deg repulsion by preferring equatorial - the textbook
    // seesaw/T-shaped/linear progression); octahedral (6) removes a
    // single position for one lone pair (all six are equivalent by
    // symmetry) or a genuine trans pair for two (square planar - any
    // coplanar antipodal-pair choice is valid, e.g. XeF4).
    var LONE_PAIR_REMOVAL = {
        2: { 0: [], 1: [1] },
        3: { 0: [], 1: [2], 2: [1, 2] },
        4: { 0: [], 1: [3], 2: [2, 3], 3: [1, 2, 3] },
        5: { 0: [], 1: [1], 2: [1, 2], 3: [1, 2, 3] },
        6: { 0: [], 1: [5], 2: [3, 4] }
    };

    // d/f-block centers have no lonePairs/stericNumber (classical VSEPR
    // lone-pair bookkeeping doesn't apply - see MolecularStructure.js).
    // For RENDERING purposes only, map the first candidate name from
    // COORDINATION_GEOMETRY_BY_NUMBER onto the same template+removal
    // machinery above (reusing it exactly, not reimplementing it) - an
    // explicit, documented, arbitrary pick among ambiguous candidates
    // (e.g. tetrahedral over square planar at CN4), never a chemistry
    // claim about which one is real for a given complex. Names not
    // covered (CN7/8) fall through to the generic fallback placement.
    var COORDINATION_NAME_TO_TEMPLATE = {
        'linear': { steric: 2, removal: 0 },
        'trigonal planar': { steric: 3, removal: 0 },
        'trigonal pyramidal': { steric: 4, removal: 1 },
        'tetrahedral': { steric: 4, removal: 0 },
        'trigonal bipyramidal': { steric: 5, removal: 0 },
        'square pyramidal': { steric: 6, removal: 1 },
        'square planar': { steric: 6, removal: 2 },
        'octahedral': { steric: 6, removal: 0 }
    };

    function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
    function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
    function vneg(a) { return [-a[0], -a[1], -a[2]]; }
    function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function vcross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function vlen(a) { return Math.sqrt(vdot(a, a)); }
    function vnorm(a) { var m = vlen(a); return m < 1e-12 ? [0, 0, 0] : vscale(a, 1 / m); }

    function rotateAroundAxis(v, axis, angle) {
        var cosA = Math.cos(angle), sinA = Math.sin(angle);
        var kxv = vcross(axis, v);
        var kdotv = vdot(axis, v);
        return [
            v[0] * cosA + kxv[0] * sinA + axis[0] * kdotv * (1 - cosA),
            v[1] * cosA + kxv[1] * sinA + axis[1] * kdotv * (1 - cosA),
            v[2] * cosA + kxv[2] * sinA + axis[2] * kdotv * (1 - cosA)
        ];
    }

    // Returns a rotation FUNCTION (not just a rotated one-shot list) that
    // rigidly rotates `from` onto `target` (both unit vectors) - the same
    // single-rotation math alignTemplate needs, factored out so ring
    // placement below can apply the identical rotation to an entire local
    // polygon's worth of points, not just a fixed-size template array.
    function buildRotation(from, target) {
        var axis = vcross(from, target);
        var axisLen = vlen(axis);
        var cosA = vdot(from, target);
        if (axisLen < 1e-9) {
            if (cosA > 0) return function(v) { return v.slice(); };
            var flipAxis = vnorm(vcross(from, Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
            return function(v) { return rotateAroundAxis(v, flipAxis, Math.PI); };
        }
        axis = vnorm(axis);
        var angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
        return function(v) { return rotateAroundAxis(v, axis, angle); };
    }

    // Rigidly rotates the whole template so template[0] ends up pointing
    // along `target` (a unit vector) - preserves every angle between
    // template entries exactly, since it's a single rotation applied to
    // all of them.
    function alignTemplate(template, target) {
        var rotate = buildRotation(template[0], target);
        return template.map(rotate);
    }

    // Materializes implicit hydrogens (from MolecularStructure's per-atom
    // analysis) as real synthetic atom nodes with their own bonds, so the
    // viewer/report show every atom, not just the heavy skeleton.
    function expandImplicitHydrogens(molecule, perAtom) {
        var atoms = molecule.atoms.map(function(a) { return { symbol: a.symbol, charge: a.charge, isImplicitH: false }; });
        var bonds = molecule.bonds.map(function(b) { return [b[0], b[1], b[2]]; });
        var stericByAtom = molecule.atoms.map(function() { return null; });
        perAtom.forEach(function(pa) { stericByAtom[pa.index] = pa.stericNumber; });
        molecule.atoms.forEach(function(a, i) {
            var h = (perAtom[i] && perAtom[i].implicitH) || 0;
            for (var k = 0; k < h; k++) {
                var hIdx = atoms.length;
                atoms.push({ symbol: 'H', charge: 0, isImplicitH: true });
                stericByAtom.push(null);
                bonds.push([i, hIdx, 1]);
            }
        });
        return { atoms: atoms, bonds: bonds, stericByAtom: stericByAtom };
    }

    function chooseRoot(expanded) {
        var n = expanded.atoms.length;
        var degree = new Array(n).fill(0);
        expanded.bonds.forEach(function(b) { degree[b[0]]++; degree[b[1]]++; });
        var best = -1, bestDegree = -1;
        for (var i = 0; i < n; i++) {
            if (expanded.atoms[i].symbol === 'H') continue;
            if (degree[i] > bestDegree) { bestDegree = degree[i]; best = i; }
        }
        return best === -1 ? 0 : best;
    }

    // ================================================================
    // Exact ring closure for simple monocyclic rings - the real fix for
    // this module's own long-standing, recurring "BFS tree placement
    // doesn't close the ring" defect (documented above and in
    // generateIdealizedCoordinates' warnings), rather than just flagging
    // it again downstream every time a new calculation depends on real
    // ring geometry (dipole moment, van der Waals volume, sum-over-states
    // polarizability all inherited the same distortion).
    //
    // Standard bridge-finding (Tarjan): an edge is a bridge iff it lies on
    // no cycle. Self-contained here (same algorithm Smiles.js's own
    // findBridgeBondIndices uses for the same reason - identifying ring
    // membership from pure graph structure) rather than a new cross-module
    // dependency, since it operates on this module's OWN heavy-atom bond
    // list (which may include non-conjugated rings, e.g. cyclohexane,
    // that Smiles.js's aromatic-only version was never meant to see).
    // ================================================================
    function findBridgeFlags(numAtoms, bonds) {
        var adj = [];
        for (var i = 0; i < numAtoms; i++) adj.push([]);
        bonds.forEach(function(b, idx) {
            adj[b[0]].push({ to: b[1], idx: idx });
            adj[b[1]].push({ to: b[0], idx: idx });
        });
        var visited = new Array(numAtoms).fill(false);
        var disc = new Array(numAtoms).fill(-1);
        var low = new Array(numAtoms).fill(-1);
        var timer = 0;
        var bridges = {};
        function dfs(u, parentEdgeIdx) {
            visited[u] = true;
            disc[u] = low[u] = timer++;
            adj[u].forEach(function(e) {
                if (e.idx === parentEdgeIdx) return;
                if (visited[e.to]) {
                    low[u] = Math.min(low[u], disc[e.to]);
                } else {
                    dfs(e.to, e.idx);
                    low[u] = Math.min(low[u], low[e.to]);
                    if (low[e.to] > disc[u]) bridges[e.idx] = true;
                }
            });
        }
        for (var s = 0; s < numAtoms; s++) if (!visited[s]) dfs(s, -1);
        return bridges;
    }

    // Finds SIMPLE monocyclic ring components only - every member atom's
    // ring-bond-degree must be exactly 2 (a plain, unfused cycle). A fused,
    // bridged, or spiro system (any shared atom between two rings, e.g.
    // porphyrin's macrocycle) fails this check and is deliberately left
    // alone: simultaneous multi-ring closure is a real constraint-solving
    // problem (distance geometry / force-field relaxation), not a closed-
    // form one - out of scope here, same as this module's own top-of-file
    // scope note already says. Those rings keep today's BFS-tree fallback
    // and its existing honest warning, completely unchanged.
    function findSimpleRingComponents(numAtoms, bonds) {
        var bridges = findBridgeFlags(numAtoms, bonds);
        var ringAdj = {};
        bonds.forEach(function(b, idx) {
            if (bridges[idx]) return;
            (ringAdj[b[0]] = ringAdj[b[0]] || []).push({ to: b[1], idx: idx });
            (ringAdj[b[1]] = ringAdj[b[1]] || []).push({ to: b[0], idx: idx });
        });
        var seen = {};
        var components = [];
        Object.keys(ringAdj).forEach(function(startKey) {
            var start = Number(startKey);
            if (seen[start]) return;
            var comp = [];
            var stack = [start];
            seen[start] = true;
            while (stack.length) {
                var v = stack.pop();
                comp.push(v);
                ringAdj[v].forEach(function(e) { if (!seen[e.to]) { seen[e.to] = true; stack.push(e.to); } });
            }
            components.push(comp);
        });
        var result = [];
        components.forEach(function(comp) {
            var ok = comp.every(function(a) { return ringAdj[a].length === 2; });
            if (!ok) return;
            var order = [comp[0]];
            var bondIndices = [];
            var prev = -1, cur = comp[0];
            while (true) {
                var edges = ringAdj[cur];
                var stepEdge = edges[0].to === prev ? edges[1] : edges[0];
                bondIndices.push(stepEdge.idx);
                if (stepEdge.to === comp[0]) break;
                order.push(stepEdge.to);
                prev = cur; cur = stepEdge.to;
            }
            result.push({ order: order, bondIndices: bondIndices });
        });
        return result;
    }

    // Given a cyclic sequence of real edge lengths, finds the circumradius
    // R of the (unique, for realistic bond-length spreads) CONVEX cyclic
    // polygon those edges close into - i.e. every vertex lies on a common
    // circle of radius R, so the polygon closes EXACTLY by construction
    // regardless of the individual edge lengths being unequal (real
    // heteroatom rings, e.g. pyridine's C-N vs C-C bonds, not just the
    // equal-edge regular-polygon case). Solves the standard identity
    // sum_k 2*asin(e_k / (2R)) = 2*pi via bisection (the sum is strictly
    // decreasing in R, so a unique root exists whenever it's bracketed -
    // always true for real, similarly-sized covalent bond lengths). Returns
    // null (never a fabricated/guessed shape) if no such R exists in a
    // generous bracket - the caller then leaves this ring to the existing
    // BFS-tree fallback exactly as before.
    function solveRingCircumradius(edgeLengths) {
        var sumEdges = edgeLengths.reduce(function(s, e) { return s + e; }, 0);
        var maxEdge = Math.max.apply(null, edgeLengths);
        function angleSum(R) {
            return edgeLengths.reduce(function(s, e) {
                return s + 2 * Math.asin(Math.min(1, e / (2 * R)));
            }, 0);
        }
        var lo = maxEdge / 2 + 1e-6;
        var hi = sumEdges;
        var target = 2 * Math.PI;
        if (angleSum(lo) - target < 0 || angleSum(hi) - target > 0) return null;
        for (var iter = 0; iter < 100; iter++) {
            var mid = (lo + hi) / 2;
            var f = angleSum(mid) - target;
            if (Math.abs(f) < 1e-12 || (hi - lo) < 1e-12) return mid;
            if (f > 0) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    // Builds the ring's own local, exactly-closed planar coordinates (z=0,
    // atom order[0] at angle 0) from its real per-bond lengths. Returns
    // null (propagated from solveRingCircumradius) if no valid closure
    // exists - never a distorted or guessed shape.
    function buildRingPolygon(order, edgeLengths) {
        var R = solveRingCircumradius(edgeLengths);
        if (R === null) return null;
        var n = order.length;
        var centralAngles = edgeLengths.map(function(e) { return 2 * Math.asin(Math.min(1, e / (2 * R))); });
        var cumulative = [0];
        for (var k = 1; k < n; k++) cumulative.push(cumulative[k - 1] + centralAngles[k - 1]);
        return cumulative.map(function(phi) { return [R * Math.cos(phi), R * Math.sin(phi), 0]; });
    }

    // molecule -> { atoms:[{symbol,x,y,z,isImplicitH,charge}],
    //               bonds:[[i,j,order,lengthAngstrom,lengthSource,ringClosure]],
    //               warnings, geometrySource }
    // options: { planar, betaModel } forwarded to MolecularStructure.analyze
    // when `structureResult` isn't already supplied (pass one in to avoid
    // re-running analysis you already have).
    function generateIdealizedCoordinates(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structureResult = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structureResult.error) return structureResult;

        var expanded = expandImplicitHydrogens(molecule, structureResult.perAtom);
        var n = expanded.atoms.length;
        var adj = [];
        for (var i = 0; i < n; i++) adj.push([]);
        expanded.bonds.forEach(function(b, bi) {
            adj[b[0]].push({ to: b[1], bi: bi });
            adj[b[1]].push({ to: b[0], bi: bi });
        });

        var positions = new Array(n).fill(null);
        var incomingDir = new Array(n).fill(null); // unit vector FROM parent TO this atom
        var visited = new Array(n).fill(false);
        var isTreeEdgeBond = new Array(expanded.bonds.length).fill(false); // set directly when a bond places a child - not reverse-engineered from positions afterward
        var warnings = [];

        // Real ring closure (see the block of functions above) for every
        // SIMPLE monocyclic ring whose atoms are all steric-3 (trigonal
        // planar - aromatic and other all-sp2 rings; sp3/saturated rings
        // and any fused/bridged system still fall back to the BFS-tree
        // placement below, unchanged, with its existing honest warning).
        // Built on the heavy-atom graph (molecule.atoms/molecule.bonds) -
        // heavy-atom indices are identical between `molecule` and
        // `expanded`/`positions` (expandImplicitHydrogens only APPENDS
        // synthetic H atoms after them), so no index translation is needed.
        var ringAtomToComponent = {};
        var ringComponents = findSimpleRingComponents(molecule.atoms.length, molecule.bonds).map(function(comp) {
            var qualifies = comp.order.every(function(a) { return expanded.stericByAtom[a] === 3; });
            var polygon = null;
            if (qualifies) {
                var edgeLengths = comp.bondIndices.map(function(bi) {
                    var b = molecule.bonds[bi];
                    return bondLength(molecule.atoms[b[0]].symbol, molecule.atoms[b[1]].symbol, b[2]).value;
                });
                polygon = buildRingPolygon(comp.order, edgeLengths);
            }
            return { order: comp.order, bondIndices: comp.bondIndices, polygon: polygon };
        }).filter(function(c) { return c.polygon !== null; });
        ringComponents.forEach(function(c, ci) { c.order.forEach(function(a) { ringAtomToComponent[a] = ci; }); });
        var ringPlaced = new Array(ringComponents.length).fill(false);
        var ringOutwardDir = {}; // per ring atom: unit vector for its one remaining (non-ring) domain, if any

        // Places every atom of ring component `ci` at once, given that
        // `entryAtom` (one member of the ring) already has a real
        // positions[]/incomingDir[] entry - either the whole-molecule root
        // (incomingDir is null - no target direction, keep the polygon's
        // own natural orientation) or a child just placed by its real
        // parent bond (incomingDir set - rotate the ring so its outward-
        // facing direction at entryAtom, the same "domain" a generic
        // template's non-reserved slot would occupy, faces away from that
        // parent, exactly the convention every other atom type already
        // uses). Marks every OTHER ring atom visited + queued for its own
        // exocyclic substituents, and marks every ring-internal bond as a
        // real, solved tree edge (isTreeEdgeBond) - not "ring-closure
        // (unsolved)" anymore, because it genuinely isn't: every bond
        // length in this polygon is exactly its cited/estimated value by
        // construction, not a leftover gap from independent tree paths.
        function placeRing(ci, entryAtom) {
            var comp = ringComponents[ci];
            var order = comp.order, N = order.length;
            var entryIdx = order.indexOf(entryAtom);
            var shift = comp.polygon[entryIdx];
            var shifted = comp.polygon.map(function(p) { return vsub(p, shift); });

            var incoming = incomingDir[entryAtom];
            var rotate;
            if (incoming) {
                var prevLocal = vnorm(shifted[(entryIdx - 1 + N) % N]);
                var nextLocal = vnorm(shifted[(entryIdx + 1) % N]);
                var localOutward = vnorm(vneg(vadd(prevLocal, nextLocal)));
                rotate = buildRotation(localOutward, vneg(incoming));
            } else {
                rotate = function(v) { return v.slice(); };
            }

            order.forEach(function(atomIdx, k) {
                if (atomIdx !== entryAtom) {
                    positions[atomIdx] = vadd(positions[entryAtom], rotate(shifted[k]));
                    visited[atomIdx] = true;
                }
            });
            comp.bondIndices.forEach(function(bi) { isTreeEdgeBond[bi] = true; });

            order.forEach(function(atomIdx, k) {
                var prevIdx = order[(k - 1 + N) % N], nextIdx = order[(k + 1) % N];
                var d1 = vnorm(vsub(positions[prevIdx], positions[atomIdx]));
                var d2 = vnorm(vsub(positions[nextIdx], positions[atomIdx]));
                ringOutwardDir[atomIdx] = vnorm(vneg(vadd(d1, d2)));
                if (atomIdx !== entryAtom) queue.push(atomIdx);
            });
        }

        var root = chooseRoot(expanded);
        positions[root] = [0, 0, 0];
        visited[root] = true;
        var queue = [root];

        while (queue.length) {
            var u = queue.shift();
            if (ringAtomToComponent[u] !== undefined && !ringPlaced[ringAtomToComponent[u]]) {
                placeRing(ringAtomToComponent[u], u);
                ringPlaced[ringAtomToComponent[u]] = true;
            }
            var steric = expanded.stericByAtom[u];
            var toPlace = adj[u].filter(function(e) { return !visited[e.to]; });
            if (toPlace.length === 0) continue;

            if (ringOutwardDir[u] && toPlace.length === 1) {
                var child0 = toPlace[0].to;
                var lenInfo0 = bondLength(expanded.atoms[u].symbol, expanded.atoms[child0].symbol, expanded.bonds[toPlace[0].bi][2]);
                positions[child0] = vadd(positions[u], vscale(ringOutwardDir[u], lenInfo0.value));
                incomingDir[child0] = ringOutwardDir[u];
                isTreeEdgeBond[toPlace[0].bi] = true;
                visited[child0] = true;
                queue.push(child0);
                continue;
            }

            var pa = structureResult.perAtom[u];
            var templateSteric = null, removalCount = 0;
            if (steric) {
                // Main-group: real VSEPR lone-pair domains. The pi-donor
                // steric adjustment already happened upstream in
                // MolecularStructure - stericNumber here already reflects
                // it, so lone-pair REMOVAL uses however many domains are
                // left over: stericNumber - totalNeighbors (not raw
                // lonePairs, which for a pi donor is one more than the
                // steric-relevant count - see MolecularStructure.js's
                // pyrrole-N handling).
                templateSteric = steric;
                removalCount = steric - pa.totalNeighbors;
            } else if (pa && pa.geometry && pa.geometry.length) {
                // d/f-block center: no lonePairs concept, but a named
                // coordination geometry exists - reuse the same template
                // machinery via the explicit, documented mapping above.
                var mapped = COORDINATION_NAME_TO_TEMPLATE[pa.geometry[0]];
                if (mapped) { templateSteric = mapped.steric; removalCount = mapped.removal; }
            }

            var directions;
            if (templateSteric && TEMPLATES[templateSteric]) {
                var isRoot = (u === root);
                var aligned = isRoot ? TEMPLATES[templateSteric].map(function(v) { return v.slice(); })
                    : alignTemplate(TEMPLATES[templateSteric], vneg(incomingDir[u]));
                var removeSet = (LONE_PAIR_REMOVAL[templateSteric] && LONE_PAIR_REMOVAL[templateSteric][removalCount]) || [];
                var reserved = isRoot ? [] : [0];
                var availableSlots = [];
                for (var s = 0; s < aligned.length; s++) {
                    if (removeSet.indexOf(s) !== -1) continue;
                    if (reserved.indexOf(s) !== -1) continue;
                    availableSlots.push(aligned[s]);
                }
                directions = availableSlots;
            } else {
                directions = null; // no VSEPR/coordination template available - fallback below
            }

            toPlace.forEach(function(e, k) {
                var dir;
                if (directions && directions[k]) {
                    dir = directions[k];
                } else {
                    warnings.push('atom ' + u + ' (' + expanded.atoms[u].symbol + '): no VSEPR template slot available for a bonded neighbor - placed via an arbitrary fallback direction, not a real geometry claim.');
                    var t = k * 2.399963; // golden-angle spread, deterministic, not physically meaningful
                    dir = vnorm([Math.cos(t), Math.sin(t), 0.3 * (k % 3 - 1)]);
                }
                var child = e.to;
                var lenInfo = bondLength(expanded.atoms[u].symbol, expanded.atoms[child].symbol, expanded.bonds[e.bi][2]);
                positions[child] = vadd(positions[u], vscale(dir, lenInfo.value));
                incomingDir[child] = dir;
                isTreeEdgeBond[e.bi] = true;
                visited[child] = true;
                queue.push(child);
            });
        }

        var bondsOut = expanded.bonds.map(function(b, bi) {
            var lenInfo = bondLength(expanded.atoms[b[0]].symbol, expanded.atoms[b[1]].symbol, b[2]);
            var actualLength = (positions[b[0]] && positions[b[1]]) ? vlen(vsub(positions[b[1]], positions[b[0]])) : null;
            // Known directly from the BFS walk itself (isTreeEdgeBond[bi] was
            // set exactly when this bond was used to place a child) - not
            // reverse-engineered from comparing positions afterward, which is
            // fragile (wrong parent/child direction, floating-point epsilon
            // mismatches) and was a real bug in an earlier version of this file.
            var ringClosure = !isTreeEdgeBond[bi];
            if (ringClosure && actualLength !== null && Math.abs(actualLength - lenInfo.value) > 0.15) {
                warnings.push('ring-closure bond ' + b[0] + '-' + b[1] + ': BFS tree placement gives ' + actualLength.toFixed(3) + ' A vs the ideal ' + lenInfo.value.toFixed(3) + ' A for this bond - true ring closure needs real conformer generation, out of scope here.');
            }
            return {
                a: b[0], b: b[1], order: b[2],
                idealLengthAngstrom: lenInfo.value,
                lengthSource: lenInfo.source,
                actualLengthAngstrom: actualLength === null ? null : Math.round(actualLength * 1000) / 1000,
                ringClosure: ringClosure
            };
        });

        var atomsOut = expanded.atoms.map(function(a, idx) {
            var p = positions[idx] || [0, 0, 0];
            return {
                index: idx,
                symbol: a.symbol,
                isImplicitH: a.isImplicitH,
                charge: a.charge,
                x: Math.round(p[0] * 1000) / 1000,
                y: Math.round(p[1] * 1000) / 1000,
                z: Math.round(p[2] * 1000) / 1000
            };
        });

        return {
            atoms: atomsOut,
            bonds: bondsOut,
            geometrySource: 'idealized (VSEPR)',
            rootAtomIndex: root,
            warnings: warnings,
            version: '0.1'
        };
    }

    return {
        bondLength: bondLength,
        BOND_LENGTH_ANGSTROM: BOND_LENGTH_ANGSTROM,
        expandImplicitHydrogens: expandImplicitHydrogens,
        generateIdealizedCoordinates: generateIdealizedCoordinates,
        version: '0.1'
    };
}));
