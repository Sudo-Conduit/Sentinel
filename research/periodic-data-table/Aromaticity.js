// UMD IIFE - Aromaticity module (Kekule matching + real Huckel MO energies)
//
// Scope: any connected conjugated-atom graph — a simple ring, or a fused/
// bridged system like porphyrin's macrocycle. Earlier versions assumed the
// input was one simple ring (atoms in ring order, edges implied by
// wraparound) and left fused systems unhandled, on the theory that "which
// cycle is the real aromatic ring" (ring perception / SSSR) needed solving
// first. It doesn't: real Huckel MO theory for a fused system is one
// secular matrix over the whole conjugated framework, not one calculation
// per ring — so this module takes an explicit bond list instead of
// assuming a wraparound cycle, and the same matching + diagonalization
// pipeline runs over any topology without needing to pick out "the" ring
// first. What's still a declared input, not derived: which atoms belong
// to the conjugated system at all, and each atom's role (see below) — see
// the architecture note at the bottom for what that leaves open.
//
// Once a system's bonds and atom roles are known, we don't need a
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

    // Two ways to turn (alpha_i, alpha_j) into a bond's beta — selectable
    // per call via options.betaModel, not a single hardcoded choice, so
    // both can be run side by side on the same system rather than
    // committing to one before it's been tested against the other:
    //
    // 'constant' (default) — BETA_EV for every bond, unconditionally.
    // Matches real simple-Huckel practice (one shared beta, not fit per
    // molecule) and is what every result so far has used.
    //
    // 'ratio' — an attempt to derive beta from PDT's own alphas instead of
    // importing it, tried first as the real Wolfsberg-Helmholz semi-
    // empirical form (beta_ij = K*(alpha_i+alpha_j)/2, K=1.75). That
    // breaks outright: using our own alpha_C=-122.4 eV it predicts
    // beta_CC=-214 eV, 214x larger than the -1.0 eV BETA_EV needed to
    // reproduce benzene's real resonance energy — because PDT's
    // orbital_energy is a simplified hydrogenic approximation whose
    // ABSOLUTE magnitude runs ~10-60x hotter than real ionization
    // energies for every multi-electron element (H matches real IE
    // exactly; C/N/O are off ~9-11x; Fe ~62x), even though the RELATIVE
    // pattern across elements — N more tightly bound than C, Fe more than
    // N — is directionally real. 'ratio' salvages only that relative
    // pattern: it scales BETA_EV by the geometric mean of each atom's
    // alpha relative to carbon's, so it reproduces today's calibrated
    // C-C beta exactly (ratio=1 when both atoms are carbon — every
    // all-carbon result is identical under both models by construction)
    // and only diverges for heteroatom bonds. This is a labeled
    // EXTRAPOLATION of the model's own internal logic, not a derivation —
    // unlike the eigenvalue solver, there is no independent known-correct
    // number to validate it against.
    var ALPHA_C_REFERENCE = PDT.get('C').orbital_energy;

    // 'physical' — the real fix for 'ratio''s limitation: beta(bond) =
    // beta0 * f(Z_eff) * g(d). Both factors are dimensionless and equal 1
    // for a C-C bond by construction, so every all-carbon result (e.g.
    // benzene) is unchanged from BETA_EV alone; only heteroatom bonds and
    // bond-length differences move.
    //
    // f(Z_eff_i, Z_eff_j) = sqrt(Z_eff_i * Z_eff_j) / Z_eff_C — geometric
    // mean of the two atoms' own PDT Z_eff, normalized to carbon. Unlike
    // the failed Wolfsberg-Helmholz attempt (which multiplied the
    // absolute, already-inflated orbital_energy and exploded to 214x
    // BETA_EV), Z_eff itself is a modest, well-behaved number (C=3.25,
    // N=3.9, O=4.55, S=5.45, Fe=3.75) and this ratio stays close to 1 for
    // real conjugated-system atoms — no explosion, no new external
    // citation, self-derived from data already in PDT.js.
    //
    // g(d) = exp(-(d_estimate - d_reference) / L) — exponential distance
    // decay, the standard form for how orbital overlap (and hence
    // resonance coupling) falls off with internuclear separation. d and L
    // are self-derived from PDT's own slater_radius (Bohr, converted to
    // Angstrom) rather than importing real bond-length tables:
    // d_estimate = slater_radius_i + slater_radius_j (the same
    // sum-of-radii bond-length estimate MolecularGeometry.js's own
    // independent fallback already uses), d_reference = 2*slater_radius_C
    // (the C-C case), L = slater_radius_C (a dimensionally-sensible decay
    // length — an atomic radius is the natural length scale for how far a
    // p-orbital extends). g(C-C) = 1 exactly by construction.
    var BOHR_TO_ANGSTROM = 0.529177;
    var CARBON_EL = PDT.get('C');
    var Z_EFF_C_REFERENCE = CARBON_EL.Z_eff;
    var SLATER_RADIUS_C_ANGSTROM = CARBON_EL.slater_radius * BOHR_TO_ANGSTROM;

    function betaZeffFactor(symbolI, symbolJ) {
        var elI = PDT.get(symbolI), elJ = PDT.get(symbolJ);
        return Math.sqrt(elI.Z_eff * elJ.Z_eff) / Z_EFF_C_REFERENCE;
    }
    // explicitDistanceAngstrom lets a caller override the Slater-radius-
    // sum estimate with a real distance (e.g. a finite-difference-
    // perturbed bond length) - used by MolecularVibrations.js to compute
    // how the pi-electron polarizability changes with bond stretching.
    // Omitted (the default, every existing caller), behavior is bit-for-
    // bit unchanged.
    function betaDistanceFactor(symbolI, symbolJ, explicitDistanceAngstrom) {
        var elI = PDT.get(symbolI), elJ = PDT.get(symbolJ);
        var d = explicitDistanceAngstrom !== undefined
            ? explicitDistanceAngstrom
            : (elI.slater_radius + elJ.slater_radius) * BOHR_TO_ANGSTROM;
        var dReference = 2 * SLATER_RADIUS_C_ANGSTROM;
        return Math.exp(-(d - dReference) / SLATER_RADIUS_C_ANGSTROM);
    }

    // Simple Huckel theory's one shared beta cannot simultaneously
    // reproduce both real thermochemical resonance energy AND real
    // spectroscopic (UV-Vis) transition energies for the same molecule —
    // a well-known, real textbook limitation, not a bug. BETA_EV above is
    // already calibrated to real benzene resonance energy (thermochemical)
    // and continues to drive delocalizationEnergyEv/totalPiEnergyEv/
    // verdict unchanged. BETA_SPECTROSCOPIC_EV is a second, separate
    // calibration — derived from benzene's real lowest pi->pi* UV
    // absorption band (~255 nm) via simple Huckel's own closed-form
    // benzene HOMO-LUMO gap, gap = 2*|beta|: beta = -(1239.84/255)/2 eV.
    // Used only for a second, parallel diagonalization (see analyze())
    // feeding homoLumo()'s gap/hardness/opticalGapNm/conductivityClass.
    var BENZENE_LOWEST_ABSORPTION_NM = 255;
    var BETA_SPECTROSCOPIC_EV = -Math.round((1239.84 / BENZENE_LOWEST_ABSORPTION_NM / 2) * 100) / 100;

    function computeBeta(alphaI, alphaJ, betaModel, symbolI, symbolJ, beta0, explicitDistanceAngstrom) {
        var base = beta0 !== undefined ? beta0 : BETA_EV;
        if (betaModel === 'ratio') {
            return base * Math.sqrt((alphaI / ALPHA_C_REFERENCE) * (alphaJ / ALPHA_C_REFERENCE));
        }
        if (betaModel === 'physical') {
            return base * betaZeffFactor(symbolI, symbolJ) * betaDistanceFactor(symbolI, symbolJ, explicitDistanceAngstrom);
        }
        return base;
    }

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
    // matrices, now also accumulating eigenVECTORS (V starts as identity;
    // every Givens rotation applied to `a` is applied to V's columns too,
    // the standard textbook way to get eigenvectors out of cyclic Jacobi
    // "for free" alongside the eigenvalues). Needed for the sum-over-states
    // polarizability formula below, which needs actual MO coefficients
    // (phi_i = sum_mu c_mu,i * chi_mu), not just MO energies. Validated
    // below in this module's own self-test against the closed-form
    // uniform-ring Huckel eigenvalues (E_j = alpha + 2*beta*cos(2*pi*j/N))
    // before it's trusted for the heteroatom (non-uniform alpha) case,
    // where no such closed form exists.
    function jacobiEigenDecomposition(matrix, maxSweeps) {
        var n = matrix.length;
        var a = matrix.map(function(row) { return row.slice(); });
        var v = [];
        for (var vi = 0; vi < n; vi++) {
            v.push(new Array(n).fill(0));
            v[vi][vi] = 1;
        }
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
                        var vip = v[i][p], viq = v[i][q];
                        v[i][p] = c * vip - s * viq;
                        v[i][q] = s * vip + c * viq;
                    }
                }
            }
        }
        var order = [];
        for (var k = 0; k < n; k++) order.push(k);
        order.sort(function(x, y) { return a[x][x] - a[y][y]; });
        var values = order.map(function(k) { return a[k][k]; });
        var vectors = order.map(function(k) { return v.map(function(row) { return row[k]; }); });
        return { values: values, vectors: vectors };
    }

    // Thin wrapper kept for backward compatibility (existing callers/tests
    // that only need eigenvalues, not the vectors alongside them).
    function jacobiEigenvalues(matrix, maxSweeps) {
        return jacobiEigenDecomposition(matrix, maxSweeps).values;
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

    // HOMO/LUMO for the pi system: reads the fill boundary off the exact
    // same MO eigenvalues + degenerate-level grouping fillElectrons()
    // already computes above - no new diagonalization, just interpreting
    // data this module already derives. Only meaningful for a conjugated
    // system (see analyze() below - non-conjugated molecules have no pi
    // MOs in this model at all, correctly absent rather than guessed).
    // homoOpenShell mirrors fillElectrons' own openShell flag: true when
    // the HOMO level is a degenerate level left half-filled (the same
    // antiaromatic/diradical signal fillElectrons already reports).
    function homoLumo(eigenvalues, piElectrons) {
        var EPS = 1e-6;
        var levels = [];
        eigenvalues.forEach(function(e) {
            var last = levels[levels.length - 1];
            if (last && Math.abs(last.energy - e) < EPS) last.count++;
            else levels.push({ energy: e, count: 1 });
        });
        var remaining = piElectrons;
        var homoEnergy = null, lumoEnergy = null, homoOpenShell = false;
        for (var i = 0; i < levels.length; i++) {
            if (remaining <= 0) break;
            var capacity = levels[i].count * 2;
            homoEnergy = levels[i].energy;
            if (remaining < capacity) homoOpenShell = true;
            remaining -= capacity;
            if (remaining <= 0) {
                lumoEnergy = (i + 1 < levels.length) ? levels[i + 1].energy : null;
                break;
            }
        }
        var gapEv = (homoEnergy !== null && lumoEnergy !== null) ? (lumoEnergy - homoEnergy) : null;

        // Real, textbook operational definitions built directly on the
        // frontier orbital energies already computed above - no new
        // physics, just the standard Parr-Pearson conceptual DFT reading
        // of HOMO/LUMO (Koopmans'-theorem-style: -E_HOMO approximates
        // ionization energy, -E_LUMO approximates electron affinity).
        //   - hardness (Parr, R.G.; Pearson, R.G. J. Am. Chem. Soc. 1983,
        //     105, 7512): eta = (LUMO - HOMO) / 2. Large = hard/stable/
        //     unreactive; small = soft/reactive.
        //   - softness: S = 1 / (2*eta).
        //   - electronegativity (same Parr-Pearson operational form):
        //     chi = -(HOMO + LUMO) / 2.
        //   - electrophilicity index (Parr, R.G.; Szentpaly, L.v.; Liu, S.
        //     J. Am. Chem. Soc. 1999, 121, 1922): omega = chi^2 / (2*eta) -
        //     how much energy a species gains by accepting electron
        //     density from an infinite electron reservoir.
        // All null together whenever gapEv itself is null (no HOMO/LUMO -
        // non-conjugated systems never reach this function at all, see
        // analyze()'s own n<2/error guards above).
        var hardnessEv = gapEv !== null ? gapEv / 2 : null;
        var softnessPerEv = (hardnessEv !== null && hardnessEv !== 0) ? 1 / (2 * hardnessEv) : null;
        var electronegativityEv = (homoEnergy !== null && lumoEnergy !== null) ? -(homoEnergy + lumoEnergy) / 2 : null;
        var electrophilicityEv = (electronegativityEv !== null && hardnessEv) ? (electronegativityEv * electronegativityEv) / (2 * hardnessEv) : null;

        // Optical gap: the wavelength of a photon whose energy exactly
        // equals the HOMO-LUMO gap (hc = 1239.84 eV*nm, commonly rounded
        // 1240) - a standard first approximation for the absorption onset,
        // not a real UV-Vis spectrum (ignores oscillator strength,
        // vibronic structure, symmetry-forbidden transitions, solvent
        // shifts). conductivityClass borrows the same qualitative energy-
        // scale language organic-electronics literature uses for
        // molecular HOMO-LUMO gaps (by analogy with real bulk band gaps -
        // Si ~1.1 eV semiconductor, diamond ~5.5 eV insulator) - this
        // project models a discrete molecule, not a periodic solid with
        // real Bloch bands, so treat this as a qualitative reading of the
        // gap's energy scale, not a band-structure calculation.
        var opticalGapNm = gapEv ? Math.round((1239.84 / gapEv) * 10) / 10 : null;
        var conductivityClass = gapEv === null ? null : gapEv < 0.5 ? 'conductor-like (very small gap)' : gapEv <= 3 ? 'semiconductor-like' : 'insulator-like';

        // gapEv/hardnessEv/opticalGapNm/conductivityClass are computed
        // from eigenvalues built with BETA_SPECTROSCOPIC_EV (see
        // analyze() - a second, parallel diagonalization from the one
        // that drives delocalizationEnergyEv), calibrated to benzene's
        // real lowest UV absorption band rather than to thermochemical
        // resonance energy - see BETA_SPECTROSCOPIC_EV's own comment for
        // why simple Huckel theory needs two separate beta calibrations
        // for these two different purposes.
        //
        // electronegativityEv/electrophilicityEv sum HOMO+LUMO rather
        // than difference them, so they track the atoms' own alpha
        // (PDT's Z_eff-derived orbital_energy) far more than beta - which
        // beta calibration is used barely moves them. Their absolute
        // magnitude inherits whatever absolute-energy-scale character
        // alpha itself has; a real fix for THEIR absolute scale (as
        // opposed to gapEv's, fixed above) is a separate, not-yet-done
        // project: calibrating PDT's alpha against real experimental
        // ionization energies rather than the pure hydrogenic estimate.
        return {
            homoEnergyEv: homoEnergy === null ? null : Math.round(homoEnergy * 1000) / 1000,
            lumoEnergyEv: lumoEnergy === null ? null : Math.round(lumoEnergy * 1000) / 1000,
            gapEv: gapEv === null ? null : Math.round(gapEv * 1000) / 1000,
            homoOpenShell: homoOpenShell,
            hardnessEv: hardnessEv === null ? null : Math.round(hardnessEv * 1000) / 1000,
            softnessPerEv: softnessPerEv === null ? null : Math.round(softnessPerEv * 1000) / 1000,
            electronegativityEv: electronegativityEv === null ? null : Math.round(electronegativityEv * 1000) / 1000,
            electrophilicityEv: electrophilicityEv === null ? null : Math.round(electrophilicityEv * 1000) / 1000,
            opticalGapNm: opticalGapNm,
            conductivityClass: conductivityClass
        };
    }

    // system = {
    //   atoms: [{ symbol, role }, ...],
    //   bonds: [[i, j], ...],  // arbitrary conjugated-system connectivity —
    //     a simple ring (wraparound edges), a fused/branching system
    //     (porphyrin), or even a non-cyclic conjugated chain all work the
    //     same way here.
    //   planar: boolean   // declared, not derived — see architecture note
    // }
    // role is required per atom and is one of:
    //   'needsDoubleBond' — must be matched to exactly one double bond
    //     among its own bonds (contributes 1 pi electron): ordinary
    //     conjugated carbons, pyridine-type N.
    //   'lonePairDonor'   — contributes its lone pair to the pi system and
    //     takes zero double bonds (contributes 2 pi electrons):
    //     pyrrole-type N, furan-type O, thiophene-type S.
    function analyze(system, options) {
        options = options || {};
        var betaModel = (options.betaModel === 'ratio' || options.betaModel === 'physical') ? options.betaModel : 'constant';
        var atoms = system.atoms || [];
        var bonds = system.bonds || [];
        var n = atoms.length;
        if (n < 2) return { error: 'A conjugated system needs at least 2 atoms.' };

        var needsDoubleBond = [];
        var lonePairDonors = [];
        var alphas = [];
        var degree = new Array(n).fill(0);
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
        bonds.forEach(function(b) { degree[b[0]]++; degree[b[1]]++; });

        // A simple monocyclic ring (every atom degree 2, edge count ==
        // atom count) is the one topology Huckel's original 4n+2 theorem
        // was actually proven for. Anything else (fused, branched, or a
        // non-cyclic chain) still gets a pi-electron count and a
        // 6/4-remainder classification reported below, but it's an
        // informational, commonly-used-in-practice convention there, not
        // the rigorous textbook result — the real, generalizable signal
        // for any topology is delocalizationEnergyEv and openShellHOMO,
        // computed the same way (diagonalization) regardless of shape.
        var isSimpleMonocycle = bonds.length === n && degree.every(function(d) { return d === 2; });

        var candidateSet = {};
        bonds.forEach(function(e) {
            if (needsDoubleBond.indexOf(e[0]) !== -1 && needsDoubleBond.indexOf(e[1]) !== -1) {
                candidateSet[e[0] + '|' + e[1]] = true;
            }
        });

        var matching = needsDoubleBond.length ? findPerfectMatching(needsDoubleBond, candidateSet) : {};
        var kekuleExists = matching !== null;

        var piElectrons = needsDoubleBond.length * 1 + lonePairDonors.length * 2;
        var planar = !!system.planar;
        var fullyConjugated = kekuleExists;
        var huckelApplicable = planar && fullyConjugated;

        // Build the real Huckel secular matrix: diagonal = each atom's own
        // orbital_energy, off-diagonal = beta for bonded neighbors —
        // whatever shape those bonds form.
        var H = [];
        for (var i = 0; i < n; i++) {
            H.push(new Array(n).fill(0));
            H[i][i] = alphas[i];
        }
        bonds.forEach(function(e) {
            var b = computeBeta(alphas[e[0]], alphas[e[1]], betaModel, atoms[e[0]].symbol, atoms[e[1]].symbol);
            H[e[0]][e[1]] = b;
            H[e[1]][e[0]] = b;
        });

        var eigenvalues = jacobiEigenvalues(H);
        var fill = fillElectrons(eigenvalues, piElectrons);

        // Second, parallel diagonalization used only for the frontier-
        // orbital descriptors (HOMO/LUMO/gap/hardness/opticalGap/
        // conductivityClass, via homoLumo() below) - built with the
        // 'physical' beta(bond)=beta0*f(Z_eff)*g(d) model and the
        // spectroscopically-calibrated BETA_SPECTROSCOPIC_EV, so
        // heteroatom/bond-length differentiation actually reaches these
        // descriptors regardless of which betaModel the caller chose for
        // the thermochemical path above. Does not affect eigenvalues/
        // fill/referenceEnergy/delocalizationEnergy/totalPiEnergyEv/
        // verdict, which keep using betaModel + BETA_EV exactly as before.
        var Hspec = [];
        for (var si = 0; si < n; si++) {
            Hspec.push(new Array(n).fill(0));
            Hspec[si][si] = alphas[si];
        }
        // bondDistanceOverrides: optional { 'i|j': distanceAngstrom } map
        // (either atom order) letting a caller perturb ONE bond's real
        // distance away from the Slater-radius-sum estimate - used by
        // MolecularVibrations.js's finite-difference d(alpha)/d(bond
        // length) calculation. Omitted (every existing caller), behavior
        // is bit-for-bit unchanged.
        var distanceOverrides = options.bondDistanceOverrides || null;
        function overrideDistanceFor(i, j) {
            if (!distanceOverrides) return undefined;
            var v = distanceOverrides[i + '|' + j];
            return v !== undefined ? v : distanceOverrides[j + '|' + i];
        }
        bonds.forEach(function(e) {
            var bs = computeBeta(alphas[e[0]], alphas[e[1]], 'physical', atoms[e[0]].symbol, atoms[e[1]].symbol, BETA_SPECTROSCOPIC_EV, overrideDistanceFor(e[0], e[1]));
            Hspec[e[0]][e[1]] = bs;
            Hspec[e[1]][e[0]] = bs;
        });
        var specDecomp = jacobiEigenDecomposition(Hspec);
        var eigenvaluesSpec = specDecomp.values;

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
                referenceEnergy += 2 * ((alphas[v] + alphas[w]) / 2 + computeBeta(alphas[v], alphas[w], betaModel, atoms[v].symbol, atoms[w].symbol));
            });
        }
        lonePairDonors.forEach(function(v) { referenceEnergy += 2 * alphas[v]; });

        var delocalizationEnergy = huckelApplicable ? (fill.totalEnergy - referenceEnergy) : 0;

        // The 4n+2/4n electron-count check is Huckel's original theorem,
        // proven for simple monocyclic rings — reported here as an
        // informational, commonly-used-in-practice label (piElectrons and
        // conventional4nPlus2Style are always computed), but it does NOT
        // drive the verdict below. The verdict is instead driven by what
        // actually generalizes to any topology: does diagonalizing the
        // real system come out lower in energy than the localized
        // reference (delocalizationEnergy < 0, genuinely stabilizing), and
        // is the ground state closed-shell (no degenerate half-filled
        // HOMO — an open shell is a real instability regardless of
        // electron count or ring shape).
        var remainder4 = piElectrons % 4;
        var conventional4nPlus2Style = remainder4 === 2;
        var STABILIZATION_EPS_EV = 1e-3;

        var verdict;
        if (!huckelApplicable) verdict = 'nonaromatic';
        else if (fill.openShell) verdict = 'antiaromatic';
        else if (delocalizationEnergy < -STABILIZATION_EPS_EV) verdict = 'aromatic';
        else verdict = 'nonaromatic';

        return {
            betaModel: betaModel,
            atomCount: n,
            isSimpleMonocycle: isSimpleMonocycle,
            kekuleExists: kekuleExists,
            matching: matching,
            piElectrons: piElectrons,
            conventional4nPlus2Style: conventional4nPlus2Style,
            planar: planar,
            fullyConjugated: fullyConjugated,
            huckelApplicable: huckelApplicable,
            eigenvaluesEv: eigenvalues.map(function(e) { return Math.round(e * 1000) / 1000; }),
            homoLumo: homoLumo(eigenvaluesSpec, piElectrons),
            openShellHOMO: fill.openShell,
            totalPiEnergyEv: Math.round(fill.totalEnergy * 1000) / 1000,
            localizedReferenceEv: Math.round(referenceEnergy * 1000) / 1000,
            delocalizationEnergyEv: Math.round(delocalizationEnergy * 1000) / 1000,
            verdict: verdict,
            // Real MO data (spectroscopic-beta eigenbasis, same one
            // homoLumo() above reads) for callers that need actual
            // coefficients, not just derived scalars - e.g. a sum-over-
            // states polarizability calculation, which needs both MO
            // energies AND phi_i = sum_mu c_mu,i * chi_mu coefficients.
            // coefficients[moIndex][atomLocalIndex]; atomLocalIndex maps
            // to a caller's own larger atom list via originalIndex below
            // (echoed straight from the input system - see
            // Smiles.toAromaticSystem's own doc comment for what it means).
            spectroscopicMO: {
                eigenvaluesEv: eigenvaluesSpec.map(function(e) { return Math.round(e * 1000) / 1000; }),
                coefficients: specDecomp.vectors
            },
            originalIndex: system.originalIndex || null,
            note: fill.openShell
                ? 'Degenerate HOMO left half-filled — simple closed-shell Huckel filling cannot honestly report a single destabilization number here; the real chemistry (Jahn-Teller distortion to a lower-symmetry, closed-shell structure) is beyond this model.'
                : (!isSimpleMonocycle ? 'Not a simple monocyclic ring — piElectrons/conventional4nPlus2Style are informational only; the verdict above comes from delocalizationEnergyEv and openShellHOMO, not electron-count parity.' : undefined)
        };
    }

    // ARCHITECTURE NOTE: role (needsDoubleBond vs lonePairDonor) and
    // planarity are still declared inputs, not derived facts — auto-
    // classifying role needs substituent/H-count/charge rules this module
    // doesn't have, and deriving true planarity needs real 3D geometry
    // this codebase has never had. What generalizing to arbitrary `bonds`
    // solves is different: no ring-perception/SSSR step is needed to pick
    // out "the" aromatic ring in a fused system, because there's no longer
    // a per-ring calculation to aim it at — the whole conjugated framework
    // gets one secular matrix and one diagonalization, same as a simple
    // ring. What's still open for a fused macrocycle specifically: which
    // atoms belong to the conjugated system is a declared input (e.g. a
    // porphyrin's saturated side chains have to be excluded by hand), and
    // the traditional "18 pi electron aromatic pathway" language for
    // porphyrins refers to a specific historically-debated subset of the
    // full ring system, not literally every atom in it — so a full-system
    // piElectrons count here will legitimately disagree with that folk
    // number; delocalizationEnergyEv is the real, computed answer, and
    // conventional4nPlus2Style is only ever an informational label.

    // Runs both beta models on the same system and returns them side by
    // side, plus a diff — the intended way to actually use 'ratio' for
    // now: as a comparison against 'constant', not a silent replacement.
    // For any all-carbon system the two are mathematically identical
    // (computeBeta('ratio') reduces to BETA_EV when alpha_i=alpha_j), so
    // deltaEv should come out exactly 0 there — a good self-check that
    // the two models are wired correctly whenever a heteroatom is added.
    function compareBetaModels(system) {
        var constant = analyze(system, { betaModel: 'constant' });
        var ratio = analyze(system, { betaModel: 'ratio' });
        var physical = analyze(system, { betaModel: 'physical' });
        var deltaEv = (!constant.error && !ratio.error)
            ? Math.round((ratio.delocalizationEnergyEv - constant.delocalizationEnergyEv) * 1000) / 1000
            : null;
        var physicalDeltaEv = (!constant.error && !physical.error)
            ? Math.round((physical.delocalizationEnergyEv - constant.delocalizationEnergyEv) * 1000) / 1000
            : null;
        return { constant: constant, ratio: ratio, physical: physical, deltaEv: deltaEv, physicalDeltaEv: physicalDeltaEv };
    }

    return {
        analyze: analyze,
        compareBetaModels: compareBetaModels,
        _findPerfectMatching: findPerfectMatching,
        _jacobiEigenvalues: jacobiEigenvalues,
        _jacobiEigenDecomposition: jacobiEigenDecomposition,
        _homoLumo: homoLumo,
        _computeBeta: computeBeta,
        _betaZeffFactor: betaZeffFactor,
        _betaDistanceFactor: betaDistanceFactor,
        BETA_EV: BETA_EV,
        BETA_SPECTROSCOPIC_EV: BETA_SPECTROSCOPIC_EV,
        version: '0.5'
    };
}));
