// UMD IIFE - MolecularStructure: the canonical molecule data model and its
// derived properties (formula, molar mass, per-atom hybridization, formal
// charge, lone pairs, coordination geometry). Sits on top of the already-
// validated PDT/Smiles/Aromaticity modules; adds no new element data or
// aromaticity math of its own.
//
// A molecule here is always { atoms: [{symbol, aromatic, explicitH, charge}],
// bonds: [[i, j, order]] } - order is 1, 2, 3, or the string 'aromatic'.
// This is exactly Smiles.parse()'s own output shape, so fromSmiles() and
// fromGraph() both just normalize into it; nothing downstream needs to know
// which path a molecule came from.
//
// Every field below is either DERIVED (computed here from the graph plus
// PDT's already-verified per-element data), PARSED (taken directly from
// SMILES/bracket-atom notation - explicitH, charge), or REFERENCE (a cited
// published constant, namely standard atomic weights - not "derived" any
// more than an element's name/symbol already isn't in PDT.js's own data).
// Nothing here is asserted/guessed; where a real limitation exists
// (unclear coordination geometry for a d-block center, no valid Kekule
// structure) it is reported as a warning, not silently papered over.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./PDT', './Smiles', './Aromaticity'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./PDT.js'), require('./Smiles.js'), require('./Aromaticity.js'));
    } else {
        root.MolecularStructure = factory(root.PDT, root.Smiles, root.Aromaticity);
    }
}(typeof self !== 'undefined' ? self : this, function(PDT, Smiles, Aromaticity) {
    'use strict';
    if (!PDT) throw new Error('MolecularStructure requires PDT');
    if (!Smiles) throw new Error('MolecularStructure requires Smiles');
    if (!Aromaticity) throw new Error('MolecularStructure requires Aromaticity');

    // ================================================================
    // Reference data: CIAAW/IUPAC standard atomic weights (2021 table,
    // conventional single value where a range is published). Elements
    // with no stable isotope (flag=true) use the mass number of their
    // longest-lived known isotope in brackets, the same convention every
    // printed periodic table uses for those entries - explicitly NOT a
    // "standard atomic weight" in the strict sense, and flagged as such
    // in molarMass()'s warnings whenever one is used.
    // ================================================================
    var STANDARD_ATOMIC_WEIGHT = {
        H: [1.008, false], He: [4.002602, false], Li: [6.94, false], Be: [9.0121831, false],
        B: [10.81, false], C: [12.011, false], N: [14.007, false], O: [15.999, false],
        F: [18.998403163, false], Ne: [20.1797, false], Na: [22.98976928, false], Mg: [24.305, false],
        Al: [26.9815384, false], Si: [28.085, false], P: [30.973761998, false], S: [32.06, false],
        Cl: [35.45, false], Ar: [39.95, false], K: [39.0983, false], Ca: [40.078, false],
        Sc: [44.955908, false], Ti: [47.867, false], V: [50.9415, false], Cr: [51.9961, false],
        Mn: [54.938043, false], Fe: [55.845, false], Co: [58.933194, false], Ni: [58.6934, false],
        Cu: [63.546, false], Zn: [65.38, false], Ga: [69.723, false], Ge: [72.630, false],
        As: [74.921595, false], Se: [78.971, false], Br: [79.904, false], Kr: [83.798, false],
        Rb: [85.4678, false], Sr: [87.62, false], Y: [88.90584, false], Zr: [91.224, false],
        Nb: [92.90637, false], Mo: [95.95, false], Tc: [98, true], Ru: [101.07, false],
        Rh: [102.90549, false], Pd: [106.42, false], Ag: [107.8682, false], Cd: [112.414, false],
        In: [114.818, false], Sn: [118.710, false], Sb: [121.760, false], Te: [127.60, false],
        I: [126.90447, false], Xe: [131.293, false], Cs: [132.90545196, false], Ba: [137.327, false],
        La: [138.90547, false], Ce: [140.116, false], Pr: [140.90766, false], Nd: [144.242, false],
        Pm: [145, true], Sm: [150.36, false], Eu: [151.964, false], Gd: [157.25, false],
        Tb: [158.925354, false], Dy: [162.500, false], Ho: [164.930328, false], Er: [167.259, false],
        Tm: [168.934218, false], Yb: [173.045, false], Lu: [174.9668, false], Hf: [178.486, false],
        Ta: [180.94788, false], W: [183.84, false], Re: [186.207, false], Os: [190.23, false],
        Ir: [192.217, false], Pt: [195.084, false], Au: [196.966570, false], Hg: [200.592, false],
        Tl: [204.38, false], Pb: [207.2, false], Bi: [208.98040, false], Po: [209, true],
        At: [210, true], Rn: [222, true], Fr: [223, true], Ra: [226, true],
        Ac: [227, true], Th: [232.0377, false], Pa: [231.03588, false], U: [238.02891, false],
        Np: [237, true], Pu: [244, true], Am: [243, true], Cm: [247, true],
        Bk: [247, true], Cf: [251, true], Es: [252, true], Fm: [257, true],
        Md: [258, true], No: [259, true], Lr: [266, true], Rf: [267, true],
        Db: [268, true], Sg: [269, true], Bh: [270, true], Hs: [270, true],
        Mt: [278, true], Ds: [281, true], Rg: [282, true], Cn: [285, true],
        Nh: [286, true], Fl: [289, true], Mc: [290, true], Lv: [293, true],
        Ts: [294, true], Og: [294, true]
    };

    // Real Daylight/OpenSMILES normal valences for the organic subset -
    // used ONLY to infer implicit H on non-bracket atoms (bracket atoms
    // always carry their own explicit, literal H count and never touch
    // this table). Listed lowest-first; the smallest entry that is not
    // less than the atom's actual bond-order sum is the one used.
    var DEFAULT_VALENCE = {
        B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6],
        F: [1], Cl: [1], Br: [1], I: [1]
    };

    var NOBLE_GASES = { He: true, Ne: true, Ar: true, Kr: true, Xe: true, Rn: true, Og: true };

    var HYBRIDIZATION_BY_STERIC = { 2: 'sp', 3: 'sp2', 4: 'sp3', 5: 'sp3d', 6: 'sp3d2' };

    // Main-group VSEPR electron-domain -> molecular geometry, keyed
    // 'stericNumber/lonePairs'. Only defined where the arrangement names a
    // real central-atom shape (2+ bonded neighbors); a terminal atom (1
    // neighbor) has a hybridization but no conventionally-named "shape",
    // so it's left undefined on purpose rather than guessed.
    var MAIN_GROUP_GEOMETRY = {
        '2/0': 'linear',
        '3/0': 'trigonal planar', '3/1': 'bent',
        '4/0': 'tetrahedral', '4/1': 'trigonal pyramidal', '4/2': 'bent',
        '5/0': 'trigonal bipyramidal', '5/1': 'seesaw', '5/2': 'T-shaped', '5/3': 'linear',
        '6/0': 'octahedral', '6/1': 'square pyramidal', '6/2': 'square planar'
    };

    // Coordination-number -> geometry name(s) for d/f-block centers, where
    // classical VSEPR lone-pair bookkeeping doesn't apply (d-block bonding
    // is ligand/crystal-field chemistry, not shared-electron-pair Lewis
    // structures). Ambiguous coordination numbers list every geometry
    // consistent with that count; picking one needs ligand-field data this
    // module doesn't have, so all candidates are reported, not one guess.
    var COORDINATION_GEOMETRY_BY_NUMBER = {
        2: ['linear'],
        3: ['trigonal planar', 'trigonal pyramidal'],
        4: ['tetrahedral', 'square planar'],
        5: ['trigonal bipyramidal', 'square pyramidal'],
        6: ['octahedral'],
        7: ['pentagonal bipyramidal', 'capped octahedral'],
        8: ['square antiprismatic', 'dodecahedral']
    };

    function normalizeAtom(a) {
        return {
            symbol: a.symbol,
            aromatic: !!a.aromatic,
            explicitH: (a.explicitH === undefined) ? null : a.explicitH,
            charge: a.charge || 0
        };
    }

    function fromSmiles(smilesString) {
        var parsed;
        try {
            parsed = Smiles.parse(smilesString);
        } catch (e) {
            return { error: 'SMILES parse error: ' + e.message };
        }
        return {
            atoms: parsed.atoms.map(normalizeAtom),
            bonds: parsed.bonds.map(function(b) { return [b[0], b[1], b[2]]; })
        };
    }

    // Accepts a hand-built graph (the Build/Add path) in the same shape;
    // bond order defaults to 1 (a plain single bond) when omitted.
    function fromGraph(graph) {
        if (!graph || !graph.atoms || !graph.bonds) return { error: 'fromGraph requires { atoms, bonds }' };
        return {
            atoms: graph.atoms.map(normalizeAtom),
            bonds: graph.bonds.map(function(b) { return [b[0], b[1], b[2] === undefined ? 1 : b[2]]; })
        };
    }

    // Runs the molecule's ring/conjugated-system bonds through
    // Aromaticity.analyze ONCE (role assignment + real Kekule perfect
    // matching + the Huckel MO verdict) so both the implicit-H/lone-pair
    // bookkeeping below and the whole-molecule aromaticity field in
    // analyze()'s return value come from the exact same computation -
    // never two separate calls that could disagree.
    function buildAromaticContext(molecule, planar, betaModel) {
        var relevant = molecule.bonds.some(function(b) { return b[2] === 'aromatic' || b[2] === 2 || b[2] === 3; });
        if (!relevant) return null;
        var aromSystem = Smiles.toAromaticSystem(molecule, !!planar);
        if (aromSystem.atoms.length < 2) return null;
        var aromResult = Aromaticity.analyze(aromSystem, { betaModel: betaModel });
        var ctx = { aromSystem: aromSystem, aromResult: aromResult, roleByAtom: null, toLocal: null };
        if (aromResult.error) return ctx;
        var roleByAtom = {};
        var toLocal = {};
        aromSystem.originalIndex.forEach(function(orig, local) {
            roleByAtom[orig] = aromSystem.atoms[local].role;
            toLocal[orig] = local;
        });
        ctx.roleByAtom = roleByAtom;
        ctx.toLocal = toLocal;
        return ctx;
    }

    // Concretizes every 'aromatic'-order bond to a real integer 1 or 2
    // using the Kekule matching above - NOT "aromatic counts as 1 for
    // everyone," which undercounts alternating-double-bond ring atoms
    // (e.g. would give benzene carbons 2 implicit H instead of the real
    // 1). Falls back to 1 (documented, warned) only when no valid Kekule
    // structure exists at all.
    function concretizeBondOrders(molecule, ctx) {
        var concreteOrder = molecule.bonds.map(function(b) { return b[2]; });
        var warnings = [];
        var hasAromaticBond = molecule.bonds.some(function(b) { return b[2] === 'aromatic'; });
        if (!hasAromaticBond) return { concreteOrder: concreteOrder, warnings: warnings };
        var matchingOk = !!(ctx && ctx.aromResult && ctx.aromResult.kekuleExists && ctx.toLocal);
        if (!matchingOk) {
            warnings.push('No valid Kekule structure found for the aromatic/conjugated system - aromatic bonds approximated as order 1 for implicit-H and lone-pair bookkeeping.');
        }
        var matching = matchingOk ? (ctx.aromResult.matching || {}) : {};
        molecule.bonds.forEach(function(b, bi) {
            if (b[2] !== 'aromatic') return;
            if (!matchingOk) { concreteOrder[bi] = 1; return; }
            var l0 = ctx.toLocal[b[0]], l1 = ctx.toLocal[b[1]];
            if (l0 === undefined || l1 === undefined) { concreteOrder[bi] = 1; return; }
            var isDouble = matching[l0] === l1 || matching[l1] === l0;
            concreteOrder[bi] = isDouble ? 2 : 1;
        });
        return { concreteOrder: concreteOrder, warnings: warnings };
    }

    function perAtomAnalysis(molecule, ctx, concrete) {
        var n = molecule.atoms.length;
        var concreteOrder = concrete.concreteOrder;
        var bondsOf = [];
        for (var i = 0; i < n; i++) bondsOf.push([]);
        molecule.bonds.forEach(function(b, bi) {
            bondsOf[b[0]].push(bi);
            bondsOf[b[1]].push(bi);
        });

        var results = [];
        var warnings = [];
        for (i = 0; i < n; i++) {
            var atom = molecule.atoms[i];
            var el = PDT.get(atom.symbol);
            if (!el) {
                results.push({ index: i, symbol: atom.symbol, error: 'Unknown element' });
                continue;
            }

            var neighborCount = bondsOf[i].length; // sigma-bond count, order-independent
            var bondOrderSum = 0;
            bondsOf[i].forEach(function(bi) {
                var ord = concreteOrder[bi];
                bondOrderSum += (ord === 'aromatic') ? 1 : ord; // defensive fallback, see concretizeBondOrders
            });

            var isBracket = (atom.explicitH !== null);
            var atomWarnings = [];
            var implicitH;
            if (isBracket) {
                implicitH = atom.explicitH;
            } else if (atom.symbol === 'H') {
                implicitH = 0;
            } else {
                var table = DEFAULT_VALENCE[atom.symbol];
                if (!table) {
                    implicitH = 0;
                    atomWarnings.push('No default valence table for ' + atom.symbol + ' - implicit H assumed 0.');
                } else {
                    var chosen = null;
                    for (var t = 0; t < table.length; t++) {
                        if (table[t] >= bondOrderSum) { chosen = table[t]; break; }
                    }
                    if (chosen === null) {
                        atomWarnings.push('Bond order sum (' + bondOrderSum + ') exceeds every normal valence for ' + atom.symbol + ' - overvalent, implicit H forced to 0.');
                        implicitH = 0;
                    } else {
                        implicitH = chosen - bondOrderSum;
                    }
                }
            }

            var totalNeighbors = neighborCount + implicitH;
            var totalBondOrder = bondOrderSum + implicitH; // each implicit H is a single bond

            // H/He never hybridize (a bare 1s orbital, no lone-pair
            // bookkeeping applies); noble gases are excluded as a scope
            // simplification (real Xe/Kr compounds exist but are outside
            // this module's organic/coordination-chemistry focus for now).
            var isMainGroup = (el.block === 's' || el.block === 'p') && atom.symbol !== 'H' && !NOBLE_GASES[atom.symbol];

            var lonePairs = null, stericNumber = null, hybridization = null, geometry = null;
            var role = (ctx && ctx.roleByAtom) ? ctx.roleByAtom[i] : undefined;
            if (isMainGroup) {
                var valenceElectrons = PDT.valenceElectronCount(el.Z);
                var nonbonding = valenceElectrons - atom.charge - totalBondOrder;
                if (nonbonding < 0) {
                    atomWarnings.push('Computed nonbonding electron count is negative (' + nonbonding + ') - bonding pattern exceeds this atom\'s valence electrons; lone pairs reported as 0.');
                    nonbonding = 0;
                }
                if (nonbonding % 2 !== 0) {
                    atomWarnings.push('Nonbonding electron count is odd (' + nonbonding + ') - radical character, not a closed-shell Lewis structure.');
                }
                lonePairs = Math.floor(nonbonding / 2);

                // A donated pi lone pair (pyrrole-type N, furan-type O...)
                // occupies a p-orbital, not a hybrid orbital - it must not
                // inflate steric number the way a classical lone pair does
                // (real pyrrole N is planar/sp2, steric number 3, not
                // tetrahedral/sp3). Only applied when Aromaticity.js itself
                // assigned this atom role 'lonePairDonor' - never guessed.
                var stericLonePairs = lonePairs;
                if (role === 'lonePairDonor' && stericLonePairs > 0) stericLonePairs -= 1;

                stericNumber = totalNeighbors + stericLonePairs;
                hybridization = HYBRIDIZATION_BY_STERIC[stericNumber] || null;
                if (!hybridization) atomWarnings.push('Steric number ' + stericNumber + ' has no standard hybridization name on file.');
                geometry = MAIN_GROUP_GEOMETRY[stericNumber + '/' + stericLonePairs] || null;
            } else if (atom.symbol !== 'H') {
                // d/f-block (or a noble gas center, e.g. a noble-gas
                // compound built via fromGraph): report coordination
                // number + every geometry consistent with it.
                geometry = COORDINATION_GEOMETRY_BY_NUMBER[totalNeighbors] || null;
            }

            results.push({
                index: i,
                symbol: atom.symbol,
                charge: atom.charge,
                implicitH: implicitH,
                neighborCount: neighborCount,
                totalNeighbors: totalNeighbors,
                bondOrderSum: totalBondOrder,
                isMainGroupCovalent: isMainGroup,
                lonePairs: lonePairs,
                stericNumber: stericNumber,
                hybridization: hybridization,
                geometry: geometry,
                piSystemRole: role || null,
                warnings: atomWarnings
            });
            warnings = warnings.concat(atomWarnings.map(function(w) { return 'atom ' + i + ' (' + atom.symbol + '): ' + w; }));
        }
        return { perAtom: results, warnings: warnings };
    }

    // Hill system: C first, H second (only if C present), everything else
    // alphabetical; if there's no carbon, everything (H included) is
    // alphabetical. The standard convention every published formula uses.
    function formula(molecule, perAtomResults) {
        var counts = {};
        function add(sym, count) { counts[sym] = (counts[sym] || 0) + count; }
        molecule.atoms.forEach(function(a, i) {
            add(a.symbol, 1);
            var h = perAtomResults[i] && perAtomResults[i].implicitH;
            if (h) add('H', h);
        });
        var symbols = Object.keys(counts);
        var ordered;
        if (counts.C) {
            var rest = symbols.filter(function(s) { return s !== 'C' && s !== 'H'; }).sort();
            ordered = ['C'].concat(counts.H ? ['H'] : []).concat(rest);
        } else {
            ordered = symbols.sort();
        }
        var str = ordered.map(function(s) { return s + (counts[s] > 1 ? counts[s] : ''); }).join('');
        return { counts: counts, string: str };
    }

    function molarMass(counts) {
        var total = 0;
        var warnings = [];
        Object.keys(counts).forEach(function(sym) {
            var entry = STANDARD_ATOMIC_WEIGHT[sym];
            if (!entry) { warnings.push('No standard atomic weight on file for ' + sym + '.'); return; }
            total += entry[0] * counts[sym];
            if (entry[1]) warnings.push(sym + ' has no stable isotope - using the mass number of its most stable known isotope, not a true standard atomic weight.');
        });
        return { value: Math.round(total * 1000) / 1000, warnings: warnings };
    }

    // The one entry point: molecule -> the full derived-property report.
    // options: { planar, betaModel } - both pass straight through to
    // Aromaticity.analyze (planar is a declared input there, same
    // documented limitation as everywhere else this module is used).
    function analyze(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var ctx = buildAromaticContext(molecule, options.planar, options.betaModel);
        var concrete = concretizeBondOrders(molecule, ctx);
        var atomResult = perAtomAnalysis(molecule, ctx, concrete);
        var f = formula(molecule, atomResult.perAtom);
        var mass = molarMass(f.counts);
        return {
            formula: f,
            molarMass: mass,
            perAtom: atomResult.perAtom,
            aromaticity: ctx ? ctx.aromResult : null,
            warnings: concrete.warnings.concat(atomResult.warnings).concat(mass.warnings),
            version: '0.1'
        };
    }

    return {
        fromSmiles: fromSmiles,
        fromGraph: fromGraph,
        analyze: analyze,
        perAtomAnalysis: perAtomAnalysis,
        formula: formula,
        molarMass: molarMass,
        STANDARD_ATOMIC_WEIGHT: STANDARD_ATOMIC_WEIGHT,
        DEFAULT_VALENCE: DEFAULT_VALENCE,
        HYBRIDIZATION_BY_STERIC: HYBRIDIZATION_BY_STERIC,
        MAIN_GROUP_GEOMETRY: MAIN_GROUP_GEOMETRY,
        COORDINATION_GEOMETRY_BY_NUMBER: COORDINATION_GEOMETRY_BY_NUMBER,
        version: '0.1'
    };
}));
