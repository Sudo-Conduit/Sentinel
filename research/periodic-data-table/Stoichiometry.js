// UMD IIFE - Stoichiometry: chemical-equation balancing and reaction
// arithmetic (limiting reagent, theoretical/percent yield) on top of PDT's
// element data and MolecularStructure's standard atomic weights.
//
// Nothing here is a new physical model - it's exact bookkeeping (integer
// linear algebra for balancing, unit conversion for the rest), the same
// "reference, not derived" status MolecularStructure.js claims for its own
// atomic-weight table. There is no empirical constant to check against
// real data; the only correctness bar is arithmetic, so every function's
// own test suite re-derives its answer a second, independent way
// (element-count conservation, mass conservation) rather than pinning
// against a hand-computed expected value alone.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./PDT', './MolecularStructure'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./PDT.js'), require('./MolecularStructure.js'));
    } else {
        root.Stoichiometry = factory(root.PDT, root.MolecularStructure);
    }
}(typeof self !== 'undefined' ? self : this, function(PDT, MolecularStructure) {
    'use strict';
    if (!PDT) throw new Error('Stoichiometry requires PDT');
    if (!MolecularStructure) throw new Error('Stoichiometry requires MolecularStructure');

    var STANDARD_ATOMIC_WEIGHT = MolecularStructure.STANDARD_ATOMIC_WEIGHT;
    var AVOGADRO = 6.02214076e23;

    // ================================================================
    // 1. FORMULA PARSER
    // ================================================================
    // Handles what PDT.js's own parseFormula() explicitly doesn't: nested
    // parentheses/brackets with a trailing multiplier (Ca(OH)2,
    // Al2(SO4)3, [Cu(NH3)4]SO4) and hydrate notation (CuSO4.5H2O or
    // CuSO4·5H2O), by summing each dot-separated fragment's own count
    // map after scaling it by that fragment's leading coefficient.
    function parseFormulaFragment(s) {
        var i = 0;
        function fail(msg) { throw new Error(msg); }
        function parseCount() {
            var start = i;
            while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
            if (i === start) return 1;
            return parseInt(s.slice(start, i), 10);
        }
        function parseGroup() {
            var counts = {};
            while (i < s.length) {
                var c = s[i];
                if (c === '(' || c === '[') {
                    var close = c === '(' ? ')' : ']';
                    i++;
                    var inner = parseGroup();
                    if (s[i] !== close) fail('Mismatched "' + c + '" in "' + s + '"');
                    i++;
                    var mult = parseCount();
                    Object.keys(inner).forEach(function(sym) {
                        counts[sym] = (counts[sym] || 0) + inner[sym] * mult;
                    });
                } else if (c === ')' || c === ']') {
                    return counts;
                } else if (c >= 'A' && c <= 'Z') {
                    var start = i;
                    i++;
                    if (i < s.length && s[i] >= 'a' && s[i] <= 'z') i++;
                    var symbol = s.slice(start, i);
                    if (!PDT.bySymbol[symbol]) fail('Unknown element: "' + symbol + '"');
                    var count = parseCount();
                    counts[symbol] = (counts[symbol] || 0) + count;
                } else {
                    fail('Unexpected character "' + c + '" in "' + s + '"');
                }
            }
            return counts;
        }
        var result = parseGroup();
        if (i !== s.length) fail('Unexpected trailing content in "' + s + '"');
        return result;
    }

    // Splits on the hydrate separator ('.' or the middle dot U+00B7),
    // treating each fragment as coefficient-prefixed (e.g. the "5" in
    // "5H2O") and additive - a hydrate's water of crystallization is a
    // literal sum of atoms, not a nested group.
    function parseFormula(formula) {
        formula = String(formula).trim().replace(/\s+/g, '');
        if (formula === '') return { error: 'Empty formula' };
        var fragments = formula.split(/[·.]/);
        var total = {};
        try {
            fragments.forEach(function(frag) {
                if (frag === '') throw new Error('Empty fragment in "' + formula + '"');
                var m = frag.match(/^(\d+)([A-Z(\[].*)$/);
                var coeff = 1, body = frag;
                if (m) { coeff = parseInt(m[1], 10); body = m[2]; }
                var counts = parseFormulaFragment(body);
                Object.keys(counts).forEach(function(sym) {
                    total[sym] = (total[sym] || 0) + counts[sym] * coeff;
                });
            });
        } catch (e) {
            return { error: e.message };
        }
        return { formula: formula, counts: total };
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

    // ================================================================
    // 2. EXACT RATIONAL ARITHMETIC (for equation balancing)
    // ================================================================
    // Balancing needs an exact null-space vector, not a floating-point
    // approximation - Gaussian elimination on floats can leave a
    // coefficient at 2.9999999999996 with no principled way to tell
    // "round to 3" from "the equation actually doesn't balance". BigInt
    // fractions sidestep that entirely: every intermediate value is exact
    // until the final integer scaling step.
    function gcdBig(a, b) {
        if (a < 0n) a = -a;
        if (b < 0n) b = -b;
        while (b) { var t = a % b; a = b; b = t; }
        return a;
    }
    function Frac(n, d) {
        if (d === undefined) d = 1n;
        if (d < 0n) { n = -n; d = -d; }
        if (n === 0n) d = 1n;
        else { var g = gcdBig(n, d); if (g > 1n) { n /= g; d /= g; } }
        return { n: n, d: d };
    }
    function fAdd(a, b) { return Frac(a.n * b.d + b.n * a.d, a.d * b.d); }
    function fSub(a, b) { return Frac(a.n * b.d - b.n * a.d, a.d * b.d); }
    function fMul(a, b) { return Frac(a.n * b.n, a.d * b.d); }
    function fDiv(a, b) { return Frac(a.n * b.d, a.d * b.n); }
    function fIsZero(a) { return a.n === 0n; }

    // ================================================================
    // 3. EQUATION PARSER + BALANCER
    // ================================================================
    // Accepts "->", "→", or "=" between sides, "+" between terms on
    // each side. A term may carry a leading coefficient (ignored on input
    // - balance() derives its own - but accepted so a partially-balanced
    // or already-balanced equation can be re-checked/re-balanced without
    // hand-editing it first).
    function parseEquation(equation) {
        var sides = String(equation).split(/->|→|=/);
        if (sides.length !== 2) return { error: 'Equation must contain "->", "→", or "=" separating reactants from products' };
        function parseSide(text) {
            var terms = text.split('+').map(function(t) { return t.trim(); }).filter(function(t) { return t !== ''; });
            var out = [];
            for (var i = 0; i < terms.length; i++) {
                var m = terms[i].match(/^(\d+)?\s*(.+)$/);
                var formula = m[2].trim();
                var parsed = parseFormula(formula);
                if (parsed.error) return { error: 'In term "' + terms[i] + '": ' + parsed.error };
                out.push({ formula: parsed.formula, counts: parsed.counts });
            }
            return out;
        }
        var reactants = parseSide(sides[0]);
        if (reactants.error) return reactants;
        var products = parseSide(sides[1]);
        if (products.error) return products;
        if (reactants.length === 0 || products.length === 0) return { error: 'Equation needs at least one reactant and one product' };
        return { reactants: reactants, products: products };
    }

    // Reduced-row-echelon-form null space over exact fractions, returning
    // ONE particular solution (the first free variable set to 1, every
    // other free variable set to 0) - sufficient for the overwhelming
    // majority of real chemical equations, which have a 1-dimensional
    // solution space. If the system is inconsistent (no formula-level
    // atom-conservation error, but e.g. genuinely un-balanceable as
    // written) or has more than one nontrivial free variable, that's
    // reported rather than silently guessed at.
    function nullSpaceOneVector(matrix, cols) {
        var rows = matrix.length;
        var m = matrix.map(function(row) { return row.slice(); });
        var pivotCols = [];
        var r = 0;
        for (var c = 0; c < cols && r < rows; c++) {
            var pivot = -1;
            for (var i = r; i < rows; i++) { if (!fIsZero(m[i][c])) { pivot = i; break; } }
            if (pivot === -1) continue;
            var tmp = m[r]; m[r] = m[pivot]; m[pivot] = tmp;
            var pv = m[r][c];
            for (var j = c; j < cols; j++) m[r][j] = fDiv(m[r][j], pv);
            for (i = 0; i < rows; i++) {
                if (i === r) continue;
                var factor = m[i][c];
                if (fIsZero(factor)) continue;
                for (j = c; j < cols; j++) m[i][j] = fSub(m[i][j], fMul(factor, m[r][j]));
            }
            pivotCols.push(c);
            r++;
        }
        var isPivot = {};
        pivotCols.forEach(function(c) { isPivot[c] = true; });
        var freeCols = [];
        for (c = 0; c < cols; c++) if (!isPivot[c]) freeCols.push(c);
        if (freeCols.length === 0) return { error: 'System has only the trivial (all-zero) solution - equation cannot be balanced with positive coefficients' };
        if (freeCols.length > 1) return { error: 'Underdetermined: ' + freeCols.length + ' independent free coefficients - this equation needs additional constraints (e.g. a stated coefficient) to balance uniquely' };
        var free = freeCols[0];
        var x = new Array(cols).fill(null).map(function() { return Frac(0n); });
        x[free] = Frac(1n);
        for (var pr = 0; pr < pivotCols.length; pr++) {
            var pc = pivotCols[pr];
            x[pc] = fSub(Frac(0n), m[pr][free]);
        }
        return { solution: x };
    }

    function balance(equationStr) {
        var eq = parseEquation(equationStr);
        if (eq.error) return { error: eq.error };
        var compounds = eq.reactants.concat(eq.products);
        var signs = eq.reactants.map(function() { return 1n; }).concat(eq.products.map(function() { return -1n; }));
        var elements = {};
        compounds.forEach(function(c) { Object.keys(c.counts).forEach(function(sym) { elements[sym] = true; }); });
        var elementList = Object.keys(elements);
        var matrix = elementList.map(function(sym) {
            return compounds.map(function(c, idx) { return Frac((BigInt(c.counts[sym] || 0)) * signs[idx]); });
        });
        var ns = nullSpaceOneVector(matrix, compounds.length);
        if (ns.error) return { error: ns.error };
        var x = ns.solution;
        // Scale to smallest positive integers: LCM of denominators, then
        // GCD-reduce the resulting integer vector.
        var lcm = 1n;
        x.forEach(function(f) { lcm = lcm / gcdBig(lcm, f.d) * f.d; });
        var ints = x.map(function(f) { return f.n * (lcm / f.d); });
        var allNonNeg = ints.every(function(v) { return v >= 0n; });
        var allNonPos = ints.every(function(v) { return v <= 0n; });
        if (!allNonNeg && !allNonPos) return { error: 'Balanced solution has mixed-sign coefficients - the equation as written cannot be balanced (check the formulas / which side each compound is on)' };
        if (allNonPos) ints = ints.map(function(v) { return -v; });
        var g = 0n;
        ints.forEach(function(v) { g = gcdBig(g, v); });
        if (g > 1n) ints = ints.map(function(v) { return v / g; });
        var coeffs = ints.map(function(v) { return Number(v); });
        if (coeffs.some(function(v) { return v === 0; })) return { error: 'Balanced solution assigns a zero coefficient to a compound that is actually present - equation is malformed' };

        var nReact = eq.reactants.length;
        var reactantTerms = eq.reactants.map(function(c, idx) { return { coeff: coeffs[idx], formula: c.formula, counts: c.counts }; });
        var productTerms = eq.products.map(function(c, idx) { return { coeff: coeffs[nReact + idx], formula: c.formula, counts: c.counts }; });

        function fmtSide(terms) {
            return terms.map(function(t) { return (t.coeff === 1 ? '' : t.coeff + ' ') + t.formula; }).join(' + ');
        }
        // Independent self-check: re-sum element counts with the derived
        // coefficients and confirm both sides genuinely match, rather than
        // trusting the linear-algebra result on its own say-so.
        var checkElements = {};
        reactantTerms.forEach(function(t) { Object.keys(t.counts).forEach(function(s) { checkElements[s] = (checkElements[s] || 0) + t.coeff * t.counts[s]; }); });
        productTerms.forEach(function(t) { Object.keys(t.counts).forEach(function(s) { checkElements[s] = (checkElements[s] || 0) - t.coeff * t.counts[s]; }); });
        var mismatches = Object.keys(checkElements).filter(function(s) { return checkElements[s] !== 0; });
        if (mismatches.length > 0) return { error: 'Internal check failed: element(s) ' + mismatches.join(', ') + ' do not balance with the derived coefficients' };

        return {
            equation: equationStr,
            reactants: reactantTerms,
            products: productTerms,
            balanced: fmtSide(reactantTerms) + ' -> ' + fmtSide(productTerms)
        };
    }

    // ================================================================
    // 4. REACTION STOICHIOMETRY (limiting reagent, yield)
    // ================================================================
    // given: { "<formula, exactly as it appears in the equation>": { grams } | { moles } }
    // options.actualYield: { "<product formula>": grams } - optional, for percent yield.
    function solve(equationStr, given, options) {
        options = options || {};
        var bal = balance(equationStr);
        if (bal.error) return { error: bal.error };
        given = given || {};

        var species = {};
        bal.reactants.forEach(function(t) { species[t.formula] = { role: 'reactant', coeff: t.coeff, counts: t.counts }; });
        bal.products.forEach(function(t) { species[t.formula] = { role: 'product', coeff: t.coeff, counts: t.counts }; });

        var unknownGiven = Object.keys(given).filter(function(f) { return !species[f]; });
        if (unknownGiven.length > 0) return { error: 'Given formula(s) not present in the balanced equation: ' + unknownGiven.join(', ') };

        var extents = []; // moles of reaction extent implied by each given reactant
        var perSpecies = {};
        Object.keys(species).forEach(function(f) {
            var s = species[f];
            var mm = molarMass(s.counts);
            perSpecies[f] = { role: s.role, coeff: s.coeff, molarMass: mm.value, warnings: mm.warnings };
        });

        var givenMoles = {};
        Object.keys(given).forEach(function(f) {
            var g = given[f];
            var mm = perSpecies[f].molarMass;
            var moles;
            if (typeof g.moles === 'number') moles = g.moles;
            else if (typeof g.grams === 'number') moles = g.grams / mm;
            else return;
            givenMoles[f] = moles;
            if (species[f].role === 'reactant') extents.push({ formula: f, extent: moles / species[f].coeff });
        });

        if (extents.length === 0) return { error: 'No reactant quantities given - provide at least one reactant\'s grams or moles' };

        var limiting = extents.reduce(function(min, e) { return e.extent < min.extent ? e : min; }, extents[0]);
        var rxnExtent = limiting.extent;

        var result = {
            equation: bal.balanced,
            limitingReagent: limiting.formula,
            reactionExtentMol: rxnExtent,
            species: {}
        };

        Object.keys(species).forEach(function(f) {
            var s = species[f];
            var theoreticalMoles = rxnExtent * s.coeff;
            var entry = {
                role: s.role,
                coefficient: s.coeff,
                molarMass: perSpecies[f].molarMass,
                theoreticalMoles: Math.round(theoreticalMoles * 1e9) / 1e9,
                theoreticalGrams: Math.round(theoreticalMoles * perSpecies[f].molarMass * 1e6) / 1e6
            };
            if (s.role === 'reactant' && givenMoles[f] !== undefined) {
                var consumed = theoreticalMoles;
                var leftoverMol = givenMoles[f] - consumed;
                entry.givenMoles = givenMoles[f];
                entry.excessMoles = Math.round(leftoverMol * 1e9) / 1e9;
                entry.excessGrams = Math.round(leftoverMol * perSpecies[f].molarMass * 1e6) / 1e6;
                entry.isLimiting = f === limiting.formula;
            }
            if (s.role === 'product' && options.actualYield && typeof options.actualYield[f] === 'number') {
                entry.actualGrams = options.actualYield[f];
                entry.percentYield = Math.round((options.actualYield[f] / entry.theoreticalGrams) * 10000) / 100;
            }
            result.species[f] = entry;
        });

        return result;
    }

    // ================================================================
    // 5. COMMAND PARSER (house convention - see PDT.run/QM.run)
    // ================================================================
    function run(command) {
        if (typeof command !== 'string') return { error: 'Command must be a string.' };
        var cmd = command.trim();
        if (cmd.toLowerCase() === 'help') {
            return {
                help: '\n' +
                'Stoichiometry.run("mass CuSO4.5H2O")            - Molar mass of a formula (parens/hydrates OK)\n' +
                'Stoichiometry.run("balance H2 + O2 = H2O")      - Balance a chemical equation\n' +
                'Stoichiometry.run("help")                       - Show this help\n' +
                'Stoichiometry.solve(equation, given, options)    - Full limiting-reagent/yield calculation, see source\n'
            };
        }
        if (cmd.toLowerCase().startsWith('mass ')) {
            var parsed = parseFormula(cmd.slice(5).trim());
            if (parsed.error) return { error: parsed.error };
            var mm = molarMass(parsed.counts);
            return { formula: parsed.formula, counts: parsed.counts, molarMass: mm.value, warnings: mm.warnings };
        }
        if (cmd.toLowerCase().startsWith('balance ')) {
            return balance(cmd.slice(8).trim());
        }
        return { error: 'Unknown command: "' + command + '". Try Stoichiometry.run("help")' };
    }

    return {
        parseFormula: parseFormula,
        molarMass: molarMass,
        parseEquation: parseEquation,
        balance: balance,
        solve: solve,
        run: run,
        AVOGADRO: AVOGADRO,
        version: '1.0',
        date: '2026-09-20',
        author: 'Pooled Impact'
    };
}));
