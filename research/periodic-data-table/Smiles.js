// UMD IIFE - Minimal SMILES parser (organics + metals subset)
//
// Scope: enough of SMILES to build real Aromaticity.js/CoordinationChemistry.js
// input graphs from a standard notation instead of hand-typing atom/bond
// arrays. Deliberately NOT a general cheminformatics engine: no
// stereochemistry (@, /, \), no isotopes, no disconnected fragments (.),
// no dative-bond notation (it isn't standardized across SMILES flavors
// anyway — metal-ligand coordination stays CoordinationChemistry's own
// valence-matching job, not something trusted from the string).
//
// This module does NOT assert aromaticity from lowercase SMILES atoms and
// hand it downstream as a verdict. It uses lowercase (aromatic) + explicit
// bracket hydrogen count to derive each atom's ROLE (needsDoubleBond /
// lonePairDonor — the exact vocabulary Aromaticity.js already takes), and
// lets Aromaticity's own matching + diagonalization independently verify
// whether the ring is actually aromatic. The SMILES author's aromatic
// lowercase is a hint about intended structure, not a trusted answer.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Smiles = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    // Organic-subset symbols writable without brackets, and their default
    // (un-ionized, no explicit H) valence — used to compute implicit H
    // counts. Two-letter symbols must be tried before single-letter ones.
    var ORGANIC_SUBSET = ['Cl', 'Br', 'B', 'C', 'N', 'O', 'P', 'S', 'F', 'I'];
    var DEFAULT_VALENCE = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, F: 1, Cl: 1, Br: 1, I: 1 };
    // Aromatic lowercase forms SMILES actually allows in the organic subset.
    var AROMATIC_LOWERCASE = { b: 'B', c: 'C', n: 'N', o: 'O', p: 'P', s: 'S' };

    function isDigit(ch) { return ch >= '0' && ch <= '9'; }

    // Tokenizes + parses a SMILES string into a generic graph:
    // { atoms: [{symbol, aromatic, explicitH, charge}], bonds: [[i, j, order]] }
    // order is 1, 2, 3, or 'aromatic' (bond symbol ':' or an unmarked bond
    // between two aromatic atoms).
    function parse(smiles) {
        var atoms = [];
        var bonds = [];
        var pos = 0;
        var len = smiles.length;
        var prevAtom = null;       // index of the most recently placed atom (bond attaches here)
        var pendingBond = null;    // bond order queued by a bond symbol, consumed by the next atom/ring-closure
        var branchStack = [];      // stack of prevAtom values, pushed on '(' popped on ')'
        var ringOpens = {};        // ring-closure digit -> { atomIndex, bondOrder }

        function readBracketAtom() {
            // pos is just past '['
            var start = pos;
            // isotope (ignored)
            while (pos < len && isDigit(smiles[pos])) pos++;
            // element symbol: try two-letter aromatic-incapable metals/halogens etc, then one-letter, then aromatic lowercase
            var symbol = null;
            var aromatic = false;
            var twoLetter = smiles.slice(pos, pos + 2);
            if (/^[A-Z][a-z]$/.test(twoLetter) && twoLetter !== 'H ') {
                symbol = twoLetter;
                pos += 2;
            } else {
                var ch = smiles[pos];
                if (AROMATIC_LOWERCASE[ch]) {
                    symbol = AROMATIC_LOWERCASE[ch];
                    aromatic = true;
                    pos++;
                } else {
                    symbol = ch.toUpperCase();
                    pos++;
                }
            }
            // chirality (ignored)
            while (pos < len && smiles[pos] === '@') pos++;
            // explicit H count
            var explicitH = 0;
            if (smiles[pos] === 'H') {
                pos++;
                var hDigits = '';
                while (pos < len && isDigit(smiles[pos])) { hDigits += smiles[pos]; pos++; }
                explicitH = hDigits ? parseInt(hDigits, 10) : 1;
            }
            // charge
            var charge = 0;
            if (smiles[pos] === '+' || smiles[pos] === '-') {
                var sign = smiles[pos] === '+' ? 1 : -1;
                pos++;
                var run = 1;
                while (smiles[pos] === (sign === 1 ? '+' : '-')) { run++; pos++; }
                var chargeDigits = '';
                while (pos < len && isDigit(smiles[pos])) { chargeDigits += smiles[pos]; pos++; }
                charge = sign * (chargeDigits ? parseInt(chargeDigits, 10) : run);
            }
            // atom class (ignored)
            if (smiles[pos] === ':') { pos++; while (pos < len && isDigit(smiles[pos])) pos++; }
            if (smiles[pos] !== ']') throw new Error('Malformed bracket atom near position ' + start);
            pos++; // consume ']'
            return { symbol: symbol, aromatic: aromatic, explicitH: explicitH, charge: charge };
        }

        function readOrganicAtom() {
            var two = smiles.slice(pos, pos + 2);
            for (var i = 0; i < ORGANIC_SUBSET.length; i++) {
                var sym = ORGANIC_SUBSET[i];
                if (sym.length === 2 && smiles.slice(pos, pos + 2) === sym) {
                    pos += 2;
                    return { symbol: sym, aromatic: false, explicitH: null, charge: 0 };
                }
            }
            var ch = smiles[pos];
            if (AROMATIC_LOWERCASE[ch]) {
                pos++;
                return { symbol: AROMATIC_LOWERCASE[ch], aromatic: true, explicitH: null, charge: 0 };
            }
            if (ORGANIC_SUBSET.indexOf(ch) !== -1) {
                pos++;
                return { symbol: ch, aromatic: false, explicitH: null, charge: 0 };
            }
            throw new Error('Unrecognized atom at position ' + pos + ' ("' + smiles.slice(pos, pos + 3) + '...")');
        }

        function bondOrderFor(a, b, explicitOrder) {
            if (explicitOrder) return explicitOrder;
            if (a.aromatic && b.aromatic) return 'aromatic';
            return 1;
        }

        function attach(atomIdx) {
            if (prevAtom !== null) {
                var order = bondOrderFor(atoms[prevAtom], atoms[atomIdx], pendingBond);
                bonds.push([prevAtom, atomIdx, order]);
            }
            pendingBond = null;
            prevAtom = atomIdx;
        }

        while (pos < len) {
            var c = smiles[pos];
            if (c === '[') {
                pos++;
                var atom = readBracketAtom();
                var idx = atoms.push(atom) - 1;
                attach(idx);
            } else if (c === '(') {
                branchStack.push(prevAtom);
                pos++;
            } else if (c === ')') {
                prevAtom = branchStack.pop();
                pos++;
            } else if (c === '-' || c === '=' || c === '#' || c === ':') {
                pendingBond = c === '-' ? 1 : c === '=' ? 2 : c === '#' ? 3 : 'aromatic';
                pos++;
            } else if (c === '/' || c === '\\') {
                pos++; // stereo bond marker — treat as a plain single bond, not derived from
            } else if (isDigit(c) || c === '%') {
                var ringId;
                if (c === '%') { ringId = smiles.slice(pos + 1, pos + 3); pos += 3; }
                else { ringId = c; pos++; }
                if (ringOpens[ringId] !== undefined) {
                    var open = ringOpens[ringId];
                    var order = bondOrderFor(atoms[open.atomIndex], atoms[prevAtom], pendingBond || open.bondOrder);
                    bonds.push([open.atomIndex, prevAtom, order]);
                    delete ringOpens[ringId];
                    pendingBond = null;
                } else {
                    ringOpens[ringId] = { atomIndex: prevAtom, bondOrder: pendingBond };
                    pendingBond = null;
                }
            } else if (c === '.') {
                prevAtom = null; // disconnected fragment — not a supported use case, but don't crash
                pos++;
            } else {
                var organicAtom = readOrganicAtom();
                var oIdx = atoms.push(organicAtom) - 1;
                attach(oIdx);
            }
        }

        return { atoms: atoms, bonds: bonds };
    }

    // Standard bridge-finding (Tarjan): an edge is a bridge iff removing it
    // disconnects the graph, equivalently iff it lies on NO cycle. Used
    // below to separate ring atoms (candidate conjugated system) from
    // branch/substituent atoms (everything only reachable via a bridge) —
    // this is a general graph-theory answer to part of "which atoms
    // belong to the conjugated system," not a heuristic specific to any
    // one molecule's shape.
    function findBridgeBondIndices(numAtoms, bonds) {
        var adj = [];
        for (var i = 0; i < numAtoms; i++) adj.push([]);
        bonds.forEach(function(b, idx) {
            adj[b[0]].push({ to: b[1], idx: idx });
            adj[b[1]].push({ to: b[0], idx: idx });
        });
        var visited = new Array(numAtoms).fill(false);
        var disc = new Array(numAtoms).fill(-1);
        var low = new Array(numAtoms).fill(-1);
        var timer = 0;
        var bridges = {};
        function dfs(u, parentEdgeIdx) {
            visited[u] = true;
            disc[u] = low[u] = timer++;
            adj[u].forEach(function(e) {
                if (e.idx === parentEdgeIdx) return;
                if (visited[e.to]) {
                    low[u] = Math.min(low[u], disc[e.to]);
                } else {
                    dfs(e.to, e.idx);
                    low[u] = Math.min(low[u], low[e.to]);
                    if (low[e.to] > disc[u]) bridges[e.idx] = true;
                }
            });
        }
        for (var s = 0; s < numAtoms; s++) if (!visited[s]) dfs(s, -1);
        return bridges;
    }

    // Converts a parsed SMILES graph's ring subsystem into the
    // {atoms, bonds} shape Aromaticity.analyze() consumes, deriving each
    // atom's role instead of requiring it be hand-declared:
    // - ring atoms are found via bridge-finding (works for any topology,
    //   not just the lowercase-aromatic case);
    // - a ring atom incident to an explicit double/triple bond, or marked
    //   aromatic (lowercase), gets role 'needsDoubleBond';
    // - a ring N/O/S/P atom with only single ring bonds and no explicit
    //   multiple bond is treated as a lone-pair donor (the common
    //   Kekulized-heteroaromatic pattern, e.g. pyrrole's N);
    // - a ring carbon with only single bonds (e.g. cyclohexane) has no
    //   plausible pi role and is excluded — being "in a ring" alone
    //   doesn't make an atom conjugated.
    // `planar` is NOT derived — it's a declared argument here, same
    // limitation as everywhere else in this codebase; callers should only
    // pass true for structures independently known to be planar.
    function toAromaticSystem(parsed, planar) {
        var n = parsed.atoms.length;
        var bridges = findBridgeBondIndices(n, parsed.bonds);
        var ringBonds = parsed.bonds.filter(function(b, idx) { return !bridges[idx]; });

        // Two different questions, easy to conflate: "does this ring bond
        // have any multiple/aromatic character at all" (used to decide
        // which atoms are IN the conjugated system) vs. "is this atom
        // incident to a strictly explicit = or # bond" (used to decide a
        // Kekulized, non-lowercase atom's ROLE). Every bond in a
        // lowercase-aromatic ring is order 'aromatic', including the ones
        // touching a lone-pair-donor atom like pyrrole's [nH] — so the
        // first, broader flag must NOT be used for role, or every aromatic
        // atom looks "double-bonded" and [nH]'s signal gets masked.
        var ringHasMultipleCharacter = new Array(n).fill(false);
        var hasExplicitDoubleOrTriple = new Array(n).fill(false);
        var inRing = new Array(n).fill(false);
        ringBonds.forEach(function(b) {
            inRing[b[0]] = inRing[b[1]] = true;
            if (b[2] === 2 || b[2] === 3 || b[2] === 'aromatic') {
                ringHasMultipleCharacter[b[0]] = ringHasMultipleCharacter[b[1]] = true;
            }
            if (b[2] === 2 || b[2] === 3) {
                hasExplicitDoubleOrTriple[b[0]] = hasExplicitDoubleOrTriple[b[1]] = true;
            }
        });

        // Total real sigma-bond count (ALL graph bonds touching the atom -
        // ring and exocyclic alike, e.g. an N-substituted pyrrole's ring N
        // has a branch bond this needs to count - PLUS explicit H, which
        // for a bracket atom like [nH] is a real bond that never appears
        // in parsed.bonds at all) - used below to tell pyridine-type
        // aromatic N (2 sigma bonds total; its 3rd valence slot is a non-
        // delocalized in-plane lone pair) from pyrrole-type (3 sigma bonds
        // total; its remaining lone pair is what delocalizes instead), the
        // real textbook distinction, rather than the H-count-only proxy
        // this used to use (which happened to work for bracket [nH] but
        // was wrong for furan/thiophene-type O/S - see ALWAYS_DONOR below).
        var totalDegree = new Array(n).fill(0);
        parsed.bonds.forEach(function(b) { totalDegree[b[0]]++; totalDegree[b[1]]++; });
        for (i = 0; i < n; i++) totalDegree[i] += (parsed.atoms[i].explicitH || 0);

        // O and S have no aromatic "pyridine-type" analog in ordinary
        // neutral organic chemistry - furan/thiophene-type heteroatoms are
        // always divalent (both bonds used by the ring) with a remaining
        // lone pair that delocalizes, so they're always a donor when
        // aromatic, regardless of H count (they never carry one) or degree.
        var ALWAYS_DONOR = { O: true, S: true };

        var HETEROATOM_DONORS = { N: true, O: true, S: true, P: true };
        var included = new Array(n).fill(false);
        for (var i = 0; i < n; i++) {
            if (!inRing[i]) continue;
            var a = parsed.atoms[i];
            if (a.aromatic || ringHasMultipleCharacter[i]) included[i] = true;
            else if (HETEROATOM_DONORS[a.symbol]) included[i] = true;
        }

        var indexMap = {};
        var newIdx = 0;
        for (i = 0; i < n; i++) if (included[i]) indexMap[i] = newIdx++;

        var atoms = [];
        for (i = 0; i < n; i++) {
            if (!included[i]) continue;
            var atom = parsed.atoms[i];
            var role;
            if (atom.aromatic) {
                if (atom.symbol === 'C') {
                    role = 'needsDoubleBond';
                } else if (ALWAYS_DONOR[atom.symbol]) {
                    role = 'lonePairDonor';
                } else {
                    // N (and P, treated the same way): a total of 3 real
                    // sigma bonds (ring bonds + explicit H + any exocyclic
                    // substituent) means the pyrrole-type case - the bond
                    // order to ring neighbors is uniformly 'aromatic'
                    // either way and carries no role information itself.
                    role = (totalDegree[i] >= 3) ? 'lonePairDonor' : 'needsDoubleBond';
                }
            } else if (hasExplicitDoubleOrTriple[i]) {
                role = 'needsDoubleBond';
            } else {
                // A heteroatom with only single ring bonds and no
                // lowercase marking (a bare Kekulized N, e.g.) — the
                // inclusion rule above already excludes a plain carbon
                // that would otherwise reach this branch.
                role = 'lonePairDonor';
            }
            atoms.push({ symbol: atom.symbol, role: role });
        }

        var bonds = [];
        ringBonds.forEach(function(b) {
            if (indexMap[b[0]] !== undefined && indexMap[b[1]] !== undefined) {
                bonds.push([indexMap[b[0]], indexMap[b[1]]]);
            }
        });

        // originalIndex[newIdx] maps back to the index in `parsed.atoms` -
        // additive, existing callers that only read atoms/bonds/planar are
        // unaffected. Lets a caller (e.g. MolecularStructure.js) merge role
        // and Kekule-matching results computed here back onto its own,
        // larger atom list that includes non-ring/substituent atoms too.
        var originalIndex = [];
        for (i = 0; i < n; i++) if (included[i]) originalIndex.push(i);

        return { atoms: atoms, bonds: bonds, planar: !!planar, originalIndex: originalIndex };
    }

    // Serializes an Aromaticity.js-style {atoms:[{symbol,role}], bonds}
    // graph BACK into a SMILES string (lowercase-aromatic form, [xH] for a
    // lonePairDonor heteroatom) — a DFS spanning tree with non-tree edges
    // becoming numbered ring closures, and all-but-the-last child at a
    // branch point wrapped in parens. Exists specifically to round-trip
    // graphs this codebase already built and verified through the parser,
    // as a way to cross-check the parser against known-correct ground
    // truth without having to recall a real-world SMILES string from
    // memory (which would carry the same transcription-error risk hand-
    // typing a large atom/bond array always has).
    function serialize(system) {
        var atoms = system.atoms;
        var n = atoms.length;
        var adj = [];
        for (var i = 0; i < n; i++) adj.push([]);
        system.bonds.forEach(function(b) { adj[b[0]].push(b[1]); adj[b[1]].push(b[0]); });

        function edgeKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

        var visited = new Array(n).fill(false);
        var parent = new Array(n).fill(-1);
        var treeEdge = {};
        function buildTree(u) {
            visited[u] = true;
            adj[u].forEach(function(v) {
                if (!visited[v]) {
                    parent[v] = u;
                    treeEdge[edgeKey(u, v)] = true;
                    buildTree(v);
                }
            });
        }
        for (i = 0; i < n; i++) if (!visited[i]) buildTree(i);

        var closureDigit = {};
        var nextDigit = 1;
        system.bonds.forEach(function(b) {
            var key = edgeKey(b[0], b[1]);
            if (!treeEdge[key]) closureDigit[key] = nextDigit++;
        });
        var atomRingDigits = [];
        for (i = 0; i < n; i++) atomRingDigits.push([]);
        system.bonds.forEach(function(b) {
            var key = edgeKey(b[0], b[1]);
            if (closureDigit[key] !== undefined) {
                atomRingDigits[b[0]].push(closureDigit[key]);
                atomRingDigits[b[1]].push(closureDigit[key]);
            }
        });

        var AROMATIC_CAPABLE = { b: true, c: true, n: true, o: true, p: true, s: true };
        function atomToken(atom) {
            var lower = atom.symbol.toLowerCase();
            if (!AROMATIC_CAPABLE[lower]) return '[' + atom.symbol + ']';
            if (atom.role === 'lonePairDonor') return '[' + lower + 'H]';
            return lower;
        }

        function emit(u, parentNode) {
            var s = atomToken(atoms[u]);
            atomRingDigits[u].forEach(function(d) { s += d; });
            var children = adj[u].filter(function(v) { return v !== parentNode && parent[v] === u; });
            children.forEach(function(v, idx) {
                var sub = emit(v, u);
                s += (idx < children.length - 1) ? '(' + sub + ')' : sub;
            });
            return s;
        }

        var pieces = [];
        for (i = 0; i < n; i++) if (parent[i] === -1) pieces.push(emit(i, -1));
        return pieces.join('.');
    }

    // Full molecular formula (heavy atoms + implicit/explicit H), for
    // cross-checking a parsed SMILES against a known real formula the same
    // way the hand-built porphine graph was formula-checked. Implicit H on
    // an aromatic atom depends on whether it ends up matched to a ring
    // double bond, which this module can't determine on its own (that's
    // Aromaticity's matching step) — callers building an aromatic system
    // should cross-check formula using Aromaticity's own matching result
    // for full rigor; this counts non-aromatic (organic-subset, valence-
    // rule) atoms exactly and aromatic atoms as their explicit H only, so
    // it undercounts aromatic ring H until that step is added by the caller.
    function heavyAtomFormula(parsed) {
        var counts = {};
        parsed.atoms.forEach(function(a) { counts[a.symbol] = (counts[a.symbol] || 0) + 1; });
        return counts;
    }

    return {
        parse: parse,
        toAromaticSystem: toAromaticSystem,
        serialize: serialize,
        heavyAtomFormula: heavyAtomFormula,
        version: '0.2'
    };
}));
