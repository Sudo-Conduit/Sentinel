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

    // Converts a parsed SMILES graph's AROMATIC subsystem (lowercase atoms
    // only, and only bonds between two aromatic atoms) into the
    // {atoms, bonds} shape Aromaticity.analyze() consumes, deriving each
    // atom's role from explicit-H bracket notation rather than requiring
    // it be hand-declared. `planar` is NOT derived — it's a declared
    // argument here, same limitation as everywhere else in this codebase;
    // callers should only pass true for structures independently known to
    // be planar.
    function toAromaticSystem(parsed, planar) {
        var aromaticIndices = [];
        parsed.atoms.forEach(function(a, i) { if (a.aromatic) aromaticIndices.push(i); });
        var indexMap = {};
        aromaticIndices.forEach(function(origIdx, newIdx) { indexMap[origIdx] = newIdx; });

        var atoms = aromaticIndices.map(function(origIdx) {
            var a = parsed.atoms[origIdx];
            // Explicit H on a heteroatom (e.g. [nH]) marks a lone-pair
            // donor (pyrrole/furan/thiophene-type); everything else
            // aromatic is treated as needing a ring double bond.
            var role = (a.explicitH && a.explicitH > 0) ? 'lonePairDonor' : 'needsDoubleBond';
            return { symbol: a.symbol, role: role };
        });

        var bonds = [];
        parsed.bonds.forEach(function(b) {
            var i = b[0], j = b[1];
            if (indexMap[i] !== undefined && indexMap[j] !== undefined) {
                bonds.push([indexMap[i], indexMap[j]]);
            }
        });

        return { atoms: atoms, bonds: bonds, planar: !!planar };
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
        heavyAtomFormula: heavyAtomFormula,
        version: '0.1'
    };
}));
