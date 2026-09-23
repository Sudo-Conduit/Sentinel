var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function check(label, actual, expected) {
  var normalized = typeof actual === 'bigint' ? Number(actual) : actual;
  var ok = (Number.isNaN(expected) && Number.isNaN(normalized)) || normalized === expected;
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

// compileAndRun throws SYNCHRONOUSLY on a compile-time error (parse/
// generateWasm run before any Promise is created), so rejection cases
// need a try/catch, not .catch().
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

// ── Case 40: true/false are real i32 values now ───────────────────────
var boolSrc = `
class C {
  yesNo(flag) {
    return flag;
  }
  yes() {
    return true;
  }
  no() {
    return false;
  }
}
`;

// ── Case 33: NaN is now a real, representable f64 value ────────────────
var nanSrc = `
class C {
  bad() {
    return NaN;
  }
}
`;

// ── Case 32: string literals are now real (heap-allocated, length-
// prefixed byte buffers, same shared heap arrays/objects use) ────────
var stringSrc = `
class C {
  greet() {
    return "hi";
  }
}
`;

function readString(inst, ptr) {
  var dv = new DataView(inst.exports.memory.buffer);
  var len = Number(dv.getBigInt64(Number(ptr), true));
  var bytes = new Uint8Array(inst.exports.memory.buffer, Number(ptr) + 8, len);
  return Buffer.from(bytes).toString('utf8');
}

// ── Case 41: typeof is now real -- resolved entirely at compile time,
// since every property here has one fixed, statically-known type for
// its whole lifetime (that's this compiler's whole premise) ──────────
var typeofSrc = `
class C {
  constructor(x) { this.x = x; }
  t() {
    return typeof this.x;
  }
}
`;

// ── Case 42: instanceof — no runtime type info, must fail loudly ──────
var instanceofSrc = `
class C {
  constructor(x) { this.x = x; }
  chk() {
    return this.x instanceof C;
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('bare true', boolSrc, function(inst) {
      check('yes()', inst.exports.yes(0), 1);
    });
  })
  .then(function() {
    return run('bare false', boolSrc, function(inst) {
      check('no()', inst.exports.no(0), 0);
    });
  })
  .then(function() {
    return run('NaN is representable', nanSrc, function(inst) {
      check('bad()', inst.exports.bad(0), NaN);
    });
  })
  .then(function() {
    return run('string literal is real', stringSrc, function(inst) {
      var s = readString(inst, inst.exports.greet(0));
      var ok = s === 'hi';
      if (!ok) failures++;
      console.log((ok ? 'PASS' : 'FAIL') + '  greet() returns "hi"  got=' + JSON.stringify(s));
    });
  })
  .then(function() {
    return run('typeof is real (compile-time resolved)', typeofSrc, function(inst) {
      inst.exports.init(0, 5n);
      var s = readString(inst, inst.exports.t(0));
      var ok = s === 'number';
      if (!ok) failures++;
      console.log((ok ? 'PASS' : 'FAIL') + '  typeof this.x (i64 property)  got=' + JSON.stringify(s));
    });
  })
  .then(function() {
    expectCompileError('instanceof rejected', instanceofSrc, 'instanceof');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
