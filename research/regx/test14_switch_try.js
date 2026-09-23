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

// Real switch dispatch, one return per case, plus a default.
var switchSrc = `
class S {
  constructor(x) { this.x = x; }
  pick() {
    switch (this.x) {
      case 1:
        return 10;
      case 2:
        return 20;
      default:
        return 99;
    }
  }
}
`;

// Real fallthrough: a case without its own break/return absorbs the
// following case's statements, exactly like real JS -- not just "doesn't
// throw", the actual returned value has to prove it.
var fallthroughSrc = `
class S {
  constructor(x) { this.x = x; }
  pick() {
    switch (this.x) {
      case 1:
      case 2:
        return 12;
      case 3:
        return 3;
    }
    return -1;
  }
}
`;

// try/catch: nothing in RegX's supported grammar can throw, so the try
// body always runs to completion and the catch block is unreachable --
// the real, honest compilation is "splice in the try body, drop the
// catch", proven here by a real (non-zero, non-default) return value.
var trySrc = `
class C {
  constructor(x) { this.x = x; }
  safe() {
    try {
      return this.x;
    } catch (e) {
      return 0;
    }
  }
}
`;

Promise.resolve()
  .then(function() {
    return run('switch: real per-case dispatch', switchSrc, function(inst) {
      inst.exports.init(0, 1n);
      check('x=1 -> case 1', inst.exports.pick(0), 10);
      inst.exports.init(0, 2n);
      check('x=2 -> case 2', inst.exports.pick(0), 20);
      inst.exports.init(0, 3n);
      check('x=3 -> default', inst.exports.pick(0), 99);
    });
  })
  .then(function() {
    return run('switch: real fallthrough (case without break)', fallthroughSrc, function(inst) {
      inst.exports.init(0, 1n);
      check('x=1 falls through to case 2\'s return', inst.exports.pick(0), 12);
      inst.exports.init(0, 2n);
      check('x=2 -> case 2 directly', inst.exports.pick(0), 12);
      inst.exports.init(0, 3n);
      check('x=3 -> case 3', inst.exports.pick(0), 3);
      inst.exports.init(0, 4n);
      check('x=4 -> no case matches, falls out of switch', inst.exports.pick(0), -1);
    });
  })
  .then(function() {
    return run('try/catch: body runs, unreachable catch dropped', trySrc, function(inst) {
      inst.exports.init(0, 42n);
      check('safe() returns this.x from the try body', inst.exports.safe(0), 42);
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
