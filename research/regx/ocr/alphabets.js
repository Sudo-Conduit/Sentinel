// ─── alphabets.js — the same play as semantics.js's DIGIT_BLOCKS /
// HARDCODED_NUMERALS, run for LETTERS instead of digits ─────────────────
//
// Scope, deliberately narrow: this is the MAPPING SURFACE only -- position
// <-> code point for a script's letters, shared across every language that
// writes with that script. It does NOT attempt equivalence (whether
// Bulgarian's use of a given Cyrillic letter "means the same thing" as
// Russian's, whether Ukrainian/Serbian/Macedonian actually use every
// position in the shared block, sound/phoneme correspondence, etc). Same
// discipline as the image->grid mesh work: establish the structural
// surface first, before any scoring or semantic layer gets built on it.
//
// ALPHABET_BLOCKS mirrors DIGIT_BLOCKS's shape exactly: {upperBase,
// lowerBase, count, languages}, position N -> upperBase+N / lowerBase+N,
// verified contiguous before being encoded here, not assumed:
//   - Cyrillic core run: 32 letters, U+0410-042F (upper) / U+0430-044F
//     (lower), confirmed contiguous in both cases, +0x20 case shift (same
//     constant as Latin's A/a). Shared, unmodified, by Russian, Bulgarian,
//     Ukrainian, Serbian, and Macedonian -- one block, five languages
//     aliased to it, not five separate entries.
//   - Latin core run: 26 letters, U+0041-005A / U+0061-007A, same shape,
//     included for consistency with the rest of this session's work.
//   - Thai consonant run: 46 letters, U+0E01-0E2E, confirmed FULLY
//     contiguous (unlike Arabic's letters, which had a real gap and
//     needed the hardcoded-list treatment instead) -- includes the two
//     vocalic letters ฤ/ฦ alongside the 44 true consonants, and two
//     obsolete consonants (ฃ, ฅ at positions 2 and 4) that modern Thai
//     doesn't use (handled as a null-mask exclusion in LANGUAGE_ALPHABETS,
//     the same move as Italian's J/K/W/X/Y). No case -- upperBase and
//     lowerBase are deliberately the SAME code point, so upperChar equals
//     lowerChar for every position, reusing the cased formula shape
//     instead of adding a separate no-case code path.
var ALPHABET_BLOCKS = {
  latin: { upperBase: 0x0041, lowerBase: 0x0061, count: 26, languages: ['English', 'German'] },
  cyrillic: { upperBase: 0x0410, lowerBase: 0x0430, count: 32, languages: ['Russian', 'Bulgarian', 'Ukrainian', 'Serbian', 'Macedonian'] },
  thai: { upperBase: 0x0E01, lowerBase: 0x0E01, count: 46, languages: ['Thai'] }
};

// HARDCODED_ALPHABET_LETTERS: real letters that fall OUTSIDE their
// script's contiguous run, same reason HARDCODED_NUMERALS exists for
// digits -- verified individually, not derivable from the block formula.
// Ё (Russian "yo") sits at U+0401/U+0451, disconnected from the main
// U+0410-042F/U+0430-044F run -- a documented historical quirk of the
// Cyrillic block's own layout, not an omission here.
var HARDCODED_ALPHABET_LETTERS = {
  cyrillicYo: { upper: 0x0401, lower: 0x0451, languages: ['Russian'] }
};

// HARDCODED_ALPHABETS: whole scripts whose letters do NOT fit the
// base+N block formula at all -- an explicit, individually-verified
// ordered list instead, same reason HARDCODED_NUMERALS exists for Han/
// gematria numerals. Arabic is the concrete case: no case (so no upper/
// lower shift to exploit), and the 28-letter alphabet itself is NOT one
// contiguous run -- alef (U+0627) through ghain (U+063A) is contiguous
// (18 letters), then a real gap of 7 code points to feh (U+0641), then
// contiguous again to yeh (U+064A). Verified directly; a formula would
// have silently produced 7 wrong letters across that gap. Notably, this
// is the OPPOSITE situation from Arabic's own DIGITS (Arabic-Indic,
// already in DIGIT_BLOCKS), which ARE a clean contiguous block -- same
// script, digits fit the formula, letters don't.
// Devanagari (Hindi, Marathi) and Bengali: same discovery as Arabic --
// letters do NOT fit the formula, unlike their own digits (already clean
// blocks in DIGIT_BLOCKS). 11 vowels + 33 (Devanagari) / 32 (Bengali)
// consonants, each verified individually. The striking part: the GAP
// PATTERN is IDENTICAL between the two scripts -- both skip the same
// relative positions in the vowel run (before position 7 and 9) and the
// same relative positions in the consonant run (before 20, 27, 28). That
// is real, independent confirmation of the shared-template theory from
// earlier this session: Unicode's Brahmic blocks were laid out on one
// common positional template (ISCII-derived), gaps and all, not encoded
// separately per script.
var DEVANAGARI_LETTERS = [0x905, 0x906, 0x907, 0x908, 0x909, 0x90A, 0x90B, 0x90F, 0x910, 0x913, 0x914,
  0x915, 0x916, 0x917, 0x918, 0x919, 0x91A, 0x91B, 0x91C, 0x91D, 0x91E, 0x91F, 0x920, 0x921, 0x922,
  0x923, 0x924, 0x925, 0x926, 0x927, 0x928, 0x92A, 0x92B, 0x92C, 0x92D, 0x92E, 0x92F, 0x930, 0x932,
  0x935, 0x936, 0x937, 0x938, 0x939];
var BENGALI_LETTERS = [0x985, 0x986, 0x987, 0x988, 0x989, 0x98A, 0x98B, 0x98F, 0x990, 0x993, 0x994,
  0x995, 0x996, 0x997, 0x998, 0x999, 0x99A, 0x99B, 0x99C, 0x99D, 0x99E, 0x99F, 0x9A0, 0x9A1, 0x9A2,
  0x9A3, 0x9A4, 0x9A5, 0x9A6, 0x9A7, 0x9A8, 0x9AA, 0x9AB, 0x9AC, 0x9AD, 0x9AE, 0x9AF, 0x9B0, 0x9B2,
  0x9B6, 0x9B7, 0x9B8, 0x9B9];

var HARDCODED_ALPHABETS = {
  arabic: {
    languages: ['Arabic'],
    letters: [0x0627, 0x0628, 0x062A, 0x062B, 0x062C, 0x062D, 0x062E, 0x062F, 0x0630,
      0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x0637, 0x0638, 0x0639, 0x063A,
      0x0641, 0x0642, 0x0643, 0x0644, 0x0645, 0x0646, 0x0647, 0x0648, 0x064A]
  },
  devanagari: { languages: ['Hindi', 'Marathi'], letters: DEVANAGARI_LETTERS },
  bengali: { languages: ['Bengali'], letters: BENGALI_LETTERS }
};

// Persian's 4 extra letters past the Arabic 28 -- real sounds Arabic
// doesn't have (p, ch, zh, g). Same "past-the-block additions" shape as
// Spanish's Ñ / Romanian's 5, just anchored to a hardcoded list instead
// of a formula block.
var PERSIAN_EXTRA_LETTERS = [
  { codePoint: 0x067E, name: 'peh (p)' },
  { codePoint: 0x0686, name: 'cheh (ch)' },
  { codePoint: 0x0698, name: 'zheh (zh)' },
  { codePoint: 0x06AF, name: 'gaf (g)' }
];

// LANGUAGE_ALPHABETS: per-language view onto a shared block, using the
// SAME null-bit meaning as the Base-3 mesh gate from earlier this session
// -- not "is this letter present" as a passive fact, but "skip this
// position when calculating" as an operational instruction. A future
// Italian-scoped recognizer never has to attempt J/K/W/X/Y at all, same
// as the mesh gate never touched the 91% null background meshes -- this
// is the selection layer, not a description layer. Plus a separate list
// for letters that fall PAST the block entirely (position >= 26), the
// same "outside the formula's range" shape HARDCODED_ALPHABET_LETTERS
// already uses for Cyrillic's Ё. Two real, verified cases of each:
//   - Italian: null bit OFF at J,K,W,X,Y (traditional 21-letter alphabet;
//     those 5 letters exist in the shared Latin block and are used in
//     loanwords, but aren't part of the native alphabet)
//   - Spanish: all 26 bits ON, plus Ñ (U+00D1/00F1) past the block
//   - Romanian: all 26 bits ON, plus 5 letters past the block (Ă Â Î Ș Ț)
//   - French, Portuguese, English: all 26 bits ON, nothing past the block
//     -- identical to the shared 'latin' block with no modification at all
function nullMaskN(count, offPositions) {
  var mask = new Array(count).fill(1);
  (offPositions || []).forEach(function(p) { mask[p] = 0; });
  return mask;
}
function nullMask26(offPositions) { return nullMaskN(26, offPositions); }
var LANGUAGE_ALPHABETS = {
  english: { blockType: 'formula', block: 'latin', nullMask: nullMask26([]), extraLetters: [] },
  french: { blockType: 'formula', block: 'latin', nullMask: nullMask26([]), extraLetters: [] },
  portuguese: { blockType: 'formula', block: 'latin', nullMask: nullMask26([]), extraLetters: [] },
  italian: { blockType: 'formula', block: 'latin', nullMask: nullMask26([9, 10, 22, 23, 24]), extraLetters: [] }, // J,K,W,X,Y off
  spanish: {
    blockType: 'formula', block: 'latin', nullMask: nullMask26([]),
    extraLetters: [{ upper: 0x00D1, lower: 0x00F1, name: 'Ñ' }]
  },
  romanian: {
    blockType: 'formula', block: 'latin', nullMask: nullMask26([]),
    extraLetters: [
      { upper: 0x0102, lower: 0x0103, name: 'Ă' },
      { upper: 0x00C2, lower: 0x00E2, name: 'Â' },
      { upper: 0x00CE, lower: 0x00EE, name: 'Î' },
      { upper: 0x0218, lower: 0x0219, name: 'Ș' },
      { upper: 0x021A, lower: 0x021B, name: 'Ț' }
    ]
  },
  // Arabic/Persian: a DIFFERENT branch entirely -- blockType 'hardcoded'
  // reads from HARDCODED_ALPHABETS's explicit list, not a formula block,
  // and there's no case so upperChar===lowerChar for every letter (one
  // glyph, not two). Persian's nullMask is all-1s over the SAME 28-letter
  // Arabic list (Persian is a strict superset, nothing skipped) plus its
  // own 4 extras past that list -- same past-the-block shape as Spanish's
  // Ñ, just anchored to a hardcoded list instead of a formula.
  arabic: { blockType: 'hardcoded', block: 'arabic', nullMask: new Array(28).fill(1), extraLetters: [] },
  // Modern Thai: same 46-letter formula block, positions 2 (ฃ) and 4 (ฅ)
  // null-masked off -- obsolete consonants no longer used in standard
  // writing, the same shape as Italian's J/K/W/X/Y exclusion, just on a
  // no-case block instead of a cased one.
  thai: { blockType: 'formula', block: 'thai', nullMask: nullMaskN(46, [2, 4]), extraLetters: [] },
  persian: {
    blockType: 'hardcoded', block: 'arabic', nullMask: new Array(28).fill(1),
    extraLetters: PERSIAN_EXTRA_LETTERS.map(function(e) { return { upper: e.codePoint, lower: e.codePoint, name: e.name }; })
  },
  // Hindi and Marathi: same 44-letter Devanagari hardcoded list, no
  // exclusions asserted here (not looking at equivalence -- whether
  // Marathi's actual usage differs from Hindi's is a real question left
  // for later, same deferral as Ukrainian/Serbian/Macedonian's Cyrillic
  // subset earlier). Bengali: its own 43-letter hardcoded list.
  hindi: { blockType: 'hardcoded', block: 'devanagari', nullMask: new Array(44).fill(1), extraLetters: [] },
  marathi: { blockType: 'hardcoded', block: 'devanagari', nullMask: new Array(44).fill(1), extraLetters: [] },
  bengali: { blockType: 'hardcoded', block: 'bengali', nullMask: new Array(43).fill(1), extraLetters: [] }
};

// Resolves a language's full effective alphabet: block positions where the
// null mask is on, plus any past-the-block extras. This is the actual
// per-language answer the flat ALPHABET_BLOCKS.latin entry alone can't
// give -- 21 letters for Italian, 27 for Spanish, 31 for Romanian, 26 for
// English/French/Portuguese, 28 for Arabic, 32 for Persian -- all derived
// from just TWO underlying sources (one formula block, one hardcoded list).
function resolveLanguageAlphabet(languageName) {
  var lang = LANGUAGE_ALPHABETS[languageName];
  if (!lang) throw new Error('alphabets.resolveLanguageAlphabet: unknown language "' + languageName + '"');
  var letters = [];
  if (lang.blockType === 'hardcoded') {
    var hc = HARDCODED_ALPHABETS[lang.block];
    hc.letters.forEach(function(codePoint, i) {
      if (lang.nullMask[i] === 0) return;
      var ch = String.fromCodePoint(codePoint);
      letters.push({ upperChar: ch, lowerChar: ch, upperCodePoint: codePoint, lowerCodePoint: codePoint });
    });
  } else {
    var block = ALPHABET_BLOCKS[lang.block];
    for (var i = 0; i < block.count; i++) {
      if (lang.nullMask[i] === 0) continue;
      var r = letterAt(lang.block, i);
      letters.push({ upperChar: r.upperChar, lowerChar: r.lowerChar, upperCodePoint: r.upper, lowerCodePoint: r.lower });
    }
  }
  lang.extraLetters.forEach(function(e) {
    letters.push({ upperChar: String.fromCodePoint(e.upper), lowerChar: String.fromCodePoint(e.lower), upperCodePoint: e.upper, lowerCodePoint: e.lower });
  });
  return letters;
}

// position (0-indexed within the block) -> code point, both cases.
function letterAt(blockName, position) {
  var block = ALPHABET_BLOCKS[blockName];
  if (!block) throw new Error('alphabets.letterAt: unknown block "' + blockName + '"');
  if (position < 0 || position >= block.count) throw new Error('alphabets.letterAt: position ' + position + ' out of range for "' + blockName + '" (0-' + (block.count - 1) + ')');
  return {
    upper: block.upperBase + position,
    lower: block.lowerBase + position,
    upperChar: String.fromCodePoint(block.upperBase + position),
    lowerChar: String.fromCodePoint(block.lowerBase + position)
  };
}

// Cross-script lookup, same shape as semantics.js's digitInAllScripts --
// position N across every known alphabet block at once.
function letterInAllScripts(position) {
  var out = {};
  Object.keys(ALPHABET_BLOCKS).forEach(function(blockName) {
    var block = ALPHABET_BLOCKS[blockName];
    if (position >= block.count) { out[blockName] = null; return; } // e.g. position 30 doesn't exist in a 26-letter block
    var r = letterAt(blockName, position);
    out[blockName] = {
      upperCodePoint: r.upper, upperHex: 'U+' + r.upper.toString(16).toUpperCase().padStart(4, '0'), upperChar: r.upperChar,
      lowerCodePoint: r.lower, lowerHex: 'U+' + r.lower.toString(16).toUpperCase().padStart(4, '0'), lowerChar: r.lowerChar,
      languages: block.languages
    };
  });
  return out;
}

module.exports = {
  ALPHABET_BLOCKS: ALPHABET_BLOCKS,
  HARDCODED_ALPHABET_LETTERS: HARDCODED_ALPHABET_LETTERS,
  HARDCODED_ALPHABETS: HARDCODED_ALPHABETS,
  LANGUAGE_ALPHABETS: LANGUAGE_ALPHABETS,
  letterAt: letterAt,
  letterInAllScripts: letterInAllScripts,
  resolveLanguageAlphabet: resolveLanguageAlphabet
};
