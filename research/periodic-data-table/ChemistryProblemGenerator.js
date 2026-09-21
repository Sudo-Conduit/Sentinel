// UMD IIFE - ChemistryProblemGenerator: deterministic gen-chem problem
// generation and step-by-step explanation, built on Stoichiometry.js
// (formula parsing/molar mass/equation balancing) and RulesEngine.js
// (the same match/reduce pipeline Stoichiometry.js's own parser uses).
//
// SCOPE, STATED UP FRONT (same "narrower correct beats wider wrong"
// discipline as CASX.js): five problem types, all grounded in real
// stoichiometry this codebase already computes exactly - molar mass,
// mass<->mole conversion, percent composition by mass, and equation
// balancing. Broader first-semester topics seen on a real exam (electron
// configuration, quantum numbers, photon energy, isotopes/mass spec,
// periodic trends) are NOT covered here; they need their own real models,
// not a text template pretending to have one. Adding a problem type means
// adding one entry to PROBLEM_TYPES with a real generate/solve pair, not
// bending an existing one to fit.
//
// DETERMINISTIC means what it says: every problem is generate(typeId,
// seed) -> the exact same question and answer for that seed, forever, via
// a seeded PRNG (mulberry32) - never Math.random(). This is a real
// requirement, not a style preference: it's what makes a generated
// problem set reproducible for an answer key, or re-derivable from just
// the seed a student was given.
//
// EXPLAIN means the returned .steps is the real derivation, not prose
// generated after the fact - molar-mass/mass<->mole/percent-composition
// problems reuse Stoichiometry.parseFormula's own RulesEngine step trace
// directly, and balance-equation problems show the actual per-element
// conservation check balance() already verifies internally.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./PDT', './Stoichiometry', './MolecularStructure'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./PDT.js'), require('./Stoichiometry.js'), require('./MolecularStructure.js'));
    } else {
        root.ChemistryProblemGenerator = factory(root.PDT, root.Stoichiometry, root.MolecularStructure);
    }
}(typeof self !== 'undefined' ? self : this, function(PDT, Stoichiometry, MolecularStructure) {
    'use strict';
    if (!PDT) throw new Error('ChemistryProblemGenerator requires PDT');
    if (!Stoichiometry) throw new Error('ChemistryProblemGenerator requires Stoichiometry');
    if (!MolecularStructure) throw new Error('ChemistryProblemGenerator requires MolecularStructure');

    var STANDARD_ATOMIC_WEIGHT = MolecularStructure.STANDARD_ATOMIC_WEIGHT;

    // ================================================================
    // 1. DETERMINISTIC PRNG (mulberry32) - never Math.random()
    // ================================================================
    // Same 32-bit seed always produces the same output stream, forever,
    // independent of engine/platform - unlike Math.random(), which is
    // explicitly NOT required to be reproducible across runs.
    function mulberry32(seed) {
        var a = seed >>> 0;
        return function() {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
    function randInt(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }
    function seedFromString(s) {
        var h = 0;
        for (var i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
        return h >>> 0;
    }
    function normalizeSeed(seed) {
        if (typeof seed === 'number') return seed >>> 0;
        return seedFromString(String(seed));
    }

    // ================================================================
    // 2. SIGNIFICANT FIGURES
    // ================================================================
    // Rounds to exactly n significant figures and formats WITHOUT losing
    // trailing zeros that are themselves significant (e.g. 74.09 to 4 sig
    // figs must print "74.09", not "74.1" and not a bare Number that
    // drops the trailing 0) - toPrecision() gets the digit count right
    // but sometimes emits exponential notation for values a student would
    // never write that way; this reformats those cases back to plain
    // decimal while preserving toPrecision()'s own significant-digit count.
    function toSigFigs(value, n) {
        if (value === 0) return (0).toFixed(Math.max(0, n - 1));
        var p = value.toPrecision(n);
        if (p.indexOf('e') === -1) return p;
        return Number(p).toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: 20 });
    }

    // ================================================================
    // 3. REFERENCE DATA - real compounds and real unbalanced equations
    // ================================================================
    var COMPOUNDS = [
        { formula: 'H2O', name: 'water' },
        { formula: 'CO2', name: 'carbon dioxide' },
        { formula: 'NaCl', name: 'sodium chloride (table salt)' },
        { formula: 'NH3', name: 'ammonia' },
        { formula: 'CH4', name: 'methane' },
        { formula: 'Ca(OH)2', name: 'calcium hydroxide (slaked lime)' },
        { formula: 'Al2(SO4)3', name: 'aluminum sulfate' },
        { formula: 'CuSO4.5H2O', name: 'copper(II) sulfate pentahydrate' },
        { formula: 'C6H12O6', name: 'glucose' },
        { formula: 'NaHCO3', name: 'sodium bicarbonate (baking soda)' },
        { formula: 'KMnO4', name: 'potassium permanganate' },
        { formula: 'Fe2O3', name: 'iron(III) oxide (rust)' },
        { formula: 'MgSO4', name: 'magnesium sulfate' },
        { formula: 'H2SO4', name: 'sulfuric acid' },
        { formula: 'HCl', name: 'hydrochloric acid' },
        { formula: 'As2O3', name: 'arsenic trioxide (white arsenic)' },
        { formula: 'Y2O3', name: 'yttrium oxide' }
    ];

    // Real, standard textbook unbalanced equations, one canonical balanced
    // form each - the same equations this codebase's own Stoichiometry
    // tests already verify against, plus a few more of the same character.
    var EQUATIONS = [
        'H2 + O2 = H2O',
        'C3H8 + O2 = CO2 + H2O',
        'Fe + O2 = Fe2O3',
        'Al + Cl2 = AlCl3',
        'Ca(OH)2 + HCl = CaCl2 + H2O',
        'N2 + H2 = NH3',
        'CH4 + O2 = CO2 + H2O',
        'Na + H2O = NaOH + H2'
    ];

    // ================================================================
    // 4. PROBLEM TYPES
    // ================================================================
    var PROBLEM_TYPES = {
        'molar-mass': {
            title: 'Molar Mass',
            generate: function(rng) {
                var c = pick(rng, COMPOUNDS);
                return { formula: c.formula, name: c.name };
            },
            question: function(p) {
                return 'What is the molar mass of ' + p.formula + ' (' + p.name + ')? Report your answer to 4 significant figures.';
            },
            solve: function(p) {
                var parsed = Stoichiometry.parseFormula(p.formula);
                if (parsed.error) throw new Error(parsed.error);
                var mm = Stoichiometry.molarMass(parsed.counts);
                var steps = parsed.steps.map(function(s) { return s.description; });
                var terms = Object.keys(parsed.counts).sort().map(function(sym) {
                    var weight = STANDARD_ATOMIC_WEIGHT[sym] ? STANDARD_ATOMIC_WEIGHT[sym][0] : null;
                    return parsed.counts[sym] + ' x ' + sym + ' (' + weight + ' g/mol)';
                });
                steps.push('Sum each element\'s count x standard atomic weight: ' + terms.join(' + '));
                steps.push('Total molar mass = ' + mm.value + ' g/mol');
                return { answer: toSigFigs(mm.value, 4) + ' g/mol', steps: steps, warnings: mm.warnings };
            }
        },

        'mass-to-moles': {
            title: 'Mass to Moles',
            generate: function(rng) {
                var c = pick(rng, COMPOUNDS);
                var mass = randInt(rng, 5, 500) / 10; // 0.5 .. 50.0 g, one decimal
                return { formula: c.formula, name: c.name, massGrams: mass };
            },
            question: function(p) {
                return 'How many moles are in ' + p.massGrams + ' g of ' + p.formula + ' (' + p.name + ')? Report your answer to 3 significant figures.';
            },
            solve: function(p) {
                var parsed = Stoichiometry.parseFormula(p.formula);
                if (parsed.error) throw new Error(parsed.error);
                var mm = Stoichiometry.molarMass(parsed.counts);
                var moles = p.massGrams / mm.value;
                var steps = [
                    'Molar mass of ' + p.formula + ' = ' + mm.value + ' g/mol',
                    'moles = mass / molar mass = ' + p.massGrams + ' g / ' + mm.value + ' g/mol = ' + moles + ' mol'
                ];
                return { answer: toSigFigs(moles, 3) + ' mol', steps: steps, warnings: mm.warnings };
            }
        },

        'moles-to-mass': {
            title: 'Moles to Mass',
            generate: function(rng) {
                var c = pick(rng, COMPOUNDS);
                var moles = randInt(rng, 1, 500) / 100; // 0.01 .. 5.00 mol
                return { formula: c.formula, name: c.name, moles: moles };
            },
            question: function(p) {
                return 'What is the mass, in grams, of ' + p.moles + ' mol of ' + p.formula + ' (' + p.name + ')? Report your answer to 3 significant figures.';
            },
            solve: function(p) {
                var parsed = Stoichiometry.parseFormula(p.formula);
                if (parsed.error) throw new Error(parsed.error);
                var mm = Stoichiometry.molarMass(parsed.counts);
                var mass = p.moles * mm.value;
                var steps = [
                    'Molar mass of ' + p.formula + ' = ' + mm.value + ' g/mol',
                    'mass = moles x molar mass = ' + p.moles + ' mol x ' + mm.value + ' g/mol = ' + mass + ' g'
                ];
                return { answer: toSigFigs(mass, 3) + ' g', steps: steps, warnings: mm.warnings };
            }
        },

        'percent-composition': {
            title: 'Percent Composition',
            generate: function(rng) {
                var c = pick(rng, COMPOUNDS);
                var parsed = Stoichiometry.parseFormula(c.formula);
                var elements = Object.keys(parsed.counts);
                var element = pick(rng, elements);
                return { formula: c.formula, name: c.name, element: element };
            },
            question: function(p) {
                return 'What is the percent by mass of ' + p.element + ' in ' + p.formula + ' (' + p.name + ')? Report your answer to 3 significant figures.';
            },
            solve: function(p) {
                var parsed = Stoichiometry.parseFormula(p.formula);
                if (parsed.error) throw new Error(parsed.error);
                var mm = Stoichiometry.molarMass(parsed.counts);
                var elementCounts = {};
                elementCounts[p.element] = parsed.counts[p.element];
                var elementMass = Stoichiometry.molarMass(elementCounts);
                var pct = (elementMass.value / mm.value) * 100;
                var steps = [
                    'Molar mass of ' + p.formula + ' = ' + mm.value + ' g/mol',
                    'Mass contributed by ' + p.element + ' (' + parsed.counts[p.element] + ' atom(s) per formula unit) = ' + elementMass.value + ' g/mol',
                    '% ' + p.element + ' = (' + elementMass.value + ' / ' + mm.value + ') x 100 = ' + pct + '%'
                ];
                return { answer: toSigFigs(pct, 3) + '%', steps: steps, warnings: mm.warnings.concat(elementMass.warnings) };
            }
        },

        'balance-equation': {
            title: 'Balance the Equation',
            generate: function(rng) {
                return { equation: pick(rng, EQUATIONS) };
            },
            question: function(p) {
                return 'Balance the following chemical equation: ' + p.equation;
            },
            solve: function(p) {
                var bal = Stoichiometry.balance(p.equation);
                if (bal.error) throw new Error(bal.error);
                var steps = ['Parse each side\'s element counts from the formulas as written.'];
                var allElements = {};
                bal.reactants.concat(bal.products).forEach(function(t) { Object.keys(t.counts).forEach(function(s) { allElements[s] = true; }); });
                Object.keys(allElements).sort().forEach(function(sym) {
                    var left = bal.reactants.reduce(function(sum, t) { return sum + t.coeff * (t.counts[sym] || 0); }, 0);
                    var right = bal.products.reduce(function(sum, t) { return sum + t.coeff * (t.counts[sym] || 0); }, 0);
                    steps.push('Check ' + sym + ': ' + left + ' on the left = ' + right + ' on the right.');
                });
                steps.push('Balanced equation: ' + bal.balanced);
                return { answer: bal.balanced, steps: steps, warnings: [] };
            }
        }
    };

    function listTypes() {
        return Object.keys(PROBLEM_TYPES).map(function(id) { return { id: id, title: PROBLEM_TYPES[id].title }; });
    }

    // The one entry point: same (typeId, seed) always produces the same
    // {question, answer, steps} - never regenerated differently on a
    // second call, by construction (mulberry32 is a pure function of its
    // seed, and every problem type's generate() calls the rng the same
    // fixed number of times regardless of what it picks).
    function generate(typeId, seed) {
        var type = PROBLEM_TYPES[typeId];
        if (!type) return { error: 'Unknown problem type: "' + typeId + '". Try ChemistryProblemGenerator.run("types")' };
        var rng = mulberry32(normalizeSeed(seed));
        var params = type.generate(rng);
        var solved;
        try {
            solved = type.solve(params);
        } catch (e) {
            return { error: e.message };
        }
        return {
            type: typeId,
            title: type.title,
            seed: seed,
            question: type.question(params),
            answer: solved.answer,
            steps: solved.steps,
            warnings: solved.warnings || []
        };
    }

    // Formats a generated problem as plain, readable "show your work"
    // text - one line per step, the answer last. This is presentation
    // only; every fact in it comes straight from generate()'s own steps.
    function explain(typeId, seed) {
        var p = generate(typeId, seed);
        if (p.error) return p.error;
        var lines = [];
        lines.push('Q: ' + p.question);
        p.steps.forEach(function(s, i) { lines.push('Step ' + (i + 1) + ': ' + s); });
        lines.push('Answer: ' + p.answer);
        return lines.join('\n');
    }

    // ================================================================
    // 4a. ANSWER CHECKING
    // ================================================================
    // Grades a student's typed answer against generate()'s own answer for
    // the same (typeId, seed) - never a separately maintained "key", so a
    // check can never drift from what explain() shows as correct.
    //
    // Numeric problem types (everything except balance-equation) compare
    // the leading number only, within a 1% relative tolerance: the
    // reference answer is itself already rounded to N significant figures
    // (see toSigFigs), so a student who rounds slightly differently, or
    // who doesn't round at all, should not be marked wrong for that - the
    // tolerance exists to accept legitimate rounding variance, not to
    // paper over a wrong answer. Units are not required to match; the
    // question already asked to "report your answer to N sig figs" but
    // there's no chemistry reason to fail a numerically-correct answer
    // for a missing/misspelled unit.
    //
    // balance-equation compares both sides as an unordered set of terms
    // (case-sensitive - "Na" and "NA" are different elements), so
    // "5 O2 + C3H8 -> 4 H2O + 3 CO2" and "C3H8 + 5O2 -> 3CO2 + 4H2O" both
    // grade as correct even though term order and spacing differ from
    // the canonical answer string.
    function extractLeadingNumber(text) {
        var m = /-?\d+(?:\.\d+)?/.exec(String(text).replace(/,/g, ''));
        return m ? parseFloat(m[0]) : NaN;
    }

    function normalizeEquationForCompare(equation) {
        var normalized = String(equation).trim().replace(/=|→|-->/g, '->');
        var parts = normalized.split('->');
        if (parts.length !== 2) return normalized.replace(/\s+/g, '');
        return parts.map(function(side) {
            return side.split('+').map(function(term) { return term.replace(/\s+/g, ''); }).sort().join('+');
        }).join('->');
    }

    // @param {string} typeId
    // @param {string|number} seed
    // @param {string} userAnswer
    // @returns {{correct: boolean, expected: string, question: string}|{error: string}}
    function checkAnswer(typeId, seed, userAnswer) {
        var result = generate(typeId, seed);
        if (result.error) return { error: result.error };

        var correct;
        if (typeId === 'balance-equation') {
            correct = normalizeEquationForCompare(userAnswer) === normalizeEquationForCompare(result.answer);
        } else {
            var userNum = extractLeadingNumber(userAnswer);
            var correctNum = extractLeadingNumber(result.answer);
            correct = isFinite(userNum) && isFinite(correctNum) &&
                Math.abs(userNum - correctNum) <= Math.abs(correctNum) * 0.01 + 1e-9;
        }
        return { correct: correct, expected: result.answer, question: result.question };
    }

    // ================================================================
    // 5. COMMAND PARSER (house convention - see PDT.run/Stoichiometry.run)
    // ================================================================
    function run(command) {
        if (typeof command !== 'string') return { error: 'Command must be a string.' };
        var cmd = command.trim();
        if (cmd.toLowerCase() === 'help') {
            return {
                help: '\n' +
                'ChemistryProblemGenerator.run("types")                          - List available problem types\n' +
                'ChemistryProblemGenerator.run("generate molar-mass seed=42")    - Generate one problem\n' +
                'ChemistryProblemGenerator.run("explain molar-mass seed=42")     - Generate + print full step-by-step explanation\n'
            };
        }
        if (cmd.toLowerCase() === 'types') return { types: listTypes() };
        var genMatch = cmd.match(/^generate\s+(\S+)\s+seed=(\S+)$/i);
        if (genMatch) return generate(genMatch[1], genMatch[2]);
        var explMatch = cmd.match(/^explain\s+(\S+)\s+seed=(\S+)$/i);
        if (explMatch) return { explanation: explain(explMatch[1], explMatch[2]) };
        return { error: 'Unknown command: "' + command + '". Try ChemistryProblemGenerator.run("help")' };
    }

    return {
        listTypes: listTypes,
        generate: generate,
        explain: explain,
        checkAnswer: checkAnswer,
        run: run,
        toSigFigs: toSigFigs,
        mulberry32: mulberry32,
        version: '1.1',
        date: '2026-09-20',
        author: 'Pooled Impact'
    };
}));
