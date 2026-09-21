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
 *   three.min.js and pdf-lib.min.js are vendored, committed copies (r128
 *   MIT, and the same pdf-lib UMD build already vendored+reviewed at
 *   pooledimpact/mountainshift/v2/lib/pdf-lib.min.js), not CDN references
 *   -- this project vendors its dependencies and reviews them rather than
 *   pulling from a CDN at load time or a package registry at build time,
 *   and this directory otherwise has zero external runtime dependencies
 *   (no ESM, no CDN).
 *
 *   An entry may optionally carry `titlePage` -- when present,
 *   BuildViewerPdf.js draws a formal title page (title/subtitle/version/
 *   company/confidentiality notice) on the PDF's cover instead of the
 *   generic "PDFVaultX container" boilerplate text. Opt-in per viewer, not
 *   a default, since it's document-specific front matter.
 * @type {Object<string, {entry: string, deps: string[], titlePage?: {title: string, subtitle?: string, version: string, company: string, confidential?: string}}>}
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
            'RulesEngine.js', 'Stoichiometry.js', 'ChemistryProblemGenerator.js',
            'pdf-lib.min.js', 'ChemistryPdfExport.js'
        ],
        titlePage: {
            title: 'Chemistry Problem Generator',
            subtitle: 'Introduction: Module A',
            version: '1.00.00',
            company: 'Pooled Impact',
            confidential: 'Confidential and Proprietary.'
        }
    }
};

module.exports = { VIEWERS };
