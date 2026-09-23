// Tests the "cpuCount + 2" heuristic directly against the real ceiling,
// using the same genuinely-async pbkdf2 work as diagnose_overlap.js (so
// this measures real overlap, not the fake-async mistake from before).
var crypto = require('crypto');
var os = require('os');
var CPU_COUNT = os.cpus().length;

function pbkdf2(n) {
  return new Promise(function(resolve, reject) {
    crypto.pbkdf2('password' + n, 'salt', 100000, 64, 'sha512', function(err, key) {
      if (err) reject(err); else resolve(key.length);
    });
  });
}

function timeSequential(n) {
  var t0 = process.hrtime.bigint();
  var chain = Promise.resolve();
  for (var i = 0; i < n; i++) chain = chain.then(function(i2) { return pbkdf2(i2); }.bind(null, i));
  return chain.then(function() { return Number(process.hrtime.bigint() - t0) / 1e6; });
}

function timeBatch(n, batchSize) {
  var t0 = process.hrtime.bigint();
  var remaining = n, idx = 0;
  var loop = function() {
    if (remaining <= 0) return Promise.resolve();
    var thisBatch = Math.min(batchSize, remaining);
    var promises = [];
    for (var i = 0; i < thisBatch; i++) { promises.push(pbkdf2(idx)); idx++; }
    remaining -= thisBatch;
    return Promise.all(promises).then(loop);
  };
  return loop().then(function() { return Number(process.hrtime.bigint() - t0) / 1e6; });
}

var N = 32; // divisible by every batch size tested below
var BATCH_SIZES = [
  Math.max(1, CPU_COUNT - 1),
  CPU_COUNT,
  CPU_COUNT + 1,
  CPU_COUNT + 2,
  CPU_COUNT * 2,
  N // fully oversubscribed, everything at once
];

console.log('cores:', CPU_COUNT, '  N=' + N + ' pbkdf2 calls  batch sizes tested:', BATCH_SIZES.join(', '));

timeSequential(N).then(function(seqMs) {
  var theoreticalBestMs = seqMs / CPU_COUNT;
  console.log('sequential: ' + seqMs.toFixed(1) + ' ms   theoretical best (seq/' + CPU_COUNT + '): ' + theoreticalBestMs.toFixed(1) + ' ms\n');

  // single-run numbers below were noisy and non-monotonic -- averaging
  // TRIALS runs per batch size before drawing any conclusion, rather than
  // trusting one noisy sample either way.
  var TRIALS = 5;
  var chain = Promise.resolve();
  BATCH_SIZES.forEach(function(bs) {
    chain = chain.then(function() {
      var times = [];
      var trialChain = Promise.resolve();
      for (var t = 0; t < TRIALS; t++) {
        trialChain = trialChain.then(function() { return timeBatch(N, bs).then(function(ms) { times.push(ms); }); });
      }
      return trialChain.then(function() {
        var avg = times.reduce(function(a, b) { return a + b; }, 0) / times.length;
        var min = Math.min.apply(null, times);
        var pctOfCeilingAvg = (theoreticalBestMs / avg) * 100;
        console.log('  batch=' + String(bs).padStart(3) + '   avg=' + avg.toFixed(1).padStart(7) + ' ms  min=' + min.toFixed(1).padStart(7) + ' ms   ' +
          (seqMs / avg).toFixed(2) + 'x avg speedup   ' + pctOfCeilingAvg.toFixed(0) + '% of ceiling (avg)   [' + times.map(function(x){return x.toFixed(0);}).join(',') + ']');
      });
    });
  });
  return chain;
}).catch(function(e) { console.log('THREW:', e.stack); process.exit(1); });
