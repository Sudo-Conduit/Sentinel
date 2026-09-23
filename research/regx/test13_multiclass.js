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

// Two classes, each with their own single property named differently.
// Real multi-class compilation: each class gets its own 0-based property
// offset table and its own namespaced exports (A_init/A_getX,
// B_init/B_getY) in ONE shared module -- not a rejection.
var twoClassSrc = `
class A {
  constructor(x) {
    this.x = x;
  }
  getX() {
    return this.x;
  }
}
class B {
  constructor(y) {
    this.y = y;
  }
  getY() {
    return this.y;
  }
}
`;

// A's and B's own properties would collide at the same offset (0) if
// compiled correctly independent-of-each-other -- and that's exactly
// right, since they're two different classes' objects, not two fields on
// one object. Using two DIFFERENT $this addresses (0 and 64) proves both
// classes' state is independently readable/writable at the same time.
Promise.resolve()
  .then(function() {
    return run('two classes, namespaced exports, independent offsets', twoClassSrc, function(inst) {
      var exportNames = Object.keys(inst.exports).sort();
      console.log('  exports:', exportNames.join(', '));
      var hasNamespaced = exportNames.indexOf('A_init') !== -1 && exportNames.indexOf('A_getX') !== -1 &&
        exportNames.indexOf('B_init') !== -1 && exportNames.indexOf('B_getY') !== -1;
      if (!hasNamespaced) { failures++; console.log('FAIL  namespaced exports missing'); }
      else { console.log('PASS  namespaced exports present'); }

      inst.exports.A_init(0, 111n);
      inst.exports.B_init(64, 222n);
      check('A instance at $this=0, getX()', inst.exports.A_getX(0), 111);
      check('B instance at $this=64, getY()', inst.exports.B_getY(64), 222);

      // Mutate B, confirm A is untouched -- proves the two classes'
      // property tables are genuinely independent, not aliased.
      inst.exports.B_init(64, 333n);
      check('A unaffected by re-init of B', inst.exports.A_getX(0), 111);
      check('B reflects its own re-init', inst.exports.B_getY(64), 333);
    });
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
