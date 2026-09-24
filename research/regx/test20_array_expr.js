var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function readArray(inst, ptr, n) {
  var mem = new BigInt64Array(inst.exports.memory.buffer, Number(ptr), n + 1);
  return Array.from(mem).map(Number);
}
function checkArray(label, actual, expected) {
  var ok = actual.length === expected.length && actual.every(function(v, i) { return v === expected[i]; });
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=[' + actual + '] want=[' + expected + ']');
}

function run(label, source, calls) {
  return RegX.compileAndRun(source, {})
    .then(function(instance) { return calls(instance, label); })
    .catch(function(err) {
      console.log('THREW (unexpected)  ' + label + '  ' + err.message);
      failures++;
    });
}

// A bare array literal as a return value -- not a property assignment.
var bareReturnSrc = `
class A {
  make() {
    return [10, 20, 30];
  }
}
`;

// A bare array literal on each side of a ternary -- proves the general
// expression path works through recursive compileExpressionToWasm
// call sites, not just a single special-cased statement shape.
var ternarySrc = `
class A {
  constructor(x) { this.x = x; }
  pick() {
    return this.x > 0 ? [1, 2] : [3, 4, 5];
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('bare array literal as a return value', bareReturnSrc, function(inst) {
      var ptr = inst.exports.make(0);
      checkArray('[length, 10, 20, 30]', readArray(inst, ptr, 3), [3, 10, 20, 30]);
    });
  })
  .then(function() {
    return run('array literal in each ternary branch', ternarySrc, function(inst) {
      inst.exports.init(0, 1n);
      checkArray('x>0 -> [1,2]', readArray(inst, inst.exports.pick(0), 2), [2, 1, 2]);
      inst.exports.init(0, -1n);
      checkArray('x<=0 -> [3,4,5]', readArray(inst, inst.exports.pick(0), 3), [3, 3, 4, 5]);
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
