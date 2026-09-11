// UMD IIFE - MolecularTPSA: Topological Polar Surface Area.
//
// Ertl, P.; Rohde, B.; Selzer, P. "Fast Calculation of Molecular Polar
// Surface Area as a Sum of Fragment-Based Contributions." J. Med. Chem.
// 2000, 43, 3714-3717. TPSA is a real, published, fragment-additive
// method: each polar atom (classically N and O) gets a CITED contribution
// value (Angstrom^2) purely from its own local bonding environment -
// heavy-neighbor count, bond orders to them, H count, charge, aromatic
// ring membership - summed with no 3D geometry involved at all (it
// approximates the real 3D polar surface area well enough in practice
// that it's a standard descriptor in drug discovery, predicting things
// like oral bioavailability/permeability).
//
// Classification here is DERIVED from MolecularStructure.js's own
// already-computed per-atom fields (neighborCount, bondOrderSum,
// implicitH, charge, piSystemRole) - no new bond-order logic. The
// contribution VALUES are CITED from the paper above.
//
// Scope, stated plainly: this implements the well-established CORE
// fragment set (plain amines, imine-type N, aromatic pyridine/pyrrole/
// furan-type atoms, ether/carbonyl/hydroxyl O) - the patterns that
// appear in essentially every TPSA worked example and that this module
// validates against real published values for. The full 2000 paper
// table has more entries (charged N, nitrile/triple-bonded N, small-ring
// strained patterns like epoxides/aziridines) that are NOT included here
// - an atom matching none of the covered patterns is EXCLUDED from the
// sum and flagged in unmatchedAtoms, never silently guessed at. That
// makes the reported psaAngstrom2 a real, honest LOWER BOUND whenever
// unmatchedAtoms is non-empty, not a claim of full coverage.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./MolecularStructure'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./MolecularStructure.js'));
    } else {
        root.MolecularTPSA = factory(root.MolecularStructure);
    }
}(typeof self !== 'undefined' ? self : this, function(MolecularStructure) {
    'use strict';
    if (!MolecularStructure) throw new Error('MolecularTPSA requires MolecularStructure');

    // CITED: Ertl/Rohde/Selzer 2000, Table 1. Angstrom^2 per fragment.
    var AROMATIC_CONTRIBUTIONS = {
        // symbol, role, H count, charge -> contribution
        'N|needsDoubleBond|0|0': 12.89, // pyridine-type aromatic N
        'N|lonePairDonor|1|0': 15.79,   // pyrrole-type aromatic NH
        'N|lonePairDonor|0|0': 4.93,    // N-substituted pyrrole-type (no H)
        'O|lonePairDonor|0|0': 13.14    // furan-type aromatic O
    };

    function nonAromaticKey(symbol, neighborCount, heavyBondOrderSum, hCount, charge) {
        return symbol + '|' + neighborCount + '|' + heavyBondOrderSum + '|' + hCount + '|' + charge;
    }
    var NONAROMATIC_CONTRIBUTIONS = {
        // N, all-single-bond amines
        'N|3|3|0|0': 3.24,   // tertiary amine: 3 single bonds, 0 H
        'N|2|2|1|0': 12.03,  // secondary amine: 2 single bonds, 1 H
        'N|1|1|2|0': 26.02,  // primary amine: 1 single bond, 2 H
        'N|2|3|0|0': 12.36,  // imine-type: 1 single + 1 double, 0 H
        // O
        'O|2|2|0|0': 9.23,   // ether: 2 single bonds, 0 H
        'O|1|2|0|0': 17.07,  // carbonyl: 1 double bond, 0 H
        'O|1|1|1|0': 20.23   // hydroxyl: 1 single bond, 1 H
    };

    // molecule/structureResult follow the same convention as this
    // project's other analysis modules - pass an already-computed
    // structureResult via options to avoid recomputing it.
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
            if (pa.symbol !== 'N' && pa.symbol !== 'O') return;

            var isAromatic = !!pa.piSystemRole;
            var contribution = null;
            var patternKey = null;

            if (isAromatic) {
                patternKey = pa.symbol + '|' + pa.piSystemRole + '|' + pa.implicitH + '|' + pa.charge;
                contribution = AROMATIC_CONTRIBUTIONS[patternKey];
            } else {
                var heavyBondOrderSum = pa.bondOrderSum - pa.implicitH; // strip the implicit-H single bonds back out
                patternKey = nonAromaticKey(pa.symbol, pa.neighborCount, heavyBondOrderSum, pa.implicitH, pa.charge);
                contribution = NONAROMATIC_CONTRIBUTIONS[patternKey];
            }

            if (contribution === undefined || contribution === null) {
                unmatched.push({
                    index: pa.index, symbol: pa.symbol, aromatic: isAromatic,
                    reason: 'No covered fragment pattern for this atom\'s environment (' +
                        (isAromatic ? 'aromatic role=' + pa.piSystemRole : 'neighbors=' + pa.neighborCount + ', bondOrderSum=' + pa.bondOrderSum) +
                        ', H=' + pa.implicitH + ', charge=' + pa.charge + ') - excluded from the sum, not guessed.'
                });
                return;
            }
            matched.push({ index: pa.index, symbol: pa.symbol, aromatic: isAromatic, contributionAngstrom2: contribution });
            total += contribution;
        });

        return {
            psaAngstrom2: Math.round(total * 100) / 100,
            isLowerBound: unmatched.length > 0,
            matchedAtoms: matched,
            unmatchedAtoms: unmatched,
            method: 'Ertl/Rohde/Selzer TPSA (J. Med. Chem. 2000, 43, 3714) - core fragment set',
            version: '0.1'
        };
    }

    return {
        analyze: analyze,
        AROMATIC_CONTRIBUTIONS: AROMATIC_CONTRIBUTIONS,
        NONAROMATIC_CONTRIBUTIONS: NONAROMATIC_CONTRIBUTIONS,
        version: '0.1'
    };
}));
