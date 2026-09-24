// ─── mandarin.js — Chinese Han characters, own file, same reason as kanji.js ──
//
// China's own official tiered structure (通用规范汉字表, 2013), independently
// arrived at but the same SHAPE as Japan's Joyo/Jinmeiyo/hyogai split:
//   - TIER 1 (一级字表): ~3,500 characters, basic education, covers ~99.5%
//     of everyday usage. The "needed" tier.
//   - TIER 2 (二级字表): ~3,000 more, general use.
//   - TIER 3 (三级字表): ~1,600 more, specialized/proper-noun use.
//   - Beyond all three: unbounded rare/classical characters, "nice to
//     have," same as Japanese hyogai.
//
// A dimension Japanese kanji doesn't have the same way: SIMPLIFIED vs
// TRADITIONAL forms. Mainland China's standard lists (above) are
// simplified characters (简体字); Taiwan/Hong Kong/Macau use traditional
// forms (繁體字) for the same words -- often different code points for
// the same character (国 U+56FD simplified vs 國 U+570B traditional).
// That's a real additional split this file doesn't resolve, only notes.
//
// Same honest scope constraint as kanji.js: no hand-typed multi-thousand
// list here. MANDARIN_TOP20 below is a real, verified small slice --
// the 20 most frequent characters in modern written Mandarin (simplified
// forms), each confirmed as a real Han-script code point before being
// written here, not the official Tier 1 list itself (that needs an
// authoritative bulk source, same as Joyo's remaining ~2,056 characters).
var path = require('path');
var CHAIN_DIR = path.join(__dirname, '..', '..', 'lib', 'chain');
var Data = require(path.join(CHAIN_DIR, 'Data.js'));

var TIERS = {
  tier1: { name: 'Tier 1 (一级字表)', officialCount: 3500, status: 'needed', populated: 'partial (top 20 frequency sample only)' },
  tier2: { name: 'Tier 2 (二级字表)', officialCount: 3000, status: 'general use', populated: 'not yet populated' },
  tier3: { name: 'Tier 3 (三级字表)', officialCount: 1600, status: 'specialized', populated: 'not yet populated' },
  beyond: { name: 'Beyond the standard table', officialCount: null, status: 'nice-to-have (unbounded)', populated: 'out of scope' }
};

// 20 most frequent characters in modern written Mandarin, simplified
// forms, verified individually (Script=Han confirmed for each).
var MANDARIN_TOP20 = [
  0x7684, 0x4E00, 0x662F, 0x4E0D, 0x4E86, 0x5728, 0x4EBA, 0x6709, 0x6211, 0x4ED6,
  0x8FD9, 0x4E2A, 0x4E0A, 0x4EEC, 0x6765, 0x5230, 0x65F6, 0x5927, 0x5730, 0x4E3A
];

function charAt(codePoint) {
  var ch = String.fromCodePoint(codePoint);
  var d = new Data().init({ text: ch, encoding: 'utf-32' }, { type: Data.SOURCE_TYPES.UNICODE });
  return { char: ch, codePoint: codePoint, codePointHex: 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0'), utf32Bits: d.rows.length };
}

function top20() {
  return MANDARIN_TOP20.map(charAt);
}

module.exports = {
  TIERS: TIERS,
  MANDARIN_TOP20: MANDARIN_TOP20,
  charAt: charAt,
  top20: top20
};
