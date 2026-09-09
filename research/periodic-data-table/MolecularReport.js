// UMD IIFE - MolecularReport: assembles a rigorous, provenance-labeled
// report from a molecule's already-computed MolecularStructure.js and
// MolecularGeometry.js results. No new chemistry - purely organizing and
// labeling numbers this project has already derived, so a reader
// (chemist, materials scientist, or biologist) always knows which of
// four categories every field falls into:
//   - DERIVED    - mechanically computed from the graph by this project's
//                  own modules (formula, hybridization, lone pairs,
//                  aromaticity, idealized VSEPR geometry...).
//   - CITED      - a published reference constant this project looked up,
//                  not computed (standard atomic weights, curated bond
//                  lengths, a matched REFERENCE_LIBRARY entry's own
//                  domain-expert-authored description).
//   - INPUT      - taken directly from what the user typed/built, not
//                  independently re-verified (e.g. the SMILES string as
//                  entered).
//   - NOT COMPUTED - explicitly listed, not silently omitted, so absence
//                  never reads as "zero" or "unimportant": dipole moment,
//                  point-group symmetry, real (measured/QM-optimized)
//                  bond lengths and angles, spectroscopic predictions,
//                  thermodynamic/mechanical properties beyond what
//                  PDT.js's own already-flagged FVT estimates cover,
//                  reaction energetics, and biological/functional
//                  context beyond a matched reference-library entry.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./PDT', './MolecularStructure', './MolecularGeometry', './CoordinationChemistry', './MolecularElectrostatics', './MolecularTPSA', './MolecularVanDerWaals', './MolecularPolarizability'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./PDT.js'), require('./MolecularStructure.js'), require('./MolecularGeometry.js'), require('./CoordinationChemistry.js'), require('./MolecularElectrostatics.js'), require('./MolecularTPSA.js'), require('./MolecularVanDerWaals.js'), require('./MolecularPolarizability.js'));
    } else {
        root.MolecularReport = factory(root.PDT, root.MolecularStructure, root.MolecularGeometry, root.CoordinationChemistry, root.MolecularElectrostatics, root.MolecularTPSA, root.MolecularVanDerWaals, root.MolecularPolarizability);
    }
}(typeof self !== 'undefined' ? self : this, function(PDT, MolecularStructure, MolecularGeometry, CoordinationChemistry, MolecularElectrostatics, MolecularTPSA, MolecularVanDerWaals, MolecularPolarizability) {
    'use strict';
    if (!MolecularStructure) throw new Error('MolecularReport requires MolecularStructure');
    if (!MolecularGeometry) throw new Error('MolecularReport requires MolecularGeometry');

    var NOT_COMPUTED = [
        'Higher-order electric multipole moments (quadrupole and beyond) - only the dipole moment is computed, and only for main-group organic elements (see Electrostatics/Polarity)',
        'Molecular point-group symmetry',
        'Real (measured or QM-optimized) bond lengths and angles - this report\'s geometry is idealized VSEPR only, and ring/macrocycle closure bonds are explicitly flagged, not solved',
        'Vibrational frequencies and IR/Raman/NMR spectroscopic predictions',
        'Thermodynamic properties beyond PDT.js\'s own already-flagged, uncalibrated FVT estimates (no real enthalpy, entropy, or heat capacity)',
        'Reaction energetics / transition states (that is the planned Reactivity module, not this one)',
        'Stereochemistry (this project\'s SMILES parser deliberately does not support @/@@ or E/Z notation)',
        'Biological or functional role beyond what a matched reference-library entry itself states (e.g. "carries oxygen") - never inferred from structure alone'
    ];

    function buildIdentity(molecule, structure, options) {
        var identity = {
            formula: structure.formula.string,
            formulaCounts: structure.formula.counts,
            molarMassGramsPerMol: structure.molarMass.value,
            molarMassCitationWarnings: structure.molarMass.warnings,
            heavyAtomCount: molecule.atoms.length
        };
        if (options && options.sourceSmiles) identity.sourceSmilesAsEntered = options.sourceSmiles;
        return identity;
    }

    function buildReferenceContext(structure) {
        if (!CoordinationChemistry) return null;
        var entries = Object.keys(structure.formula.counts).map(function(sym) {
            return { symbol: sym, count: structure.formula.counts[sym] };
        });
        var key = CoordinationChemistry.canonicalFormula(entries);
        var entry = CoordinationChemistry.referenceLibrary && CoordinationChemistry.referenceLibrary[key];
        if (!entry) return null;
        return {
            matched: true,
            name: entry.name,
            metal: entry.metal || null,
            ligandDonors: entry.ligandDonors || null,
            geometryDescription: entry.geometry || null,
            notes: entry.notes || null,
            source: 'CoordinationChemistry.js reference library - domain-expert-authored text, not computed by this pipeline'
        };
    }

    function summarizePerAtom(perAtom) {
        return perAtom.map(function(a) {
            if (a.error) return { index: a.index, symbol: a.symbol, error: a.error };
            return {
                index: a.index,
                symbol: a.symbol,
                implicitH: a.implicitH,
                totalNeighbors: a.totalNeighbors,
                hybridization: a.hybridization,
                lonePairs: a.lonePairs,
                geometry: a.geometry,
                formalChargeAsEntered: a.charge,
                piSystemRole: a.piSystemRole
            };
        });
    }

    function buildBonding(structure) {
        var bonding = { perAtom: summarizePerAtom(structure.perAtom), aromaticity: null };
        if (structure.aromaticity && !structure.aromaticity.error) {
            bonding.aromaticity = {
                verdict: structure.aromaticity.verdict,
                piElectrons: structure.aromaticity.piElectrons,
                delocalizationEnergyEv: structure.aromaticity.delocalizationEnergyEv,
                kekuleExists: structure.aromaticity.kekuleExists,
                planarDeclared: structure.aromaticity.planar,
                homoLumo: structure.aromaticity.homoLumo || null,
                note: structure.aromaticity.note || null
            };
        }
        return bonding;
    }

    function buildGeometrySection(geometry) {
        var ringClosures = geometry.bonds.filter(function(b) { return b.ringClosure; });
        return {
            source: geometry.geometrySource,
            atomCount: geometry.atoms.length,
            bondCount: geometry.bonds.length,
            ringClosureBondCount: ringClosures.length,
            ringClosureBonds: ringClosures.map(function(b) {
                return {
                    atoms: [b.a, b.b],
                    idealLengthAngstrom: b.idealLengthAngstrom,
                    actualLengthAngstrom: b.actualLengthAngstrom,
                    note: 'Not solved by this BFS spanning-tree placement - true ring/macrocycle closure needs real conformer generation.'
                };
            }),
            estimatedBondLengthCount: geometry.bonds.filter(function(b) { return (b.lengthSource || '').indexOf('estimated') === 0; }).length
        };
    }

    function buildElectrostatics(molecule, structure, geometry, options) {
        if (options && options.electrostaticsResult) return options.electrostaticsResult;
        if (!MolecularElectrostatics) return null;
        var result = MolecularElectrostatics.analyze(molecule, Object.assign({ structureResult: structure, geometryResult: geometry }, options));
        if (result.error) return null;
        return result;
    }

    function buildTPSA(molecule, structure, options) {
        if (options && options.tpsaResult) return options.tpsaResult;
        if (!MolecularTPSA) return null;
        var result = MolecularTPSA.analyze(molecule, Object.assign({ structureResult: structure }, options));
        if (result.error) return null;
        return result;
    }

    function buildVanDerWaals(molecule, structure, geometry, options) {
        if (options && options.vanDerWaalsResult) return options.vanDerWaalsResult;
        if (!MolecularVanDerWaals) return null;
        var result = MolecularVanDerWaals.analyze(molecule, Object.assign({ structureResult: structure, geometryResult: geometry }, options));
        if (result.error) return null;
        return result;
    }

    function buildPolarizability(molecule, structure, options) {
        if (options && options.polarizabilityResult) return options.polarizabilityResult;
        if (!MolecularPolarizability) return null;
        var result = MolecularPolarizability.analyze(molecule, Object.assign({ structureResult: structure }, options));
        if (result.error) return null;
        return result;
    }

    function buildPiPolarizability(molecule, structure, geometry, options) {
        if (options && options.piPolarizabilityResult) return options.piPolarizabilityResult;
        if (!MolecularPolarizability || !MolecularPolarizability.analyzePiElectronic) return null;
        var result = MolecularPolarizability.analyzePiElectronic(molecule, Object.assign({ structureResult: structure, geometryResult: geometry }, options));
        if (result.error) return null;
        return result;
    }

    // molecule/structureResult/geometryResult are the outputs of
    // MolecularStructure.fromSmiles|fromGraph, .analyze(), and
    // MolecularGeometry.generateIdealizedCoordinates() respectively -
    // pass already-computed results in (options.structureResult /
    // options.geometryResult) to avoid recomputing them.
    function build(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var geometry = options.geometryResult || MolecularGeometry.generateIdealizedCoordinates(molecule, Object.assign({ structureResult: structure }, options));
        if (geometry.error) return geometry;
        var electrostatics = buildElectrostatics(molecule, structure, geometry, options);
        var tpsa = buildTPSA(molecule, structure, options);
        var vanDerWaals = buildVanDerWaals(molecule, structure, geometry, options);
        var polarizability = buildPolarizability(molecule, structure, options);
        var piPolarizability = buildPiPolarizability(molecule, structure, geometry, options);

        return {
            identity: buildIdentity(molecule, structure, options),
            bonding: buildBonding(structure),
            geometry: buildGeometrySection(geometry),
            electrostatics: electrostatics,
            tpsa: tpsa,
            vanDerWaals: vanDerWaals,
            polarizability: polarizability,
            piPolarizability: piPolarizability,
            referenceContext: buildReferenceContext(structure),
            provenance: {
                derived: [
                    'Molecular formula and molar mass (atom counting + implicit-H inference; atomic weights themselves are CITED, see below)',
                    'Per-atom implicit hydrogen count, steric number, hybridization, lone pairs, and VSEPR geometry name',
                    'Aromaticity verdict, pi-electron count, delocalization energy, and HOMO/LUMO (real Huckel MO diagonalization - HOMO/LUMO only for conjugated systems)',
                    'Idealized VSEPR 3D coordinates and bond lengths (reference bond-length table below is CITED, placement itself is DERIVED)',
                    electrostatics && electrostatics.applicable ? 'Partial atomic charges and dipole moment (Gasteiger-Marsili PEOE equalization + vector sum over idealized coordinates - electronegativity parameters below are CITED, the equalization itself is DERIVED)' : null,
                    tpsa ? 'Topological polar surface area (fragment classification from this project\'s own per-atom bonding data - the fragment contribution VALUES below are CITED)' : null,
                    vanDerWaals ? 'Molecular volume and surface area (Monte Carlo union-of-spheres / Shrake-Rupley over idealized coordinates - Van der Waals radii below are CITED, the geometry algorithms themselves are DERIVED)' : null,
                    polarizability ? 'Mean molecular polarizability (atomic hybrid component additivity - contribution VALUES below are CITED, with a documented accuracy caveat - see MolecularPolarizability.js)' : null,
                    piPolarizability && piPolarizability.applicable ? 'Pi-electron polarizability (sum-over-states 2nd-order perturbation theory over this project\'s own Huckel MOs and idealized coordinates - fully DERIVED, no external table, see MolecularPolarizability.js analyzePiElectronic)' : null
                ].filter(Boolean),
                cited: [
                    'Standard atomic weights (CIAAW/IUPAC 2021 table, MolecularStructure.js)',
                    'Reference covalent bond lengths (MolecularGeometry.js) - pairs not in the curated table fall back to an uncalibrated estimate, flagged per-bond via lengthSource',
                    electrostatics && electrostatics.applicable ? 'Gasteiger-Marsili PEOE electronegativity parameters (Tetrahedron 1980, 36, 3219) - MolecularElectrostatics.js' : null,
                    tpsa ? 'Ertl/Rohde/Selzer TPSA fragment contribution values (J. Med. Chem. 2000, 43, 3714) - MolecularTPSA.js' : null,
                    vanDerWaals ? 'Bondi (1964) Van der Waals radii - MolecularVanDerWaals.js' : null,
                    polarizability ? 'Miller atomic hybrid polarizability components (J. Am. Chem. Soc. 1990, 112, 8533) - MolecularPolarizability.js' : null,
                    structure.molarMass.warnings.length ? 'One or more elements in this formula have no stable isotope - see molarMassCitationWarnings' : null
                ].filter(Boolean),
                notComputed: NOT_COMPUTED
            },
            warnings: (structure.warnings || []).concat(geometry.warnings || []),
            version: '0.1'
        };
    }

    return {
        build: build,
        NOT_COMPUTED: NOT_COMPUTED,
        version: '0.1'
    };
}));
