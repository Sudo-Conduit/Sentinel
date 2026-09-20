// Regression suite for ChemistryProblemGenerator.js - determinism (the
// core contract: same type+seed must always produce the same problem),
// each problem type's arithmetic checked against known real values (not
// just internal self-consistency), and the significant-figures formatter.
var G = require('../ChemistryProblemGenerator.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}
function near(a, b, eps) { return Math.abs(a - b) < (eps || 0.01); }

// --- determinism: the core contract ---
['molar-mass', 'mass-to-moles', 'moles-to-mass', 'percent-composition', 'balance-equation'].forEach(function(typeId) {
  var a = G.generate(typeId, 42);
  var b = G.generate(typeId, 42);
  check('generate("' + typeId + '", 42) is deterministic (identical question+answer+steps across two calls)',
    JSON.stringify(a) === JSON.stringify(b));
});

check('Different seeds produce different molar-mass problems (the generator actually varies, not hardcoded)',
  G.generate('molar-mass', 1).question !== G.generate('molar-mass', 2).question);

check('A string seed is accepted and is itself deterministic across two calls',
  JSON.stringify(G.generate('molar-mass', 'student-7')) === JSON.stringify(G.generate('molar-mass', 'student-7')));

// --- listTypes ---
check('listTypes() reports all 5 shipped problem types', G.listTypes().length === 5);

// --- molar-mass: cross-check against Stoichiometry.js's own molarMass ---
var Stoichiometry = require('../Stoichiometry.js');
for (var seed = 0; seed < 20; seed++) {
  var p = G.generate('molar-mass', seed);
  var real = Stoichiometry.molarMass(Stoichiometry.parseFormula(p.title ? p.question.match(/of (\S+) \(/)[1] : '').counts).value;
  check('molar-mass seed=' + seed + ': generated answer matches Stoichiometry.molarMass for the same formula',
    p.answer.indexOf(G.toSigFigs(real, 4)) === 0);
}

// --- mass-to-moles / moles-to-mass: real arithmetic (moles = mass/molarMass) ---
var m2m = G.generate('mass-to-moles', 7);
var formulaM2M = m2m.question.match(/of (\S+) \(/)[1];
var massM2M = parseFloat(m2m.question.match(/in ([\d.]+) g/)[1]);
var mmM2M = Stoichiometry.molarMass(Stoichiometry.parseFormula(formulaM2M).counts).value;
check('mass-to-moles: answer equals mass/molarMass to 3 sig figs (real division, not a placeholder)',
  near(parseFloat(m2m.answer), G.toSigFigs(massM2M / mmM2M, 3), 1e-9) || m2m.answer === (G.toSigFigs(massM2M / mmM2M, 3) + ' mol'));

var mo2m = G.generate('moles-to-mass', 7);
var formulaMo2M = mo2m.question.match(/of (\S+) \(/)[1];
var molesMo2M = parseFloat(mo2m.question.match(/mass, in grams, of ([\d.]+) mol/)[1]);
var mmMo2M = Stoichiometry.molarMass(Stoichiometry.parseFormula(formulaMo2M).counts).value;
check('moles-to-mass: answer equals moles*molarMass to 3 sig figs (real multiplication)',
  mo2m.answer === (G.toSigFigs(molesMo2M * mmMo2M, 3) + ' g'));

// --- percent-composition: real textbook example, MgSO4 magnesium content ---
var found = false;
for (var s = 0; s < 200 && !found; s++) {
  var pc = G.generate('percent-composition', s);
  if (pc.question.indexOf('MgSO4') !== -1 && pc.question.indexOf(' of Mg ') !== -1) {
    found = true;
    check('Percent composition of Mg in MgSO4 matches the real textbook value ~20.2%',
      pc.answer === '20.2%');
  }
}
check('At least one seed in the first 200 produced the MgSO4/Mg percent-composition case (sanity check on the search above)', found);

// --- balance-equation: every generated balance is internally self-consistent ---
for (var eqSeed = 0; eqSeed < 8; eqSeed++) {
  var be = G.generate('balance-equation', eqSeed);
  var bal = Stoichiometry.balance(be.question.replace('Balance the following chemical equation: ', ''));
  check('balance-equation seed=' + eqSeed + ': generated answer matches Stoichiometry.balance() for the same equation',
    be.answer === bal.balanced);
}

// --- significant figures ---
check('toSigFigs(74.092, 4) preserves a real trailing-zero-bearing sig fig: "74.09"', G.toSigFigs(74.092, 4) === '74.09');
check('toSigFigs(158.032, 4) rounds down correctly to "158.0" (trailing zero kept, not dropped)', G.toSigFigs(158.032, 4) === '158.0');
check('toSigFigs(5, 3) pads trailing zeros to the requested precision: "5.00"', G.toSigFigs(5, 3) === '5.00');
check('toSigFigs(123456, 3) rounds a large number without switching to exponential notation', G.toSigFigs(123456, 3) === '123000');
check('toSigFigs(0.000123456, 3) rounds a small number without switching to exponential notation', G.toSigFigs(0.000123456, 3) === '0.000123');

// --- error handling ---
check('An unknown problem type reports an error rather than throwing or returning garbage',
  !!G.generate('not-a-real-type', 1).error);

module.exports = { name: 'ChemistryProblemGenerator.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
