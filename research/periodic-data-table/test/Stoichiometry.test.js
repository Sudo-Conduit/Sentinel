// Regression suite for Stoichiometry.js - formula parsing (parens,
// hydrates), equation balancing (exact rational linear algebra, not
// floats), and limiting-reagent/yield arithmetic. Checked against known
// textbook molar masses and standard balanced equations, not invented
// numbers - the same convention as the rest of this test/ directory.
var S = require('../Stoichiometry.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}
function near(a, b, eps) { return Math.abs(a - b) < (eps || 0.01); }

// --- formula parsing / molar mass ---
check('H2O molar mass is the real textbook value 18.015 g/mol',
  near(S.molarMass(S.parseFormula('H2O').counts).value, 18.015, 0.005));

check('Ca(OH)2 (parenthesized group) molar mass is the real textbook value 74.09 g/mol',
  near(S.molarMass(S.parseFormula('Ca(OH)2').counts).value, 74.09, 0.01));

check('Al2(SO4)3 (nested-group multiplier) molar mass is the real textbook value 342.15 g/mol',
  near(S.molarMass(S.parseFormula('Al2(SO4)3').counts).value, 342.15, 0.05));

var hydrate = S.parseFormula('CuSO4.5H2O');
check('CuSO4.5H2O (hydrate dot notation) parses to Cu1 S1 O9 H10',
  hydrate.counts.Cu === 1 && hydrate.counts.S === 1 && hydrate.counts.O === 9 && hydrate.counts.H === 10);
check('CuSO4.5H2O molar mass is the real textbook value 249.68 g/mol',
  near(S.molarMass(hydrate.counts).value, 249.68, 0.01));

var alSulfate = S.parseFormula('Al2(SO4)3');
check('Al2(SO4)3 parsing records a RulesEngine step trace with the CASX-style {ruleId, type, description, before, after} shape',
  alSulfate.steps.length === 1 &&
  alSulfate.steps[0].type === 'parse' &&
  alSulfate.steps[0].before === 'Al2(SO4)3' &&
  typeof alSulfate.steps[0].description === 'string' && alSulfate.steps[0].description.indexOf('(SO4)3') !== -1);

var complexIon = S.parseFormula('[Cu(NH3)4]SO4');
check('[Cu(NH3)4]SO4 (bracket nested around a paren group, exercising RulesEngine\'s fixed-point resolution twice) parses to Cu1 N4 H12 S1 O4',
  complexIon.counts.Cu === 1 && complexIon.counts.N === 4 && complexIon.counts.H === 12 &&
  complexIon.counts.S === 1 && complexIon.counts.O === 4);

check('Malformed formula (unmatched paren) reports an error, not a silent wrong count',
  !!S.parseFormula('Ca(OH2').error);

check('Unknown element symbol reports an error',
  !!S.parseFormula('Qz2').error);

// --- equation balancing ---
check('H2 + O2 = H2O balances to the textbook 2:1:2',
  S.balance('H2 + O2 = H2O').balanced === '2 H2 + O2 -> 2 H2O');

check('Propane combustion balances to the textbook 1:5:3:4',
  S.balance('C3H8 + O2 = CO2 + H2O').balanced === 'C3H8 + 5 O2 -> 3 CO2 + 4 H2O');

check('Iron rusting/combustion balances to the textbook 4:3:2',
  S.balance('Fe + O2 = Fe2O3').balanced === '4 Fe + 3 O2 -> 2 Fe2O3');

check('Aluminum chlorination balances to the textbook 2:3:2',
  S.balance('Al + Cl2 = AlCl3').balanced === '2 Al + 3 Cl2 -> 2 AlCl3');

check('Already-balanced input with parens (Ca(OH)2 neutralization) balances to textbook 1:2:1:2',
  S.balance('Ca(OH)2 + HCl = CaCl2 + H2O').balanced === 'Ca(OH)2 + 2 HCl -> CaCl2 + 2 H2O');

var badEq = S.balance('H2O = NaCl');
check('An equation whose sides share no common element reports an error rather than a bogus coefficient set',
  !!badEq.error);

// Independent re-check: every balanced equation's own element counts must
// actually match, computed a second way from the parsed compound counts
// rather than trusting balance()'s internal self-check alone.
['H2 + O2 = H2O', 'C3H8 + O2 = CO2 + H2O', 'Fe + O2 = Fe2O3', 'Al + Cl2 = AlCl3'].forEach(function(eq) {
  var b = S.balance(eq);
  var left = {}, right = {};
  b.reactants.forEach(function(t) { Object.keys(t.counts).forEach(function(s) { left[s] = (left[s] || 0) + t.coeff * t.counts[s]; }); });
  b.products.forEach(function(t) { Object.keys(t.counts).forEach(function(s) { right[s] = (right[s] || 0) + t.coeff * t.counts[s]; }); });
  var allSyms = Object.keys(left).concat(Object.keys(right)).filter(function(v, i, a) { return a.indexOf(v) === i; });
  var ok = allSyms.every(function(s) { return (left[s] || 0) === (right[s] || 0); });
  check('Independent element-count re-check for "' + eq + '" confirms conservation', ok);
});

// --- reaction stoichiometry ---
// 2H2 + O2 -> 2H2O: 4g H2 (~1.984 mol H2, needs ~0.992 mol O2 = ~31.74g);
// giving 32g O2 (~1.0 mol) leaves O2 in slight excess, H2 limiting.
var hydrogenCombustion = S.solve('H2 + O2 = H2O', { H2: { grams: 4 }, O2: { grams: 32 } });
check('2H2+O2->2H2O with 4g H2 / 32g O2: H2 is the limiting reagent',
  hydrogenCombustion.limitingReagent === 'H2');
check('2H2+O2->2H2O: theoretical H2O yield from 4g H2 is the textbook ~35.74g',
  near(hydrogenCombustion.species.H2O.theoreticalGrams, 35.74, 0.05));
check('2H2+O2->2H2O: O2 (non-limiting) is left with a small positive excess, not consumed to exactly zero',
  hydrogenCombustion.species.O2.excessGrams > 0);

// Stoichiometrically exact amounts (no excess): 2 mol H2 + 1 mol O2 exactly.
var exact = S.solve('H2 + O2 = H2O', { H2: { moles: 2 }, O2: { moles: 1 } });
check('2H2+O2->2H2O with exact stoichiometric moles: neither reagent has leftover excess',
  near(exact.species.H2.excessMoles, 0, 1e-6) && near(exact.species.O2.excessMoles, 0, 1e-6));
check('2H2+O2->2H2O with exact stoichiometric moles: 2 mol H2O produced',
  near(exact.species.H2O.theoreticalMoles, 2, 1e-6));

// Percent yield: theoretical H2O from the exact case above is 2 mol * 18.015 = 36.03g.
var withYield = S.solve('H2 + O2 = H2O', { H2: { moles: 2 }, O2: { moles: 1 } }, { actualYield: { H2O: 30 } });
check('Percent yield of 30g actual against ~36.03g theoretical is the correct ~83.3%',
  near(withYield.species.H2O.percentYield, 83.26, 0.5));

check('Requesting a species not present in the equation reports an error',
  !!S.solve('H2 + O2 = H2O', { N2: { grams: 10 } }).error);

check('Giving no reactant quantities at all reports an error rather than a bogus result',
  !!S.solve('H2 + O2 = H2O', {}).error);

module.exports = { name: 'Stoichiometry.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
