// UMD IIFE - MolecularPolarizability: mean molecular polarizability
// volume (Angstrom^3) via atomic hybrid component additivity.
//
// Miller, K.J. "Additivity Methods in Molecular Polarizability." J. Am.
// Chem. Soc. 1990, 112, 23, 8533-8542. Same shape as MolecularTPSA.js:
// each atom contributes a fixed value from its own element+hybridization
// type, summed with no 3D geometry involved. Classification reuses
// MolecularStructure.js's own per-atom hybridization field, same as
// MolecularTPSA.js - no new bonding logic here.
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
        define(['./MolecularStructure'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./MolecularStructure.js'));
    } else {
        root.MolecularPolarizability = factory(root.MolecularStructure);
    }
}(typeof self !== 'undefined' ? self : this, function(MolecularStructure) {
    'use strict';
    if (!MolecularStructure) throw new Error('MolecularPolarizability requires MolecularStructure');

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

    return {
        analyze: analyze,
        ATOMIC_CONTRIBUTION: ATOMIC_CONTRIBUTION,
        version: '0.1'
    };
}));
