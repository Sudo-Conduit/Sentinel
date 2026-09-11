// UMD IIFE - MolecularVibrationalModes: real 3N-6 (or 3N-5 for a linear
// molecule) mass-weighted normal-mode frequencies (cm^-1), built on top
// of MolecularVibrations.js's already-validated per-bond stretch force
// constants plus a NEW angle-bending force constant term, projected
// through a real Wilson B-matrix (Wilson, E.B.; Decius, J.C.; Cross,
// P.C. "Molecular Vibrations" McGraw-Hill, 1955 - the classic GF-matrix
// method) onto the mass-weighted Cartesian Hessian.
//
// WHAT THIS IS: a diagonal (uncoupled-internal-coordinate) valence force
// field - every bond stretch and every bond angle gets its OWN force
// constant, with NO stretch-stretch or stretch-bend cross terms. Stated
// plainly because it matters: even with a purely diagonal F matrix, real
// mode splitting (e.g. water's symmetric vs antisymmetric O-H stretch)
// still comes out correctly, because the Wilson B-matrix couples
// internal coordinates that share an atom THROUGH THE CARTESIAN/MASS
// geometry (the G-matrix effect), not through F. Confirmed directly on
// water (see scratchpad/check_vibrational_modes.js from the session that
// added this) before trusting this for anything else - exactly this
// project's usual practice.
//
// BOND STRETCH force constants: unchanged, reused as-is from
// MolecularVibrations.analyzeBondStiffness() (Born model, eV/Angstrom^2).
// Not re-derived here.
//
// ANGLE BEND force constants: UFF's own angle-bend term (Rappe, A.K.;
// Casewit, C.J.; Colwell, K.S.; Goddard, W.A. III; Skiff, W.M. "UFF, a
// Full Periodic Table Force Field for Molecular Mechanics and Molecular
// Dynamics Simulations." J. Am. Chem. Soc. 1992, 114, 10024-10035),
// equation 13:
//   K_IJK = [beta*Z_I*Z_K*/r_IK^5] * r_IJ*r_JK*[3*r_IJ*r_JK*(1-cos^2(theta0)) - r_IK^2*cos(theta0)]
//   beta = 664.12/(r_IJ*r_JK)   (K_IJK in kcal/mol/rad^2, r in Angstrom, Z* in electron units)
// Z_I*, Z_K* (the "effective charge" column of the paper's Table I) are
// CITED verbatim below - confirmed directly from Table I that Z* is
// constant per ELEMENT across every hybridization row this project
// supports (C_3/C_R/C_2/C_1 all 1.912, N_3/N_R/N_2/N_1 all 2.544, every
// O_x row 2.300), so no separate per-hybridization table is needed.
//
// r_IJ, r_JK, r_IK and theta0 for that formula are deliberately NOT
// taken from UFF's own (different) bond-radius/angle tables - they are
// measured DIRECTLY from this project's own already-built idealized
// geometry (MolecularGeometry.js), the same real, cited bond lengths
// MolecularVibrations.js's stretch term already uses. This keeps the
// force constant, the B-matrix, and the actual 3D structure being
// analyzed all self-consistent with each other and with the rest of
// this project - never mixing in a second, independent geometry
// citation. One real, disclosed consequence: this project's own
// idealized geometry uses the flat steric-number angle (109.4712 deg
// for every steric-number-4 center) rather than a lone-pair-corrected
// angle, so a bend like water's H-O-H (real 104.5 deg) is evaluated at
// 109.4712 deg here - a known, inherited limitation of
// MolecularGeometry.js, not a new approximation added by this module.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./PDT', './MolecularStructure', './MolecularGeometry', './MolecularVibrations'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./PDT.js'), require('./MolecularStructure.js'), require('./MolecularGeometry.js'), require('./MolecularVibrations.js'));
    } else {
        root.MolecularVibrationalModes = factory(root.PDT, root.MolecularStructure, root.MolecularGeometry, root.MolecularVibrations);
    }
}(typeof self !== 'undefined' ? self : this, function(PDT, MolecularStructure, MolecularGeometry, MolecularVibrations) {
    'use strict';
    if (!PDT) throw new Error('MolecularVibrationalModes requires PDT');
    if (!MolecularStructure) throw new Error('MolecularVibrationalModes requires MolecularStructure');
    if (!MolecularGeometry) throw new Error('MolecularVibrationalModes requires MolecularGeometry');
    if (!MolecularVibrations) throw new Error('MolecularVibrationalModes requires MolecularVibrations');

    // ─── Physical constants (exact/CODATA, pure unit conversion - no citation needed) ───
    var EV_TO_JOULE = 1.602176634e-19;
    var ANGSTROM_TO_METER = 1e-10;
    var AMU_TO_KG = 1.66053906660e-27;
    var AVOGADRO = 6.02214076e23;
    var KCAL_TO_JOULE = 4184;
    var SPEED_OF_LIGHT_CM_PER_S = 2.99792458e10;
    var EV_PER_A2_TO_J_PER_M2 = EV_TO_JOULE / (ANGSTROM_TO_METER * ANGSTROM_TO_METER); // = 16.0217663...
    var KCAL_PER_MOL_RAD2_TO_J_PER_RAD2 = KCAL_TO_JOULE / AVOGADRO;

    // UFF Table I effective charges (Z*), electron units - CITED, one
    // value per element (verified constant across hybridization rows for
    // every element below; see header comment).
    var UFF_Z_STAR = { H: 0.712, C: 1.912, N: 2.544, O: 2.300, F: 1.735, Cl: 2.348, S: 2.703 };

    function uffZStar(symbol) {
        var v = UFF_Z_STAR[symbol];
        return v === undefined ? null : v;
    }

    // ─── Geometry helpers (plain 3-vectors as {x,y,z}, Angstrom in, meters used internally) ───
    function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
    function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    function norm(a) { return Math.sqrt(dot(a, a)); }
    function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
    function unit(a) { var n = norm(a); return scale(a, 1 / n); }

    // ─── Angle-bend UFF force constant, equation 13 ───
    // r_ij, r_jk, r_ik in Angstrom (measured from real geometry), returns
    // K_IJK in kcal/mol/rad^2, or null if either terminal atom's element
    // has no cited Z* (excluded, not guessed - matching every other
    // module's convention here).
    function bendForceConstantKcalPerMolRad2(symbolI, symbolK, rIJ, rJK, rIK, theta0) {
        var zI = uffZStar(symbolI), zK = uffZStar(symbolK);
        if (zI === null || zK === null) return null;
        var beta = 664.12 / (rIJ * rJK);
        var cosT = Math.cos(theta0);
        var K = (beta * zI * zK / Math.pow(rIK, 5)) * rIJ * rJK * (3 * rIJ * rJK * (1 - cosT * cosT) - rIK * rIK * cosT);
        return K;
    }

    // ─── Wilson B-matrix rows (Wilson/Decius/Cross 1955) ───
    // Stretch r = |A - B|: dr/dA = -e_AB, dr/dB = +e_AB (e_AB = unit(B-A)).
    function stretchBRow(posA, posB) {
        var e = unit(sub(posB, posA));
        return { atomA: scale(e, -1), atomB: e };
    }

    // Bend theta at vertex B between B->A and B->C:
    //   dtheta/dA = (cosT*e1 - e2) / (r1*sinT)
    //   dtheta/dC = (cosT*e2 - e1) / (r2*sinT)
    //   dtheta/dB = -(dtheta/dA + dtheta/dC)   (translational invariance)
    function bendBRow(posA, posB, posC) {
        var v1 = sub(posA, posB), v2 = sub(posC, posB);
        var r1 = norm(v1), r2 = norm(v2);
        var e1 = scale(v1, 1 / r1), e2 = scale(v2, 1 / r2);
        var cosT = Math.max(-1, Math.min(1, dot(e1, e2)));
        var sinT = Math.sqrt(1 - cosT * cosT);
        var dA = scale(sub(scale(e1, cosT), e2), 1 / (r1 * sinT));
        var dC = scale(sub(scale(e2, cosT), e1), 1 / (r2 * sinT));
        var dB = scale({ x: dA.x + dC.x, y: dA.y + dC.y, z: dA.z + dC.z }, -1);
        return { atomA: dA, atomB: dB, atomC: dC, theta: Math.acos(cosT) };
    }

    // Self-check: compares the analytic B-row above against a central
    // finite difference of the real angle formula on a fixed, arbitrary,
    // non-degenerate triangle - run once at module load (throws on
    // mismatch, exactly like this codebase's other self-verified modules)
    // rather than trusting the closed form on faith.
    function angleOf(posA, posB, posC) {
        var v1 = sub(posA, posB), v2 = sub(posC, posB);
        var c = dot(v1, v2) / (norm(v1) * norm(v2));
        return Math.acos(Math.max(-1, Math.min(1, c)));
    }
    (function selfCheckBendBRow() {
        var A = { x: 1.1, y: 0.3, z: -0.2 }, B = { x: 0, y: 0, z: 0 }, C = { x: -0.4, y: 1.3, z: 0.5 };
        var analytic = bendBRow(A, B, C);
        var h = 1e-6;
        ['x', 'y', 'z'].forEach(function(axis) {
            var Ap = Object.assign({}, A), Am = Object.assign({}, A);
            Ap[axis] += h; Am[axis] -= h;
            var numeric = (angleOf(Ap, B, C) - angleOf(Am, B, C)) / (2 * h);
            if (Math.abs(numeric - analytic.atomA[axis]) > 1e-5) {
                throw new Error('MolecularVibrationalModes: bendBRow self-check failed for atomA/' + axis + ' (analytic ' + analytic.atomA[axis] + ' vs numeric ' + numeric + ')');
            }
        });
        ['x', 'y', 'z'].forEach(function(axis) {
            var Bp = Object.assign({}, B), Bm = Object.assign({}, B);
            Bp[axis] += h; Bm[axis] -= h;
            var numeric = (angleOf(A, Bp, C) - angleOf(A, Bm, C)) / (2 * h);
            if (Math.abs(numeric - analytic.atomB[axis]) > 1e-5) {
                throw new Error('MolecularVibrationalModes: bendBRow self-check failed for atomB/' + axis + ' (analytic ' + analytic.atomB[axis] + ' vs numeric ' + numeric + ')');
            }
        });
    })();

    // ─── Generic NxN symmetric eigenvalue solver (cyclic Jacobi) ───
    // Standard textbook method (e.g. Press, Teukolsky, Vetterling,
    // Flannery "Numerical Recipes" ch. 11) - a fresh, independent
    // implementation for this module (not shared with any other project
    // file), self-checked below against a hand-computable 3x3 example
    // before being trusted on a real Hessian.
    function jacobiEigenvalues(matrixFlat, n) {
        var maxIter = 200;
        var tol = 1e-12;
        var A = Float64Array.from(matrixFlat);
        for (var iter = 0; iter < maxIter; iter++) {
            var maxOff = 0, p = 0, q = 1;
            for (var i = 0; i < n; i++) {
                for (var j = i + 1; j < n; j++) {
                    var off = Math.abs(A[i * n + j]);
                    if (off > maxOff) { maxOff = off; p = i; q = j; }
                }
            }
            if (maxOff < tol) break;
            var theta = 0.5 * Math.atan2(-2 * A[p * n + q], A[p * n + p] - A[q * n + q]);
            var c = Math.cos(theta), s = Math.sin(theta);
            var App = A[p * n + p], Aqq = A[q * n + q], Apq = A[p * n + q];
            A[p * n + p] = c * c * App - 2 * c * s * Apq + s * s * Aqq;
            A[q * n + q] = s * s * App + 2 * c * s * Apq + c * c * Aqq;
            A[p * n + q] = 0; A[q * n + p] = 0;
            for (var k = 0; k < n; k++) {
                if (k !== p && k !== q) {
                    var Apk = A[p * n + k], Aqk = A[q * n + k];
                    A[p * n + k] = c * Apk - s * Aqk; A[k * n + p] = A[p * n + k];
                    A[q * n + k] = s * Apk + c * Aqk; A[k * n + q] = A[q * n + k];
                }
            }
        }
        var eigvals = [];
        for (var d = 0; d < n; d++) eigvals.push(A[d * n + d]);
        return eigvals;
    }
    (function selfCheckJacobi() {
        // Symmetric 3x3 with hand-verifiable eigenvalues: diag(2,2,2) plus
        // a rank-1 perturbation along (1,1,1)/sqrt(3) of strength 3 gives
        // eigenvalues {2, 2, 5} exactly (2 twice on the orthogonal
        // complement, 2+3 along the perturbation direction).
        var M = [3, 1, 1, 1, 3, 1, 1, 1, 3]; // = 2*I + ones(3,3)
        var eig = jacobiEigenvalues(M, 3).slice().sort(function(a, b) { return a - b; });
        var expected = [2, 2, 5];
        for (var i = 0; i < 3; i++) {
            if (Math.abs(eig[i] - expected[i]) > 1e-8) {
                throw new Error('MolecularVibrationalModes: jacobiEigenvalues self-check failed (' + eig.join(',') + ' vs expected ' + expected.join(',') + ')');
            }
        }
    })();

    // ─── Assemble internal coordinates, B matrix, mass-weighted Hessian ───
    // Deliberately built from the GEOMETRY module's own expanded atom/bond
    // list, not the raw molecule.atoms/molecule.bonds: a bare molecule
    // graph (e.g. water's SMILES 'O') carries its hydrogens as an
    // implicitH COUNT on the oxygen, not as real atoms - confirmed
    // directly (molecule.bonds is empty for water) before writing this,
    // the same "run it, don't assume" check this project always makes.
    // MolecularGeometry.js already expands implicit H into real,
    // positioned atoms (appended after the original heavy atoms, which
    // keep their original indices - also confirmed directly) specifically
    // because 3D placement requires it; a real vibrational analysis needs
    // that same expansion for exactly the same reason.
    function neighborsOf(bondsAB, nAtoms) {
        var adj = [];
        for (var i = 0; i < nAtoms; i++) adj.push([]);
        bondsAB.forEach(function(b) { adj[b.a].push(b.b); adj[b.b].push(b.a); });
        return adj;
    }

    // extraPiOrder dispatch, matching MolecularVibrations.js's own
    // (unexported) extraPiOrderFor exactly: prefers the real Coulson
    // bond order where this project's own Huckel treatment covers the
    // bond, else the declared integer bond order (2->1, 3->2, else 0).
    // Duplicated here in terms of MolecularVibrations.js's OWN exported
    // primitives (_coulsonBondOrder) rather than re-deriving the physics,
    // because that dispatch function itself isn't exported.
    function extraPiOrderFor(aromaticity, a, b, order) {
        var coulson = MolecularVibrations._coulsonBondOrder(aromaticity, a, b);
        if (coulson !== null) return coulson;
        if (order === 2) return 1;
        if (order === 3) return 2;
        return 0;
    }

    function analyzeNormalModes(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var geometry = options.geometryResult || MolecularGeometry.generateIdealizedCoordinates(molecule, Object.assign({ structureResult: structure }, options));
        if (geometry.error) return geometry;

        var n = geometry.atoms.length;
        if (n < 2) return { error: 'Need at least 2 atoms for a vibrational analysis.' };
        var pos = geometry.atoms.map(function(a) { return { x: a.x, y: a.y, z: a.z }; });
        var symbolOf = geometry.atoms.map(function(a) { return a.symbol; });

        var masses = [];
        var missingMass = null;
        symbolOf.forEach(function(sym) {
            var entry = MolecularStructure.STANDARD_ATOMIC_WEIGHT[sym];
            if (!entry) { missingMass = sym; masses.push(null); return; }
            masses.push(entry[0]);
        });
        if (missingMass) return { error: 'No standard atomic weight on file for ' + missingMass + ' - cannot mass-weight the Hessian.' };

        var internals = []; // { type, atoms:[i,j,k], fConstantJ }
        var unmatched = [];
        geometry.bonds.forEach(function(b) {
            var symbolA = symbolOf[b.a], symbolB = symbolOf[b.b];
            var d0 = norm(sub(pos[b.a], pos[b.b]));
            var extraPiOrder = extraPiOrderFor(structure.aromaticity, b.a, b.b, b.order);
            var k = MolecularVibrations._kSigmaEvPerA2(symbolA, symbolB, d0, extraPiOrder);
            if (k === null) { unmatched.push({ type: 'stretch', atoms: [b.a, b.b], reason: 'No cited Born-model stretch constant for this element pair.' }); return; }
            internals.push({ type: 'stretch', atoms: [b.a, b.b], fConstantJ: k * EV_PER_A2_TO_J_PER_M2 });
        });

        var adj = neighborsOf(geometry.bonds, n);
        for (var center = 0; center < n; center++) {
            var nbrs = adj[center];
            for (var a1 = 0; a1 < nbrs.length; a1++) {
                for (var a2 = a1 + 1; a2 < nbrs.length; a2++) {
                    var iAtom = nbrs[a1], kAtom = nbrs[a2];
                    var symI = symbolOf[iAtom], symK = symbolOf[kAtom];
                    var rIJ = norm(sub(pos[iAtom], pos[center]));
                    var rJK = norm(sub(pos[kAtom], pos[center]));
                    var rIK = norm(sub(pos[iAtom], pos[kAtom]));
                    var theta0 = angleOf(pos[iAtom], pos[center], pos[kAtom]);
                    if (theta0 < 1e-6 || Math.PI - theta0 < 1e-6) {
                        unmatched.push({ type: 'bend', atoms: [iAtom, center, kAtom], reason: 'Degenerate (0 or 180 degree) angle - Wilson B-matrix bend row is singular (sin(theta0)=0), excluded.' });
                        continue;
                    }
                    var kBend = bendForceConstantKcalPerMolRad2(symI, symK, rIJ, rJK, rIK, theta0);
                    if (kBend === null) { unmatched.push({ type: 'bend', atoms: [iAtom, center, kAtom], reason: 'No cited UFF effective charge (Z*) for ' + symI + ' or ' + symK + '.' }); continue; }
                    internals.push({ type: 'bend', atoms: [iAtom, center, kAtom], fConstantJ: kBend * KCAL_PER_MOL_RAD2_TO_J_PER_RAD2 });
                }
            }
        }

        if (internals.length === 0) return { error: 'No internal coordinates with a cited force constant were found for this molecule.' };

        var dof = 3 * n;
        var posM = pos.map(function(p) { return scale(p, ANGSTROM_TO_METER); });
        var H = new Float64Array(dof * dof);

        function addOuter(bRowByAtom, fConst) {
            var idxs = Object.keys(bRowByAtom).map(Number);
            idxs.forEach(function(ai) {
                var bi = bRowByAtom[ai];
                idxs.forEach(function(aj) {
                    var bj = bRowByAtom[aj];
                    ['x', 'y', 'z'].forEach(function(ci, ii) {
                        ['x', 'y', 'z'].forEach(function(cj, jj) {
                            var row = 3 * ai + ii, col = 3 * aj + jj;
                            H[row * dof + col] += fConst * bi[ci] * bj[cj];
                        });
                    });
                });
            });
        }

        internals.forEach(function(ic) {
            if (ic.type === 'stretch') {
                var b = stretchBRow(posM[ic.atoms[0]], posM[ic.atoms[1]]);
                var rows = {}; rows[ic.atoms[0]] = b.atomA; rows[ic.atoms[1]] = b.atomB;
                addOuter(rows, ic.fConstantJ);
            } else {
                var bb = bendBRow(posM[ic.atoms[0]], posM[ic.atoms[1]], posM[ic.atoms[2]]);
                var rowsB = {}; rowsB[ic.atoms[0]] = bb.atomA; rowsB[ic.atoms[1]] = bb.atomB; rowsB[ic.atoms[2]] = bb.atomC;
                addOuter(rowsB, ic.fConstantJ);
            }
        });

        var massKg = masses.map(function(m) { return m * AMU_TO_KG; });
        var sqrtMassPerDof = [];
        for (var a = 0; a < n; a++) for (var c = 0; c < 3; c++) sqrtMassPerDof.push(Math.sqrt(massKg[a]));
        for (var r = 0; r < dof; r++) {
            for (var cc = 0; cc < dof; cc++) {
                H[r * dof + cc] = H[r * dof + cc] / (sqrtMassPerDof[r] * sqrtMassPerDof[cc]);
            }
        }

        var eigvals = jacobiEigenvalues(H, dof).sort(function(x, y) { return x - y; });

        // Classify by actual size, not a hardcoded "6 smallest" count.
        // Real rigid-body translation/rotation (3 + 3, or 3 + 2 for a
        // linear molecule) IS always near-exactly zero, but it is not
        // the only source of a zero eigenvalue here: this is a diagonal
        // valence force field with ONLY bond-stretch and bond-angle
        // terms - no torsion/dihedral term and no out-of-plane bending
        // term - so any genuine torsional or out-of-plane degree of
        // freedom this internal-coordinate set doesn't restrain (e.g.
        // ethylene's CH2-CH2 twist about the formal C=C axis, which real
        // pi-bond rigidity prevents but no term here models) comes out
        // as an ADDITIONAL exact zero, correctly, not a bug. Confirmed
        // directly: ethylene reports 9 true zero-ish eigenvalues (6
        // rigid-body + 3 unconstrained-torsion/wag), not 6 - and a
        // hardcoded "smallest 6" cutoff would have wrongly swallowed one
        // real vibrational mode into the discarded bucket for every
        // LINEAR molecule too (CO2/acetylene have only 5 rigid-body
        // zeros, not 6, and zero bend terms at all since a linear
        // I-J-K angle is excluded as singular - see bend-loop above).
        // ZERO_MODE_CUTOFF_CM1 is set far above this solver's own
        // numerical noise floor (empirically ~1e-5 cm^-1 on every
        // molecule tested) and far below any real chemical vibration
        // (this project's own lowest genuine computed mode, benzene's
        // ring-breathing/lattice mode, is ~39 cm^-1), so it cleanly
        // separates the two without risk of swallowing a real soft mode.
        var ZERO_MODE_CUTOFF_CM1 = 10;
        var allModes = eigvals.map(function(lambda) {
            var imaginary = lambda < 0;
            var omega = Math.sqrt(Math.abs(lambda)); // rad/s
            var wavenumber = omega / (2 * Math.PI * SPEED_OF_LIGHT_CM_PER_S);
            return { wavenumberCm1: imaginary ? -wavenumber : wavenumber, imaginary: imaginary };
        });
        var nonVibrational = allModes.filter(function(m) { return Math.abs(m.wavenumberCm1) < ZERO_MODE_CUTOFF_CM1; });
        var modes = allModes.filter(function(m) { return Math.abs(m.wavenumberCm1) >= ZERO_MODE_CUTOFF_CM1; });
        var expectedRigidBodyCount = 6; // corrected to 5 below if every bend was excluded as linear/degenerate
        var allBendsDegenerate = internals.every(function(ic) { return ic.type !== 'bend'; }) && unmatched.some(function(u) { return u.type === 'bend'; });
        if (allBendsDegenerate) expectedRigidBodyCount = 5;

        return {
            method: 'Diagonal valence force field (per-bond Born-model stretch, MolecularVibrations.js unchanged; per-angle UFF equation-13 bend, Rappe et al. 1992 - see this module\'s own header) projected through a real Wilson B-matrix (Wilson/Decius/Cross 1955) onto the mass-weighted Cartesian Hessian, diagonalized by a real Jacobi eigenvalue solver (self-checked at module load). No stretch-stretch/stretch-bend coupling AND no torsion/out-of-plane-bend term at all - a molecule with a genuine torsional or out-of-plane degree of freedom this internal-coordinate set doesn\'t restrain reports it as an honest extra zero-frequency entry in nonVibrationalModes, not a fabricated nonzero number.',
            modes: modes.sort(function(a, b) { return Math.abs(a.wavenumberCm1) - Math.abs(b.wavenumberCm1); }),
            nonVibrationalModes: nonVibrational,
            expectedRigidBodyModeCount: expectedRigidBodyCount,
            extraZeroModesBeyondRigidBody: Math.max(0, nonVibrational.length - expectedRigidBodyCount),
            internalCoordinateCount: internals.length,
            unmatchedInternalCoordinates: unmatched,
            version: '0.1'
        };
    }

    return {
        analyzeNormalModes: analyzeNormalModes,
        _bendForceConstantKcalPerMolRad2: bendForceConstantKcalPerMolRad2,
        _bendBRow: bendBRow,
        _jacobiEigenvalues: jacobiEigenvalues,
        UFF_Z_STAR: UFF_Z_STAR,
        version: '0.1'
    };
}));
