// Standalone proof of RulesEngine's correctness: right-associative `^`,
// left-associative `*`/`+`, and parens overriding both — using plain
// numeric-string reduction (no WASM, no RegX). If this doesn't produce
// mathematically correct answers here, integrating it into RegX's
// compiler would just be moving a wrong algorithm somewhere new.

var RulesEngine = require('./RulesEngine.js');

var failures = 0;
function check(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

// ── Innermost-parens rule ───────────────────────────────────────────────
var ParenRule = {
  ruleId: 'paren',
  match: function(text) {
    return /\(([^()]+)\)/.exec(text);
  },
  reduce: function(text, m, state) {
    var engine = new RulesEngine([PowRule, MulRule, AddRule]);
    var inner = engine.run(m[1], state).text;
    return text.slice(0, m.index) + inner + text.slice(m.index + m[0].length);
  }
};

// ── Right-associative: reduce the LAST ^ first ──────────────────────────
var PowRule = {
  ruleId: 'pow',
  match: function(text) {
    return /(-?\d+)\^(-?\d+)(?!.*\^)/.exec(text);
  },
  reduce: function(text, m) {
    var result = Math.pow(parseInt(m[1], 10), parseInt(m[2], 10));
    return text.slice(0, m.index) + String(result) + text.slice(m.index + m[0].length);
  }
};

// ── Left-associative: reduce the FIRST * ────────────────────────────────
var MulRule = {
  ruleId: 'mul',
  match: function(text) {
    return /(-?\d+)\*(-?\d+)/.exec(text);
  },
  reduce: function(text, m) {
    var result = parseInt(m[1], 10) * parseInt(m[2], 10);
    return text.slice(0, m.index) + String(result) + text.slice(m.index + m[0].length);
  }
};

// ── Left-associative: reduce the FIRST + ────────────────────────────────
var AddRule = {
  ruleId: 'add',
  match: function(text) {
    return /(-?\d+)\+(-?\d+)/.exec(text);
  },
  reduce: function(text, m) {
    var result = parseInt(m[1], 10) + parseInt(m[2], 10);
    return text.slice(0, m.index) + String(result) + text.slice(m.index + m[0].length);
  }
};

function evaluate(expr) {
  var engine = new RulesEngine([ParenRule, PowRule, MulRule, AddRule]);
  return engine.run(expr, {}).text;
}

// The case that broke the old flat-split-and-fold algorithm: right-
// associativity actually changes the answer.
check('2^3^2 is right-associative', evaluate('2^3^2'), String(Math.pow(2, Math.pow(3, 2)))); // 2^(3^2) = 2^9 = 512
check('(2^3)^2 with explicit parens', evaluate('(2^3)^2'), String(Math.pow(Math.pow(2, 3), 2))); // 64 — parens override associativity

// Precedence ordering: ^ before * before +.
check('2+3*4^2 respects precedence', evaluate('2+3*4^2'), '50'); // 4^2=16, 3*16=48, 2+48=50

// Left-associativity for * and +, unaffected by this change.
check('10*2*3 left-associative', evaluate('10*2*3'), '60');
check('10+2+3 left-associative', evaluate('10+2+3'), '15');

// Mixed with parens forcing a non-default grouping.
check('(2+3)*4', evaluate('(2+3)*4'), '20');

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
