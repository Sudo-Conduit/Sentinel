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

function matchConfidence(bits, CANONICAL) {
  var best = null, bestScore = -Infinity;
  Object.keys(CANONICAL).forEach(function(g) {
    var pattern = CANONICAL[g];
    var score = 0;
    for (var i = 0; i < bits.length; i++) {
      var b = bits[i] === '1' ? 1 : 0;
      var p = pattern[i] === '1' ? 1 : 0;
      score += (2 * b - 1) * (2 * p - 1);
    }
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
