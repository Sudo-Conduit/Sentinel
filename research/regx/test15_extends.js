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

// Derived overrides Base's own methods and constructor -- proves both
// classes compile independently, each callable under its own namespace.
var overrideSrc = `
class Base {
  constructor(x) { this.x = x; }
  get() { return this.x; }
}
class Derived extends Base {
  constructor(x) { this.x = x; }
  get() { return this.x; }
}
`;

// Derived adds a NEW field (y) and a new method (sum), but never
// redeclares get()/double() -- both must be real, callable, INHERITED
// exports on Derived, compiled fresh against Derived's own (merged)
// property offsets, not just present on Base.
var inheritSrc = `
class Base {
  constructor(x) { this.x = x; }
  get() { return this.x; }
  double() { return this.x * 2; }
}
class Derived extends Base {
  constructor(x, y) { this.x = x; this.y = y; }
  sum() { return this.x + this.y; }
}
`;

Promise.resolve()
  .then(function() {
    return run('Base and Derived independently, both overriding', overrideSrc, function(inst) {
      inst.exports.Base_init(0, 5n);
      inst.exports.Derived_init(64, 42n);
      check('Base.get()', inst.exports.Base_get(0), 5);
      check('Derived.get() (its own override)', inst.exports.Derived_get(64), 42);
      check('Base unaffected by Derived instance', inst.exports.Base_get(0), 5);
    });
  })
  .then(function() {
    return run('Derived inherits non-overridden Base methods', inheritSrc, function(inst) {
      inst.exports.Derived_init(64, 10n, 3n);
      check('Derived.get() (inherited, unmodified)', inst.exports.Derived_get(64), 10);
      check('Derived.double() (inherited, unmodified)', inst.exports.Derived_double(64), 20);
      check('Derived.sum() (its own, uses inherited x plus its own y)', inst.exports.Derived_sum(64), 13);
      // Base itself is still independently compiled and callable.
      inst.exports.Base_init(0, 100n);
      check('Base.get() still independent', inst.exports.Base_get(0), 100);
      check('Base.double() still independent', inst.exports.Base_double(0), 200);
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
