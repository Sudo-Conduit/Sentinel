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

var ceilSrc = `
class C {
  constructor(x) { this.x = x; }
  f() { return Math.ceil(this.x / 2); }
}
`;

var absSrc = `
class C {
  f() { return Math.abs(-7); }
}
`;

var sqrtSrc = `
class C {
  constructor(x) { this.x = x; }
  f() { return Math.sqrt(this.x); }
}
`;

var truncSrc = `
class C {
  constructor(x) { this.x = x; }
  f() { return Math.trunc(this.x / 2); }
}
`;

// Two-argument intrinsics.
var maxSrc = `
class C {
  constructor(a, b) { this.a = a; this.b = b; }
  f() { return Math.max(this.a, this.b); }
}
`;

var minSrc = `
class C {
  constructor(a, b) { this.a = a; this.b = b; }
  f() { return Math.min(this.a, this.b); }
}
`;

// An intrinsic embedded WITHIN a larger arithmetic expression, not the
// whole return value — proves IntrinsicRule works inside the pipeline,
// not just at the top-level whole-expression check.
var embeddedSrc = `
class C {
  constructor(x) { this.x = x; }
  f() { return 1 + Math.floor(this.x / 2); }
}
`;

// Nested intrinsics — an intrinsic's own argument is itself an intrinsic
// call, proving findMatchingParen correctly nests rather than stopping
// at the first ')'.
var nestedSrc = `
class C {
  constructor(a, b, c) { this.a = a; this.b = b; this.c = c; }
  f() { return Math.max(this.a, Math.min(this.b, this.c)); }
}
`;

// Wrong argument count must fail loudly, not silently misparse.
var wrongArityMaxSrc = `
class C {
  constructor(x) { this.x = x; }
  f() { return Math.max(this.x); }
}
`;

var wrongArityFloorSrc = `
class C {
  constructor(x) { this.x = x; }
  f() { return Math.floor(this.x, 2); }
}
`;

Promise.resolve()
  .then(function() {
    return run('Math.ceil', ceilSrc, function(inst) {
      inst.exports.init(0, 19n);
      check('Math.ceil(19/2)=Math.ceil(9.5)', inst.exports.f(0), 10);
    });
  })
  .then(function() {
    return run('Math.abs', absSrc, function(inst) {
      check('Math.abs(-7)', inst.exports.f(0), 7);
    });
  })
  .then(function() {
    return run('Math.sqrt', sqrtSrc, function(inst) {
      inst.exports.init(0, 16n);
      check('Math.sqrt(16)', inst.exports.f(0), 4);
    });
  })
  .then(function() {
    return run('Math.trunc', truncSrc, function(inst) {
      inst.exports.init(0, 19n);
      check('Math.trunc(19/2)=Math.trunc(9.5)', inst.exports.f(0), 9);
    });
  })
  .then(function() {
    return run('Math.max', maxSrc, function(inst) {
      inst.exports.init(0, 3n, 8n);
      check('Math.max(3,8)', inst.exports.f(0), 8);
    });
  })
  .then(function() {
    return run('Math.min', minSrc, function(inst) {
      inst.exports.init(0, 3n, 8n);
      check('Math.min(3,8)', inst.exports.f(0), 3);
    });
  })
  .then(function() {
    return run('intrinsic embedded in a larger expression', embeddedSrc, function(inst) {
      inst.exports.init(0, 19n);
      check('1 + Math.floor(19/2) = 1 + 9', inst.exports.f(0), 10);
    });
  })
  .then(function() {
    return run('nested intrinsics', nestedSrc, function(inst) {
      inst.exports.init(0, 100n, 3n, 8n);
      check('Math.max(100, Math.min(3,8)) = Math.max(100,3)', inst.exports.f(0), 100);
    });
  })
  .then(function() {
    expectCompileError('Math.max wrong arity rejected', wrongArityMaxSrc, 'expects 2 argument');
  })
  .then(function() {
    expectCompileError('Math.floor wrong arity rejected', wrongArityFloorSrc, 'expects 1 argument');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
