var ExtendX = require('./ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('./RegX.js');
var FE_C = require('./frontend_c.js');
var FE_JAVA = require('./frontend_java.js');
var FE_PHP = require('./frontend_php.js');
var FE_PYTHON = require('./frontend_python.js');
var FE_TS = require('./frontend_typescript.js');

var FE_BY_LANG = { c: FE_C, java: FE_JAVA, php: FE_PHP, python: FE_PYTHON, typescript: FE_TS };

var failures = 0;
function check(label, actual, expected) {
  var normalized = typeof actual === 'bigint' ? Number(actual) : actual;
  var ok = Math.abs(normalized - expected) < 1e-9;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

function run(label, lang, source, calls) {
  return FE_BY_LANG[lang].compileAndRun(source, {})
    .then(function(instance) {
      return calls(instance, label);
    })
    .catch(function(err) {
      console.log('THREW (unexpected)  ' + label + '  ' + err.message);
      failures++;
    });
}

// Synchronous front-end parse errors (malformed SOURCE, never a rejection
// of well-formed input) -- these throw before any WASM even exists, same
// standard RegX's own JS parser/backend already holds itself to.
function expectParseError(label, lang, source, expectedSubstring) {
  try {
    FE_BY_LANG[lang].compile(source);
    console.log('FAIL  ' + label + '  expected a thrown parse error, got none');
    failures++;
  } catch (err) {
    var ok = err.message.indexOf(expectedSubstring) !== -1;
    if (!ok) failures++;
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  threw: "' + err.message + '"');
  }
}

// Errors that only surface once the translated expression text reaches
// RegX's OWN, unmodified backend (e.g. an unknown identifier) -- proves
// the existing compileArithmeticToWasm error handling is reached unchanged
// through this front-end, not re-implemented.
function expectBackendError(label, lang, source, expectedSubstring) {
  try {
    FE_BY_LANG[lang].compileAndRun(source, {});
    console.log('FAIL  ' + label + '  expected a thrown compile error, got none');
    failures++;
  } catch (err) {
    var ok = err.message.indexOf(expectedSubstring) !== -1;
    if (!ok) failures++;
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  threw: "' + err.message + '"');
  }
}

// x=3, y=2 for every language below:
//   x*y = 6, x^2(=x*x or pow(x,2)) = 9, pi/y = 1.5707963267948966
//   6 + 9 - 1.5707963267948966 = 13.429203673205103
var EXPECTED_CALC = 6 + 9 - (Math.PI / 2);

// ── C: real syntax, #include, M_PI, pow(x,2) ───────────────────────────
var cSrc = '\n#include <math.h>\n' +
  'double calc(double x, double y) {\n' +
  '  return x * y + pow(x, 2) - M_PI / y;\n' +
  '}\n';

var cSquareOnlySrc = 'double square(double x) {\n  return x * x;\n}\n';

// unbalanced syntax: missing closing brace
var cUnbalancedSrc = 'double calc(double x, double y) {\n  return x * y;\n';

// wrong arity: pow() called with only 1 argument -- real C (via <math.h>)
// would reject this too (pow has a fixed 2-parameter prototype).
var cWrongAritySrc = 'double calc(double x) {\n  return pow(x);\n}\n';

// ── Java: real syntax, static double, Math.pow, Math.PI ────────────────
var javaSrc = 'static double calc(double x, double y) {\n' +
  '  return x * y + Math.pow(x, 2) - Math.PI / y;\n' +
  '}\n';

var javaUnknownIdentSrc = 'static double calc(double x) {\n  return q + x;\n}\n';

// ── PHP: real syntax, $ sigils, real **, M_PI ───────────────────────────
var phpSrc = '<?php\nfunction calc($x, $y) {\n' +
  '  return $x * $y + ($x ** 2) - M_PI / $y;\n' +
  '}\n';

var phpMulOnlySrc = 'function calc($x, $y) {\n  return $x * $y + ($x * $x) - M_PI / $y;\n}\n';

// unbalanced syntax: mismatched parens in the header
var phpUnbalancedSrc = 'function calc($x, $y {\n  return $x + $y;\n}\n';

// ── Python: real syntax, math.pi, real ** ───────────────────────────────
var pySrcOneLiner = 'def calc(x, y): return x * y + (x ** 2) - math.pi / y';

var pySrcBlock = 'def calc(x, y):\n    return x * y + (x ** 2) - math.pi / y\n';

var pyNoReturnSrc = 'def calc(x, y):\n    pass\n';

// ── TypeScript: real syntax, type annotations, real **, Math.PI ────────
var tsSrc = 'function calc(x: number, y: number): number {\n' +
  '  return x * y + (x ** 2) - Math.PI / y;\n' +
  '}\n';

// Wrong arity, TS-style: this parser deliberately only translates real
// TS/JS `**` (see frontend_typescript.js's own comment) -- Math.pow(...)
// isn't rewritten, so a malformed call here surfaces through RegX's own,
// UNMODIFIED call-rejection check in compileExpressionToWasm, proving the
// existing backend's error handling is reached unchanged, not re-
// implemented at the front-end.
var tsWrongAritySrc = 'function calc(x: number, y: number): number {\n' +
  '  return Math.pow(x) - Math.PI / y;\n' +
  '}\n';

Promise.resolve()
  // ── C ──
  .then(function() {
    return run('C: real syntax + M_PI + pow(x,2)', 'c', cSrc, function(inst) {
      check('calc(3,2)', inst.exports.calc(0, 3n, 2n), EXPECTED_CALC);
    });
  })
  .then(function() {
    return run('C: x*x squaring idiom', 'c', cSquareOnlySrc, function(inst) {
      check('square(4) = 16', inst.exports.square(0, 4n), 16);
    });
  })
  .then(function() {
    expectParseError('C: unbalanced braces rejected', 'c', cUnbalancedSrc, 'unbalanced');
  })
  .then(function() {
    expectParseError('C: pow() wrong arity rejected', 'c', cWrongAritySrc, '2 arguments');
  })
  // ── Java ──
  .then(function() {
    return run('Java: real syntax + Math.PI + Math.pow(x,2)', 'java', javaSrc, function(inst) {
      check('calc(3,2)', inst.exports.calc(0, 3n, 2n), EXPECTED_CALC);
    });
  })
  .then(function() {
    expectBackendError('Java: unknown identifier rejected by unmodified backend', 'java', javaUnknownIdentSrc, 'unknown identifier');
  })
  // ── PHP ──
  .then(function() {
    return run('PHP: real syntax + $ sigils + real ** + M_PI', 'php', phpSrc, function(inst) {
      check('calc(3,2)', inst.exports.calc(0, 3n, 2n), EXPECTED_CALC);
    });
  })
  .then(function() {
    return run('PHP: $x * $x squaring idiom', 'php', phpMulOnlySrc, function(inst) {
      check('calc(3,2)', inst.exports.calc(0, 3n, 2n), EXPECTED_CALC);
    });
  })
  .then(function() {
    expectParseError('PHP: unbalanced parens in header rejected', 'php', phpUnbalancedSrc, 'no recognizable');
  })
  // ── Python ──
  .then(function() {
    return run('Python: single-line def + real ** + math.pi', 'python', pySrcOneLiner, function(inst) {
      check('calc(3,2)', inst.exports.calc(0, 3n, 2n), EXPECTED_CALC);
    });
  })
  .then(function() {
    return run('Python: indented block def', 'python', pySrcBlock, function(inst) {
      check('calc(3,2)', inst.exports.calc(0, 3n, 2n), EXPECTED_CALC);
    });
  })
  .then(function() {
    expectParseError('Python: missing return statement rejected', 'python', pyNoReturnSrc, 'return');
  })
  // ── TypeScript ──
  .then(function() {
    return run('TypeScript: type annotations + real ** + Math.PI', 'typescript', tsSrc, function(inst) {
      check('calc(3,2)', inst.exports.calc(0, 3n, 2n), EXPECTED_CALC);
    });
  })
  .then(function() {
    expectBackendError('TypeScript: unrewritten Math.pow() rejected by unmodified backend', 'typescript', tsWrongAritySrc, 'function/method calls are not supported');
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  });
