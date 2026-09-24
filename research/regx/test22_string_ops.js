var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function readString(inst, ptr) {
  var dv = new DataView(inst.exports.memory.buffer);
  var len = Number(dv.getBigInt64(Number(ptr), true));
  var bytes = new Uint8Array(inst.exports.memory.buffer, Number(ptr) + 8, len);
  return Buffer.from(bytes).toString('utf8');
}
function checkStr(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}
function check(label, actual, expected) {
  var normalized = typeof actual === 'bigint' ? Number(actual) : actual;
  var ok = normalized === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

function run(label, source, calls) {
  return RegX.compileAndRun(source, {})
    .then(function(instance) { return calls(instance, label); })
    .catch(function(err) {
      console.log('THREW (unexpected)  ' + label + '  ' + err.message);
      failures++;
    });
}

function expectCompileError(label, source, expectedSubstring) {
  try {
    RegX.compileAndRun(source, {});
    console.log('FAIL  ' + label + '  expected a thrown compile error, got none');
    failures++;
  } catch (err) {
    var ok = err.message.indexOf(expectedSubstring) !== -1;
    if (!ok) failures++;
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  threw: "' + err.message + '"');
  }
}

// Property + property, and property + literal concatenation.
var concatSrc = `
class C {
  constructor() { this.first = 'hello'; this.second = 'world'; }
  full() { return this.first + this.second; }
  greet() { return this.first + ' there'; }
}
`;

// Chained concatenation (a + b + c) -- proves the result of one concat
// carries the 'string' tag through to the next one, not just the first
// pair.
var chainedSrc = `
class C {
  constructor() { this.a = 'ab'; this.c = 'xy'; }
  chained() { return this.a + this.c + 'z'; }
}
`;

// Real equality/inequality, including a real (fixed, previously-broken)
// === that had been silently always false.
var compareSrc = `
class C {
  constructor() { this.a = 'ab'; this.b = 'abc'; }
  sameEq() { return this.a === this.a; }
  diffEq() { return this.a === this.b; }
  diffNeq() { return this.a !== this.b; }
  litEq() { return this.a === 'ab'; }
}
`;

// Real === on plain numbers too (this bug affected numbers, not just
// the new string comparisons that surfaced it).
var numericStrictEqSrc = `
class C {
  constructor(a, b) { this.a = a; this.b = b; }
  eq() { return this.a === this.b; }
}
`;

// Comparing a string to a non-string, and ordering a string with <, are
// both real, specific errors -- no automatic coercion, no lexicographic
// ordering in v1.
var mismatchSrc = `
class C {
  constructor(x) { this.name = 'x'; this.x = x; }
  bad() {
    return this.name === this.x;
  }
}
`;

var orderingSrc = `
class C {
  constructor() { this.name = 'x'; }
  bad() {
    return this.name < 'y';
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('concatenation: property+property, property+literal', concatSrc, function(inst) {
      inst.exports.init(0);
      checkStr('this.first + this.second', readString(inst, inst.exports.full(0)), 'helloworld');
      checkStr('this.first + literal', readString(inst, inst.exports.greet(0)), 'hello there');
    });
  })
  .then(function() {
    return run('chained concatenation a+c+literal', chainedSrc, function(inst) {
      inst.exports.init(0);
      checkStr('chained()', readString(inst, inst.exports.chained(0)), 'abxyz');
    });
  })
  .then(function() {
    return run('string equality/inequality', compareSrc, function(inst) {
      inst.exports.init(0);
      check('a === a', inst.exports.sameEq(0), 1);
      check('a === b (different length)', inst.exports.diffEq(0), 0);
      check('a !== b', inst.exports.diffNeq(0), 1);
      check('a === literal "ab"', inst.exports.litEq(0), 1);
    });
  })
  .then(function() {
    return run('=== on numbers (was silently always false before this fix)', numericStrictEqSrc, function(inst) {
      inst.exports.init(0, 5n, 5n);
      check('5 === 5', inst.exports.eq(0), 1);
      inst.exports.init(0, 5n, 6n);
      check('5 === 6', inst.exports.eq(0), 0);
    });
  })
  .then(function() {
    expectCompileError('comparing a string to a non-string rejected', mismatchSrc, 'cannot compare a string to a non-string');
  })
  .then(function() {
    expectCompileError('ordering comparison on strings rejected', orderingSrc, 'is not defined for strings');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
