var path = require('path');
var FrontendOCR = require('./frontend_ocr.js');
var Semantics = require('./semantics.js');
var IR = require('./image_reference.js');

var failures = 0;
function check(label, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// end to end: real mesh from the real test image -> recognize() -> associate()
var pngPath = path.join(__dirname, '90x80_001_ng.png');
var loaded = IR.loadAsChainData(pngPath);
var meshTensor3 = IR.meshTensor(loaded.img, 3, 3); // '3', diagonal
var bits3 = IR.tensorToBitString(meshTensor3);

Promise.resolve()
  .then(function() { return FrontendOCR.recognize(bits3); })
  .then(function(recognized) {
    check("real mesh recognized as '3'", recognized.glyph, '3');
    var assoc = Semantics.associate(recognized.glyph);
    console.log('\nEnd-to-end association for the real recognized mesh:');
    console.log('  glyph token:', assoc.glyph);
    console.log('  code point:', assoc.codePointHex, '(' + assoc.codePoint + ')');
    console.log('  UTF-32 bytes:', assoc.utf32Hex);
    console.log('  Numeric_Value:', assoc.numericValue);
    check('code point matches Unicode U+0033', assoc.codePointHex, 'U+0033');
    check('UTF-32 bytes match verified encoding', assoc.utf32Hex, '0x00 0x00 0x00 0x33');
    check('Numeric_Value is the grounded quantity 3 (a real number, not a string)', assoc.numericValue, 3);
    check('numericValue is typeof number, not string', typeof assoc.numericValue, 'number');

    console.log("\n--- letter 'A': should associate to a code point but NO numeric value ---");
    var assocA = Semantics.associate('A');
    console.log('  glyph:', assocA.glyph, ' code point:', assocA.codePointHex, ' numericValue:', assocA.numericValue);
    check("'A' has a real code point", assocA.codePointHex, 'U+0041');
    check("'A' correctly has NO Numeric_Value (it's a letter)", assocA.numericValue, null);

    console.log('\n--- unrecognized (null) glyph: association must not fabricate meaning ---');
    var assocNull = Semantics.associate(null);
    check('null glyph associates to nothing, not a guess', assocNull.numericValue, null);

    console.log('\n--- many-to-one: other scripts\' "3" share the same Numeric_Value ---');
    [0x0663, 0x06F3, 0x0969, 0x09E9, 0x0E53, 0xFF13].forEach(function(cp) {
      check('U+' + cp.toString(16).toUpperCase() + ' also has Numeric_Value 3', Semantics.CODEPOINT_TO_NUMERIC_VALUE[cp], 3);
    });
    check('U+096B (Devanagari FIVE, not three) correctly does NOT have Numeric_Value 3', Semantics.CODEPOINT_TO_NUMERIC_VALUE[0x096B], 5);

    console.log('\n--- cross-script lookup for digit 3, derived not hand-listed ---');
    var all3 = Semantics.digitInAllScripts(3);
    Object.keys(all3).forEach(function(block) {
      console.log('  ' + block.padEnd(20) + all3[block].codePointHex + '  "' + all3[block].char + '"  (' + all3[block].languages.join(', ') + ')');
    });
    check('western block digit 3 is U+0033', all3.western.codePointHex, 'U+0033');
    check('devanagari digit 3 is the CORRECTED U+0969, not the old wrong U+096B', all3.devanagari.codePointHex, 'U+0969');
    check('arabicIndic digit 3 is U+0663', all3.arabicIndic.codePointHex, 'U+0663');

    console.log('\n--- hardcoded family: Han ideographic (Kanji/Mandarin/Sino-Korean), digit 3 ---');
    var han3 = Semantics.digitInHardcodedFamilies(3);
    Object.keys(han3).forEach(function(fam) {
      console.log('  ' + fam.padEnd(16) + han3[fam].codePointHex + '  "' + han3[fam].char + '"  (' + han3[fam].languages.join(', ') + ')');
    });
    check('han family digit 3 is U+4E09', han3.han.codePointHex, 'U+4E09');
    check('hebrewGematria digit 3 is U+05D2 (gimel)', han3.hebrewGematria.codePointHex, 'U+05D2');
    check('Numeric_Value lookup for Han 3 (U+4E09) resolves to 3', Semantics.CODEPOINT_TO_NUMERIC_VALUE[0x4E09], 3);
    check('Numeric_Value lookup for gimel (U+05D2) resolves to 3', Semantics.CODEPOINT_TO_NUMERIC_VALUE[0x05D2], 3);

    console.log('\n--- gematria has no zero: must not fabricate one ---');
    var gematria0 = Semantics.digitInHardcodedFamilies(0);
    check('hebrewGematria digit 0 is honestly null, not a guess', gematria0.hebrewGematria, null);
    check('han digit 0 (零) IS defined -- Han numerals genuinely have a zero', gematria0.han.codePointHex, 'U+96F6');

    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(function(e) { console.log('THREW: ' + e.stack); process.exit(1); });
