// ─── semantics.js — associates recognize()'s output tokens with grounded
// meaning, via UTF-32 code points ────────────────────────────────────────
//
// recognize() (frontend_ocr.js) returns an opaque string label ('3', 'A',
// ...) -- a RulesEngine match result, nothing more. This module is the
// separate association layer: glyph token -> real Unicode code point ->
// UTF-32 bytes (via chain's own Data.js, not hand-rolled) -> Numeric_Value,
// where one exists.
//
// DIGIT_BLOCKS is the pattern this is actually built on: most scripts with
// native decimal digits lay them out as ONE contiguous run of 10 code
// points, digit N at (zero + N) -- true for Western, Arabic-Indic,
// Extended Arabic-Indic (Persian/Urdu), Devanagari, Bengali, Thai,
// Fullwidth, all verified directly against real code points, not
// asserted. Three consequences fall out of representing it this way
// instead of a flat, hand-listed table:
//   1. All ten digits per script are DERIVED (zero + n), not transcribed
//      one at a time -- the earlier version of this file hand-typed
//      Devanagari '3' as U+096B, which is actually Devanagari '5' (५).
//      The real Devanagari '3' is U+0969 (base U+0966 + 3). Deriving it
//      catches that class of error instead of committing it.
//   2. German, English, and Bulgarian aren't three separate entries --
//      they're three languages sharing ONE block ('western', zero
//      U+0030), a fixed shared location, not a per-language lookup.
//   3. Anything that does NOT fit this linear-offset pattern (no known
//      case in this table yet, but e.g. a script using ideographs instead
//      of positional digits) gets an explicit, individually hardcoded
//      entry instead of being forced into a formula that doesn't apply to
//      it -- the formula is an earned generalization, not a universal law.
var path = require('path');
var CHAIN_DIR = path.join(__dirname, '..', '..', 'lib', 'chain');
var Data = require(path.join(CHAIN_DIR, 'Data.js'));

var DIGIT_BLOCKS = {
  western: { zero: 0x0030, languages: ['German', 'English', 'Bulgarian'] },
  arabicIndic: { zero: 0x0660, languages: ['Arabic'] },
  extendedArabicIndic: { zero: 0x06F0, languages: ['Persian', 'Urdu'] },
  devanagari: { zero: 0x0966, languages: ['Hindi', 'Marathi'] },
  bengali: { zero: 0x09E6, languages: ['Bengali'] },
  thai: { zero: 0x0E50, languages: ['Thai'] },
  fullwidth: { zero: 0xFF10, languages: ['CJK typography'] }
};

// The hardcoded family: numeral systems that genuinely do NOT fit the
// base+N linear-offset pattern, verified individually rather than forced
// into DIGIT_BLOCKS's formula. Two real architectures, not one:
//   - Han ideographic (Kanji, Mandarin, and Korean's Sino-Korean numerals
//     -- the SAME characters, reused across three languages/scripts, not
//     three separate entries, same "shared fixed location" principle as
//     DIGIT_BLOCKS.western): a genuine base-10 system, but each digit is
//     its own unrelated code point (三 '3' and 十 '10' do not
//     differ by a constant offset), composed multiplicatively/additively
//     for larger numbers (三百 = 3x100 = 300).
//   - Hebrew gematria: the script's OWN LETTERS reused as numerals
//     (א aleph=1, ב bet=2, ...), not a separate digit block at
//     all. No letter for zero -- gematria has no zero concept, so 0 is
//     deliberately absent here rather than filled with a guess.
var HARDCODED_NUMERALS = {
  han: {
    languages: ['Kanji (Japanese)', 'Mandarin (Chinese)', 'Korean (Sino-Korean)'],
    codePoints: { 0: 0x96F6, 1: 0x4E00, 2: 0x4E8C, 3: 0x4E09, 4: 0x56DB, 5: 0x4E94, 6: 0x516D, 7: 0x4E03, 8: 0x516B, 9: 0x4E5D }
  },
  hebrewGematria: {
    languages: ['Hebrew (traditional/religious/calendrical use)'],
    codePoints: { 1: 0x05D0, 2: 0x05D1, 3: 0x05D2, 4: 0x05D3, 5: 0x05D4, 6: 0x05D5, 7: 0x05D6, 8: 0x05D7, 9: 0x05D8 }
    // no 0: gematria has no zero concept, not an oversight
  }
};

// CODEPOINT_TO_NUMERIC_VALUE, derived from DIGIT_BLOCKS and
// HARDCODED_NUMERALS -- not hand-listed as one flat table.
var CODEPOINT_TO_NUMERIC_VALUE = {};
Object.keys(DIGIT_BLOCKS).forEach(function(blockName) {
  var zero = DIGIT_BLOCKS[blockName].zero;
  for (var n = 0; n <= 9; n++) CODEPOINT_TO_NUMERIC_VALUE[zero + n] = n;
});
Object.keys(HARDCODED_NUMERALS).forEach(function(familyName) {
  var codePoints = HARDCODED_NUMERALS[familyName].codePoints;
  Object.keys(codePoints).forEach(function(n) { CODEPOINT_TO_NUMERIC_VALUE[codePoints[n]] = Number(n); });
});

// Non-digit glyphs (letters) this OCR pipeline also recognizes: real code
// points, deliberately no Numeric_Value entry -- a hardcoded exception to
// the digit-block pattern because it isn't a digit at all, not because the
// pattern failed.
var LETTER_CODEPOINTS = { 'A': 0x0041 };

// glyph token (recognize()'s output, Western-script glyph shapes only --
// that's the only font this pipeline has) -> its real Unicode code point,
// derived from the 'western' block for '0'-'9', hardcoded for letters.
var GLYPH_TO_CODEPOINT = {};
for (var n = 0; n <= 9; n++) GLYPH_TO_CODEPOINT[String(n)] = DIGIT_BLOCKS.western.zero + n;
Object.keys(LETTER_CODEPOINTS).forEach(function(g) { GLYPH_TO_CODEPOINT[g] = LETTER_CODEPOINTS[g]; });

// The actual association: recognize()'s glyph token -> code point -> real
// UTF-32 bytes (via chain's Data.js UNICODE source, not hand-rolled) plus
// the grounded Numeric_Value where one exists.
function associate(glyphToken) {
  if (glyphToken === null || glyphToken === undefined) {
    return { glyph: null, codePoint: null, utf32Hex: null, numericValue: null };
  }
  var codePoint = GLYPH_TO_CODEPOINT[glyphToken];
  if (codePoint === undefined) {
    throw new Error('semantics.associate: no known code point for glyph token "' + glyphToken + '"');
  }
  var ch = String.fromCodePoint(codePoint);
  var d = new Data().init({ text: ch, encoding: 'utf-32' }, { type: Data.SOURCE_TYPES.UNICODE });
  var utf32Bytes = [];
  for (var i = 0; i < d.rows.length; i += 8) {
    var byte = 0;
    for (var b = 0; b < 8; b++) byte = (byte << 1) | d.rows[i + b];
    utf32Bytes.push(byte);
  }
  var numericValue = CODEPOINT_TO_NUMERIC_VALUE.hasOwnProperty(codePoint) ? CODEPOINT_TO_NUMERIC_VALUE[codePoint] : null;
  return {
    glyph: glyphToken,
    codePoint: codePoint,
    codePointHex: 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0'),
    utf32Bytes: utf32Bytes,
    utf32Hex: utf32Bytes.map(function(b) { return '0x' + b.toString(16).padStart(2, '0'); }).join(' '),
    numericValue: numericValue
  };
}

// Cross-script lookup: given a digit 0-9, the code point for it in EVERY
// known digit block -- the direct payoff of the base+N pattern. This
// wasn't reachable at all from the old flat table without re-deriving it
// by hand each time.
function digitInAllScripts(n) {
  if (n < 0 || n > 9 || !Number.isInteger(n)) throw new Error('digitInAllScripts: n must be an integer 0-9');
  var out = {};
  Object.keys(DIGIT_BLOCKS).forEach(function(blockName) {
    var cp = DIGIT_BLOCKS[blockName].zero + n;
    out[blockName] = { codePoint: cp, codePointHex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), char: String.fromCodePoint(cp), languages: DIGIT_BLOCKS[blockName].languages };
  });
  return out;
}

// Same lookup as digitInAllScripts, but for the hardcoded family -- since
// there's no formula, this just reads the explicit table, but it's the
// SAME shaped answer (digit -> {codePoint, char, languages} per family),
// so a caller doesn't need to know which representation mechanism backs
// a given script to ask "what does digit N look like here."
function digitInHardcodedFamilies(n) {
  if (n < 0 || n > 9 || !Number.isInteger(n)) throw new Error('digitInHardcodedFamilies: n must be an integer 0-9');
  var out = {};
  Object.keys(HARDCODED_NUMERALS).forEach(function(familyName) {
    var cp = HARDCODED_NUMERALS[familyName].codePoints[n];
    if (cp === undefined) { out[familyName] = null; return; } // e.g. gematria has no zero
    out[familyName] = { codePoint: cp, codePointHex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), char: String.fromCodePoint(cp), languages: HARDCODED_NUMERALS[familyName].languages };
  });
  return out;
}

module.exports = {
  DIGIT_BLOCKS: DIGIT_BLOCKS,
  HARDCODED_NUMERALS: HARDCODED_NUMERALS,
  GLYPH_TO_CODEPOINT: GLYPH_TO_CODEPOINT,
  CODEPOINT_TO_NUMERIC_VALUE: CODEPOINT_TO_NUMERIC_VALUE,
  associate: associate,
  digitInAllScripts: digitInAllScripts,
  digitInHardcodedFamilies: digitInHardcodedFamilies
};
