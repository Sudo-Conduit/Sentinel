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

// Real events: `.on()` pushes a real closure onto a growable array,
// `.emit()` walks it with a real for-loop and dispatches EACH stored
// listener through a genuine, runtime call_indirect (the table index
// itself, not just the arguments, is only known once it's read back out
// of the array element). Two DIFFERENT listeners (onA/onB) are used
// (not the same one twice) so a bug that always dispatches slot 0 -- or
// that corrupts an earlier slot when the array grows -- shows up as a
// wrong count, not just "didn't throw".
var emitterSrc = `
class Emitter {
  constructor() {
    this.listeners = [];
    this.countA = 0;
    this.countB = 0;
    this.onA = () => this.bumpA();
    this.onB = () => this.bumpB();
  }
  bumpA() { this.countA = this.countA + 1; }
  bumpB() { this.countB = this.countB + 1; }
  addA() { this.listeners.push(this.onA); }
  addB() { this.listeners.push(this.onB); }
  size() { return this.listeners.length; }
  emit() {
    for (let i = 0; i < this.listeners.length; i = i + 1) {
      this.listeners[i]();
    }
  }
  getA() { return this.countA; }
  getB() { return this.countB; }
}
`;

// this.arr.push() on a plain i64 property -- a real, legitimate compile
// error (push has no meaning on something that was never an array),
// not silently accepted.
var pushOnNonArraySrc = `
class Bad1 {
  constructor() { this.x = 5; }
  test() { this.x.push(1); }
}
`;

// this.arr[i]() where arr holds plain i64 elements (not closures) -- a
// real, legitimate compile error: there is nothing callable stored
// there, and no way to know that except from this compiler's own static
// element-type inference.
var dynCallOnNonFunctionArraySrc = `
class Bad2 {
  constructor() { this.arr = [1, 2, 3]; }
  test() { this.arr[0](); }
}
`;

// Pushing a closure that takes an argument into a listener array -- a
// real, legitimate compile error: this compiler's event-listener
// convention (matching its existing closure model) is zero user
// arguments, checked at the actual push site, not silently allowed to
// corrupt the shared call_indirect dispatch type later.
var wrongArityListenerSrc = `
class Bad3 {
  constructor() {
    this.listeners = [];
    this.bad = (x) => x + 1;
  }
  add() { this.listeners.push(this.bad); }
}
`;

Promise.resolve()
  .then(function() {
    return run('events: empty emitter starts at size 0', emitterSrc, function(inst) {
      inst.exports.init(0);
      check('size() before any listener added', inst.exports.size(0), 0);
    });
  })
  .then(function() {
    return run('events: push grows the array, .length reflects it', emitterSrc, function(inst) {
      inst.exports.init(0);
      inst.exports.addA(0);
      check('size() after 1st push', inst.exports.size(0), 1);
      inst.exports.addB(0);
      check('size() after 2nd push (real growth, not overwrite)', inst.exports.size(0), 2);
      inst.exports.addA(0);
      check('size() after 3rd push (grown TWICE)', inst.exports.size(0), 3);
    });
  })
  .then(function() {
    return run('events: emit() dispatches every listener via dynamic call_indirect', emitterSrc, function(inst) {
      inst.exports.init(0);
      inst.exports.addA(0); // listeners = [onA]
      inst.exports.addB(0); // listeners = [onA, onB] -- array reallocated; onA must SURVIVE the copy
      inst.exports.addA(0); // listeners = [onA, onB, onA] -- reallocated AGAIN
      inst.exports.emit(0);
      // onA sits at slots 0 and 2 -- bumpA must run twice; onB sits at
      // slot 1 -- bumpB must run exactly once. A wrong count here means
      // either growth corrupted an old element, or call_indirect
      // dispatched the wrong (or a stale) table index for some slot.
      check('bumpA() ran twice (onA at slots 0 and 2, both survived growth)', inst.exports.getA(0), 2);
      check('bumpB() ran once (onB at slot 1, survived growth too)', inst.exports.getB(0), 1);
    });
  })
  .then(function() {
    return run('events: emit() called again accumulates further (real state, not a fluke)', emitterSrc, function(inst) {
      inst.exports.init(0);
      inst.exports.addA(0);
      inst.exports.addB(0);
      inst.exports.emit(0);
      inst.exports.emit(0);
      check('bumpA() ran twice total (once per emit)', inst.exports.getA(0), 2);
      check('bumpB() ran twice total (once per emit)', inst.exports.getB(0), 2);
    });
  })
  .then(function() {
    expectCompileError('push() on a non-array property is rejected', pushOnNonArraySrc, 'non-array property');
  })
  .then(function() {
    expectCompileError('dynamic call on a non-function-typed array is rejected', dynCallOnNonFunctionArraySrc, 'listener) elements');
  })
  .then(function() {
    expectCompileError('pushing a wrong-arity closure as a listener is rejected', wrongArityListenerSrc, 'must take no arguments');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
