// Real end-to-end test: frozen Qwen2.5-0.5B config -> deriveModelMatmuls ->
// real FLOP counts, plus the funnel math, watts formula, and emissions
// formula against real/sane inputs. Same PASS/FAIL convention as
// research/regx/ocr's test*.js files.
var fs = require('fs');
var path = require('path');
var Sim = require('./llm-simulator.js');

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
function checkClose(label, actual, expected, tolerance) {
  var ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want~=' + expected);
}

console.log('--- deriveModelMatmuls against real frozen Qwen2.5-0.5B shape ---');
var qwenFrozen = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'models', 'qwen2.5-0.5b.json'), 'utf8'));
var shape = qwenFrozen.shape;

check('shape.numHiddenLayers (real, from live HF fetch)', shape.numHiddenLayers, 24);
check('shape.numAttentionHeads', shape.numAttentionHeads, 14);
check('shape.numKeyValueHeads (real GQA ratio, not assumed uniform)', shape.numKeyValueHeads, 2);
check('shape.headDim = hiddenSize/numAttentionHeads', shape.headDim, 64);

// prefill: 600 new tokens (Lite tier's sentTokens), kvLen == seqLen (no prior cache)
var prefillMatmuls = Sim.deriveModelMatmuls(shape, 600, 600);
checkTrue('prefill matmul count = 9 per layer x 24 layers + 1 lm_head', prefillMatmuls.length === 9 * 24 + 1);

var prefillFlops = prefillMatmuls.reduce(function(sum, mm) { return sum + Sim.matmulFlops(mm); }, 0);
checkTrue('prefill total FLOPs is a real positive number', prefillFlops > 0);
console.log('  prefill (600 tokens) total FLOPs: ' + (prefillFlops / 1e9).toFixed(2) + ' GFLOP');

// decode: 1 new token, kvLen = 601 (600 prompt tokens + 1 already-generated)
var decodeMatmuls = Sim.deriveModelMatmuls(shape, 1, 601);
var decodeFlops = decodeMatmuls.reduce(function(sum, mm) { return sum + Sim.matmulFlops(mm); }, 0);
console.log('  decode (1 new token, kvLen=601) total FLOPs: ' + (decodeFlops / 1e6).toFixed(2) + ' MFLOP');
checkTrue('decode FLOPs per token is much smaller than prefill total (KV-cache reuse working)', decodeFlops < prefillFlops / 100);

console.log('\n--- funnel math ---');
var funnel = Sim.deriveConcurrentUsers(100000, { mauToDau: 5, dauToConcurrent: 5 });
check('MAU/5 = DAU', funnel.dau, 20000);
check('DAU/5 = concurrent', funnel.concurrent, 4000);

console.log('\n--- Teads/CCF watts formula, real constants from a1.medium ---');
var emissionsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'emissions', 'aws-instances.json'), 'utf8'));
var a1medium = emissionsData.instances.find(function(r) { return r.instanceType === 'a1.medium'; });
checkTrue('a1.medium found in frozen data', !!a1medium);
var wattsIdle = Sim.estimateWatts(a1medium.pkgWattIdle, a1medium.pkgWatt100, 0);
var wattsFull = Sim.estimateWatts(a1medium.pkgWattIdle, a1medium.pkgWatt100, 100);
check('0% utilization returns exactly Pidle', wattsIdle, a1medium.pkgWattIdle);
check('100% utilization returns exactly Pmax', wattsFull, a1medium.pkgWatt100);
var wattsHalf = Sim.estimateWatts(a1medium.pkgWattIdle, a1medium.pkgWatt100, 50);
checkClose('50% utilization is the real midpoint', wattsHalf, (a1medium.pkgWattIdle + a1medium.pkgWatt100) / 2, 0.001);

console.log('\n--- emissions formula: explicit region override ---');
var emissions = Sim.estimateEmissions(wattsHalf, 1, { gridIntensityGCO2PerKWh: 400, vCPUsUsed: 1 }); // 400 gCO2/kWh, a representative mixed-grid figure
checkTrue('operationalGramsCO2e is a real positive number', emissions.operationalGramsCO2e > 0);
checkTrue('embodiedGramsCO2e is a real positive number (ballpark default, not null)', emissions.embodiedGramsCO2e > 0);
check('totalGramsCO2e = operational + embodied', emissions.totalGramsCO2e, emissions.operationalGramsCO2e + emissions.embodiedGramsCO2e);
check('gridIntensityIsDefault is false when caller supplies one', emissions.gridIntensityIsDefault, false);

console.log('\n--- emissions formula: simulator ballpark defaults (no overrides) ---');
var emissionsDefault = Sim.estimateEmissions(wattsHalf, 1);
checkTrue('operationalGramsCO2e is a real positive number using the global-average default', emissionsDefault.operationalGramsCO2e > 0);
checkTrue('embodiedGramsCO2e is a real positive number using the reference-server default', emissionsDefault.embodiedGramsCO2e > 0);
check('gridIntensityUsedGCO2PerKWh falls back to the sourced global average', emissionsDefault.gridIntensityUsedGCO2PerKWh, 445);
check('gridIntensityIsDefault is true with no override supplied', emissionsDefault.gridIntensityIsDefault, true);

console.log('\n--- LM head matmul: now included in deriveModelMatmuls ---');
var prefillWithHead = Sim.deriveModelMatmuls(shape, 600, 600);
var lmHead = prefillWithHead.find(function(mm) { return mm.name === 'lm_head'; });
checkTrue('lm_head matmul present', !!lmHead);
if (lmHead) {
  check('lm_head m=1 (last position only, standard inference-time behavior)', lmHead.m, 1);
  check('lm_head k=hiddenSize', lmHead.k, shape.hiddenSize);
  check('lm_head n=vocabSize', lmHead.n, shape.vocabSize);
}
checkTrue('deriveModelMatmuls now returns 9*layers + 1 lm_head', prefillWithHead.length === 9 * shape.numHiddenLayers + 1);

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
