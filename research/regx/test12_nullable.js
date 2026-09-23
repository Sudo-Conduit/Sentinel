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

// A nullable i64 property: this.x is inferred nullable purely from the
// literal `null` assignment on one branch -- the other branch assigns a
// real param, never analyzed for nullability itself.
var nullableIntSrc = `
class C {
  constructor(x) {
    if (x == 0) {
      this.x = null;
    } else {
      this.x = x;
    }
  }
  get() {
    return this.x ?? -1;
  }
  setNull() {
    this.x = null;
  }
  setValue(v) {
    this.x = v;
  }
}
`;

// Element type inference for nullable properties: a decimal literal
// anywhere among the property's non-null assignments makes the payload
// f64, same rule as ordinary (non-nullable) property type inference.
var nullableFloatSrc = `
class C {
  constructor(x) {
    if (x == 0) {
      this.x = null;
    } else {
      this.x = 2.5;
    }
  }
  get() {
    return this.x ?? -1.5;
  }
}
`;

// this.x ?? default where default is itself an arithmetic expression --
// proves the right side goes through the ordinary expression pipeline,
// not some literal-only special case.
var nullishWithExprDefaultSrc = `
class C {
  constructor(x) {
    if (x == 0) {
      this.x = null;
    } else {
      this.x = x;
    }
  }
  get(fallback) {
    return this.x ?? (fallback * 2);
  }
}
`;

// Reading a nullable property directly (not through ??) has no
// representation and must be rejected loudly, not silently read the
// tag or the payload as if it were the whole value.
var directReadRejectedSrc = `
class C {
  constructor(x) {
    if (x == 0) {
      this.x = null;
    } else {
      this.x = x;
    }
  }
  bad() {
    return this.x + 1;
  }
}
`;

// null/undefined have no representation as a general expression value
// outside of assignment or the left of ?? -- e.g. as a bare return value
// or a comparison operand.
var bareNullRejectedSrc = `
class C {
  f() {
    return null;
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('nullable i64 property, both branches', nullableIntSrc, function(inst) {
      inst.exports.init(0, 0n);
      check('constructed with x=0 -> this.x = null -> ?? -1', inst.exports.get(0), -1);
      inst.exports.init(0, 7n);
      check('constructed with x=7 -> this.x = 7 -> ?? -1', inst.exports.get(0), 7);
    });
  })
  .then(function() {
    return run('nullable property mutated after construction', nullableIntSrc, function(inst) {
      inst.exports.init(0, 42n);
      check('starts present', inst.exports.get(0), 42);
      inst.exports.setNull(0);
      check('set back to null', inst.exports.get(0), -1);
      inst.exports.setValue(0, 100n);
      check('set to a real value again', inst.exports.get(0), 100);
    });
  })
  .then(function() {
    return run('nullable f64 property (element type inference)', nullableFloatSrc, function(inst) {
      inst.exports.init(0, 0n);
      check('x=0 -> null -> ?? -1.5', inst.exports.get(0), -1.5);
      inst.exports.init(0, 9n);
      check('x=9 -> this.x = 2.5', inst.exports.get(0), 2.5);
    });
  })
  .then(function() {
    return run('?? default is a real expression, not just a literal', nullishWithExprDefaultSrc, function(inst) {
      inst.exports.init(0, 0n);
      check('null ?? (fallback*2), fallback=10', inst.exports.get(0, 10n), 20);
      inst.exports.init(0, 3n);
      check('present value ?? (fallback*2), value wins', inst.exports.get(0, 10n), 3);
    });
  })
  .then(function() {
    expectCompileError('direct read of a nullable property rejected', directReadRejectedSrc, 'reading nullable property');
  })
  .then(function() {
    expectCompileError('bare null as a general expression rejected', bareNullRejectedSrc, 'null/undefined has no representation');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
