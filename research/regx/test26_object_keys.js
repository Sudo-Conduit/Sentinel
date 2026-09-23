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

// Object.keys(this.obj) assigned to a real array property -- a genuine
// heap array of genuine heap strings, one per field, in DECLARATION
// order (matching real JS's own Object.keys() ordering for string
// keys). Read back element-by-element via readString to prove these
// are real strings, not just correctly-COUNTED opaque handles.
var basicSrc = `
class K {
  constructor(a, b, c) { this.obj = { first: a, second: b, third: c }; this.names = Object.keys(this.obj); }
  namesArr() { return this.names; }
  size() { return this.names.length; }
}
`;

// Object.keys(this.obj)[INDEX] used directly, without ever assigning
// the result to a property first -- proves the array construction and
// its indexing both work as a general expression, not only as a
// property-assignment RHS.
var directIndexSrc = `
class K2 {
  constructor(a, b) { this.obj = { x: a, y: b }; }
  firstKey() { return Object.keys(this.obj)[0]; }
  secondKey() { return Object.keys(this.obj)[1]; }
}
`;

// Object.keys() result used directly as a return value (the whole
// expression, no local/property in between at all).
var bareReturnSrc = `
class K3 {
  constructor(a) { this.obj = { onlyField: a }; }
  keys() { return Object.keys(this.obj); }
}
`;

// A real for-loop walking Object.keys()'s own array property via
// .length and indexed reads -- reuses the existing array .length/
// indexing machinery end-to-end, not a special-cased read path.
var forLoopSrc = `
class K4 {
  constructor(a, b, c) {
    this.obj = { p: a, q: b, r: c };
    this.names = Object.keys(this.obj);
    this.count = 0;
  }
  countNames() {
    for (let i = 0; i < this.names.length; i = i + 1) {
      this.count = this.count + 1;
    }
    return this.count;
  }
  nameAt(i) { return this.names[i]; }
}
`;

// Object.keys() on something that is NOT a known object-shaped
// property -- an array property -- is a real, legitimate compile
// error, exactly like real JS throwing when handed a value with no
// enumerable own keys this compiler can see, not a silent zero-length
// result.
var onArrayPropSrc = `
class Bad1 {
  constructor() { this.arr = [1, 2, 3]; }
  test() { return Object.keys(this.arr); }
}
`;

// Object.keys() on a plain numeric property -- same, real compile
// error.
var onNumberPropSrc = `
class Bad2 {
  constructor(x) { this.x = x; }
  test() { return Object.keys(this.x); }
}
`;

// Object.keys() on a non-property expression -- real compile error,
// not silently coerced to i64.const 0.
var onExprSrc = `
class Bad3 {
  constructor(x) { this.x = x; }
  test() { return Object.keys(this.x + 1); }
}
`;

// Wrong arity: 0 arguments.
var zeroArgsSrc = `
class Bad4 {
  constructor(a) { this.obj = { a: a }; }
  test() { return Object.keys(); }
}
`;

// Wrong arity: 2 arguments.
var twoArgsSrc = `
class Bad5 {
  constructor(a) { this.obj = { a: a }; }
  test() { return Object.keys(this.obj, this.obj); }
}
`;

Promise.resolve()
  .then(function() {
    return run('Object.keys() assigned to an array property, read back element by element', basicSrc, function(inst) {
      inst.exports.init(0, 1n, 2n, 3n);
      check('size() === 3 (three declared fields)', inst.exports.size(0), 3);
      var ptr = inst.exports.namesArr(0);
      var dv = new DataView(inst.exports.memory.buffer);
      var len = Number(dv.getBigInt64(Number(ptr), true));
      check('array length prefix === 3', len, 3);
      var elem0 = dv.getBigInt64(Number(ptr) + 8, true);
      var elem1 = dv.getBigInt64(Number(ptr) + 16, true);
      var elem2 = dv.getBigInt64(Number(ptr) + 24, true);
      checkStr('names[0] === "first"', readString(inst, elem0), 'first');
      checkStr('names[1] === "second"', readString(inst, elem1), 'second');
      checkStr('names[2] === "third"', readString(inst, elem2), 'third');
    });
  })
  .then(function() {
    return run('Object.keys(this.obj)[INDEX] used directly, no property assignment', directIndexSrc, function(inst) {
      inst.exports.init(0, 10n, 20n);
      checkStr('Object.keys(this.obj)[0] === "x"', readString(inst, inst.exports.firstKey(0)), 'x');
      checkStr('Object.keys(this.obj)[1] === "y"', readString(inst, inst.exports.secondKey(0)), 'y');
    });
  })
  .then(function() {
    return run('Object.keys() used directly as a return value', bareReturnSrc, function(inst) {
      inst.exports.init(0, 99n);
      var ptr = inst.exports.keys(0);
      var dv = new DataView(inst.exports.memory.buffer);
      check('length === 1 (one declared field)', Number(dv.getBigInt64(Number(ptr), true)), 1);
      var elem0 = dv.getBigInt64(Number(ptr) + 8, true);
      checkStr('keys()[0] === "onlyField"', readString(inst, elem0), 'onlyField');
    });
  })
  .then(function() {
    return run('for-loop over Object.keys() property via real .length/indexing', forLoopSrc, function(inst) {
      inst.exports.init(0, 1n, 2n, 3n);
      check('for-loop over .length counts all 3 real keys', inst.exports.countNames(0), 3);
      checkStr('nameAt(0) === "p"', readString(inst, inst.exports.nameAt(0, 0n)), 'p');
      checkStr('nameAt(1) === "q"', readString(inst, inst.exports.nameAt(0, 1n)), 'q');
      checkStr('nameAt(2) === "r"', readString(inst, inst.exports.nameAt(0, 2n)), 'r');
    });
  })
  .then(function() {
    expectCompileError('Object.keys() on an array property is rejected', onArrayPropSrc, 'known, static object-shaped property');
  })
  .then(function() {
    expectCompileError('Object.keys() on a plain numeric property is rejected', onNumberPropSrc, 'known, static object-shaped property');
  })
  .then(function() {
    expectCompileError('Object.keys() on a non-property expression is rejected', onExprSrc, 'direct object-shaped property reference');
  })
  .then(function() {
    expectCompileError('Object.keys() with 0 arguments is rejected', zeroArgsSrc, 'expects exactly 1 argument');
  })
  .then(function() {
    expectCompileError('Object.keys() with 2 arguments is rejected', twoArgsSrc, 'expects exactly 1 argument');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
