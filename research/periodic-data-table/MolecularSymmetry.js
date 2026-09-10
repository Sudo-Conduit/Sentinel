// UMD IIFE - MolecularSymmetry: real numerical point-group detection from
// this project's own idealized 3D geometry (MolecularGeometry.js).
//
// METHOD (a simplified, self-contained version of the standard numeric
// symmetry-detection approach used by real quantum-chemistry packages -
// see Pilati, T.; Forni, A. "SYMMOL: a program to find the maximum
// symmetry group in an atom cluster." J. Appl. Cryst. 1998, 31, 503 for
// the classic published algorithm this borrows its structure from):
//   1. Diagonalize the (unweighted, geometric) moment-of-inertia-shaped
//      tensor to get 3 principal axes. This is a real theorem, not a
//      heuristic: any proper rotation axis of order >= 2 a molecule
//      actually has MUST coincide with one of its principal axes - so
//      the principal axes are exactly the right (and only) places to
//      look, whether or not the moments happen to be numerically
//      degenerate.
//   2. Classify by degeneracy pattern (linear / spherical top / symmetric
//      top / asymmetric top) to decide which axis/plane CANDIDATES are
//      worth testing, then actually test each candidate operation
//      (rotate/reflect/invert every atom, check the result maps onto the
//      original atom set - same element, position within tolerance, a
//      genuine one-to-one correspondence) rather than assuming a
//      candidate holds.
//   3. Combine whichever real operations were found into the standard
//      point-group classification tree (Cn/Cnv/Cnh/Dn/Dnh/Dnd/S2n/Td/
//      Ci/Cs/C1, plus the linear special cases C∞v/D∞h).
//
// This project's own idealized (never measured/noisy) geometry is an
// advantage here, not just a limitation elsewhere: a real symmetry
// operation on an idealized VSEPR structure should match to near machine
// precision, not "close enough" - so a tight numeric tolerance is used,
// and a failed match is trusted as a real absence of that symmetry
// element, not numerical noise.
//
// HONEST SCOPE LIMIT: high-order cubic groups (Oh, Ih) are not
// distinguished from a bare "spherical top" - this project's own
// molecule set has no real candidates for those (Td, from a tetrahedral
// center like methane, is the one spherical-top case detected
// explicitly). Dnd (odd staggered dihedral, needs an S2n test this
// module does implement) is tested but less exercised by this project's
// mostly-planar idealized geometries. Point groups above n=8 are not
// searched (chemically irrelevant for anything this project generates).
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./MolecularStructure', './MolecularGeometry'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./MolecularStructure.js'), require('./MolecularGeometry.js'));
    } else {
        root.MolecularSymmetry = factory(root.MolecularStructure, root.MolecularGeometry);
    }
}(typeof self !== 'undefined' ? self : this, function(MolecularStructure, MolecularGeometry) {
    'use strict';
    if (!MolecularStructure) throw new Error('MolecularSymmetry requires MolecularStructure');
    if (!MolecularGeometry) throw new Error('MolecularSymmetry requires MolecularGeometry');

    var TOL = 1e-3; // Angstrom - tight, since geometry is idealized/exact, not measured

    // ─── Vector helpers ───
    function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
    function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
    function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
    function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
    function norm(a) { return Math.sqrt(dot(a, a)); }
    function unitOrNull(a) { var n = norm(a); return n < 1e-8 ? null : scale(a, 1 / n); }

    // ─── 3x3 symmetric eigenvalue/eigenvector solver (cyclic Jacobi with
    // rotation accumulation) - a fresh, small, self-checked implementation
    // for this module specifically (eigenVECTORS are needed here, unlike
    // MolecularVibrationalModes.js's eigenvalue-only solver). ───
    function jacobiEigenSystem3(m) {
        // m: [m00,m01,m02, m10,m11,m12, m20,m21,m22]
        var A = m.slice();
        var V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
        function idx(r, c) { return r * 3 + c; }
        for (var iter = 0; iter < 100; iter++) {
            var p = 0, q = 1, maxOff = Math.abs(A[idx(0, 1)]);
            if (Math.abs(A[idx(0, 2)]) > maxOff) { maxOff = Math.abs(A[idx(0, 2)]); p = 0; q = 2; }
            if (Math.abs(A[idx(1, 2)]) > maxOff) { maxOff = Math.abs(A[idx(1, 2)]); p = 1; q = 2; }
            if (maxOff < 1e-14) break;
            var theta = 0.5 * Math.atan2(-2 * A[idx(p, q)], A[idx(p, p)] - A[idx(q, q)]);
            var c = Math.cos(theta), s = Math.sin(theta);
            var App = A[idx(p, p)], Aqq = A[idx(q, q)], Apq = A[idx(p, q)];
            A[idx(p, p)] = c * c * App - 2 * c * s * Apq + s * s * Aqq;
            A[idx(q, q)] = s * s * App + 2 * c * s * Apq + c * c * Aqq;
            A[idx(p, q)] = 0; A[idx(q, p)] = 0;
            for (var k = 0; k < 3; k++) {
                if (k !== p && k !== q) {
                    var Apk = A[idx(p, k)], Aqk = A[idx(q, k)];
                    A[idx(p, k)] = c * Apk - s * Aqk; A[idx(k, p)] = A[idx(p, k)];
                    A[idx(q, k)] = s * Apk + c * Aqk; A[idx(k, q)] = A[idx(q, k)];
                }
                var Vkp = V[idx(k, p)], Vkq = V[idx(k, q)];
                V[idx(k, p)] = c * Vkp - s * Vkq;
                V[idx(k, q)] = s * Vkp + c * Vkq;
            }
        }
        var eigvals = [A[0], A[4], A[8]];
        var eigvecs = [
            { x: V[0], y: V[3], z: V[6] },
            { x: V[1], y: V[4], z: V[7] },
            { x: V[2], y: V[5], z: V[8] }
        ];
        var order = [0, 1, 2].sort(function(a, b) { return eigvals[a] - eigvals[b]; });
        return { values: order.map(function(i) { return eigvals[i]; }), vectors: order.map(function(i) { return eigvecs[i]; }) };
    }
    (function selfCheckEigenSystem() {
        // diag(5,3,1) is already diagonal - eigenvectors must be the axes themselves (in ascending eigenvalue order: 1,3,5).
        var r = jacobiEigenSystem3([5, 0, 0, 0, 3, 0, 0, 0, 1]);
        var expectedVals = [1, 3, 5];
        for (var i = 0; i < 3; i++) {
            if (Math.abs(r.values[i] - expectedVals[i]) > 1e-9) throw new Error('MolecularSymmetry: jacobiEigenSystem3 self-check failed (values)');
        }
        // Verify Av = lambda*v for each returned eigenpair on a NON-diagonal case.
        var M = [2, 1, 0, 1, 2, 0, 0, 0, 3];
        var r2 = jacobiEigenSystem3(M);
        for (var j = 0; j < 3; j++) {
            var v = r2.vectors[j], lam = r2.values[j];
            var Av = { x: M[0] * v.x + M[1] * v.y + M[2] * v.z, y: M[3] * v.x + M[4] * v.y + M[5] * v.z, z: M[6] * v.x + M[7] * v.y + M[8] * v.z };
            var residual = norm(sub(Av, scale(v, lam)));
            if (residual > 1e-8) throw new Error('MolecularSymmetry: jacobiEigenSystem3 self-check failed (Av=lambda*v residual ' + residual + ')');
        }
    })();

    // ─── Symmetry-operation appliers (about the centroid) and the
    // atom-correspondence checker that decides whether an operation is
    // a REAL symmetry of this structure. ───
    function rotateAboutAxis(v, axisUnit, angle) {
        var cosA = Math.cos(angle), sinA = Math.sin(angle);
        var term1 = scale(v, cosA);
        var term2 = scale(cross(axisUnit, v), sinA);
        var term3 = scale(axisUnit, dot(axisUnit, v) * (1 - cosA));
        return add(add(term1, term2), term3);
    }
    function reflectThroughPlane(v, normalUnit) {
        return sub(v, scale(normalUnit, 2 * dot(v, normalUnit)));
    }

    // atoms: [{symbol, pos:{x,y,z}}] already centered on the centroid.
    // transform(pos) -> transformed pos. Returns {mapping, maxError} iff
    // every transformed atom has a unique, same-element, within-`tol`
    // correspondence in the original set (a genuine permutation, not
    // just "something nearby") - null otherwise.
    function correspondence(atoms, transform, tol) {
        var used = new Array(atoms.length).fill(false);
        var mapping = new Array(atoms.length).fill(-1);
        var maxError = 0;
        for (var i = 0; i < atoms.length; i++) {
            var t = transform(atoms[i].pos);
            var bestJ = -1, bestD = Infinity;
            for (var j = 0; j < atoms.length; j++) {
                if (used[j] || atoms[j].symbol !== atoms[i].symbol) continue;
                var d = norm(sub(t, atoms[j].pos));
                if (d < bestD) { bestD = d; bestJ = j; }
            }
            if (bestJ === -1 || bestD > tol) return null;
            used[bestJ] = true;
            mapping[i] = bestJ;
            if (bestD > maxError) maxError = bestD;
        }
        return { mapping: mapping, maxError: maxError };
    }
    function isValidSymmetryOperation(atoms, transform) {
        return correspondence(atoms, transform, TOL) !== null;
    }

    // A candidate rotation AXIS derived from an eigenvector of the shape
    // tensor is only as precise as that eigenvector - and eigenvector
    // precision degrades badly when its eigenvalue is close (but not
    // exactly equal) to a neighboring one, a real numerical sensitivity
    // (not a bug), confirmed directly on pyrrole: its two in-plane
    // principal moments differ by only ~1.2%, and the resulting
    // eigenvector was measurably (~0.8 deg) off from the molecule's real
    // exact C2 axis - enough to fail the strict correspondence check on
    // atoms far from the axis (0.034 A error vs a 0.001 A tolerance).
    // FIX: for any matched pair (atom i -> atom j) under a proper
    // rotation about the true axis u, pos_i and pos_j have IDENTICAL
    // components along u (rotation about u preserves the u-component),
    // so pos_i - pos_j is exactly perpendicular to u for every real
    // matched pair, regardless of rotation order. Given several such
    // difference vectors, u is the direction perpendicular to all of
    // them - found as the smallest-eigenvalue eigenvector of their
    // outer-product sum (the same real least-squares idea as PCA/SVD),
    // reusing this module's own jacobiEigenSystem3.
    function refineAxisFromPairs(atoms, mapping, approxAxis) {
        var Mxx = 0, Myy = 0, Mzz = 0, Mxy = 0, Mxz = 0, Myz = 0, count = 0;
        for (var i = 0; i < atoms.length; i++) {
            var j = mapping[i];
            if (j === i) continue;
            var d = sub(atoms[i].pos, atoms[j].pos);
            if (norm(d) < 1e-6) continue;
            Mxx += d.x * d.x; Myy += d.y * d.y; Mzz += d.z * d.z;
            Mxy += d.x * d.y; Mxz += d.x * d.z; Myz += d.y * d.z;
            count++;
        }
        if (count < 1) return null;
        var eig = jacobiEigenSystem3([Mxx, Mxy, Mxz, Mxy, Myy, Myz, Mxz, Myz, Mzz]);
        // For a PLANAR molecule every Delta lies exactly in-plane, so the
        // out-of-plane direction is ALSO an exact (trivial) null vector
        // of M - and can win on eigenvalue alone over the true in-plane
        // axis (confirmed directly on pyrrole: this returned the z-axis,
        // 90 degrees from the real symmetry axis). The right tie-break is
        // domain knowledge already in hand: this is a REFINEMENT of an
        // already-approximately-correct guess, so pick whichever
        // eigenvector stays closest in direction to that guess, not
        // blindly the smallest eigenvalue.
        var bestI = 0, bestAlign = -1;
        eig.vectors.forEach(function(v, i) {
            var align = Math.abs(dot(v, approxAxis));
            if (align > bestAlign) { bestAlign = align; bestI = i; }
        });
        return eig.vectors[bestI];
    }

    // Tests whether SOME real rotation of the given order exists near
    // `approxAxis` - tries the exact candidate first (cheap, exact for
    // any well-separated axis), and only falls back to the loose-match
    // + refine-axis + strict-retest path (see refineAxisFromPairs above)
    // when the direct strict test fails, trying both the refined axis
    // and its negation (rotation sense is not determined by the
    // refinement). Returns the working axis, or null.
    // Loose enough to survive a near-degenerate eigenvector's angular
    // error even on atoms far from the centroid (confirmed directly:
    // pyrrole's peripheral H atoms showed up to 0.066 A displacement
    // from a ~0.8 deg axis misalignment) - still gated by a strict
    // re-test afterward, so a bad initial correspondence can only cause
    // a missed symmetry, never a false positive.
    var LOOSE_TOL = 0.15;
    function findRotationAxis(atoms, approxAxis, order) {
        var angle = 2 * Math.PI / order;
        if (correspondence(atoms, function(p) { return rotateAboutAxis(p, approxAxis, angle); }, TOL)) return approxAxis;
        var axis = approxAxis;
        for (var iter = 0; iter < 3; iter++) {
            var loose = correspondence(atoms, function(p) { return rotateAboutAxis(p, axis, angle); }, LOOSE_TOL);
            if (!loose) return null;
            var refined = refineAxisFromPairs(atoms, loose.mapping, axis);
            if (!refined) return null;
            if (correspondence(atoms, function(p) { return rotateAboutAxis(p, refined, angle); }, TOL)) return refined;
            var neg = scale(refined, -1);
            if (correspondence(atoms, function(p) { return rotateAboutAxis(p, neg, angle); }, TOL)) return neg;
            axis = refined; // not converged yet - refine again from this improved estimate
        }
        return null;
    }
    function testRotation(atoms, axisUnit, order) {
        return findRotationAxis(atoms, axisUnit, order) !== null;
    }
    function testReflection(atoms, normalUnit) {
        return isValidSymmetryOperation(atoms, function(p) { return reflectThroughPlane(p, normalUnit); });
    }
    function testInversion(atoms) {
        return isValidSymmetryOperation(atoms, function(p) { return scale(p, -1); });
    }
    function testImproperRotation(atoms, axisUnit, order) {
        return isValidSymmetryOperation(atoms, function(p) {
            var rotated = rotateAboutAxis(p, axisUnit, 2 * Math.PI / order);
            return reflectThroughPlane(rotated, axisUnit);
        });
    }

    // Highest proper rotation order (2..maxN) about a given (possibly
    // approximate) axis that is actually a real symmetry of this
    // structure, or 1 if none. Returns {order, axis} - axis is the
    // exact-enough (possibly refined) direction actually used, needed
    // downstream for sigma_h/S2n/Dn tests about that same axis.
    function highestRotationInfo(atoms, axisUnit, maxN) {
        var best = 1, bestAxis = axisUnit;
        for (var k = 2; k <= maxN; k++) {
            var found = findRotationAxis(atoms, axisUnit, k);
            if (found) { best = k; bestAxis = found; }
        }
        return { order: best, axis: bestAxis };
    }

    // Candidate perpendicular-to-axis directions, generated from every
    // atom's own radial (perpendicular) component, plus pairwise angular
    // bisectors - generous/redundant on purpose (a wrong candidate just
    // fails the real correspondence check, cheaply).
    function perpendicularCandidates(atoms, axisUnit) {
        var radials = [];
        atoms.forEach(function(a) {
            var alongAxis = scale(axisUnit, dot(a.pos, axisUnit));
            var perp = unitOrNull(sub(a.pos, alongAxis));
            if (perp) radials.push(perp);
        });
        var candidates = radials.slice();
        for (var i = 0; i < radials.length; i++) {
            for (var j = i + 1; j < radials.length; j++) {
                var bis1 = unitOrNull(add(radials[i], radials[j]));
                if (bis1) candidates.push(bis1);
                var bis2 = unitOrNull(sub(radials[i], radials[j]));
                if (bis2) candidates.push(bis2);
            }
        }
        // Deduplicate near-identical directions (up to sign).
        var unique = [];
        candidates.forEach(function(c) {
            var isDup = unique.some(function(u) { return Math.abs(Math.abs(dot(u, c)) - 1) < 1e-6; });
            if (!isDup) unique.push(c);
        });
        return unique;
    }

    function detectPointGroup(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var geometry = options.geometryResult || MolecularGeometry.generateIdealizedCoordinates(molecule, Object.assign({ structureResult: structure }, options));
        if (geometry.error) return geometry;

        var n = geometry.atoms.length;
        if (n < 2) return { pointGroup: 'K-h (single atom, spherical by convention)', method: 'trivial', version: '0.1' };

        var centroid = { x: 0, y: 0, z: 0 };
        geometry.atoms.forEach(function(a) { centroid = add(centroid, a); });
        centroid = scale(centroid, 1 / n);
        var atoms = geometry.atoms.map(function(a) { return { symbol: a.symbol, pos: sub(a, centroid) }; });

        // Unweighted "shape tensor" (same form as an inertia tensor with
        // all masses set to 1) - its eigenvectors are the real principal
        // symmetry axes regardless of mass; using unit masses here
        // (rather than MolecularThermodynamics.js's real atomic masses)
        // is deliberate and standard for symmetry detection specifically.
        var Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
        atoms.forEach(function(a) {
            var x = a.pos.x, y = a.pos.y, z = a.pos.z;
            Ixx += y * y + z * z; Iyy += x * x + z * z; Izz += x * x + y * y;
            Ixy -= x * y; Ixz -= x * z; Iyz -= y * z;
        });
        var eig = jacobiEigenSystem3([Ixx, Ixy, Ixz, Ixy, Iyy, Iyz, Ixz, Iyz, Izz]);
        var vals = eig.values, axes = eig.vectors; // ascending

        var scaleRef = Math.max(vals[2], 1e-6);
        var isLinear = vals[0] / scaleRef < 1e-6;

        var found = { rotations: [], mirrors: 0, inversion: false, improper: [] };

        if (isLinear) {
            var mainAxis = axes[2];
            var hasInversion = testInversion(atoms);
            found.inversion = hasInversion;
            return {
                pointGroup: hasInversion ? 'D_inf_h' : 'C_inf_v',
                topType: 'linear',
                elementsFound: found,
                method: 'Linear molecule (one principal moment ~0) - classified by inversion symmetry alone (D_inf_h if centrosymmetric, e.g. CO2; C_inf_v otherwise, e.g. a generic linear A-B-C).',
                version: '0.1'
            };
        }

        var isSpherical = (vals[2] - vals[0]) / scaleRef < 1e-4;
        if (isSpherical) {
            // Td test: 4 real C3 axes through (centroid -> non-central-atom) directions
            // that are actually 3-fold symmetric, plus S4 about the 3 principal axes.
            var c3Candidates = [];
            atoms.forEach(function(a) { var u = unitOrNull(a.pos); if (u) c3Candidates.push(u); });
            var realC3 = c3Candidates.filter(function(ax) { return testRotation(atoms, ax, 3); });
            var s4Count = axes.filter(function(ax) { return testImproperRotation(atoms, ax, 4); }).length;
            if (realC3.length >= 4 && s4Count >= 1) {
                return { pointGroup: 'Td', topType: 'spherical', elementsFound: { c3Axes: realC3.length, s4Axes: s4Count }, method: 'Spherical top (all 3 principal moments equal) with >=4 real C3 axes and a real S4 - tetrahedral (Td), e.g. methane.', version: '0.1' };
            }
            return { pointGroup: 'spherical top (Oh/Ih/Td not distinguished)', topType: 'spherical', method: 'All 3 principal moments equal but this did not match this module\'s specific Td test - a real high-symmetry spherical top exists here, but only Td is distinguished explicitly (see this module\'s own scope note).', version: '0.1' };
        }

        // Symmetric top (2 of 3 moments equal): unique axis is the one
        // whose eigenvalue differs from the other two.
        var uniqueAxisIndex = null;
        if (Math.abs(vals[0] - vals[1]) / scaleRef < 1e-4) uniqueAxisIndex = 2;
        else if (Math.abs(vals[1] - vals[2]) / scaleRef < 1e-4) uniqueAxisIndex = 0;

        var candidateAxesForCn = uniqueAxisIndex !== null ? [axes[uniqueAxisIndex]] : [axes[0], axes[1], axes[2]];

        var bestAxis = null, bestOrder = 1, bestAxisIndex = -1;
        candidateAxesForCn.forEach(function(ax, idx) {
            var info = highestRotationInfo(atoms, ax, 8);
            if (info.order > bestOrder) { bestOrder = info.order; bestAxis = info.axis; bestAxisIndex = idx; }
        });

        if (bestOrder === 1) {
            // Asymmetric-top, no Cn>=2 found on any principal axis (or a
            // symmetric top with no real rotation on its unique axis,
            // unusual but handled the same way): only Cs/Ci/C1 possible.
            var anyMirror = axes.some(function(ax) { return testReflection(atoms, ax); });
            var hasInv = testInversion(atoms);
            var pg = hasInv ? 'Ci' : (anyMirror ? 'Cs' : 'C1');
            return { pointGroup: pg, topType: 'asymmetric/no axis', elementsFound: { inversion: hasInv, mirror: anyMirror }, method: 'No principal axis carries a real Cn (n>=2) - classified by mirror/inversion alone among C1/Cs/Ci.', version: '0.1' };
        }

        var mainAxis = bestAxis;
        var mainOrder = bestOrder;
        found.rotations.push({ order: mainOrder });

        // Perpendicular C2 axes (Dn candidate) - only meaningful for n>=2 main axis.
        // For an asymmetric top (3 distinct principal axes), the OTHER
        // two principal axes are always valid extra candidates directly -
        // needed because atom-radial candidates alone can miss a real
        // perpendicular axis that has zero radial component on every
        // atom (a planar molecule's out-of-plane axis, e.g. ethylene's
        // D2h: confirmed directly - none of its 4 H atoms has any
        // out-of-plane displacement to derive that axis from, so without
        // this it was mis-detected as C2v instead of D2h).
        var perpCands = perpendicularCandidates(atoms, mainAxis);
        if (uniqueAxisIndex === null) {
            for (var pi = 0; pi < 3; pi++) {
                if (pi === bestAxisIndex) continue;
                perpCands.push(axes[pi]);
            }
        }
        var perpC2Count = perpCands.filter(function(ax) { return testRotation(atoms, ax, 2); }).length;
        var hasDn = mainOrder >= 2 && perpC2Count >= mainOrder;

        var hasSigmaH = testReflection(atoms, mainAxis);
        var sigmaVCount = perpCands.filter(function(ax) { return testReflection(atoms, cross(mainAxis, ax)); }).length;
        // A sigma_v plane CONTAINS the main axis; its normal is
        // perpendicular to both the main axis and the in-plane radial
        // direction, i.e. normal = mainAxis x radial.
        var hasSigmaV = sigmaVCount > 0;
        var hasS2n = testImproperRotation(atoms, mainAxis, 2 * mainOrder);
        var hasInversion = testInversion(atoms);

        found.mirrors = (hasSigmaH ? 1 : 0) + sigmaVCount;
        found.inversion = hasInversion;
        found.improper = hasS2n ? [2 * mainOrder] : [];

        var pointGroup;
        if (hasDn && hasSigmaH) pointGroup = 'D' + mainOrder + 'h';
        else if (hasDn && hasSigmaV && !hasSigmaH) pointGroup = 'D' + mainOrder + 'd';
        else if (hasDn) pointGroup = 'D' + mainOrder;
        else if (hasSigmaH && hasSigmaV) pointGroup = 'C' + mainOrder + 'v'; // degenerate case, sigmaH acts as one of the sigmaV set for even n
        else if (hasSigmaV) pointGroup = 'C' + mainOrder + 'v';
        else if (hasSigmaH) pointGroup = 'C' + mainOrder + 'h';
        else if (hasS2n) pointGroup = 'S' + (2 * mainOrder);
        else pointGroup = 'C' + mainOrder;

        return {
            pointGroup: pointGroup,
            topType: uniqueAxisIndex !== null ? 'symmetric top' : 'asymmetric top',
            mainAxisOrder: mainOrder,
            elementsFound: { rotations: found.rotations, perpendicularC2Count: perpC2Count, sigmaH: hasSigmaH, sigmaVCount: sigmaVCount, inversion: hasInversion, improperOrder: found.improper[0] || null },
            method: 'Principal-axis-theorem search (Pilati & Forni 1998-style): candidate axes/planes are generated from the real geometry (principal inertia axes; perpendicular-plane candidates from each atom\'s own radial direction and pairwise bisectors), each candidate operation is actually tested against every atom (same element, position match within ' + TOL + ' A), not assumed.',
            version: '0.1'
        };
    }

    return {
        detectPointGroup: detectPointGroup,
        _jacobiEigenSystem3: jacobiEigenSystem3,
        version: '0.1'
    };
}));
