// UMD IIFE - Coordination Chemistry module (extends PDT)
//
// PDT.stable() treats a whole formula as one flat ionic valence-sum: every
// atom's V*bonding.sign gets thrown into a single pool, which is correct for
// ordinary covalent molecules but wrong for coordination complexes — a
// transition metal's acceptor valence isn't satisfied by "the formula's
// overall charge balance," it's satisfied *locally* by specific donor atoms
// (classically N, O, S) donating a lone pair into it. Dumping Fe's V=4
// acceptor charge into the same global sum as every C-H bond in a porphyrin
// ring is why PDT.stable("C34H32FeN4O4") — heme b — comes back "unstable"
// even though it's one of the most famous stable molecules in biochemistry.
//
// This module doesn't replace PDT.stable's global check; it runs it on a
// *leftover* atom pool after pulling out whatever satisfies each metal
// center locally, and reports both. See ARCHITECTURE NOTE below for the
// one real limitation this approach has.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./PDT'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./PDT.js'));
    } else {
        root.CoordinationChemistry = factory(root.PDT);
    }
}(typeof self !== 'undefined' ? self : this, function(PDT) {
    'use strict';
    if (!PDT) throw new Error('CoordinationChemistry requires PDT');

    // Classic hard/borderline Lewis-base donor atoms, in a simplified
    // priority order (roughly HSAB-generalized: most first-row transition
    // metals are hard-to-borderline and favor N/O over the softer S). This
    // is a deliberate simplification, not the real spectrochemical series —
    // documented here rather than derived, same as PDT's own element table.
    var DONOR_PRIORITY = ['N', 'O', 'S'];

    function isMetalCenter(symbol) {
        var el = PDT.get(symbol);
        return !!el && (el.block === 'd' || el.block === 'f');
    }

    // Sorts a parsed [{symbol,count}] list into a canonical "C6H12O6"-style
    // string (alphabetical by symbol) so a reference-library lookup doesn't
    // care what order the user typed the formula's elements in.
    function canonicalFormula(parsedEntries) {
        return parsedEntries
            .slice()
            .sort(function(a, b) { return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0; })
            .map(function(p) { return p.symbol + p.count; })
            .join('');
    }

    // ─── Reference library ──────────────────────────────────────────────
    // Known coordination compounds where the real metal-ligand connectivity
    // is simply recorded, not inferred — see ARCHITECTURE NOTE below for why
    // that's necessary for anything beyond the single-metal heuristic case.
    // Keyed by canonicalFormula().
    var REFERENCE_LIBRARY = {
        'C34Fe1H32N4O4': {
            name: 'Heme b (iron-protoporphyrin IX)',
            metal: 'Fe',
            ligandDonors: { N: 4 },
            stable: true,
            geometry: 'Square-pyramidal / octahedral at Fe — 4 pyrrole N equatorial ' +
                '(satisfied by this formula alone); 1-2 axial sites are occupied in ' +
                'vivo by a protein residue and/or a substrate or O2, not present in ' +
                'the bare cofactor formula.',
            aromatic: true,
            notes: 'The Fe-N4 porphyrin core shared by hemoglobin, myoglobin, and ' +
                'cytochrome P450. The macrocycle is an 18 pi-electron aromatic ' +
                'system — additional real stabilization this model does not derive ' +
                'on its own; recorded here as a flag rather than computed.'
        }
    };

    // ─── Local coordination analysis ────────────────────────────────────
    // For each acceptor-type metal center, its own already-computed V *is*
    // the number of donor-lone-pair units it needs — Fe's V=4 is exactly
    // "4 dative bonds," which is why 4 pyrrole nitrogens satisfy it exactly.
    // Reusing V here (rather than inventing a separate "coordination number"
    // table) keeps this grounded in numbers PDT already computes.
    function analyzeCenters(parsedEntries) {
        var metals = parsedEntries.filter(function(p) { return isMetalCenter(p.symbol); });
        var pool = {};
        DONOR_PRIORITY.forEach(function(sym) { pool[sym] = 0; });
        parsedEntries.forEach(function(p) {
            if (DONOR_PRIORITY.indexOf(p.symbol) !== -1) pool[p.symbol] += p.count;
        });

        var centers = metals.map(function(m) {
            var el = PDT.get(m.symbol);
            if (el.bonding.type !== 'acceptor') {
                return {
                    symbol: m.symbol, count: m.count, supported: false,
                    note: 'bonding.type="' + el.bonding.type + '" — only acceptor-type ' +
                        'metal centers are handled by this module; falling back to the ' +
                        'global covalent check for this atom.',
                    localBalanced: null, donorsConsumed: {}
                };
            }
            var need = el.V * m.count;
            var requiredDonorUnits = need;
            var donorsConsumed = {};
            DONOR_PRIORITY.forEach(function(donorSym) {
                if (need <= 0) return;
                var take = Math.min(need, pool[donorSym]);
                if (take > 0) {
                    donorsConsumed[donorSym] = take;
                    pool[donorSym] -= take;
                    need -= take;
                }
            });
            return {
                symbol: m.symbol, count: m.count, supported: true, V: el.V,
                requiredDonorUnits: requiredDonorUnits, donorsConsumed: donorsConsumed,
                unmetUnits: need, localBalanced: need === 0
            };
        });

        return { centers: centers, remainingDonorPool: pool };
    }

    // Whatever donor-atom units weren't consumed by a metal center, plus
    // every non-metal atom, still has to balance under the ordinary global
    // covalent rule (PDT.valenceBalance) — just on the leftover pool.
    function leftoverAfterCoordination(parsedEntries, centers) {
        var consumedTotals = {};
        centers.forEach(function(c) {
            Object.keys(c.donorsConsumed || {}).forEach(function(sym) {
                consumedTotals[sym] = (consumedTotals[sym] || 0) + c.donorsConsumed[sym];
            });
        });
        return parsedEntries
            .filter(function(p) { return !isMetalCenter(p.symbol); })
            .map(function(p) {
                var count = p.count - (consumedTotals[p.symbol] || 0);
                return { symbol: p.symbol, count: count };
            })
            .filter(function(p) { return p.count > 0; });
    }

    // ─── Public entry point ─────────────────────────────────────────────
    // Runs PDT.stable's parser + naive global check first (for the parsed
    // atom list and for side-by-side comparison), then layers the local
    // per-metal-center analysis on top.
    function analyze(formula) {
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        var naiveGlobal = PDT.stable(formula);
        if (naiveGlobal.error) return { error: naiveGlobal.error };

        var canonical = canonicalFormula(naiveGlobal.parsed);
        var reference = REFERENCE_LIBRARY[canonical] || null;
        var metals = naiveGlobal.parsed.filter(function(p) { return isMetalCenter(p.symbol); });

        if (!metals.length) {
            return {
                formula: formula, canonical: canonical, isCoordinationComplex: false,
                reference: reference, naiveGlobal: naiveGlobal, stable: naiveGlobal.balanced,
                elapsedMs: elapsed(t0)
            };
        }

        var analysis = analyzeCenters(naiveGlobal.parsed);
        var leftoverParsed = leftoverAfterCoordination(naiveGlobal.parsed, analysis.centers);
        var leftoverResult = leftoverParsed.length ? PDT.valenceBalance(leftoverParsed) : { sum: 0, balanced: true };

        var allSupported = analysis.centers.every(function(c) { return c.supported; });
        var allCentersBalanced = allSupported && analysis.centers.every(function(c) { return c.localBalanced; });
        var heuristicStable = allCentersBalanced && leftoverResult.balanced;

        var stable = reference ? reference.stable : heuristicStable;
        var geometry = reference ? reference.geometry : analysis.centers.map(function(c) {
            if (!c.supported) return c.symbol + ': ' + c.note;
            return c.symbol + (c.count > 1 ? ' x' + c.count : '') + ': ' +
                (c.localBalanced ? 'coordinatively satisfied (' + Object.keys(c.donorsConsumed).map(function(s) { return c.donorsConsumed[s] + 'x' + s; }).join(', ') + ')'
                                  : c.unmetUnits + ' unit(s) short of a satisfied center');
        }).join('; ');

        return {
            formula: formula,
            canonical: canonical,
            isCoordinationComplex: true,
            reference: reference,
            centers: analysis.centers,
            leftover: { parsed: leftoverParsed, sum: leftoverResult.sum, balanced: leftoverResult.balanced },
            naiveGlobal: naiveGlobal,
            stable: stable,
            geometry: geometry,
            aromaticBonus: reference ? !!reference.aromatic : false,
            message: stable ? '✅ Stable coordination complex' : '❌ Unstable (coordination centers unsatisfied)',
            elapsedMs: elapsed(t0)
        };
    }

    function elapsed(t0) {
        var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        return t1 - t0;
    }

    // ARCHITECTURE NOTE: a molecular formula is a flat atom-count bag with
    // no bond graph, so "which specific donor atoms coordinate the metal"
    // is not, in general, derivable from stoichiometry alone (isomers can
    // share a formula with completely different connectivity — this is the
    // classic structure-from-stoichiometry problem, not a bug in this
    // module). analyzeCenters's greedy allocation is a heuristic that
    // works when there's one metal center and the available donor supply
    // roughly matches its needs (as it does for heme). For anything more
    // ambiguous — multiple competing metal centers, more donor atoms
    // available than any single center needs, genuinely novel complexes —
    // treat the heuristic result as a best-effort estimate and prefer a
    // REFERENCE_LIBRARY entry (real, documented connectivity) when one
    // exists, which is what `analyze()` already does.

    return {
        isMetalCenter: isMetalCenter,
        canonicalFormula: canonicalFormula,
        analyze: analyze,
        referenceLibrary: REFERENCE_LIBRARY,
        version: '0.1'
    };
}));
