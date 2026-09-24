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
    .then(function(instance) {
      return calls(instance, label);
    })
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

// ── Case 43: real compound assignment ───────────────────────────────────
var compoundSrc = `
class C {
  constructor(a) { this.a = a; }
  inc() {
    this.a += 5;
    return this.a;
  }
}
`;

var compoundMulSrc = `
class C {
  constructor(a) { this.a = a; }
  doubleIt() {
    this.a *= 2;
    return this.a;
  }
}
`;

// ── Case 28/29: arrays are now real (fixed-size literal, index read/write) ─
// See test11_arrays.js for thorough array coverage; this file just checks
// that array literal assignment and indexing no longer throw.
var arraySrc = `
class C {
  make() {
    this.arr = [1, 2, 3];
  }
  first() {
    return this.arr[0];
  }
  set(v) {
    this.arr[0] = v;
  }
}
`;

// ── Case 34/35: Math.floor is now a real intrinsic, not a rejection ────
// this.x stays i64 (property type is inferred from assignment text, and
// "this.x = x;" has no decimal literal anywhere) — a real i64 param can't
// cross the JS boundary as a plain float anyway (needs BigInt), so the
// fractional value here comes from real division (guaranteed f64),
// exercising both Math.floor AND the i64->f64 promotion at once.
var mathFloorExprSrc = `
class C {
  constructor(x) { this.x = x; }
  f() {
    return Math.floor(this.x / 2);
  }
}
`;

var mathFloorStmtSrc = `
class C {
  constructor(x) { this.x = x; }
  f() {
    Math.floor(this.x / 2);
    return 9;
  }
}
`;

// A genuinely unrecognized call — not an intrinsic, not a host import —
// still has to be rejected loudly, same as before.
var unknownCallSrc = `
class C {
  constructor(x) { this.x = x; }
  f() {
    return this.x.doSomething();
  }
}
`;

// this.arr.push(1) on a class where 'arr' was never actually declared
// as an array property anywhere (no this.arr = [...] assignment exists
// in this class at all) -- push() itself is real now (see test25_events
// .js), but calling it on a property that was never an array is still a
// genuine compile-time error, just a more specific one than the old
// blanket "push is unsupported" used to be.
var arrayMethodCallSrc = `
class C {
  add() {
    this.arr.push(1);
    return 9;
  }
}
`;

// ── Case 60/61: specifically-named rejections, not "malformed ternary" ──
// ?. still has no representation -- not because null itself is
// unrepresentable anymore (see nullishSrc below), but because this
// compiler has no object-reference model to dot a further property off
// of this.x at all.
var optionalChainSrc = `
class C {
  get() {
    return this.x?.y;
  }
}
`;

// ?? is now real: this.x is inferred nullable because one of its
// assignments (in the else-less branch below) is the literal `null`.
// See test12_nullable.js for thorough nullable-property coverage.
var nullishSrc = `
class C {
  constructor(x) {
    if (x == 0) {
      this.x = null;
    } else {
      this.x = x;
    }
  }
  get() {
    return this.x ?? 99;
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('compound += ', compoundSrc, function(inst) {
      inst.exports.init(0, 10n);
      check('this.a += 5, a=10', inst.exports.inc(0), 15);
    });
  })
  .then(function() {
    return run('compound *=', compoundMulSrc, function(inst) {
      inst.exports.init(0, 7n);
      check('this.a *= 2, a=7', inst.exports.doubleIt(0), 14);
    });
  })
  .then(function() {
    return run('array literal, index read, index write', arraySrc, function(inst) {
      inst.exports.make(0);
      check('this.arr = [1,2,3]; return this.arr[0]', inst.exports.first(0), 1);
      inst.exports.set(0, 99n);
      check('this.arr[0] = 99; return this.arr[0]', inst.exports.first(0), 99);
    });
  })
  .then(function() {
    return run('Math.floor as an expression', mathFloorExprSrc, function(inst) {
      inst.exports.init(0, 19n);
      check('Math.floor(this.x/2), x=19 -> 9.5 -> 9', inst.exports.f(0), 9);
    });
  })
  .then(function() {
    return run('Math.floor as a bare statement', mathFloorStmtSrc, function(inst) {
      inst.exports.init(0, 19n);
      check('Math.floor(this.x/2); (discarded), returns 9 unaffected', inst.exports.f(0), 9);
    });
  })
  .then(function() {
    expectCompileError('genuinely unrecognized call rejected', unknownCallSrc, 'function/method calls');
  })
  .then(function() {
    expectCompileError('push() on a property that was never declared an array is rejected', arrayMethodCallSrc, 'non-array property');
  })
  .then(function() {
    expectCompileError('optional chaining specifically named', optionalChainSrc, 'object-reference model');
  })
  .then(function() {
    return run('nullish coalescing on a real nullable property', nullishSrc, function(inst) {
      inst.exports.init(0, 0n);
      check('this.x ?? 99, x was null', inst.exports.get(0), 99);
      inst.exports.init(0, 5n);
      check('this.x ?? 99, x was 5 (not null)', inst.exports.get(0), 5);
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
