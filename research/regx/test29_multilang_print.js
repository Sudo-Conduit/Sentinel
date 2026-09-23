// Verifies each language front-end's native print/output statement
// (printf/System.out.println/echo/print/console.log) genuinely reaches
// RegX's EXISTING console.log/KNOWN_IMPORTS host-import machinery -- the
// SAME env.log import test27 in RegXConformance.js already proves reaches
// real console.log at instantiate() -- not a fabricated no-op. Captured
// via a real `env: { log: fn }` override passed as `imports` to
// instantiate(), the identical technique RegXConformance.js's own case 27
// uses (a host-controlled side channel is the only way to prove a value
// actually crossed the WASM import boundary rather than being dropped).

var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');
var FE_C = require('./frontend_c.js');
var FE_JAVA = require('./frontend_java.js');
var FE_PHP = require('./frontend_php.js');
var FE_PYTHON = require('./frontend_python.js');
var FE_TS = require('./frontend_typescript.js');

var failures = 0;
function check(label, actual, expected) {
  var normalized = typeof actual === 'bigint' ? Number(actual) : actual;
  var ok = normalized === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

// Compiles+runs `source` with `frontend`, capturing every value that
// crosses the env.log import (in call order) via a real host function
// override -- not global console.log monkey-patching, matching
// RegXConformance.js case 27's own `env: { log: fn }` pattern exactly.
function runCapturingLog(label, frontend, source, calls) {
  var captured = [];
  var instance = frontend.compile(source);
  instance.generateWasm();
  return instance.instantiate({ env: { log: function(v) { captured.push(v); } } })
    .then(function(inst) {
      return calls(inst, captured, label);
    })
    .catch(function(err) {
      console.log('THREW (unexpected)  ' + label + '  ' + err.message);
      failures++;
    });
}

Promise.resolve()
  // ── C: printf(EXPR) -- single-value, no format string ──────────────────
  .then(function() {
    var src = 'double calc(double x, double y) {\n' +
      '  printf(x);\n' +
      '  return x * y;\n' +
      '}\n';
    return runCapturingLog('C: printf(x) reaches env.log', FE_C, src, function(inst, captured) {
      var ret = inst.exports.calc(0, 3n, 4n);
      check('printf captured value', Number(captured[0]), 3);
      check('captured count', captured.length, 1);
      check('calc(3,4) return', ret, 12);
    });
  })
  // ── C: printf("format", EXPR) -- format string dropped, value kept ─────
  .then(function() {
    var src = 'double calc(double x, double y) {\n' +
      '  printf("%f\\n", x + y);\n' +
      '  return x * y;\n' +
      '}\n';
    return runCapturingLog('C: printf("%f\\n", x+y) drops format, keeps value', FE_C, src, function(inst, captured) {
      inst.exports.calc(0, 3n, 4n);
      check('printf captured value', Number(captured[0]), 7);
    });
  })
  // ── Java: System.out.println(EXPR); ─────────────────────────────────────
  .then(function() {
    var src = 'static double calc(double x, double y) {\n' +
      '  System.out.println(x * y);\n' +
      '  return x + y;\n' +
      '}\n';
    return runCapturingLog('Java: System.out.println(x*y) reaches env.log', FE_JAVA, src, function(inst, captured) {
      var ret = inst.exports.calc(0, 3n, 4n);
      check('println captured value', Number(captured[0]), 12);
      check('calc(3,4) return', ret, 7);
    });
  })
  // ── PHP: echo EXPR; (language construct, no parens) ─────────────────────
  .then(function() {
    var src = 'function calc($x, $y) {\n' +
      '  echo $x;\n' +
      '  return $x * $y;\n' +
      '}\n';
    return runCapturingLog('PHP: echo $x reaches env.log', FE_PHP, src, function(inst, captured) {
      var ret = inst.exports.calc(0, 5n, 6n);
      check('echo captured value', Number(captured[0]), 5);
      check('calc(5,6) return', ret, 30);
    });
  })
  // ── PHP: echo with M_PI + $ sigil translation still applies ─────────────
  .then(function() {
    var src = 'function calc($x, $y) {\n' +
      '  echo $x + $y;\n' +
      '  return $x - $y;\n' +
      '}\n';
    return runCapturingLog('PHP: echo $x + $y reaches env.log', FE_PHP, src, function(inst, captured) {
      inst.exports.calc(0, 5n, 6n);
      check('echo captured value', Number(captured[0]), 11);
    });
  })
  // ── Python: print(EXPR) ──────────────────────────────────────────────────
  .then(function() {
    var src = 'def calc(x, y):\n    print(x * y)\n    return x + y\n';
    return runCapturingLog('Python: print(x*y) reaches env.log', FE_PYTHON, src, function(inst, captured) {
      var ret = inst.exports.calc(0, 4n, 5n);
      check('print captured value', Number(captured[0]), 20);
      check('calc(4,5) return', ret, 9);
    });
  })
  // ── TypeScript: console.log(EXPR); as a real statement, not just return ─
  .then(function() {
    var src = 'function calc(x: number, y: number): number {\n' +
      '  console.log(x + y);\n' +
      '  return x * y;\n' +
      '}\n';
    return runCapturingLog('TypeScript: console.log(x+y) reaches env.log', FE_TS, src, function(inst, captured) {
      var ret = inst.exports.calc(0, 4n, 5n);
      check('console.log captured value', Number(captured[0]), 9);
      check('calc(4,5) return', ret, 20);
    });
  })
  // ── Multiple print statements: recorded in source order ────────────────
  .then(function() {
    var src = 'def calc(x, y):\n    print(x)\n    print(y)\n    return x + y\n';
    return runCapturingLog('Python: two print(...) statements, source order preserved', FE_PYTHON, src, function(inst, captured) {
      inst.exports.calc(0, 4n, 6n);
      check('captured count', captured.length, 2);
      check('first print', Number(captured[0]), 4);
      check('second print', Number(captured[1]), 6);
    });
  })
  // ── Scope errors: multi-value/format printf is genuinely out of scope ──
  .then(function() {
    try {
      FE_C.compile('double calc(double x) {\n  printf("%d %d", x, x);\n  return x;\n}\n');
      console.log('FAIL  C: multi-value printf rejected  expected a thrown error, got none');
      failures++;
    } catch (err) {
      var ok = err.message.indexOf('out of scope') !== -1;
      if (!ok) failures++;
      console.log((ok ? 'PASS' : 'FAIL') + '  C: multi-value printf rejected  threw: "' + err.message + '"');
    }
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
