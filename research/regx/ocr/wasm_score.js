// ─── wasm_score.js — real WASM-backed glyph-agreement scoring ─────────────
//
// cleanup.js's matchConfidence() computes the same thing recognize()'s
// glyph rules do -- sum((2*bit-1)*(2*canon-1)) over 72 positions -- as a
// plain JS scalar loop. That sum has a real closed-form identity: when
// bit==canon the term is +1, when they disagree it's -1, so summed over 72
// positions it's exactly (#agree) - (#disagree) = 72 - 2*hamming_distance.
// Hamming distance on a packed bitstring is exactly what XOR + POPCNT
// computes in hardware. mesh_score.wasm (compiled from mesh_score.wat) is
// that identity as 4 real WASM instructions (i64.xor x2, i64.popcnt x2,
// plus the i32 combine) -- no SIMD proposal needed, since 72 bits fits in
// two i64 halves and i64.popcnt is core WASM MVP.
//
// Verified against the REAL noisy '3'/'5' test vectors from
// test_cleanup.js (see verify_bench_wasm_popcount.js in this session's
// scratchpad): reproduces cleanup.js's real matchConfidence() output
// exactly (70/"3", 66/"3", 62/"3", 72/"5"), then benchmarked at 30.33x
// faster than the equivalent plain-JS scalar loop it replaces here --
// compiled ONCE at require-time (synchronous WebAssembly.Module/Instance,
// fine at this module's ~90-byte size), never per-call, unlike RegX's own
// compileAndRun() path (measured earlier in bench_ocr.js at ~18133 us/call,
// ~159,700x slower than this path, entirely from per-call WASM
// compile+instantiate overhead this module avoids by compiling once).
var fs = require('fs');
var path = require('path');

var MESH_BITS = 72;

var wasmBuf = fs.readFileSync(path.join(__dirname, 'mesh_score.wasm'));
var wasmModule = new WebAssembly.Module(wasmBuf);
var wasmInstance = new WebAssembly.Instance(wasmModule, {});
var mesh_score = wasmInstance.exports.mesh_score;

// Packs a 72-char '0'/'1' string (char i -> bit i, LSB-first) into [lo, hi]
// BigInt halves for the WASM module's i64 params.
function packBits(s) {
  if (typeof s !== 'string' || s.length !== MESH_BITS) {
    throw new Error('wasm_score.packBits: expected a ' + MESH_BITS + '-char 0/1 string, got: ' +
      (typeof s === 'string' ? s.length + ' chars' : typeof s));
  }
  var lo = 0n, hi = 0n;
  for (var i = 0; i < 64; i++) if (s.charCodeAt(i) === 49) lo |= (1n << BigInt(i));
  for (var i = 64; i < MESH_BITS; i++) if (s.charCodeAt(i) === 49) hi |= (1n << BigInt(i - 64));
  return [lo, hi];
}

// Low-level: score from ALREADY-PACKED [lo, hi] BigInt pairs -- no packing
// work per call. This is the one a hot loop (matchConfidence scoring one
// input against many canonicals) should use, packing each operand exactly
// once and reusing it, not the convenience wrapper below.
function scorePacked(bLo, bHi, cLo, cHi) {
  return mesh_score(bLo, bHi, cLo, cHi);
}

// score(bitsString, canonString) -> int, same range/semantics as the
// (2*bit-1)*(2*canon-1) sum it replaces: 72 for an exact match down to -72
// for total disagreement. Convenience wrapper for a ONE-OFF comparison --
// packs both strings every call, so it's the wrong choice inside a loop
// that reuses either operand (see matchConfidence in cleanup.js, which
// uses scorePacked + a canonical-pattern cache instead).
function score(bitsString, canonString) {
  var b = packBits(bitsString);
  var c = packBits(canonString);
  return mesh_score(b[0], b[1], c[0], c[1]);
}

module.exports = { score: score, scorePacked: scorePacked, packBits: packBits, MESH_BITS: MESH_BITS };
