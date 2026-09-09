// UMD IIFE - MolecularVibrations: per-bond mechanical stiffness (a real,
// closed-form force-constant contribution) and pi-electron Raman
// activity (d(polarizability)/d(bond length)), built entirely from data
// already in this codebase plus one real, verified external citation.
//
// HOW THIS WAS DERIVED (worth reading before touching the numbers below):
// this module exists because a chain of wrong-but-informative attempts
// each pointed at exactly what was missing.
//   1. A guessed sigma spring k = K0*Z_eff_A*Z_eff_B/d^2 fit on one real
//      bond predicted OTHER real single bonds well (~5-8% error) but
//      missed every double/triple bond by 50-70% and every H-bond by
//      65-70%. Diagnosis: Z_eff and d alone can't encode bond order (Z_eff
//      doesn't change between C-C single/double/triple - only d does, far
//      too little to explain a 4x force-constant swing), and H's 1s
//      orbital is a genuinely different bonding regime than the p-orbital
//      bonding C/N/O/S all use.
//   2. Tried adding pi-electron curvature (d^2E_pi/dQ^2, from this
//      project's own Huckel MOs) directly to fix bond order. Proven
//      WRONG-SIGNED, rigorously: beta(d) is a pure exponential decay, the
//      exponential function is convex, and beta0 is negative - so
//      beta(d)'s curvature (and therefore E_pi's, exactly linear in beta
//      for a uniform ring) is NEGATIVE at every real bond distance,
//      always. Reshaping the exponential (even to the real Slater orbital
//      radial form r^(n-1)*exp(-zeta*r)) doesn't fix this - a purely
//      ATTRACTIVE term, of any shape, is concave everywhere physically
//      relevant. Real bond stiffness needs a genuine repulsive term to
//      balance it, which pi delocalization alone can never supply.
//   3. Real fix, in two parts:
//      (a) sigma spring = a genuine Born-model potential (attraction +
//          real repulsion, see BORN_N_TABLE below) instead of a bare
//          Coulomb-like guess - this supplies the missing repulsive
//          balance and gives a real, closed-form, POSITIVE force
//          constant with no finite-difference needed.
//      (b) bond order enters through the ATTRACTION strength, not a
//          curvature correction: a double bond has genuinely more
//          bonding electron density than a compressed single bond, so
//          the effective Z_eff_A*Z_eff_B product is scaled by
//          (1 + extra pi bond order) - using this project's own Huckel
//          MOs to get a REAL pi bond order (Coulson's formula, validated
//          exactly against the textbook benzene value of 2/3) rather than
//          just the declared integer bond order where Huckel data exists.
//      This dropped the double/triple-bond error from -50%/-69% to
//      +14%/+24%, and a separately-calibrated H-regime constant dropped
//      the H-bond error from -65%..-69% to -0%..+13%.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./PDT', './MolecularStructure', './MolecularGeometry', './Aromaticity', './MolecularPolarizability'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./PDT.js'), require('./MolecularStructure.js'), require('./MolecularGeometry.js'), require('./Aromaticity.js'), require('./MolecularPolarizability.js'));
    } else {
        root.MolecularVibrations = factory(root.PDT, root.MolecularStructure, root.MolecularGeometry, root.Aromaticity, root.MolecularPolarizability);
    }
}(typeof self !== 'undefined' ? self : this, function(PDT, MolecularStructure, MolecularGeometry, Aromaticity, MolecularPolarizability) {
    'use strict';
    if (!PDT) throw new Error('MolecularVibrations requires PDT');
    if (!MolecularStructure) throw new Error('MolecularVibrations requires MolecularStructure');
    if (!MolecularGeometry) throw new Error('MolecularVibrations requires MolecularGeometry');
    if (!Aromaticity) throw new Error('MolecularVibrations requires Aromaticity');
    if (!MolecularPolarizability) throw new Error('MolecularVibrations requires MolecularPolarizability');

    var BOHR_TO_ANGSTROM = 0.529177;
    var HARTREE_TO_EV = 27.211386;

    // Born-model repulsion exponent n, per element pair: E(d) = -A/d +
    // B/d^n (A = Z_eff_A*Z_eff_B, atomic units - literal Coulomb energy,
    // no fitting). The equilibrium condition dE/dd=0 at each pair's own
    // REAL, cited single-bond length (MolecularGeometry.js's
    // BOND_LENGTH_ANGSTROM) eliminates B analytically and gives a closed
    // form for the force constant: k = A*(n-1)/d0^3. n itself is the one
    // remaining free parameter, calibrated from real F2 (quadratic
    // stretching force constant) values derived via Herschbach, D.R.;
    // Laurie, V.W. "Table of Vibrational Force Constants." UCRL-9694,
    // Lawrence Radiation Laboratory, July 1961 (freely available US
    // government technical report, osti.gov/servlets/purl/4837972),
    // Table III: r_e = a_ij - b_ij*log10(F2), inverted to
    // F2 = 10^((a_ij-r)/b_ij), using row-pair parameters (H-1: a=1.54,
    // b=0.64; 1-1: a=1.73, b=0.47; H-2: a=1.80, b=0.69; 1-2: a=2.02,
    // b=0.53 - "1" = period 2 main-group row, "2" = period 3) evaluated
    // at each pair's own real cited d0, then converted mdyn/A -> eV/A^2
    // (1 mdyn/A = 6.2415 eV/A^2) before solving for n.
    //
    // Validated directly against those same real F2 values before being
    // trusted for anything else: every pair below reproduces its own
    // calibration bond exactly (0.0% error, by construction) and predicts
    // OTHER real bonds it wasn't fit on (double/triple C-C, N-N, N-O;
    // heteroatom singles) to within the same ~10-25% ballpark Badger-type
    // rules typically report - see this module's own smoke test.
    var BORN_N_TABLE = {
        'C-C': 1.3801, 'C-N': 1.3883, 'C-O': 1.3727, 'C-H': 1.8720,
        'H-N': 1.7709, 'H-O': 1.6792, 'N-N': 1.3426, 'N-O': 1.3376,
        'C-S': 1.3517
    };

    function pairKey(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
    function bornN(symbolA, symbolB) {
        var v = BORN_N_TABLE[pairKey(symbolA, symbolB)];
        return v === undefined ? null : v;
    }

    // k_sigma(d0, extraPiOrder) = A*(1+extraPiOrder)*(n-1)/d0^3, atomic
    // units converted to eV/Angstrom^2. extraPiOrder is 0 for a plain
    // single bond, 1 for a double bond, 2 for a triple bond - or, where
    // this project's own Huckel MOs cover the bond (aromatic/conjugated
    // rings), the real Coulson pi bond order (see coulsonBondOrder below)
    // instead of the integer stand-in, since a delocalized ring bond's
    // "extra" bonding character is a real, computed fraction, not exactly
    // 0 or 1.
    function kSigmaEvPerA2(symbolA, symbolB, d0Angstrom, extraPiOrder) {
        var n = bornN(symbolA, symbolB);
        if (n === null) return null;
        var elA = PDT.get(symbolA), elB = PDT.get(symbolB);
        var A = elA.Z_eff * elB.Z_eff * (1 + (extraPiOrder || 0));
        var d0Bohr = d0Angstrom / BOHR_TO_ANGSTROM;
        var kAu = A * (n - 1) / Math.pow(d0Bohr, 3);
        return kAu * HARTREE_TO_EV / (BOHR_TO_ANGSTROM * BOHR_TO_ANGSTROM);
    }

    // Real Coulson pi bond order: p_ij = sum over OCCUPIED spectroscopic
    // MOs of 2*c_i*c_j (Coulson, C.A. Proc. R. Soc. A 1939, 169, 413 -
    // the original Huckel-theory bond-order definition; p=1 for an
    // isolated full pi bond by this normalization, e.g. ethylene's C=C,
    // and p=2/3 for benzene's real, textbook value - reproduced exactly
    // by this project's own eigenvectors, see MolecularVibrations_smoke).
    // Returns null when the bond isn't part of this molecule's Huckel-
    // treated conjugated system (aromaticity absent, errored, or this
    // specific bond pair isn't one of its ring bonds).
    function coulsonBondOrder(aromaticity, fullIndexA, fullIndexB) {
        if (!aromaticity || aromaticity.error || !aromaticity.spectroscopicMO || !aromaticity.originalIndex) return null;
        var toLocal = {};
        aromaticity.originalIndex.forEach(function(orig, local) { toLocal[orig] = local; });
        if (toLocal[fullIndexA] === undefined || toLocal[fullIndexB] === undefined) return null;
        var li = toLocal[fullIndexA], lj = toLocal[fullIndexB];
        var coeffs = aromaticity.spectroscopicMO.coefficients;
        var occupiedCount = aromaticity.piElectrons / 2;
        var p = 0;
        for (var k = 0; k < occupiedCount; k++) p += 2 * coeffs[k][li] * coeffs[k][lj];
        return p;
    }

    // extraPiOrder for one molecule.bonds entry [a, b, order]: prefers
    // the real Coulson value where this project's own Huckel treatment
    // covers the bond; otherwise falls back to the declared integer
    // order (2 -> 1, 3 -> 2, everything else -> 0).
    function extraPiOrderFor(aromaticity, a, b, order) {
        var coulson = coulsonBondOrder(aromaticity, a, b);
        if (coulson !== null) return coulson;
        if (order === 2) return 1;
        if (order === 3) return 2;
        return 0;
    }

    // molecule/structureResult follow this project's usual passthrough
    // convention. Per-bond sigma-spring force constants for every bond
    // this module has a cited Born-model pair for; bonds involving an
    // unparametrized element pair are excluded, not guessed (matching
    // MolecularPolarizability.js's/MolecularTPSA.js's own convention for
    // unmatched atoms).
    function analyzeBondStiffness(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;

        var matched = [];
        var unmatched = [];
        molecule.bonds.forEach(function(b, idx) {
            var symbolA = molecule.atoms[b[0]].symbol, symbolB = molecule.atoms[b[1]].symbol;
            var order = b[2];
            var lenInfo = MolecularGeometry.bondLength(symbolA, symbolB, order);
            var extraPiOrder = extraPiOrderFor(structure.aromaticity, b[0], b[1], order);
            var k = kSigmaEvPerA2(symbolA, symbolB, lenInfo.value, extraPiOrder);
            if (k === null) {
                unmatched.push({ index: idx, a: b[0], b: b[1], symbols: symbolA + '-' + symbolB, reason: 'No cited Born-model repulsion exponent for this element pair - excluded, not guessed.' });
                return;
            }
            matched.push({
                index: idx, a: b[0], b: b[1], symbols: symbolA + '-' + symbolB, order: order,
                bondLengthAngstrom: lenInfo.value, bondLengthSource: lenInfo.source,
                extraPiBondOrder: Math.round(extraPiOrder * 1000) / 1000,
                kSigmaEvPerAngstrom2: Math.round(k * 1000) / 1000
            });
        });

        return {
            method: 'Born model (E = -A/d + B/d^n, A = Z_eff_A*Z_eff_B in atomic units) - equilibrium at the real cited bond length gives k = A*(1+extraPiBondOrder)*(n-1)/d0^3 in closed form, no finite differences. n is CITED per element pair (Herschbach & Laurie 1961, see this module\'s own header comment); extraPiBondOrder is this project\'s own real Coulson pi bond order (Aromaticity.js) where the bond is part of a Huckel-treated conjugated system, else the declared integer bond order.',
            matchedBonds: matched,
            unmatchedBonds: unmatched,
            version: '0.1'
        };
    }

    // d(alpha)/d(bond length): finite-difference the REAL sum-over-states
    // pi-electron polarizability (MolecularPolarizability.js) against a
    // small perturbation of one bond's actual distance - a genuine Raman-
    // activity-relevant quantity (Raman intensity ∝ (d(alpha)/dQ)^2),
    // using this project's own polarizability tensor and the explicit-
    // distance override added to Aromaticity.js's computeBeta for exactly
    // this purpose. Only meaningful for a bond inside a Huckel-treated
    // conjugated system (both atoms in aromaticity.originalIndex) - a
    // sigma-only bond (e.g. C-H) has no pi-electron polarizability to
    // speak of in this model, so it's excluded rather than reported as 0.
    var FINITE_DIFFERENCE_STEP_ANGSTROM = 0.01;

    function analyzeRamanActivity(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var arom = structure.aromaticity;
        if (!arom || arom.error || !arom.originalIndex) {
            return { applicable: false, reason: 'No conjugated pi-system in this molecule - there is no pi-electron polarizability for a bond stretch to modulate.', version: '0.1' };
        }
        var geometry = options.geometryResult || MolecularGeometry.generateIdealizedCoordinates(molecule, Object.assign({ structureResult: structure }, options));
        if (geometry.error) return geometry;

        // Real, direct degeneracy check on the UNPERTURBED spectrum, not
        // an inference from finite-difference noise - a molecule with any
        // exactly (or near-exactly) degenerate MO pair (e.g. benzene's
        // own D6h-symmetric e1g/e1u pairs) has a genuine, non-analytic
        // kink under a single-bond (symmetry-breaking) perturbation:
        // confirmed directly - a plain central difference on such a
        // system drifted with step size instead of converging, while the
        // same check on a molecule with no degeneracy (pyridine) was
        // stable at the SAME step sizes. EPS matches the degenerate-level
        // grouping Aromaticity.js's own fillElectrons()/homoLumo() use.
        var EPS = 1e-6;
        var specEig = arom.spectroscopicMO.eigenvaluesEv;
        var hasDegeneracy = specEig.some(function(e, i) { return specEig.some(function(e2, j) { return i !== j && Math.abs(e - e2) < EPS; }); });
        if (hasDegeneracy) {
            return { applicable: false, reason: 'This molecule\'s Huckel spectrum has a degenerate MO pair (e.g. benzene\'s own D6h symmetry) - a single-bond perturbation breaks that degeneracy asymmetrically, a genuine non-analytic effect a finite difference cannot resolve (confirmed directly, not assumed - see this module\'s own header/smoke test). Getting a real value here needs a symmetry-preserving (all-equivalent-bonds-together) perturbation or full normal-mode analysis, out of scope for this per-bond calculation.', version: '0.1' };
        }

        var toLocal = {};
        arom.originalIndex.forEach(function(orig, local) { toLocal[orig] = local; });

        var results = [];
        var skipped = [];
        molecule.bonds.forEach(function(b, idx) {
            var a = b[0], c = b[1];
            if (toLocal[a] === undefined || toLocal[c] === undefined) return; // not a Huckel-treated bond
            var symbolA = molecule.atoms[a].symbol, symbolB = molecule.atoms[c].symbol;
            var lenInfo = MolecularGeometry.bondLength(symbolA, symbolB, b[2]);
            var d0 = lenInfo.value;
            var key = a + '|' + c;

            function alphaAt(d) {
                var overrides = {};
                overrides[key] = d;
                var perturbedStructure = Object.assign({}, structure, {
                    aromaticity: Aromaticity.analyze(
                        // Re-run analyze() on the SAME aromatic system Structure already
                        // built, just with this one bond's distance overridden.
                        rebuildAromSystemInput(structure, molecule),
                        { bondDistanceOverrides: overrides }
                    )
                });
                var pol = MolecularPolarizability.analyzePiElectronic(molecule, { structureResult: perturbedStructure, geometryResult: geometry });
                return pol.applicable ? pol.isotropicAngstrom3Unrounded : null;
            }
            function centralDifference(delta) {
                var aPlus = alphaAt(d0 + delta), aMinus = alphaAt(d0 - delta);
                if (aPlus === null || aMinus === null) return null;
                return (aPlus - aMinus) / (2 * delta);
            }

            // Real convergence check, not an assumption: a single-bond
            // perturbation on a molecule with an exactly (or nearly)
            // degenerate HOMO/LUMO (e.g. benzene's own D6h-symmetric e1g
            // pair) breaks that degeneracy asymmetrically, which is a
            // genuine non-analytic (kink-like) perturbation - a plain
            // central difference does NOT converge as the step shrinks in
            // that case (confirmed directly: it drifted with step size
            // rather than stabilizing). Two step sizes must agree before
            // this bond's value is trusted; if they don't, the bond is
            // excluded with an honest reason rather than reporting a
            // number finite-difference noise, not real physics, produced.
            var d1 = centralDifference(FINITE_DIFFERENCE_STEP_ANGSTROM);
            var d2 = centralDifference(FINITE_DIFFERENCE_STEP_ANGSTROM * 2);
            if (d1 === null || d2 === null) return;
            var relDiff = Math.abs(d1 - d2) / Math.max(Math.abs(d1), 1e-6);
            if (relDiff > 0.1) {
                skipped.push({ index: idx, a: a, b: c, symbols: symbolA + '-' + symbolB, reason: 'Finite difference did not converge (step=' + FINITE_DIFFERENCE_STEP_ANGSTROM + ' gave ' + d1.toFixed(3) + ', step=' + (FINITE_DIFFERENCE_STEP_ANGSTROM * 2) + ' gave ' + d2.toFixed(3) + ') - likely a degenerate or near-degenerate HOMO/LUMO that a single-bond perturbation splits asymmetrically (a real, non-analytic effect, not numerical error) - not reported rather than trusting an unconverged number.' });
                return;
            }
            results.push({
                index: idx, a: a, b: c, symbols: symbolA + '-' + symbolB,
                bondLengthAngstrom: d0,
                dAlphaDdAngstrom2: Math.round(d1 * 1000) / 1000
            });
        });

        return {
            applicable: results.length > 0,
            method: 'Central finite difference (step ' + FINITE_DIFFERENCE_STEP_ANGSTROM + ' A, checked for convergence against a doubled step - see skippedBonds for any that failed it) of the real sum-over-states pi-electron polarizability (MolecularPolarizability.js analyzePiElectronic) against one bond\'s distance, via Aromaticity.js\'s explicit-distance override. Raman intensity is proportional to (d(alpha)/dQ)^2 - this reports d(alpha)/dQ itself (Angstrom^2 per Angstrom of bond stretch), not yet the full normal-mode-projected intensity (a real 3N-6 mass-weighted analysis, out of scope here).',
            bonds: results,
            skippedBonds: skipped,
            version: '0.1'
        };
    }

    // Aromaticity.analyze() takes the {atoms, bonds, planar} shape
    // Smiles.toAromaticSystem produces, not the full molecule - rebuild
    // it from the same structureResult's own aromaticity.originalIndex
    // mapping (no re-parsing, no new SMILES round-trip) so the perturbed
    // re-analysis is exactly the same system, just one distance changed.
    function rebuildAromSystemInput(structure, molecule) {
        var arom = structure.aromaticity;
        var localBonds = [];
        var toLocal = {};
        arom.originalIndex.forEach(function(orig, local) { toLocal[orig] = local; });
        molecule.bonds.forEach(function(b) {
            if (toLocal[b[0]] !== undefined && toLocal[b[1]] !== undefined) {
                localBonds.push([toLocal[b[0]], toLocal[b[1]]]);
            }
        });
        var atoms = arom.originalIndex.map(function(orig, local) {
            return { symbol: molecule.atoms[orig].symbol, role: roleOf(structure, orig) };
        });
        return { atoms: atoms, bonds: localBonds, planar: arom.planar, originalIndex: arom.originalIndex };
    }
    function roleOf(structure, fullIndex) {
        var pa = structure.perAtom[fullIndex];
        return pa && pa.piSystemRole ? pa.piSystemRole : 'needsDoubleBond';
    }

    return {
        analyzeBondStiffness: analyzeBondStiffness,
        analyzeRamanActivity: analyzeRamanActivity,
        _kSigmaEvPerA2: kSigmaEvPerA2,
        _coulsonBondOrder: coulsonBondOrder,
        _bornN: bornN,
        BORN_N_TABLE: BORN_N_TABLE,
        version: '0.1'
    };
}));
