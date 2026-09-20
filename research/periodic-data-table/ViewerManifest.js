/**
 * @file ViewerManifest.js
 * @author Will Fobbs
 * @description Shared, single-source-of-truth list of this directory's
 *   standalone chemistry viewers and their local JS dependency lists (read
 *   directly off each viewer's own <script src> tags, in load order -- not
 *   derived by globbing, so the list stays a reviewable, deliberate
 *   choice, the way Terminal.pdf's DEPENDENCIES is).
 *
 *   Both InlineViewerHtml.js (folds each viewer's dependencies into one
 *   standalone .html) and BuildViewerPdf.js (wraps that standalone .html
 *   in a PDFVaultX PDF) require this instead of keeping their own copies,
 *   so the two build steps can never drift out of sync with each other.
 *
 *   three.min.js is a vendored, committed copy (r128, MIT), not a CDN
 *   reference -- this project vendors its dependencies and reviews them
 *   rather than pulling from a CDN at load time or a package registry at
 *   build time, and this directory otherwise has zero external runtime
 *   dependencies (no ESM, no CDN).
 * @type {Object<string, {entry: string, deps: string[]}>}
 */
'use strict';

const VIEWERS = {
    'molecule-viewer': {
        entry: 'MoleculeViewer.html',
        deps: [
            'three.min.js',
            'PDT.js', 'Smiles.js', 'Aromaticity.js', 'CoordinationChemistry.js',
            'MolecularStructure.js', 'MolecularGeometry.js', 'MolecularElectrostatics.js',
            'MolecularTPSA.js', 'MolecularVanDerWaals.js', 'MolecularPolarizability.js',
            'MolecularReactivity.js', 'MolecularVibrations.js', 'MolecularVibrationalModes.js',
            'MolecularSymmetry.js', 'MolecularThermodynamics.js', 'MolecularDescriptors.js',
            'MolecularReport.js', 'MolecularViewer.js'
        ]
    },
    'inverse-design': {
        entry: 'InverseDesign.html',
        deps: [
            'PDT.js', 'Smiles.js', 'Aromaticity.js', 'CoordinationChemistry.js',
            'MolecularStructure.js', 'MolecularGeometry.js', 'MolecularElectrostatics.js',
            'MolecularTPSA.js', 'MolecularVanDerWaals.js', 'MolecularPolarizability.js',
            'MolecularReactivity.js', 'MolecularVibrations.js', 'MolecularVibrationalModes.js',
            'MolecularSymmetry.js', 'MolecularThermodynamics.js', 'MolecularDescriptors.js',
            'MolecularReport.js', 'ExtendX.js'
        ]
    },
    'fobbs-valence-table': {
        entry: 'FobbsValenceTable.html',
        deps: ['three.min.js']
    },
    'chemistry-problem-generator': {
        entry: 'ChemistryProblemGenerator.html',
        deps: [
            'PDT.js', 'Smiles.js', 'Aromaticity.js', 'MolecularStructure.js',
            'RulesEngine.js', 'Stoichiometry.js', 'ChemistryProblemGenerator.js'
        ]
    }
};

module.exports = { VIEWERS };
