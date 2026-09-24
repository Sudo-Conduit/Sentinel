// ─── cleanup.js — Phase 4: fuzzy-confidence cleanup loop into recognize() ──
//
// recognize() (frontend_ocr.js) only ever does exact match: a single
// flipped bit against a known template is enough to make it return -1,
// same as genuinely unrecognizable input. This module is the POLICY layer
// sitting in front of it: score the input against every known template
// (same (2*bit-1)*(2*canon-1) agreement sum recognize() itself is built
// from), and if the best match is confident enough, SNAP the input to that
// template's exact bits before recognize() ever sees it. The engine still
// only ever runs its own rule -- this is a separate, external decision
// using the engine's own scoring math, not a new thing the engine does.
//
// Threshold is not a guess. Measured directly against this session's own
// 9 canonical glyphs (see diagnostic run): self-match is always 72 (max),
// and the worst real cross-glyph confusion (a genuinely DIFFERENT glyph
// scoring high against the wrong template) is 58, between '3' and '5'.
// THRESHOLD = 64 sits 6 points (3 bit-flips) above that worst confusion
// ceiling, while still tolerating up to 4 bit-flips of real noise
// (72 - 64 = 8 score points = 4 flipped bits, since each flip costs 2).
var THRESHOLD = 64;

// Scoring itself is delegated to wasm_score.js: the same
// sum((2*bit-1)*(2*canon-1)) agreement score, computed via the real
// XOR+POPCNT identity (score = 72 - 2*hamming) in a WASM module compiled
// once at require-time, rather than a 72-term JS scalar loop re-run on
// every call.
//
// First wiring attempt used WasmScore.score(bitsString, canonString)
// directly inside this function's per-glyph loop -- measured SLOWER than
// the plain-JS loop it replaced (0.38x), not faster. Real cause, found by
// re-running the benchmark against this actual integration instead of
// trusting the standalone one: score() packs BOTH 72-char strings into
// BigInts on every call (a real JS loop + BigInt shifts each time), so the
// same `bits` string was getting re-packed 9x per matchConfidence() call,
// and every CANONICAL pattern was getting re-packed on every single call,
// forever, even though CANONICAL never changes. Fixed by packing `bits`
// ONCE per call and caching each CANONICAL table's packed patterns
// (WeakMap keyed on the CANONICAL object, since it's a stable module-level
// constant from frontend_ocr.js) -- scorePacked() then does zero packing
// work per glyph comparison. See test_wasm_score.js for the re-verified
// correctness + re-measured (real, this time) speedup.
var WasmScore = require('./wasm_score.js');
var canonPackedCache = new WeakMap();

function getPackedCanon(CANONICAL) {
  var cached = canonPackedCache.get(CANONICAL);
  if (!cached) {
    cached = {};
    Object.keys(CANONICAL).forEach(function(g) { cached[g] = WasmScore.packBits(CANONICAL[g]); });
    canonPackedCache.set(CANONICAL, cached);
  }
  return cached;
}

function matchConfidence(bits, CANONICAL) {
  var packedBits = WasmScore.packBits(bits);
  var packedCanon = getPackedCanon(CANONICAL);
  var best = null, bestScore = -Infinity;
  Object.keys(CANONICAL).forEach(function(g) {
    var c = packedCanon[g];
    var score = WasmScore.scorePacked(packedBits[0], packedBits[1], c[0], c[1]);
    if (score > bestScore) { bestScore = score; best = g; }
  });
  return { glyph: best, score: bestScore };
}

function cleanup(bits, CANONICAL, threshold) {
  threshold = threshold === undefined ? THRESHOLD : threshold;
  var match = matchConfidence(bits, CANONICAL);
  if (match.score >= threshold) {
    return { cleanedBits: CANONICAL[match.glyph], wasCleaned: bits !== CANONICAL[match.glyph], glyph: match.glyph, score: match.score };
  }
  return { cleanedBits: bits, wasCleaned: false, glyph: null, score: match.score };
}

module.exports = { THRESHOLD: THRESHOLD, matchConfidence: matchConfidence, cleanup: cleanup };
