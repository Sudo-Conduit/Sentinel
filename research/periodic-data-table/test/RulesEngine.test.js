// Regression suite for RulesEngine.js - the domain-agnostic match/reduce
// pipeline shared with RegX.js and CASX.js. This project vendors it as a
// dependency of Stoichiometry.js's formula parser (see its own tests for
// real chemistry-formula coverage); this file checks the engine's own
// documented contracts in isolation - fixed-point iteration, rule
// ordering, the placeholder table, and its stated guardrails.
var RulesEngine = require('../RulesEngine.js');

var checks = 0, failures = [];
function check(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

// A rule that repeatedly halves any run of 'x' characters until one is
// left - exercises match/reduce running to a fixed point within one rule.
var HalveXRule = {
  ruleId: 'halve-x',
  match: function(text) {
    var m = /x{2,}/.exec(text);
    if (!m) return null;
    return { index: m.index, run: m[0] };
  },
  reduce: function(text, m) {
    var half = m.run.slice(0, Math.ceil(m.run.length / 2));
    return text.slice(0, m.index) + half + text.slice(m.index + m.run.length);
  }
};

var r1 = new RulesEngine([HalveXRule]).run('axxxxxxxxb');
check('A single rule runs to its own fixed point (repeated xxxxxxxx -> x)', r1.text === 'axb');

// Two rules, run in ARRAY ORDER, each to its own fixed point before the
// next starts - the ordering guarantee RegX/CASX both depend on.
var UpperRule = { ruleId: 'upper', match: function(t) { var m = /[a-z]/.exec(t); return m ? { index: m.index } : null; }, reduce: function(t, m) { return t.slice(0, m.index) + t[m.index].toUpperCase() + t.slice(m.index + 1); } };
var StripDigitRule = { ruleId: 'strip-digit', match: function(t) { var m = /\d/.exec(t); return m ? { index: m.index } : null; }, reduce: function(t, m) { return t.slice(0, m.index) + t.slice(m.index + 1); } };
var r2 = new RulesEngine([UpperRule, StripDigitRule]).run('a1b2c3');
check('Rules run in declared array order to a combined fixed point', r2.text === 'ABC');

// A rule that matches but never changes the text must be caught, not loop
// forever - this is RulesEngine's own documented safety contract.
var NoopRule = { ruleId: 'noop', match: function(t) { return t.length > 0 ? { index: 0 } : null; }, reduce: function(t) { return t; } };
var threw = false, threwMessage = '';
try { new RulesEngine([NoopRule]).run('a'); } catch (e) { threw = true; threwMessage = e.message; }
check('A rule that matches but does not change the text throws rather than looping forever', threw && threwMessage.indexOf('noop') !== -1);

// Placeholder table: intern/resolve round-trip, and isPlaceholder tells a
// real placeholder token apart from ordinary text.
var pt = RulesEngine.definePlaceholderTable();
var token = pt.intern({ hello: 'world' });
check('Placeholder token round-trips through intern/resolve', pt.resolve(token).hello === 'world');
check('isPlaceholder is true for a real token', pt.isPlaceholder(token) === true);
check('isPlaceholder is false for ordinary text', pt.isPlaceholder('H2O') === false);

var pt2 = RulesEngine.definePlaceholderTable();
var tokenA = pt2.intern('first');
var tokenB = pt2.intern('second');
check('Distinct intern() calls get distinct tokens with independent payloads',
  tokenA !== tokenB && pt2.resolve(tokenA) === 'first' && pt2.resolve(tokenB) === 'second');

module.exports = { name: 'RulesEngine.test.js', checks: checks, failures: failures };

if (require.main === module) {
  if (failures.length === 0) console.log('ALL ' + checks + ' CHECKS PASSED');
  else { console.log((checks - failures.length) + '/' + checks + ' passed. FAILED: ' + failures.join(', ')); process.exitCode = 1; }
}
