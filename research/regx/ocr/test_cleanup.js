var FrontendOCR = require('./frontend_ocr.js');
var Cleanup = require('./cleanup.js');
var CANON = FrontendOCR.CANONICAL;

var failures = 0;
function check(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

function flipBits(bits, positions) {
  var arr = bits.split('');
  positions.forEach(function(p) { arr[p] = arr[p] === '1' ? '0' : '1'; });
  return arr.join('');
}

var clean3 = CANON['3'];

Promise.resolve().then(function() {
  console.log('--- 1-bit noise (score should drop to 70, well above threshold ' + Cleanup.THRESHOLD + ') ---');
  var noisy1 = flipBits(clean3, [10]);
  return FrontendOCR.recognize(noisy1).then(function(raw) {
    check('raw recognize() on 1-bit-noisy "3" fails as expected', raw.glyph, null);
    var conf = Cleanup.matchConfidence(noisy1, CANON);
    check('confidence correctly identifies it as "3"', conf.glyph, '3');
    check('confidence score is 70', conf.score, 70);
    var result = Cleanup.cleanup(noisy1, CANON);
    check('cleanup decides to clean (score >= threshold)', result.wasCleaned, true);
    return FrontendOCR.recognize(result.cleanedBits).then(function(recovered) {
      check('recognize() on CLEANED bits now succeeds', recovered.glyph, '3');
      check('recognize() on CLEANED bits scores exactly 72', recovered.score, 72);
    });
  });
})
.then(function() {
  console.log('\n--- 3-bit noise (score should drop to 66, still above threshold) ---');
  var noisy3 = flipBits(clean3, [10, 20, 30]);
  return FrontendOCR.recognize(noisy3).then(function(raw) {
    check('raw recognize() on 3-bit-noisy "3" fails', raw.glyph, null);
    var conf = Cleanup.matchConfidence(noisy3, CANON);
    check('confidence score is 66', conf.score, 66);
    var result = Cleanup.cleanup(noisy3, CANON);
    check('cleanup decides to clean', result.wasCleaned, true);
    return FrontendOCR.recognize(result.cleanedBits).then(function(recovered) {
      check('recovered glyph is "3"', recovered.glyph, '3');
    });
  });
})
.then(function() {
  console.log('\n--- 5-bit noise (score should drop to 62, BELOW threshold -- must NOT be cleaned) ---');
  var noisy5 = flipBits(clean3, [10, 20, 30, 40, 50]);
  return FrontendOCR.recognize(noisy5).then(function(raw) {
    check('raw recognize() on 5-bit-noisy "3" fails', raw.glyph, null);
    var conf = Cleanup.matchConfidence(noisy5, CANON);
    check('confidence score is 62', conf.score, 62);
    var result = Cleanup.cleanup(noisy5, CANON);
    check('cleanup correctly DECLINES to clean (below threshold)', result.wasCleaned, false);
    check('cleanedBits equals original (untouched) when declined', result.cleanedBits, noisy5);
  });
})
.then(function() {
  console.log('\n--- real (non-noisy) "5" input: must not be misidentified as a corrected "3" ---');
  var real5 = CANON['5'];
  return FrontendOCR.recognize(real5).then(function(raw) {
    check('raw recognize() on real "5" succeeds directly, no cleanup needed', raw.glyph, '5');
    var result = Cleanup.cleanup(real5, CANON);
    check('cleanup identifies it as "5", not confused with "3" (worst-case cross-glyph pair)', result.glyph, '5');
    check('cleanup is a no-op on already-clean input', result.wasCleaned, false);
  });
})
.then(function() {
  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})
.catch(function(e) { console.log('THREW: ' + e.stack); process.exit(1); });
