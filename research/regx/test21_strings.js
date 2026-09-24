var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');

var failures = 0;
function readString(inst, ptr) {
  var dv = new DataView(inst.exports.memory.buffer);
  var len = Number(dv.getBigInt64(Number(ptr), true));
  var bytes = new Uint8Array(inst.exports.memory.buffer, Number(ptr) + 8, len);
  return Buffer.from(bytes).toString('utf8');
}
function checkStr(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

function run(label, source, calls) {
  return RegX.compileAndRun(source, {})
    .then(function(instance) { return calls(instance, label); })
    .catch(function(err) {
      console.log('THREW (unexpected)  ' + label + '  ' + err.message);
      failures++;
    });
}

// A string property (single-quoted) read back across two separate
// method calls -- proves the heap-allocated buffer survives, not just
// the immediate assignment.
var propertySrc = `
class A {
  constructor() { this.name = 'hello world'; }
  getName() {
    return this.name;
  }
}
`;

// A bare string literal as a return value -- not a property assignment.
var bareReturnSrc = `
class A {
  greet() {
    return "hi there";
  }
}
`;

// Two different string-valued methods on one instance -- proves each
// literal's own bytes are independently correct, not aliased.
var twoStringsSrc = `
class A {
  constructor() { this.first = "alpha"; this.second = "beta"; }
  getFirst() { return this.first; }
  getSecond() { return this.second; }
}
`;

// A template literal with NO interpolation is just a string.
var templateNoInterpSrc = `
class A {
  greet() {
    return \`plain template\`;
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('string property survives across calls', propertySrc, function(inst) {
      inst.exports.init(0);
      checkStr('getName()', readString(inst, inst.exports.getName(0)), 'hello world');
      checkStr('getName() again, same value', readString(inst, inst.exports.getName(0)), 'hello world');
    });
  })
  .then(function() {
    return run('bare string literal as a return value', bareReturnSrc, function(inst) {
      checkStr('greet()', readString(inst, inst.exports.greet(0)), 'hi there');
    });
  })
  .then(function() {
    return run('two independent string properties', twoStringsSrc, function(inst) {
      inst.exports.init(0);
      checkStr('getFirst()', readString(inst, inst.exports.getFirst(0)), 'alpha');
      checkStr('getSecond()', readString(inst, inst.exports.getSecond(0)), 'beta');
    });
  })
  .then(function() {
    return run('template literal with no interpolation', templateNoInterpSrc, function(inst) {
      checkStr('greet()', readString(inst, inst.exports.greet(0)), 'plain template');
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
