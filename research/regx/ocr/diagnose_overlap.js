// Corrected diagnostic. My last test was wrong in a specific way: it wrapped
// synchronous work in `new Promise(resolve => resolve(busyWork()))`, which
// resolves in the SAME tick -- there is no "in flight" window at all, so it
// could never show overlap regardless of Promise.all() or batch size. That
// wasn't a fair test of concurrency; it was a test of something guaranteed
// to show 1.00x by construction.
//
// To see real overlap, the work has to be GENUINELY async -- actually
// handed to libuv's thread pool (default size 4, same as this machine's
// core count) and running there WHILE the main JS thread is free to do
// something else. crypto.pbkdf2 is the standard example: CPU-bound AND
// genuinely dispatched off-thread. This also tests the batch-size point
// directly: overlap should show up near a batch size matching the thread
// pool (~4), and NOT keep improving once you oversubscribe it (50, 550).
var crypto = require('crypto');
var os = require('os');
console.log('cores:', os.cpus().length, '  UV_THREADPOOL_SIZE:', process.env.UV_THREADPOOL_SIZE || '(default 4)');

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
  for (var i = 0; i < n; i++) {
    chain = chain.then(function(i2) { return pbkdf2(i2); }.bind(null, i));
  }
  return chain.then(function() { return Number(process.hrtime.bigint() - t0) / 1e6; });
}

function timeBatch(n, batchSize) {
  var t0 = process.hrtime.bigint();
  var chain = Promise.resolve();
  var remaining = n;
  var idx = 0;
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

var N = 16;

timeSequential(N).then(function(seqMs) {
  console.log('\nN=' + N + ' real pbkdf2(100000 rounds) calls:');
  console.log('  sequential (1 at a time):     ' + seqMs.toFixed(1) + ' ms');
  return timeBatch(N, 4).then(function(b4) {
    console.log('  Promise.all() batch size 4:   ' + b4.toFixed(1) + ' ms   (ratio vs sequential: ' + (seqMs / b4).toFixed(2) + 'x)');
    return timeBatch(N, 16).then(function(b16) {
      console.log('  Promise.all() batch size 16:  ' + b16.toFixed(1) + ' ms   (ratio vs sequential: ' + (seqMs / b16).toFixed(2) + 'x)');
      console.log('\nIf overlap is real: batch-size-4 should approach ~4x (matches core/threadpool count); batch-size-16 (all at once, oversubscribed) should NOT be much better than batch-size-4, since only 4 threads exist to run on regardless of how many promises are queued at once.');
    });
  });
}).catch(function(e) { console.log('THREW:', e.stack); process.exit(1); });
