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

// A whole-expression sibling call and one embedded in arithmetic --
// real, direct `call`, not a rejection.
var basicSrc = `
class Calc {
  constructor(x) { this.x = x; }
  double() { return this.x * 2; }
  quadruple() { return this.double() * 2; }
}
`;

// Forward reference: first() calls second(), declared LATER in the
// class -- proves the fixed-point return-type inference resolves
// regardless of declaration order.
var forwardRefSrc = `
class Calc {
  constructor(x) { this.x = x; }
  first() { return this.second() + 1; }
  second() { return this.x * 3; }
}
`;

// A bare-statement call to a genuinely VOID sibling method (no return
// anywhere in its body) -- used for its side effect, mutating state a
// later call reads back.
var voidCallSrc = `
class Calc {
  constructor() { this.log = 0; }
  track() {
    this.bump();
    return this.log;
  }
  bump() {
    this.log = this.log + 1;
  }
}
`;

// Calling a sibling method that doesn't exist is a real, specific error.
var unknownMethodSrc = `
class C {
  f() {
    return this.doesNotExist();
  }
}
`;

// Wrong argument count to a sibling call is a real, specific error.
var wrongArityMethodSrc = `
class C {
  add(a, b) {
    return a + b;
  }
  f() {
    return this.add(1);
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('sibling call, whole expression and embedded in arithmetic', basicSrc, function(inst) {
      inst.exports.init(0, 5n);
      check('double()', inst.exports.double(0), 10);
      check('quadruple() = double()*2, embedded call', inst.exports.quadruple(0), 20);
    });
  })
  .then(function() {
    return run('forward-referencing sibling call', forwardRefSrc, function(inst) {
      inst.exports.init(0, 5n);
      check('first() calls second(), declared later', inst.exports.first(0), 16);
    });
  })
  .then(function() {
    return run('bare-statement call to a void sibling method', voidCallSrc, function(inst) {
      inst.exports.init(0);
      check('track() after one bump()', inst.exports.track(0), 1);
      check('track() after two bumps()', inst.exports.track(0), 2);
    });
  })
  .then(function() {
    expectCompileError('calling a nonexistent sibling method rejected', unknownMethodSrc, 'function/method calls are not supported');
  })
  .then(function() {
    expectCompileError('wrong arity sibling call rejected', wrongArityMethodSrc, 'expects 2 argument');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
