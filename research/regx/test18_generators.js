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

function drain(inst, nextName, doneName, thisAddr) {
  var results = [];
  for (;;) {
    var v = inst.exports[nextName](thisAddr);
    if (inst.exports[doneName](thisAddr)) break;
    results.push(typeof v === 'bigint' ? Number(v) : v);
  }
  return results;
}

function run(label, source, calls) {
  return RegX.compileAndRun(source, {})
    .then(function(instance) { return calls(instance, label); })
    .catch(function(err) {
      console.log('THREW (unexpected)  ' + label + '  ' + err.message);
      failures++;
    });
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every(function(v, i) { return v === b[i]; });
}
function checkArray(label, actual, expected) {
  var ok = arraysEqual(actual, expected);
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=[' + actual + '] want=[' + expected + ']');
}

// The exact conformance case 57 shape: a single yield, no loop -- proves
// the driver correctly handles the "one value then done" case.
var singleYieldSrc = `
class Gen {
  constructor(x) { this.x = x; }
  *walk() {
    yield this.x;
  }
}
`;

// A real multi-yield loop -- exactly the pattern most real generator
// code uses: a while loop wrapping yield, with a local variable
// (promoted to hidden per-instance state) mutated across iterations and
// surviving separate .next() calls, which run as completely separate
// WASM function invocations with no shared stack.
var loopSrc = `
class Counter {
  constructor(limit) { this.limit = limit; }
  *count() {
    let i = 0;
    while (i < this.limit) {
      yield i;
      i = i + 1;
    }
  }
}
`;

// A branch INSIDE the loop, itself containing yield on both arms --
// proves the block lowering handles nested if/while around yield, not
// just a flat top-level sequence.
var branchInLoopSrc = `
class Evens {
  constructor(limit) { this.limit = limit; }
  *evens() {
    let i = 0;
    while (i < this.limit) {
      if (i == 0) {
        yield 100;
      } else {
        yield i;
      }
      i = i + 1;
    }
  }
}
`;

// Calling .next() after the generator is already exhausted must keep
// returning the same "done" result, not re-run anything or throw.
var exhaustedCallsMoreSrc = `
class One {
  *once() {
    yield 42;
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('single yield, no loop (conformance case 57 shape)', singleYieldSrc, function(inst) {
      inst.exports.init(0, 9n);
      check('walk_done() before any next()', inst.exports.walk_done(0), 0);
      check('walk_next() yields the captured value', inst.exports.walk_next(0), 9);
      check('walk_done() still false right after the yield', inst.exports.walk_done(0), 0);
      check('walk_next() again reaches the implicit end', inst.exports.walk_next(0), 0);
      check('walk_done() true once exhausted', inst.exports.walk_done(0), 1);
    });
  })
  .then(function() {
    return run('multi-yield while loop, local variable persists across calls', loopSrc, function(inst) {
      inst.exports.init(0, 4n);
      checkArray('count() yields 0,1,2,3', drain(inst, 'count_next', 'count_done', 0), [0, 1, 2, 3]);
    });
  })
  .then(function() {
    return run('if/else branch inside a while loop, both arms yield', branchInLoopSrc, function(inst) {
      inst.exports.init(0, 4n);
      checkArray('evens() yields 100,1,2,3', drain(inst, 'evens_next', 'evens_done', 0), [100, 1, 2, 3]);
    });
  })
  .then(function() {
    return run('calling next() after exhaustion stays exhausted', exhaustedCallsMoreSrc, function(inst) {
      check('first next()', inst.exports.once_next(0), 42);
      inst.exports.once_next(0); // reach done
      check('done after second next()', inst.exports.once_done(0), 1);
      check('third next() stays 0, does not re-run', inst.exports.once_next(0), 0);
      check('still done', inst.exports.once_done(0), 1);
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
