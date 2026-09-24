// Verifies wasm_score.js's mesh_score.wasm module against the REAL noisy
// '3'/'5' test vectors from test_cleanup.js (not synthetic data), then
// benchmarks it -- compiled ONCE at require-time, called many times --
// against a plain-JS scalar loop doing the identical 72-term sum, and notes
// the RegX compileAndRun() cost already measured in bench_ocr.js
// (~18133 us/call) for reference. Same PASS/FAIL convention as every other
// test*.js here.
var FrontendOCR = require('./frontend_ocr.js');
var Cleanup = require('./cleanup.js');
var WasmScore = require('./wasm_score.js');
var CANON = FrontendOCR.CANONICAL;

function flipBits(bits, positions) {
  var arr = bits.split('');
  positions.forEach(function(p) { arr[p] = arr[p] === '1' ? '0' : '1'; });
  return arr.join('');
}

var failures = 0;
function check(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

console.log('--- correctness: wasm_score.score() vs real cleanup.js matchConfidence, same test vectors as test_cleanup.js ---');
var clean3 = CANON['3'];
var cases = {
  noisy1: flipBits(clean3, [10]),
  noisy3: flipBits(clean3, [10, 20, 30]),
  noisy5: flipBits(clean3, [10, 20, 30, 40, 50]),
  real5: CANON['5']
};

Object.keys(cases).forEach(function(name) {
  var bits = cases[name];
  var best = null, bestScore = -Infinity;
  Object.keys(CANON).forEach(function(g) {
    var score = WasmScore.score(bits, CANON[g]);
    if (score > bestScore) { bestScore = score; best = g; }
  });
  var jsRef = Cleanup.matchConfidence(bits, CANON);
  check(name + ' glyph matches cleanup.js matchConfidence()', best, jsRef.glyph);
  check(name + ' score matches cleanup.js matchConfidence()', bestScore, jsRef.score);
});

// every canonical glyph must self-match at exactly 72 -- same invariant
// frontend_ocr.js's exact-match rules rely on
Object.keys(CANON).forEach(function(g) {
  check('self-match "' + g + '" scores exactly 72', WasmScore.score(CANON[g], CANON[g]), 72);
});

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));

// ---- benchmark: compiled-once WASM popcount vs a plain-JS scalar loop ----
// (informational, not a pass/fail check -- prints real numbers, same as
// bench_ocr.js does for the RegX paths)
if (failures === 0) {
  var glyphs = Object.keys(CANON);
  var testBits = cases.noisy3;
  var ROUNDS = 500000; // x9 canonicals = 4.5M scorings per method

  function jsScalarMatchConfidence(bits, CANONICAL) {
    var best = null, bestScore = -Infinity;
    for (var gi = 0; gi < glyphs.length; gi++) {
      var g = glyphs[gi];
      var pattern = CANONICAL[g];
      var score = 0;
      for (var i = 0; i < bits.length; i++) {
        var b = bits.charCodeAt(i) === 49 ? 1 : 0;
        var p = pattern.charCodeAt(i) === 49 ? 1 : 0;
        score += (2 * b - 1) * (2 * p - 1);
      }
      if (score > bestScore) { bestScore = score; best = g; }
    }
    return bestScore;
  }

  // pack-once pattern: the same shape cleanup.js's real matchConfidence()
  // now uses -- bits packed once per call, canonicals packed once total
  // (cached), scorePacked() does zero packing work per glyph
  var packedCanonByGlyph = {};
  glyphs.forEach(function(g) { packedCanonByGlyph[g] = WasmScore.packBits(CANON[g]); });

  function wasmMatchConfidence(bits) {
    var packedBits = WasmScore.packBits(bits);
    var bestScore = -Infinity;
    for (var gi = 0; gi < glyphs.length; gi++) {
      var c = packedCanonByGlyph[glyphs[gi]];
      var score = WasmScore.scorePacked(packedBits[0], packedBits[1], c[0], c[1]);
      if (score > bestScore) bestScore = score;
    }
    return bestScore;
  }

  var checksum = 0;
  for (var r = 0; r < 10000; r++) checksum += jsScalarMatchConfidence(testBits, CANON);
  checksum = 0;
  for (var r = 0; r < 10000; r++) checksum += wasmMatchConfidence(testBits);

  var t0 = process.hrtime.bigint();
  checksum = 0;
  for (var r = 0; r < ROUNDS; r++) checksum += jsScalarMatchConfidence(testBits, CANON);
  var t1 = process.hrtime.bigint();
  var jsMs = Number(t1 - t0) / 1e6;
  console.log('\nplain JS matchConfidence (72-term sum x 9 glyphs):   ' +
    jsMs.toFixed(2) + ' ms total, ' + (jsMs * 1e6 / ROUNDS).toFixed(2) + ' ns/call   checksum=' + checksum);

  t0 = process.hrtime.bigint();
  checksum = 0;
  for (var r = 0; r < ROUNDS; r++) checksum += wasmMatchConfidence(testBits);
  t1 = process.hrtime.bigint();
  var wasmMs = Number(t1 - t0) / 1e6;
  console.log('WASM popcount matchConfidence (x 9 glyphs):          ' +
    wasmMs.toFixed(2) + ' ms total, ' + (wasmMs * 1e6 / ROUNDS).toFixed(2) + ' ns/call   checksum=' + checksum);
  console.log('speedup vs plain JS: ' + (jsMs / wasmMs).toFixed(2) + 'x');
}

process.exit(failures === 0 ? 0 : 1);
