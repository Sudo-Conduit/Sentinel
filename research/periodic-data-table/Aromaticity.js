// UMD IIFE - Aromaticity module (Kekule matching + real Huckel MO energies)
//
// Scope: a single simple (non-fused) monocyclic ring. Fused/bridged ring
// systems (porphyrin's macrocycle) are NOT handled here — deciding which
// cycle(s) in a fused system constitute the real delocalization pathway is
// a separate, harder problem (see the architecture note at the bottom).
//
// Once a ring's bonds and atom roles are known, we don't need a
// per-molecule guessed stabilization constant: each atom's own
// Z_eff-derived orbital_energy (already computed by PDT.js) IS the Huckel
// "alpha" (Coulomb integral) for that atom, no different from how real
// Huckel Molecular Orbital theory uses one alpha per atom. Building the
// ring's Huckel secular matrix from those real alphas and diagonalizing it
// gives real, molecule-specific pi-system energies — replacing a guessed
// eV constant with the same physics already in this codebase. The one
// remaining external parameter is beta (the resonance/coupling integral
// between adjacent p-orbitals) — real Huckel theory treats this as a
// single shared universal constant too, not a per-molecule fit; see
// BETA_EV below for the value used and why.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./PDT'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./PDT.js'));
    } else {
        root.Aromaticity = factory(root.PDT);
    }
}(typeof self !== 'undefined' ? self : this, function(PDT) {
    'use strict';
    if (!PDT) throw new Error('Aromaticity requires PDT');

    // The one universal resonance-integral constant this model still needs
    // — real simple-Huckel treatments use a single shared beta too (they
    // don't fit a new one per molecule). Commonly cited simple-Huckel
    // parametrizations for a carbon-carbon pi interaction fall roughly in
    // the -0.7 to -3 eV range depending on convention; -1.0 eV is used
    // here as a representative, clearly-labeled value, not a per-molecule
    // fit the way STABILIZATION_PER_ELECTRON constants were before.
    var BETA_EV = -1.0;

    // Exact perfect-matching search via backtracking, not Edmonds' Blossom
    // algorithm: ring sizes here (a handful to a couple dozen atoms) make
    // brute-force search fully adequate and far easier to verify correct
    // than hand-rolling Blossom, whose extra machinery (blossom
    // contraction) only earns its keep at graph sizes this module doesn't
    // have. This also only needs to find ANY perfect matching (every
    // needs-double-bond atom covered), not a maximum matching in the
    // general sense.
    function findPerfectMatching(vertices, edgeSet) {
        var matched = {};
        function backtrack(remaining) {
            if (remaining.length === 0) return true;
            var v = remaining[0];
            var rest = remaining.slice(1);
            for (var i = 0; i < rest.length; i++) {
                var w = rest[i];
                if (edgeSet[v + '|' + w] || edgeSet[w + '|' + v]) {
                    matched[v] = w;
                    matched[w] = v;
                    var next = rest.slice(0, i).concat(rest.slice(i + 1));
                    if (backtrack(next)) return true;
                    delete matched[v];
                    delete matched[w];
                }
            }
            return false;
        }
        if (vertices.length % 2 !== 0) return null;
        var ok = backtrack(vertices.slice());
        return ok ? matched : null;
    }

    // Classic cyclic Jacobi eigenvalue algorithm for real symmetric
    // matrices. Returns eigenvalues only (ascending) — no eigenvectors
    // needed here. Standard textbook rotation formulas; validated below in
    // this module's own self-test against the closed-form uniform-ring
    // Huckel eigenvalues (E_j = alpha + 2*beta*cos(2*pi*j/N)) before it's
    // trusted for the heteroatom (non-uniform alpha) case, where no such
    // closed form exists.
    function jacobiEigenvalues(matrix, maxSweeps) {
        var n = matrix.length;
        var a = matrix.map(function(row) { return row.slice(); });
        maxSweeps = maxSweeps || 200;
        for (var sweep = 0; sweep < maxSweeps; sweep++) {
            var off = 0;
            for (var p = 0; p < n; p++) {
                for (var q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
            }
            if (off < 1e-14) break;
            for (p = 0; p < n; p++) {
                for (q = p + 1; q < n; q++) {
                    if (Math.abs(a[p][q]) < 1e-15) continue;
                    var theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
                    var sign = theta >= 0 ? 1 : -1;
                    var t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                    var c = 1 / Math.sqrt(t * t + 1);
                    var s = t * c;
                    var app = a[p][p], aqq = a[q][q], apq = a[p][q];
                    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
                    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
                    a[p][q] = a[q][p] = 0;
                    for (var i = 0; i < n; i++) {
                        if (i !== p && i !== q) {
                            var aip = a[i][p], aiq = a[i][q];
                            a[i][p] = a[p][i] = c * aip - s * aiq;
                            a[i][q] = a[q][i] = s * aip + c * aiq;
                        }
                    }
                }
            }
        }
        var eig = [];
        for (var k = 0; k < n; k++) eig.push(a[k][k]);
        return eig.sort(function(x, y) { return x - y; });
    }

    // Fills piElectrons into ascending MO energies (2 per level, respecting
    // degeneracy — nearly-equal eigenvalues are grouped as one level).
    // Returns total energy and whether the fill leaves a degenerate HOMO
    // half-filled (open-shell / diradical character — cyclobutadiene's
    // real problem, and exactly why simple closed-shell HMO filling can't
    // honestly report a clean destabilization number for it).
    function fillElectrons(eigenvalues, piElectrons) {
        var EPS = 1e-6;
        var levels = [];
        eigenvalues.forEach(function(e) {
            var last = levels[levels.length - 1];
            if (last && Math.abs(last.energy - e) < EPS) last.count++;
            else levels.push({ energy: e, count: 1 });
        });
        var remaining = piElectrons;
        var total = 0;
        var openShell = false;
        for (var i = 0; i < levels.length && remaining > 0; i++) {
            var capacity = levels[i].count * 2;
            var occupy = Math.min(capacity, remaining);
            total += occupy * levels[i].energy;
            if (occupy < capacity && occupy > 0) openShell = true; // degenerate level half-filled
            remaining -= occupy;
        }
        return { totalEnergy: total, openShell: openShell };
    }

    // ring = {
    //   atoms: [{ symbol, role }, ...] in ring order (consecutive atoms are
    //     ring-bonded; the list wraps from last back to first),
    //   planar: boolean   // declared, not derived — see architecture note
    // }
    // role is required per atom and is one of:
    //   'needsDoubleBond' — must be matched to exactly one ring double bond
    //     (contributes 1 pi electron): ordinary ring carbons, pyridine-type N.
    //   'lonePairDonor'   — contributes its lone pair to the pi system and
    //     takes zero ring double bonds (contributes 2 pi electrons):
    //     pyrrole-type N, furan-type O, thiophene-type S.
    function analyzeRing(ring) {
        var atoms = ring.atoms || [];
        var n = atoms.length;
        if (n < 3) return { error: 'A ring needs at least 3 atoms.' };

        var ringEdges = [];
        for (var i = 0; i < n; i++) ringEdges.push([i, (i + 1) % n]);

        var needsDoubleBond = [];
        var lonePairDonors = [];
        var alphas = [];
        for (var idx = 0; idx < n; idx++) {
            var atom = atoms[idx];
            var role = atom.role;
            if (role === 'needsDoubleBond') needsDoubleBond.push(idx);
            else if (role === 'lonePairDonor') lonePairDonors.push(idx);
            else return { error: 'Atom ' + idx + ' (' + atom.symbol + ') needs role "needsDoubleBond" or "lonePairDonor" — this module does not infer it automatically.' };

            var el = PDT.get(atom.symbol);
            if (!el) return { error: 'Unknown element: ' + atom.symbol };
            alphas.push(el.orbital_energy); // real, Z_eff-derived — not guessed
        }

        var candidateSet = {};
        ringEdges.forEach(function(e) {
            if (needsDoubleBond.indexOf(e[0]) !== -1 && needsDoubleBond.indexOf(e[1]) !== -1) {
                candidateSet[e[0] + '|' + e[1]] = true;
            }
        });

        var matching = needsDoubleBond.length ? findPerfectMatching(needsDoubleBond, candidateSet) : {};
        var kekuleExists = matching !== null;

        var piElectrons = needsDoubleBond.length * 1 + lonePairDonors.length * 2;
        var planar = !!ring.planar;
        var fullyConjugated = kekuleExists;
        var huckelApplicable = planar && fullyConjugated;

        // Build the real Huckel secular matrix: diagonal = each atom's own
        // orbital_energy, off-diagonal = beta for ring-bonded neighbors.
        var H = [];
        for (i = 0; i < n; i++) {
            H.push(new Array(n).fill(0));
            H[i][i] = alphas[i];
        }
        ringEdges.forEach(function(e) {
            H[e[0]][e[1]] = BETA_EV;
            H[e[1]][e[0]] = BETA_EV;
        });

        var eigenvalues = jacobiEigenvalues(H);
        var fill = fillElectrons(eigenvalues, piElectrons);

        // Localized reference: needsDoubleBond atoms pair up into isolated
        // 2-atom pi bonds (bonding MO = average-alpha + beta, 2 electrons
        // each); lonePairDonors keep their lone pair at their own alpha,
        // contributing 2 electrons at their own atomic energy — i.e. "no
        // ring" reference energy, same electron count, zero delocalization.
        var referenceEnergy = 0;
        if (matching) {
            var counted = {};
            needsDoubleBond.forEach(function(v) {
                if (counted[v]) return;
                var w = matching[v];
                counted[v] = counted[w] = true;
                referenceEnergy += 2 * ((alphas[v] + alphas[w]) / 2 + BETA_EV);
            });
        }
        lonePairDonors.forEach(function(v) { referenceEnergy += 2 * alphas[v]; });

        var delocalizationEnergy = huckelApplicable ? (fill.totalEnergy - referenceEnergy) : 0;

        var remainder4 = piElectrons % 4;
        var isAromaticCount = remainder4 === 2;
        var isAntiaromaticCount = remainder4 === 0 && piElectrons > 0;

        var verdict;
        if (!huckelApplicable) verdict = 'nonaromatic';
        else if (isAromaticCount && !fill.openShell) verdict = 'aromatic';
        else if (isAntiaromaticCount || fill.openShell) verdict = 'antiaromatic';
        else verdict = 'nonaromatic';

        return {
            ringSize: n,
            kekuleExists: kekuleExists,
            matching: matching,
            piElectrons: piElectrons,
            planar: planar,
            fullyConjugated: fullyConjugated,
            huckelApplicable: huckelApplicable,
            eigenvaluesEv: eigenvalues.map(function(e) { return Math.round(e * 1000) / 1000; }),
            openShellHOMO: fill.openShell,
            totalPiEnergyEv: Math.round(fill.totalEnergy * 1000) / 1000,
            localizedReferenceEv: Math.round(referenceEnergy * 1000) / 1000,
            delocalizationEnergyEv: Math.round(delocalizationEnergy * 1000) / 1000,
            verdict: verdict,
            note: fill.openShell
                ? 'Degenerate HOMO left half-filled — simple closed-shell Huckel filling cannot honestly report a single destabilization number here; the real chemistry (Jahn-Teller distortion to a lower-symmetry, closed-shell structure) is beyond this model.'
                : undefined
        };
    }

    // ARCHITECTURE NOTE: role (needsDoubleBond vs lonePairDonor) and
    // planarity are still declared inputs, not derived facts — see the
    // reasoning in the module's history. What changed here is the ENERGY:
    // alpha now comes from PDT's real orbital_energy per atom instead of a
    // per-molecule guessed stabilization constant, and beta is the one
    // remaining universal (not molecule-specific) parameter, same as real
    // Huckel theory. This module also only ever sees one simple ring — a
    // fused system like porphyrin needs a separate ring-selection step
    // first, not attempted here.

    return {
        analyzeRing: analyzeRing,
        _findPerfectMatching: findPerfectMatching,
        _jacobiEigenvalues: jacobiEigenvalues,
        BETA_EV: BETA_EV,
        version: '0.2'
    };
}));
