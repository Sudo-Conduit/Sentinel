var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function check(label, actual, expected) {
  var normalized = typeof actual === 'bigint' ? Number(actual) : actual;
  var ok = Math.abs(normalized - expected) < 1e-9;
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

// A real object literal with two named fields, read back via
// destructuring in TWO different methods -- proves the field offsets
// are consistent across separately-compiled call sites, not just
// coincidentally correct in one.
var basicSrc = `
class D {
  constructor(a, b) { this.obj = { a: a, b: b }; }
  getA() {
    const { a, b } = this.obj;
    return a;
  }
  getB() {
    const { a, b } = this.obj;
    return b;
  }
}
`;

// Mixed i64/f64 fields in one object -- each field independently
// promotes to f64 based on its OWN literal text, not the whole object
// uniformly (unlike arrays).
var mixedTypeSrc = `
class D {
  constructor(a) { this.obj = { count: a, ratio: 2.5 }; }
  sum() {
    const { count, ratio } = this.obj;
    return count + ratio;
  }
}
`;

// Destructuring only SOME of an object's fields (not all of them) --
// proves field access doesn't require touching every field.
var partialSrc = `
class D {
  constructor(a, b, c) { this.obj = { x: a, y: b, z: c }; }
  onlyY() {
    const { y } = this.obj;
    return y;
  }
}
`;

// Destructuring a property that is NOT object-shaped is a real type
// error -- exactly what real JS itself would throw at runtime
// destructuring a non-object -- not a silently-wrong compile.
var notAnObjectSrc = `
class D {
  constructor(x) { this.x = x; }
  bad() {
    const { a, b } = this.x;
    return a;
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('object literal + destructuring across two methods', basicSrc, function(inst) {
      inst.exports.init(0, 5n, 42n);
      check('getA() reads field a', inst.exports.getA(0), 5);
      check('getB() reads field b', inst.exports.getB(0), 42);
    });
  })
  .then(function() {
    return run('mixed i64/f64 fields in one object', mixedTypeSrc, function(inst) {
      inst.exports.init(0, 5n);
      check('count(i64) + ratio(f64) = 5 + 2.5', inst.exports.sum(0), 7.5);
    });
  })
  .then(function() {
    return run('destructuring only some fields', partialSrc, function(inst) {
      inst.exports.init(0, 1n, 2n, 3n);
      check('only y destructured, still correct', inst.exports.onlyY(0), 2);
    });
  })
  .then(function() {
    expectCompileError('destructuring a non-object property rejected', notAnObjectSrc, 'not a known object-shaped property');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
