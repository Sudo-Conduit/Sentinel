// UMD IIFE - MolecularReactivity: per-atom Fukui functions, the standard
// condensed-to-atoms reactivity indices of conceptual DFT.
//
// f+_k (electrophilic attack site / favored by an incoming NUCLEOPHILE) and
// f-_k (nucleophilic attack site / favored by an incoming ELECTROPHILE) are
// defined (Parr, R.G.; Yang, W. J. Am. Chem. Soc. 1984, 106, 4049) as the
// response of atom k's electron density to a change in the molecule's total
// electron count: f+_k = [rho_k(N+1) - rho_k(N)], f-_k = [rho_k(N) - rho_k(N-1)].
// A true finite-difference evaluation needs three separate self-consistent
// electron-density calculations (N-1, N, N+1 electrons) - not available
// here, since this project's Huckel treatment fills a FIXED MO set for a
// fixed N and has no SCF step to rerun at N+-1.
//
// What IS used instead is the standard, universally-applied practical
// simplification - the frontier molecular orbital (FMO) approximation
// (same Parr & Yang 1984 paper, condensed to atoms by Yang, W.; Mortier,
// W.J. J. Am. Chem. Soc. 1986, 108, 5708): the density CHANGE from
// adding/removing one electron is approximated by the density of the
// orbital that electron would actually occupy - the LUMO for f+, the HOMO
// for f-. Condensed to atom k using this project's own Huckel MO
// coefficients (Aromaticity.js's spectroscopic-beta eigenbasis, the same
// one homoLumo()/analyzePiElectronic() already read):
//   f+_k = |c_LUMO,k|^2      f-_k = |c_HOMO,k|^2      f0_k = (f+_k + f-_k)/2
//
// DEGENERATE FRONTIER LEVEL (e.g. benzene's doubly-degenerate e-symmetry
// HOMO and LUMO pairs): Yang & Mortier's own treatment averages - not
// sums - |c|^2 over every MO in a degenerate level, so that a benzene ring
// carbon isn't double-counted relative to a non-degenerate case. This is
// also a real, checkable self-consistency requirement, not just a
// convention: f+ is a normalized density (it integrates to exactly the ONE
// electron being added), so summing atom-condensed f+_k over every atom in
// the pi system must come out to 1.000 - averaging over the degenerate set
// is what makes that hold; summing instead would give piElectrons-degeneracy-
// dependent totals like 2.000 for benzene, which cannot be a normalized
// density. See the test file for this exact sum-to-1 check on benzene.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./MolecularStructure', './Aromaticity'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./MolecularStructure.js'), require('./Aromaticity.js'));
    } else {
        root.MolecularReactivity = factory(root.MolecularStructure, root.Aromaticity);
    }
}(typeof self !== 'undefined' ? self : this, function(MolecularStructure, Aromaticity) {
    'use strict';
    if (!MolecularStructure) throw new Error('MolecularReactivity requires MolecularStructure');
    if (!Aromaticity) throw new Error('MolecularReactivity requires Aromaticity');

    // molecule/structureResult follow this project's usual passthrough
    // convention (same shape analyzePiElectronic in MolecularPolarizability.js
    // uses - options.structureResult lets a caller that already ran
    // MolecularStructure.analyze() once reuse it instead of recomputing).
    function analyzeFukuiFunctions(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var arom = structure.aromaticity;
        if (!arom || arom.error || !arom.spectroscopicMO || !arom.originalIndex) {
            return { applicable: false, reason: 'No conjugated pi-system in this molecule - Fukui functions here are condensed from Huckel pi MOs, and there are none to condense.', version: '0.1' };
        }
        if (arom.openShellHOMO) {
            return { applicable: false, reason: 'Degenerate, half-filled HOMO (open-shell/antiaromatic character) - there is no single well-defined HOMO level to read f- from (adding vs. removing an electron do not even leave the same open-shell configuration), same case Aromaticity.js\'s own delocalization-energy note and MolecularPolarizability.js\'s sum-over-states both already flag.', version: '0.1' };
        }

        var eigenvaluesEv = arom.spectroscopicMO.eigenvaluesEv;
        var coefficients = arom.spectroscopicMO.coefficients; // [moIndex][atomLocalIndex]
        var moIndices = Aromaticity._homoLumoMoIndices(eigenvaluesEv, arom.piElectrons);

        if (!moIndices.homoMoIndices || !moIndices.lumoMoIndices) {
            return { applicable: false, reason: 'No unoccupied pi MO available in this pi-system (the Huckel basis is fully filled) - f+ has no LUMO to read, so nothing normalizable can be reported.', version: '0.1' };
        }

        var homoGroup = moIndices.homoMoIndices;
        var lumoGroup = moIndices.lumoMoIndices;
        var atomCount = coefficients[0].length;

        var perAtom = [];
        var sumFPlus = 0, sumFMinus = 0;
        for (var k = 0; k < atomCount; k++) {
            var fPlus = 0;
            for (var i = 0; i < lumoGroup.length; i++) {
                var cPlus = coefficients[lumoGroup[i]][k];
                fPlus += cPlus * cPlus;
            }
            fPlus /= lumoGroup.length; // average over a degenerate LUMO set - see file header

            var fMinus = 0;
            for (var j = 0; j < homoGroup.length; j++) {
                var cMinus = coefficients[homoGroup[j]][k];
                fMinus += cMinus * cMinus;
            }
            fMinus /= homoGroup.length; // average over a degenerate HOMO set - see file header

            sumFPlus += fPlus;
            sumFMinus += fMinus;
            perAtom.push({
                atomIndex: arom.originalIndex[k],
                fPlus: Math.round(fPlus * 1e6) / 1e6,
                fMinus: Math.round(fMinus * 1e6) / 1e6,
                fZero: Math.round(((fPlus + fMinus) / 2) * 1e6) / 1e6
            });
        }

        return {
            applicable: true,
            perAtom: perAtom,
            homoDegeneracy: homoGroup.length,
            lumoDegeneracy: lumoGroup.length,
            // Real, checkable self-consistency invariant, not a display
            // nicety: each of f+/f- is a normalized density change for
            // exactly one electron, so summed over every pi-system atom it
            // must come out to 1 - see file header. Kept unrounded (not the
            // display-rounded perAtom values above) so this checks the
            // actual computation, not accumulated display-rounding error.
            sumFPlus: Math.round(sumFPlus * 1e6) / 1e6,
            sumFMinus: Math.round(sumFMinus * 1e6) / 1e6,
            method: 'Frontier molecular orbital (FMO) approximation to the Parr-Yang Fukui function (J. Am. Chem. Soc. 1984, 106, 4049), condensed to atoms per Yang & Mortier (J. Am. Chem. Soc. 1986, 108, 5708): f+_k = |c_LUMO,k|^2 (nucleophile-favored/electrophilic-attack site), f-_k = |c_HOMO,k|^2 (electrophile-favored/nucleophilic-attack site), averaged over a degenerate frontier level - see MolecularReactivity.js file header for why FMO rather than true finite-difference, and why averaging rather than summing degenerate MOs.',
            version: '0.1'
        };
    }

    return {
        analyzeFukuiFunctions: analyzeFukuiFunctions,
        version: '0.1'
    };
}));
