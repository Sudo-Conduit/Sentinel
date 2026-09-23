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

// Fixed-size i64 array: construction, indexed read at multiple indices,
// indexed write, and a read-after-write to prove the write really landed
// at the right element (not just overwriting index 0 every time).
var intArraySrc = `
class C {
  make() {
    this.arr = [10, 20, 30];
  }
  get(i) {
    return this.arr[i];
  }
  set(i, v) {
    this.arr[i] = v;
  }
}
`;

// Element type inference: any decimal literal anywhere in the array's
// literal source makes the WHOLE array f64-typed (uniform element type,
// same rule as property type inference).
var floatArraySrc = `
class C {
  make() {
    this.arr = [1.5, 2.5, 3.5];
  }
  get(i) {
    return this.arr[i];
  }
}
`;

// Index expressions aren't limited to a bare identifier -- real arithmetic
// on the index itself has to compile through the ordinary expression
// pipeline, not some special-cased literal-only path.
var computedIndexSrc = `
class C {
  make() {
    this.arr = [100, 200, 300];
  }
  getPlusOne(i) {
    return this.arr[i + 1];
  }
}
`;

// A method call several bytecode-generations away from make() -- the heap
// bump pointer (global 0) has to survive being read back correctly across
// separate exported-function invocations, not just within one call.
var persistAcrossCallsSrc = `
class C {
  make() {
    this.arr = [7, 8, 9];
  }
  sum() {
    return this.arr[0] + this.arr[1] + this.arr[2];
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('int array construction + read', intArraySrc, function(inst) {
      inst.exports.make(0);
      check('arr[0]', inst.exports.get(0, 0n), 10);
      check('arr[1]', inst.exports.get(0, 1n), 20);
      check('arr[2]', inst.exports.get(0, 2n), 30);
    });
  })
  .then(function() {
    return run('int array write then read-back', intArraySrc, function(inst) {
      inst.exports.make(0);
      inst.exports.set(0, 1n, 999n);
      check('arr[0] unaffected by set(1,...)', inst.exports.get(0, 0n), 10);
      check('arr[1] after set(1,999)', inst.exports.get(0, 1n), 999);
      check('arr[2] unaffected by set(1,...)', inst.exports.get(0, 2n), 30);
    });
  })
  .then(function() {
    return run('float array element type inference', floatArraySrc, function(inst) {
      inst.exports.make(0);
      check('arr[0]=1.5', inst.exports.get(0, 0n), 1.5);
      check('arr[1]=2.5', inst.exports.get(0, 1n), 2.5);
      check('arr[2]=3.5', inst.exports.get(0, 2n), 3.5);
    });
  })
  .then(function() {
    return run('computed index expression', computedIndexSrc, function(inst) {
      inst.exports.make(0);
      check('arr[0+1]', inst.exports.getPlusOne(0, 0n), 200);
      check('arr[1+1]', inst.exports.getPlusOne(0, 1n), 300);
    });
  })
  .then(function() {
    return run('array survives across separate exported calls', persistAcrossCallsSrc, function(inst) {
      inst.exports.make(0);
      check('7+8+9', inst.exports.sum(0), 24);
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
