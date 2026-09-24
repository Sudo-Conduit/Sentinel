// Verifies every frozen data/models/*.json file's shape derivation is still
// internally consistent (same sanity checks fetch_model_config.js applies
// at acquisition time), so a hand-edit or a corrupted freeze is caught
// immediately rather than silently feeding wrong shapes into the simulator.
// Same PASS/FAIL convention as research/regx/ocr's test*.js files.
var fs = require('fs');
var path = require('path');

var MODELS_DIR = path.join(__dirname, '..', 'data', 'models');
var failures = 0;

function check(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

function checkTrue(label, cond) {
  if (!cond) failures++;
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
}

var files = fs.readdirSync(MODELS_DIR).filter(function(f) { return f.endsWith('.json'); });
if (files.length === 0) {
  console.log('no frozen model files in ' + MODELS_DIR + ' yet -- nothing to verify');
  process.exit(0);
}

files.forEach(function(file) {
  var frozen = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, file), 'utf8'));
  var s = frozen.shape;
  var label = file + ' (' + frozen.sourceRepo + ')';

  checkTrue(label + ': sourceRepo present', typeof frozen.sourceRepo === 'string' && frozen.sourceRepo.length > 0);
  checkTrue(label + ': sourceUrl present', typeof frozen.sourceUrl === 'string' && frozen.sourceUrl.indexOf('huggingface.co') !== -1);
  checkTrue(label + ': hiddenSize positive integer', Number.isInteger(s.hiddenSize) && s.hiddenSize > 0);
  checkTrue(label + ': numHiddenLayers positive integer', Number.isInteger(s.numHiddenLayers) && s.numHiddenLayers > 0);
  checkTrue(label + ': numAttentionHeads positive integer', Number.isInteger(s.numAttentionHeads) && s.numAttentionHeads > 0);
  checkTrue(label + ': numKeyValueHeads positive integer', Number.isInteger(s.numKeyValueHeads) && s.numKeyValueHeads > 0);
  checkTrue(label + ': numAttentionHeads divisible by numKeyValueHeads (GQA grouping)',
    s.numAttentionHeads % s.numKeyValueHeads === 0);
  checkTrue(label + ': numKeyValueHeads <= numAttentionHeads',
    s.numKeyValueHeads <= s.numAttentionHeads);
  check(label + ': headDim = hiddenSize / numAttentionHeads', s.headDim, s.hiddenSize / s.numAttentionHeads);
  checkTrue(label + ': headDim is an integer (no fractional head)', Number.isInteger(s.headDim));
  checkTrue(label + ': intermediateSize positive integer', Number.isInteger(s.intermediateSize) && s.intermediateSize > 0);
  checkTrue(label + ': vocabSize positive integer', Number.isInteger(s.vocabSize) && s.vocabSize > 0);
});

console.log('\nchecked ' + files.length + ' frozen model file(s)');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)');
process.exit(failures === 0 ? 0 : 1);
