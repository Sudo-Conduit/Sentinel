// Decisive test: can Promise.all() over PURELY SYNCHRONOUS JS (no await
// inside, no I/O, no worker_threads) use more than one core in Node? Uses
// a CPU-bound busy-loop sized to ~1ms/call so the effect (if any) is far
// above noise -- unlike recognize()'s ~5us, which is too fast for this
// question to be answered cleanly either way.
var os = require('os');
console.log('cores available:', os.cpus().length);

function busyWork(iterations) {
  var x = 0;
  for (var i = 0; i < iterations; i++) x += Math.sqrt(i) * Math.sin(i);
  return x;
}

// calibrate: find an iteration count that takes ~1ms
var ITER = 2000000;
var calT0 = process.hrtime.bigint();
busyWork(ITER);
var calMs = Number(process.hrtime.bigint() - calT0) / 1e6;
console.log('calibration: busyWork(' + ITER + ') took ' + calMs.toFixed(3) + ' ms\n');

var N = 40;

// sequential
var t0 = process.hrtime.bigint();
for (var i = 0; i < N; i++) busyWork(ITER);
var seqMs = Number(process.hrtime.bigint() - t0) / 1e6;

// "concurrent" via Promise.all() of async functions wrapping the same synchronous work
function asyncBusyWork(iterations) {
  return new Promise(function(resolve) { resolve(busyWork(iterations)); });
}

var t1 = process.hrtime.bigint();
var promises = [];
for (var j = 0; j < N; j++) promises.push(asyncBusyWork(ITER));
Promise.all(promises).then(function() {
  var parMs = Number(process.hrtime.bigint() - t1) / 1e6;
  console.log('N=' + N + ' calls of a ~' + calMs.toFixed(2) + 'ms CPU-bound synchronous function:');
  console.log('  sequential for-loop:        ' + seqMs.toFixed(2) + ' ms total');
  console.log('  Promise.all() of N promises: ' + parMs.toFixed(2) + ' ms total');
  console.log('  ratio: ' + (seqMs / parMs).toFixed(2) + 'x');
  console.log('  if this were real 4-core parallelism, ratio would be near 4.00x. If Node\'s main thread is single-threaded regardless of Promise.all(), ratio will be ~1.00x.');
});
