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

// Real setTimeout: the callback is a real closure (`() => this.incr()`,
// itself calling a void sibling method for its side effect) invoked by
// a REAL host timer, not simulated -- verified by actually waiting for
// it to fire and checking mutated instance state afterward.
var timeoutSrc = `
class Ticker {
  constructor() {
    this.count = 0;
    this.tick = () => this.incr();
  }
  incr() { this.count = this.count + 1; }
  schedule() { this.id = setTimeout(this.tick, 30); return this.id; }
  getCount() { return this.count; }
}
`;

// Real setInterval + real clearInterval: proves cancellation genuinely
// stops the host timer (not just a compiled no-op), by checking the
// count is unchanged well after the clearInterval call.
var intervalSrc = `
class Ticker {
  constructor() {
    this.count = 0;
    this.tick = () => this.incr();
  }
  incr() { this.count = this.count + 1; }
  start() { this.id = setInterval(this.tick, 25); }
  stop() { clearInterval(this.id); }
  getCount() { return this.count; }
}
`;

// Real clearTimeout: cancelling BEFORE it fires means the callback
// never runs at all.
var cancelTimeoutSrc = `
class Ticker {
  constructor() {
    this.count = 0;
    this.tick = () => this.incr();
  }
  incr() { this.count = this.count + 1; }
  schedule() { this.id = setTimeout(this.tick, 40); }
  cancel() { clearTimeout(this.id); }
  getCount() { return this.count; }
}
`;

Promise.resolve()
  .then(function() {
    return new Promise(function(resolve) {
      RegX.compileAndRun(timeoutSrc, {}).then(function(inst) {
        inst.exports.init(0);
        var id = inst.exports.schedule(0);
        check('setTimeout returns a real (nonzero) timer id', Number(id) > 0, true);
        check('count before the timer fires', inst.exports.getCount(0), 0);
        setTimeout(function() {
          check('count after the real timer fired', inst.exports.getCount(0), 1);
          resolve();
        }, 100);
      });
    });
  })
  .then(function() {
    return new Promise(function(resolve) {
      RegX.compileAndRun(intervalSrc, {}).then(function(inst) {
        inst.exports.init(0);
        inst.exports.start(0);
        setTimeout(function() {
          inst.exports.stop(0);
          var countAtStop = Number(inst.exports.getCount(0));
          check('interval fired multiple times before stop', countAtStop >= 2, true);
          setTimeout(function() {
            check('count unchanged well after clearInterval (really cancelled)', inst.exports.getCount(0), countAtStop);
            resolve();
          }, 80);
        }, 90);
      });
    });
  })
  .then(function() {
    return new Promise(function(resolve) {
      RegX.compileAndRun(cancelTimeoutSrc, {}).then(function(inst) {
        inst.exports.init(0);
        inst.exports.schedule(0);
        inst.exports.cancel(0);
        setTimeout(function() {
          check('clearTimeout before it fired means the callback never ran', inst.exports.getCount(0), 0);
          resolve();
        }, 80);
      });
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
