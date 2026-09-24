var Alphabets = require('./alphabets.js');

var failures = 0;
function check(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

// position 0 -> A / а, position 31 -> the last Cyrillic letter (Я / я)
var cyr0 = Alphabets.letterAt('cyrillic', 0);
check('cyrillic position 0 upper is U+0410 (А)', cyr0.upperChar, 'А');
check('cyrillic position 0 lower is U+0430 (а)', cyr0.lowerChar, 'а');

var cyr31 = Alphabets.letterAt('cyrillic', 31);
check('cyrillic position 31 upper is U+042F (Я)', cyr31.upperChar, 'Я');
check('cyrillic position 31 lower is U+044F (я)', cyr31.lowerChar, 'я');

var lat0 = Alphabets.letterAt('latin', 0);
check('latin position 0 is A/a', lat0.upperChar + lat0.lowerChar, 'Aa');

console.log('\n--- Ё (hardcoded exception, outside the contiguous run) ---');
var yo = Alphabets.HARDCODED_ALPHABET_LETTERS.cyrillicYo;
check('Ё upper is U+0401', 'U+' + yo.upper.toString(16).toUpperCase().padStart(4, '0'), 'U+0401');
check('ё lower is U+0451', 'U+' + yo.lower.toString(16).toUpperCase().padStart(4, '0'), 'U+0451');
check('Ё is NOT reachable via the block formula (0410 + 31 = 042F, the last real block position, not 0401)',
  Alphabets.letterAt('cyrillic', 31).upperChar === 'Ё', false);

console.log('\n--- cross-script lookup, position 2 (third letter) ---');
var pos2 = Alphabets.letterInAllScripts(2);
Object.keys(pos2).forEach(function(b) {
  console.log('  ' + b.padEnd(10) + pos2[b].upperHex + '/' + pos2[b].lowerHex + '  "' + pos2[b].upperChar + pos2[b].lowerChar + '"  (' + pos2[b].languages.join(', ') + ')');
});
check('latin position 2 is C/c', pos2.latin.upperChar + pos2.latin.lowerChar, 'Cc');
check('cyrillic position 2 is В/в (shared by Russian, Bulgarian, Ukrainian, Serbian, Macedonian)', pos2.cyrillic.upperChar + pos2.cyrillic.lowerChar, 'Вв');

console.log('\n--- Romance languages: null-bit mask + past-26 extras, same shared latin block ---');
['english', 'french', 'portuguese', 'italian', 'spanish', 'romanian'].forEach(function(lang) {
  var letters = Alphabets.resolveLanguageAlphabet(lang);
  console.log('  ' + lang.padEnd(12) + letters.length + ' letters  ' + letters.map(function(l) { return l.upperChar; }).join(''));
});
check('english resolves to 26', Alphabets.resolveLanguageAlphabet('english').length, 26);
check('french resolves to 26', Alphabets.resolveLanguageAlphabet('french').length, 26);
check('portuguese resolves to 26', Alphabets.resolveLanguageAlphabet('portuguese').length, 26);
check('italian resolves to 21 (26 minus J,K,W,X,Y)', Alphabets.resolveLanguageAlphabet('italian').length, 21);
check('spanish resolves to 27 (26 + Ñ)', Alphabets.resolveLanguageAlphabet('spanish').length, 27);
check('romanian resolves to 31 (26 + 5)', Alphabets.resolveLanguageAlphabet('romanian').length, 31);
check('italian does not include J', Alphabets.resolveLanguageAlphabet('italian').some(function(l) { return l.upperChar === 'J'; }), false);
check('spanish includes Ñ', Alphabets.resolveLanguageAlphabet('spanish').some(function(l) { return l.upperChar === 'Ñ'; }), true);

console.log('\n--- Arabic/Persian: hardcoded whole-alphabet family, no case ---');
var arabicLetters = Alphabets.resolveLanguageAlphabet('arabic');
var persianLetters = Alphabets.resolveLanguageAlphabet('persian');
console.log('  arabic  ' + arabicLetters.length + ' letters  ' + arabicLetters.map(function(l) { return l.upperChar; }).join(''));
console.log('  persian ' + persianLetters.length + ' letters  ' + persianLetters.map(function(l) { return l.upperChar; }).join(''));
check('arabic resolves to 28 letters', arabicLetters.length, 28);
check('persian resolves to 32 letters (28 + 4)', persianLetters.length, 32);
check('arabic first letter is alef (ا), not hamza', arabicLetters[0].upperChar, 'ا');
check('arabic has no case: upperChar === lowerChar', arabicLetters[0].upperChar, arabicLetters[0].lowerChar);
check('persian includes peh (پ)', persianLetters.some(function(l) { return l.upperChar === 'پ'; }), true);
check('persian includes gaf (گ)', persianLetters.some(function(l) { return l.upperChar === 'گ'; }), true);
check('arabic does NOT include peh (it is Persian-only)', arabicLetters.some(function(l) { return l.upperChar === 'پ'; }), false);

console.log('\n--- Thai: no-case formula block (46 contiguous), 2 obsolete letters null-masked off ---');
var thaiLetters = Alphabets.resolveLanguageAlphabet('thai');
console.log('  thai (modern)  ' + thaiLetters.length + ' letters  ' + thaiLetters.map(function(l) { return l.upperChar; }).join(''));
check('modern thai resolves to 44 (46 minus 2 obsolete)', thaiLetters.length, 44);
check('thai first letter is ก (ko kai)', thaiLetters[0].upperChar, 'ก');
check('thai has no case: upperChar === lowerChar', thaiLetters[0].upperChar, thaiLetters[0].lowerChar);
check('modern thai excludes ฃ (obsolete)', thaiLetters.some(function(l) { return l.upperChar === 'ฃ'; }), false);
check('modern thai excludes ฅ (obsolete)', thaiLetters.some(function(l) { return l.upperChar === 'ฅ'; }), false);
check('modern thai still includes ค (position 3, between the two excluded ones)', thaiLetters.some(function(l) { return l.upperChar === 'ค'; }), true);

console.log('\n--- Devanagari (Hindi, Marathi) and Bengali: hardcoded, gap pattern matches Arabic\'s shape ---');
var hindiLetters = Alphabets.resolveLanguageAlphabet('hindi');
var bengaliLetters = Alphabets.resolveLanguageAlphabet('bengali');
console.log('  hindi/marathi  ' + hindiLetters.length + ' letters  ' + hindiLetters.map(function(l) { return l.upperChar; }).join(''));
console.log('  bengali        ' + bengaliLetters.length + ' letters  ' + bengaliLetters.map(function(l) { return l.upperChar; }).join(''));
check('devanagari resolves to 44 (11 vowels + 33 consonants)', hindiLetters.length, 44);
check('bengali resolves to 43 (11 vowels + 32 consonants)', bengaliLetters.length, 43);
check('devanagari first letter is अ', hindiLetters[0].upperChar, 'अ');
check('bengali first letter is অ', bengaliLetters[0].upperChar, 'অ');
check('devanagari has no case', hindiLetters[0].upperChar, hindiLetters[0].lowerChar);
check('marathi aliases the same devanagari list as hindi', Alphabets.resolveLanguageAlphabet('marathi').length, 44);

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
