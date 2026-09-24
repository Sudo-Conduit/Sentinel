var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function check(label, actual, expected) {
  var normalized = typeof actual === 'bigint' ? actual : actual;
  var ok = normalized === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}
function checkClose(label, actual, expected, epsilon) {
  var ok = Math.abs(Number(actual) - expected) < epsilon;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want~=' + expected);
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

// ── i64 holds exact precision beyond f64's 2^53 safe-integer limit ─────
var bigIntSrc = `
class C {
  constructor(a) { this.a = a; }
  addOne() {
    return this.a + 1;
  }
}
`;
// 2^53 + 1 = 9007199254740993 — the canonical case an f64-only compiler
// gets wrong (it would round to 9007199254740992 and never see the +1).

// ── Decimal literals promote a whole expression to f64 ─────────────────
// (2-term only: 3+-term +/* chains hit the pre-existing, separately
// tracked case-03/10 regression — only one combining opcode is emitted
// regardless of term count — which is out of scope here and untouched.)
var floatSrc = `
class C {
  constructor(r) { this.r = r; }
  circumference() {
    return this.r * 6.28318;
  }
}
`;

// ── An i64 property mixed with an f64 literal promotes to f64 ──────────
var mixedSrc = `
class C {
  constructor(count) { this.count = count; }
  half() {
    return this.count * 0.5;
  }
}
`;

// ── this.X property type is inferred once from its assignment text ─────
var typedPropsSrc = `
class C {
  constructor(n, x) { this.n = n; this.x = x; }
  readN() { return this.n; }
  readX() { return this.x; }
}
`;
// this.x is never assigned a decimal literal directly (it comes from a
// param), so it stays i64 — only a literal with a decimal point (or NaN)
// in an assignment forces a property to f64.

Promise.resolve()
  .then(function() {
    return run('i64 exact beyond 2^53', bigIntSrc, function(inst) {
      inst.exports.init(0, 9007199254740993n); // 2^53 + 1
      check('addOne() exact i64 arithmetic', inst.exports.addOne(0), 9007199254740994n);
    });
  })
  .then(function() {
    return run('f64 promotion from decimal literal', floatSrc, function(inst) {
      inst.exports.init(0, 3n);
      checkClose('circumference() = r*2pi (f64)', inst.exports.circumference(0), 18.84954, 0.001);
    });
  })
  .then(function() {
    return run('f64 promotion, half()', mixedSrc, function(inst) {
      inst.exports.init(0, 7n);
      checkClose('half() = count*0.5 (f64)', inst.exports.half(0), 3.5, 0.0001);
    });
  })
  .then(function() {
    return run('property types inferred independently', typedPropsSrc, function(inst) {
      inst.exports.init(0, 42n, 9007199254740993n);
      check('readN() stays i64', inst.exports.readN(0), 42n);
      check('readX() stays i64, exact beyond 2^53', inst.exports.readX(0), 9007199254740993n);
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
