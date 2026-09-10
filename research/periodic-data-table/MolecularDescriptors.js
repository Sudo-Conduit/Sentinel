// UMD IIFE - MolecularDescriptors: quadrupole moment, molar refractivity,
// and the Lipinski/Veber druglikeness counts (HBD/HBA/rotatable bonds) -
// four "cheap win" properties that are each a direct, real extension of
// data this project already computes, not a new physical model.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./MolecularStructure', './MolecularGeometry', './MolecularElectrostatics', './MolecularPolarizability'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./MolecularStructure.js'), require('./MolecularGeometry.js'), require('./MolecularElectrostatics.js'), require('./MolecularPolarizability.js'));
    } else {
        root.MolecularDescriptors = factory(root.MolecularStructure, root.MolecularGeometry, root.MolecularElectrostatics, root.MolecularPolarizability);
    }
}(typeof self !== 'undefined' ? self : this, function(MolecularStructure, MolecularGeometry, MolecularElectrostatics, MolecularPolarizability) {
    'use strict';
    if (!MolecularStructure) throw new Error('MolecularDescriptors requires MolecularStructure');
    if (!MolecularGeometry) throw new Error('MolecularDescriptors requires MolecularGeometry');

    var AVOGADRO = 6.02214076e23;
    var EEV_TO_DEBYE = 4.80320; // same conversion MolecularElectrostatics.js uses for the dipole

    // ─── Quadrupole moment: the next real term in the SAME multipole
    // expansion the dipole is the first term of - same PEOE charges, same
    // idealized geometry, just the next moment (Q_ab = sum qi*(3*ria*rib
    // - ri^2*delta_ab)), computed about the center of MASS (the standard
    // convention for a tabulated molecular quadrupole moment - unlike the
    // dipole, the quadrupole of a charged distribution is origin-
    // dependent unless the dipole is also zero, so the origin choice is
    // stated explicitly rather than left implicit). Reported in
    // Buckingham (1 B = 1 Debye*Angstrom, the standard unit for this
    // quantity) using the same e*Angstrom -> Debye conversion factor the
    // dipole already uses. Inherits the same PEOE accuracy caveat the
    // dipole moment already carries (see MolecularElectrostatics.js).
    function analyzeQuadrupole(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var geometry = options.geometryResult || MolecularGeometry.generateIdealizedCoordinates(molecule, Object.assign({ structureResult: structure }, options));
        if (geometry.error) return geometry;
        var electro = options.electrostaticsResult || MolecularElectrostatics.analyze(molecule, Object.assign({ structureResult: structure, geometryResult: geometry }, options));
        if (electro.error || !electro.applicable) return { applicable: false, reason: electro.reason || 'Electrostatics not applicable to this molecule - see MolecularElectrostatics.js.', version: '0.1' };

        var charges = electro.partialCharges.map(function(p) { return p.charge; });
        var atoms = geometry.atoms;
        var n = atoms.length;

        var totalMass = 0, cx = 0, cy = 0, cz = 0;
        atoms.forEach(function(a) {
            var entry = MolecularStructure.STANDARD_ATOMIC_WEIGHT[a.symbol];
            var m = entry ? entry[0] : 0;
            totalMass += m; cx += m * a.x; cy += m * a.y; cz += m * a.z;
        });
        if (totalMass > 0) { cx /= totalMass; cy /= totalMass; cz /= totalMass; }

        var Qxx = 0, Qyy = 0, Qzz = 0, Qxy = 0, Qxz = 0, Qyz = 0;
        for (var i = 0; i < n; i++) {
            var q = charges[i];
            var x = atoms[i].x - cx, y = atoms[i].y - cy, z = atoms[i].z - cz;
            var r2 = x * x + y * y + z * z;
            Qxx += q * (3 * x * x - r2); Qyy += q * (3 * y * y - r2); Qzz += q * (3 * z * z - r2);
            Qxy += q * 3 * x * y; Qxz += q * 3 * x * z; Qyz += q * 3 * y * z;
        }
        var round3 = function(v) { return Math.round(v * EEV_TO_DEBYE * 1000) / 1000; };
        return {
            applicable: true,
            method: 'Same multipole expansion as the dipole moment (MolecularElectrostatics.js), one term further: Q_ab = sum(q_i*(3*r_ia*r_ib - r_i^2*delta_ab)), same PEOE partial charges and idealized geometry, computed about the center of MASS. Traceless by construction (Qxx+Qyy+Qzz=0) - reported traceCheck confirms this numerically rather than assuming it. Inherits the same PEOE magnitude-accuracy caveat the dipole moment already carries.',
            originConvention: 'center of mass',
            tensorBuckingham: { Qxx: round3(Qxx), Qyy: round3(Qyy), Qzz: round3(Qzz), Qxy: round3(Qxy), Qxz: round3(Qxz), Qyz: round3(Qyz) },
            traceCheck: Math.round((Qxx + Qyy + Qzz) * EEV_TO_DEBYE * 1e6) / 1e6,
            version: '0.1'
        };
    }

    // ─── Molar refractivity: Lorentz-Lorenz relates it DIRECTLY to the
    // mean polarizability this project already computes - R_molar =
    // (4*pi/3)*N_A*alpha, no new physical model, and no density/index
    // measurement needed (unlike inverting for a real refractive index,
    // which DOES need a real density this project doesn't have - stated
    // as a scope limit, not silently worked around).
    function analyzeMolarRefractivity(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var pol = options.polarizabilityResult || MolecularPolarizability.analyze(molecule, Object.assign({ structureResult: structure }, options));
        if (pol.error) return pol;
        var alphaAngstrom3 = pol.polarizabilityAngstrom3;
        var alphaCm3 = alphaAngstrom3 * 1e-24;
        var molarRefractivityCm3PerMol = (4 * Math.PI / 3) * AVOGADRO * alphaCm3;
        return {
            method: 'Lorentz-Lorenz relation R_molar = (4*pi/3)*N_A*alpha, applied directly to this project\'s own mean polarizability (MolecularPolarizability.js) - no new citation needed, both quantities describe the same polarizability, just in different conventional units. Real refractive index (n) is NOT computed here - that needs the molecule\'s actual density, which this project has no source for (out of scope, not guessed).',
            molarRefractivityCm3PerMol: Math.round(molarRefractivityCm3PerMol * 1000) / 1000,
            fromPolarizabilityAngstrom3: alphaAngstrom3,
            version: '0.1'
        };
    }

    // ─── Ring-membership for every bond (not just the geometry module's
    // own ring-CLOSURE bond) - a real, standard graph algorithm: build
    // any spanning tree/forest, every non-tree edge is a real ring
    // closure, and every TREE edge on the path between that edge's two
    // endpoints is therefore also part of that same ring.
    function ringBondSet(nAtoms, bonds) {
        var adj = [];
        for (var i = 0; i < nAtoms; i++) adj.push([]);
        bonds.forEach(function(b, idx) { adj[b[0]].push([b[1], idx]); adj[b[1]].push([b[0], idx]); });
        var parent = new Array(nAtoms).fill(-1);
        var parentEdge = new Array(nAtoms).fill(-1);
        var visited = new Array(nAtoms).fill(false);
        var treeEdge = new Array(bonds.length).fill(false);
        function bfs(start) {
            visited[start] = true;
            var queue = [start];
            while (queue.length) {
                var u = queue.shift();
                adj[u].forEach(function(pair) {
                    var v = pair[0], idx = pair[1];
                    if (!visited[v]) { visited[v] = true; parent[v] = u; parentEdge[v] = idx; treeEdge[idx] = true; queue.push(v); }
                });
            }
        }
        for (var s = 0; s < nAtoms; s++) if (!visited[s]) bfs(s);

        var inRing = new Array(bonds.length).fill(false);
        bonds.forEach(function(b, idx) {
            if (treeEdge[idx]) return; // handled below via the path it closes
        });
        function pathToRoot(u) {
            var path = [];
            while (parent[u] !== -1) { path.push(u); u = parent[u]; }
            path.push(u);
            return path;
        }
        bonds.forEach(function(b, idx) {
            if (treeEdge[idx]) return;
            inRing[idx] = true;
            var pu = pathToRoot(b[0]), pv = pathToRoot(b[1]);
            var setV = {}; pv.forEach(function(x) { setV[x] = true; });
            var lca = pu.filter(function(x) { return setV[x]; })[0]; // first common ancestor walking up from b[0]
            var u = b[0];
            while (u !== lca) { inRing[parentEdge[u]] = true; u = parent[u]; }
            var v = b[1];
            while (v !== lca) { inRing[parentEdge[v]] = true; v = parent[v]; }
        });
        return inRing;
    }

    // ─── Lipinski/Veber druglikeness counts ───
    // HBD: number of N/O atoms carrying >=1 H (Lipinski's original
    // "number of OH and NH groups" convention - counts the heavy atom
    // once, not each H).
    // HBA: simple Lipinski convention - every N and O atom counts (a
    // documented simplification vs refined acceptor rules that exclude
    // e.g. pyrrole-type N or an amide N - stated plainly, not silently
    // "improved" into a different, unlabeled definition).
    // Rotatable bonds: Veber's definition - a non-ring single bond
    // between two heavy atoms that are each bonded to at least one OTHER
    // heavy atom (excludes terminal-group bonds, e.g. a bond to a
    // terminal -CH3/-F, which contribute no real conformational freedom).
    function analyzeDruglikeness(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;

        var hbd = 0, hba = 0;
        structure.perAtom.forEach(function(pa) {
            if (pa.error) return;
            if (pa.symbol === 'N' || pa.symbol === 'O') {
                hba++;
                if (pa.implicitH > 0) hbd++;
            }
        });

        var heavyDegree = structure.perAtom.map(function(pa) { return pa.error ? 0 : pa.neighborCount; });
        var inRing = ringBondSet(molecule.atoms.length, molecule.bonds);
        var rotatable = 0;
        molecule.bonds.forEach(function(b, idx) {
            if (b[2] !== 1) return; // single bonds only
            if (inRing[idx]) return; // not a ring bond
            if (heavyDegree[b[0]] < 2 || heavyDegree[b[1]] < 2) return; // not a terminal-group bond
            rotatable++;
        });

        return {
            method: 'Lipinski (HBD = N/O atoms with >=1 H; HBA = every N and O atom, the simple original convention, not a refined acceptor rule) + Veber (rotatable bonds = non-ring single bonds between two non-terminal heavy atoms) druglikeness counts - pure graph-theoretic counting over this project\'s own already-computed connectivity/implicit-H data, no new citation beyond the two named conventions.',
            hydrogenBondDonors: hbd,
            hydrogenBondAcceptors: hba,
            rotatableBonds: rotatable,
            version: '0.1'
        };
    }

    return {
        analyzeQuadrupole: analyzeQuadrupole,
        analyzeMolarRefractivity: analyzeMolarRefractivity,
        analyzeDruglikeness: analyzeDruglikeness,
        _ringBondSet: ringBondSet,
        version: '0.1'
    };
}));
