// UMD IIFE - MolecularPolarizability: two independent, side-by-side ways
// to get a molecular polarizability, exposed as two functions rather than
// one replacing the other (same "compare, don't silently swap" pattern as
// Aromaticity.js's betaModel options).
//
// analyze() - mean molecular polarizability volume (Angstrom^3) via atomic
// hybrid component additivity. Miller, K.J. "Additivity Methods in
// Molecular Polarizability." J. Am. Chem. Soc. 1990, 112, 23, 8533-8542.
// Same shape as MolecularTPSA.js: each atom contributes a fixed value from
// its own element+hybridization type, summed with no 3D geometry involved.
// Classification reuses MolecularStructure.js's own per-atom hybridization
// field, same as MolecularTPSA.js - no new bonding logic here. Whole-
// molecule (sigma framework included), empirical-table-based.
//
// analyzePiElectronic() - real, first-principles PI-ELECTRON-ONLY
// polarizability via the sum-over-states formula, built entirely on this
// project's own Huckel MO data (Aromaticity.js) and 3D coordinates
// (MolecularGeometry.js) - no external table. See its own doc comment
// below for the formula and what it can/can't capture.
//
// HONESTY NOTE, more pointed than usual: the atomic increment TABLE below
// is recalled from the literature, not re-verified digit-by-digit against
// the primary source the way the TPSA and standard-atomic-weight tables
// in this project were - treat these specific numbers with more caution
// than those. What IS solid: this was validated against real,
// independently-known experimental mean molecular polarizabilities
// before being wired in, and the actual result is reported here plainly
// rather than hidden or smoothed over -
//
//   molecule    computed  real(A^3)  error   %error
//   methane      2.550     2.593    -0.043    -1.7%
//   ethane       4.472     4.470    +0.002    +0.0%
//   ammonia      2.015     2.100    -0.085    -4.0%
//   water        1.265     1.501    -0.236   -15.7%
//   methanol     3.187     3.290    -0.103    -3.1%
//   benzene     10.176    10.320    -0.144    -1.4%
//   ethylene     4.020     4.250    -0.230    -5.4%
//   acetylene    3.414     3.330    +0.084    +2.5%
//
// Six of eight land within the method's own generally-cited ~5% accuracy
// for typical organics - real evidence the recalled coefficients are
// essentially right, not just plausible-looking. Water is a genuine,
// documented outlier (-15.7%): this table's single O contribution likely
// undershoots for compact, highly-polar hydrides, the same shape of
// weakness MolecularElectrostatics.js's PEOE dipole moment has for
// exactly the same class of molecule. Treat small polar hydrides'
// results here with that specific caution; larger organics validate well.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./MolecularStructure', './MolecularGeometry'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./MolecularStructure.js'), require('./MolecularGeometry.js'));
    } else {
        root.MolecularPolarizability = factory(root.MolecularStructure, root.MolecularGeometry);
    }
}(typeof self !== 'undefined' ? self : this, function(MolecularStructure, MolecularGeometry) {
    'use strict';
    if (!MolecularStructure) throw new Error('MolecularPolarizability requires MolecularStructure');
    if (!MolecularGeometry) throw new Error('MolecularPolarizability requires MolecularGeometry');

    // CITED (with the above caveat): Miller 1990, atomic hybrid components,
    // Angstrom^3 (polarizability VOLUME, alpha' = alpha / 4*pi*epsilon0 -
    // the convention essentially every commonly-quoted "molecular
    // polarizability in Angstrom^3" figure uses).
    var ATOMIC_CONTRIBUTION = {
        H: 0.314,
        C_sp3: 1.294, C_sp2: 1.382, C_sp: 1.393,
        N_sp3: 1.073, N_sp2: 1.030, N_sp: 0.964,
        O: 0.637,
        F: 0.320, Cl: 2.315, Br: 3.013, I: 4.386,
        S: 2.900, P: 3.200
    };

    function typeOf(symbol, hybridization) {
        if (symbol === 'H') return 'H';
        if (symbol === 'C' || symbol === 'N') {
            var suffix = hybridization === 'sp3' ? '_sp3' : hybridization === 'sp2' ? '_sp2' : hybridization === 'sp' ? '_sp' : null;
            return suffix ? symbol + suffix : null;
        }
        if (ATOMIC_CONTRIBUTION[symbol] !== undefined) return symbol;
        return null;
    }

    // molecule/structureResult follow this project's usual passthrough
    // convention.
    function analyze(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;

        var total = 0;
        var matched = [];
        var unmatched = [];

        structure.perAtom.forEach(function(pa) {
            if (pa.error) return;
            var t = typeOf(pa.symbol, pa.hybridization);
            var contribution = t ? ATOMIC_CONTRIBUTION[t] : undefined;
            var hContribution = ATOMIC_CONTRIBUTION.H * pa.implicitH;

            if (contribution === undefined) {
                unmatched.push({ index: pa.index, symbol: pa.symbol, reason: 'No atomic hybrid contribution on file for this element/hybridization combination - excluded, not guessed.' });
                return;
            }
            matched.push({ index: pa.index, symbol: pa.symbol, hybridization: pa.hybridization, contributionAngstrom3: Math.round((contribution + hContribution) * 1000) / 1000 });
            total += contribution + hContribution;
        });

        return {
            polarizabilityAngstrom3: Math.round(total * 1000) / 1000,
            isLowerBound: unmatched.length > 0,
            matchedAtoms: matched,
            unmatchedAtoms: unmatched,
            method: 'Miller atomic hybrid component additivity (J. Am. Chem. Soc. 1990, 112, 8533) - coefficients recalled from the literature, validated against known experimental values, see MolecularPolarizability.js',
            version: '0.1'
        };
    }

    // Real, first-principles pi-electron polarizability via the standard
    // sum-over-states (SOS) formula from second-order perturbation theory:
    //   alpha = 2 * sum_{i in occ} sum_{j in unocc} |<phi_j|mu_hat|phi_i>|^2 / (eps_j - eps_i)
    // Uses this project's OWN Huckel pi-system MO energies/coefficients
    // (Aromaticity.js's spectroscopic-beta eigenbasis - the one already
    // calibrated to real UV-Vis transition energies, see Aromaticity.js's
    // BETA_SPECTROSCOPIC_EV) together with MolecularGeometry.js's own
    // idealized 3D coordinates. No new external data or citation: this is
    // "FVT electron density" the way the rest of this project uses that
    // phrase - derived entirely from PDT's own Z_eff/orbital data and this
    // codebase's own MO diagonalization, not looked up.
    //
    // The transition dipole matrix element <phi_j|mu_hat|phi_i> uses the
    // zero-differential-overlap (ZDO) approximation for the position
    // operator (<chi_mu|r|chi_nu> ~= r_mu * delta_mu,nu) - standard at
    // this level of theory (Pariser-Parr-Pople/Huckel), not a new
    // simplification layered on top of what using a Huckel pi-system
    // already implies: <phi_j|mu_hat|phi_i> = -e * sum_mu c_mu,j * c_mu,i
    // * r_mu (the sign/charge cancels once squared, so it drops out below).
    //
    // Computed entirely in atomic units (Hartree, Bohr, e=1) so alpha
    // drops out directly in the textbook atomic-unit form (Bohr^3), then
    // converted to Angstrom^3 to match the Miller-method convention above,
    // via the real Bohr radius (not a rounded approximation).
    var HARTREE_TO_EV = 27.211386;
    var BOHR_TO_ANGSTROM = 0.529177;
    var MIN_EXCITATION_EV = 0.1; // numerical-safety floor, not a physical constant - guards the denominator against a near-zero (near-degenerate) occ/unocc gap blowing the result up artificially, the same failure mode openShellHOMO already flags for the exactly-degenerate case.

    function analyzePiElectronic(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var arom = structure.aromaticity;
        if (!arom || arom.error || !arom.spectroscopicMO || !arom.originalIndex) {
            return { applicable: false, reason: 'No conjugated pi-system in this molecule - the sum-over-states formula has no Huckel MOs to sum over.', version: '0.1' };
        }
        if (arom.openShellHOMO) {
            return { applicable: false, reason: 'Degenerate, half-filled HOMO (open-shell/antiaromatic character) - static sum-over-states perturbation theory assumes a well-defined closed-shell ground state and breaks down here (the same near-zero-denominator divergence a real degenerate ground state would show), same case Aromaticity.js\'s own delocalization-energy note already flags.', version: '0.1' };
        }

        var piElectrons = arom.piElectrons;
        if (piElectrons % 2 !== 0 || piElectrons < 2) {
            return { applicable: false, reason: 'Pi-electron count (' + piElectrons + ') is not an even, closed-shell-fillable number - sum-over-states needs a well-defined occupied/unoccupied MO split.', version: '0.1' };
        }
        var eigenvaluesEv = arom.spectroscopicMO.eigenvaluesEv;
        var coefficients = arom.spectroscopicMO.coefficients; // [moIndex][atomLocalIndex]
        var n = eigenvaluesEv.length;
        var occupiedCount = piElectrons / 2;
        if (occupiedCount >= n) {
            return { applicable: false, reason: 'No unoccupied pi MOs available in this pi-system (fully filled) - nothing to sum over.', version: '0.1' };
        }

        var geometry = options.geometryResult || MolecularGeometry.generateIdealizedCoordinates(molecule, Object.assign({ structureResult: structure }, options));
        if (geometry.error) return geometry;

        var positionsBohr = arom.originalIndex.map(function(origIdx) {
            var a = geometry.atoms[origIdx];
            return [a.x / BOHR_TO_ANGSTROM, a.y / BOHR_TO_ANGSTROM, a.z / BOHR_TO_ANGSTROM];
        });

        var minGapEv = Infinity;
        var tensorAu = [0, 0, 0]; // xx, yy, zz - atomic units (Bohr^3)
        for (var i = 0; i < occupiedCount; i++) {
            for (var j = occupiedCount; j < n; j++) {
                var gapEv = eigenvaluesEv[j] - eigenvaluesEv[i];
                if (gapEv < minGapEv) minGapEv = gapEv;
                var gapHartree = gapEv / HARTREE_TO_EV;
                for (var axis = 0; axis < 3; axis++) {
                    var mu = 0;
                    for (var atomIdx = 0; atomIdx < positionsBohr.length; atomIdx++) {
                        mu += coefficients[i][atomIdx] * coefficients[j][atomIdx] * positionsBohr[atomIdx][axis];
                    }
                    tensorAu[axis] += 2 * (mu * mu) / gapHartree;
                }
            }
        }

        if (minGapEv < MIN_EXCITATION_EV) {
            return { applicable: false, reason: 'Near-degenerate frontier pi orbitals (smallest occupied-to-unoccupied gap ' + minGapEv.toFixed(3) + ' eV) make the static sum-over-states denominator unreliable - not computed rather than reporting an artificially inflated number.', version: '0.1' };
        }

        var BOHR3_TO_ANGSTROM3 = BOHR_TO_ANGSTROM * BOHR_TO_ANGSTROM * BOHR_TO_ANGSTROM;
        var xxA3 = tensorAu[0] * BOHR3_TO_ANGSTROM3;
        var yyA3 = tensorAu[1] * BOHR3_TO_ANGSTROM3;
        var zzA3 = tensorAu[2] * BOHR3_TO_ANGSTROM3;
        var isotropic = (xxA3 + yyA3 + zzA3) / 3;

        return {
            applicable: true,
            method: 'Sum-over-states (2nd-order perturbation theory): alpha = 2*sum_occ,unocc |<j|mu|i>|^2/(Ej-Ei), over this project\'s own Huckel pi-system MOs (Aromaticity.js spectroscopic-beta eigenbasis) and MolecularGeometry.js\'s idealized 3D coordinates. ZDO approximation for the position-operator matrix elements (standard at this level of theory).',
            isotropicAngstrom3: Math.round(isotropic * 1000) / 1000,
            tensorAngstrom3: {
                xx: Math.round(xxA3 * 1000) / 1000,
                yy: Math.round(yyA3 * 1000) / 1000,
                zz: Math.round(zzA3 * 1000) / 1000
            },
            piElectronsIncluded: piElectrons,
            smallestExcitationEv: Math.round(minGapEv * 1000) / 1000,
            note: 'This is the pi-ELECTRONIC polarizability only (response of the conjugated pi system alone) - it does NOT include sigma-bond framework polarizability (this codebase has no sigma MO theory), so it is a different physical quantity than the whole-molecule Miller additivity estimate above, not directly summable with it. The ZDO position operator used here is atom-CENTERED (<chi_mu|r|chi_nu> ~= r_mu), so for a planar ring the "zz" (out-of-plane) component comes out exactly 0 by construction - a real p_z orbital\'s own spatial extent perpendicular to the ring plane is a separate physical effect this atom-position-only model cannot see, not a finding that out-of-plane polarizability is actually zero. Coordinates come from MolecularGeometry.js\'s idealized VSEPR geometry, including its own documented ring-closure placement limitations (see geometry.warnings) - a real ring conformer would shift atom positions and therefore this number.',
            version: '0.1'
        };
    }

    return {
        analyze: analyze,
        analyzePiElectronic: analyzePiElectronic,
        ATOMIC_CONTRIBUTION: ATOMIC_CONTRIBUTION,
        version: '0.1'
    };
}));
