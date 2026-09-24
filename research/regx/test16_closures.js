var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
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

// Zero-arg arrow, single captured constructor param -- exactly
// conformance case 47's shape, but actually CALLED, not just read.
var basicSrc = `
class A {
  constructor(x) { this.f = () => x; }
  call() { return this.f(); }
}
`;

// Own params AND a captured value combined in one expression -- proves
// captures and the closure's own arguments aren't confused with each
// other.
var mixedSrc = `
class A {
  constructor(x) { this.add = (a, b) => a + b + x; }
  call(a, b) { return this.add(a, b); }
}
`;

// Two independent closures on the same instance, different arities and
// different captured values -- proves the table dispatches to the RIGHT
// function per property, not just "the only one that exists."
var twoClosuresSrc = `
class A {
  constructor(x, y) {
    this.f = () => x;
    this.g = (a) => a * y;
  }
  callF() { return this.f(); }
  callG(a) { return this.g(a); }
}
`;

// A closure captures nothing at all -- pure function of its own params.
var noCaptureSrc = `
class A {
  constructor() { this.square = (n) => n * n; }
  call(n) { return this.square(n); }
}
`;

// Capturing an identifier that ISN'T a constructor parameter is a real
// error (real JS itself would throw ReferenceError for a truly
// undefined binding) -- not a "RegX doesn't support this" rejection.
var unknownCaptureSrc = `
class A {
  constructor(x) { this.f = () => y; }
  call() { return this.f(); }
}
`;

Promise.resolve()
  .then(function() {
    return run('closure with one captured value, actually called', basicSrc, function(inst) {
      inst.exports.init(0, 9n);
      check('this.f() returns the captured constructor param', inst.exports.call(0), 9);
    });
  })
  .then(function() {
    return run('closure combining its own params with a capture', mixedSrc, function(inst) {
      inst.exports.init(0, 100n);
      check('add(2,3) = 2+3+100', inst.exports.call(0, 2n, 3n), 105);
      check('add(10,20) = 10+20+100', inst.exports.call(0, 10n, 20n), 130);
    });
  })
  .then(function() {
    return run('two independent closures, different arity and captures', twoClosuresSrc, function(inst) {
      inst.exports.init(0, 7n, 3n);
      check('f() returns its own capture', inst.exports.callF(0), 7);
      check('g(5) = 5 * its own capture', inst.exports.callG(0, 5n), 15);
    });
  })
  .then(function() {
    return run('closure with no captures at all', noCaptureSrc, function(inst) {
      inst.exports.init(0);
      check('square(6)', inst.exports.call(0, 6n), 36);
    });
  })
  .then(function() {
    expectCompileError('capturing an undefined identifier rejected', unknownCaptureSrc, 'captures unknown identifier');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
