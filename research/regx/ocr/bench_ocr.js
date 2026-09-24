// Real timing comparison: FrontendOCR.recognize() (RulesEngine only) vs
// FrontendOCR.compileAndRun() (full RegX WASM compile+instantiate+call),
// over the same 11 meshes from 90x80_001_ng.png, plus a correctness check
// that both paths agree on every case.
var zlib = require('zlib');
var fs = require('fs');
var path = require('path');

var ExtendX = require('../ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('../RegX.js');
var FrontendOCR = require('./frontend_ocr.js');

function readPng(p) {
  var buf = fs.readFileSync(p);
  var off = 8, width, height;
  var idatChunks = [];
  while (off < buf.length) {
    var len = buf.readUInt32BE(off);
    var type = buf.toString('ascii', off + 4, off + 8);
    var data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === 'IDAT') idatChunks.push(data);
    else if (type === 'IEND') break;
    off += 8 + len + 4;
  }
  var raw = zlib.inflateSync(Buffer.concat(idatChunks));
  var bpp = 3, stride = width * bpp;
  var pixels = new Uint8Array(width * height * 3);
  function paeth(a, b, c) { var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
  var prevRow = new Uint8Array(stride);
  for (var y = 0; y < height; y++) {
    var rowStart = y * (1 + stride), filter = raw[rowStart], row = new Uint8Array(stride);
    for (var x = 0; x < stride; x++) {
      var rb = raw[rowStart + 1 + x];
      var a = x >= bpp ? row[x - bpp] : 0, b = prevRow[x], c = x >= bpp ? prevRow[x - bpp] : 0, v;
      switch (filter) {
        case 0: v = rb; break;
        case 1: v = (rb + a) & 0xFF; break;
        case 2: v = (rb + b) & 0xFF; break;
        case 3: v = (rb + ((a + b) >> 1)) & 0xFF; break;
        case 4: v = (rb + paeth(a, b, c)) & 0xFF; break;
      }
      row[x] = v;
    }
    pixels.set(row, y * stride);
    prevRow = row;
  }
  return { width: width, height: height, pixels: pixels };
}

function isNullPixel(r, g, b) { return r === 255 && g === 255 && b === 255; }

function meshBits(img, col, row) {
  var bits = '';
  for (var dy = 0; dy < FrontendOCR.CELL_H; dy++) {
    for (var dx = 0; dx < FrontendOCR.CELL_W; dx++) {
      var x = col * FrontendOCR.CELL_W + dx, y = row * FrontendOCR.CELL_H + dy;
      var o = (y * img.width + x) * 3;
      bits += isNullPixel(img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]) ? '0' : '1';
    }
  }
  return bits;
}

var img = readPng(path.join(__dirname, '90x80_001_ng.png'));
var meshes = [
  [0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7],
  [1, 8], [8, 8], [0, 1]
];
var bitsList = meshes.map(function(m) { return meshBits(img, m[0], m[1]); });

// suppress the frontend's own console.log(EXPR) prints from the WASM path
// during timing/agreement runs -- noise, not signal, for this comparison
var realLog = console.log;

// Phase 1 baseline: recognize() is now Promise-returning (see frontend_ocr.js).
// This awaits each call ONE AT A TIME, same sequential shape as the old sync
// loop -- the only thing that changed is Promise construction + microtask
// scheduling around the identical computation. This number IS the
// "Promise-wrapping-overhead-only" baseline Phase 2's real batching needs
// to be compared against, not against the original 13.86us/call sync number
// (that comparison would conflate interface overhead with real parallelism).
function timeSequentialAwait(n) {
  var t0 = process.hrtime.bigint();
  var results = [];
  var chain = Promise.resolve();
  for (var iter = 0; iter < n; iter++) {
    for (var i = 0; i < bitsList.length; i++) {
      chain = chain.then(function(bits) {
        return FrontendOCR.recognize(bits);
      }.bind(null, bitsList[i])).then(function(r) { results.push(r); });
    }
  }
  return chain.then(function() {
    var t1 = process.hrtime.bigint();
    return { elapsedMs: Number(t1 - t0) / 1e6, results: results.slice(0, bitsList.length) };
  });
}

// Phase 2, corrected: Promise.all() takes ONLY the array of already-started
// promises -- no .then() wrapping around the dispatch, no per-pass chaining,
// no timers. Calling recognize(bits) starts its executor immediately and
// synchronously (that's how `new Promise(executor)` works); building the
// whole array in a plain loop means every one of the n*bitsList.length
// calls has already been dispatched before Promise.all() is ever invoked.
// The first draft chained n separate Promise.all() calls through n .then()
// hops -- that re-serializes exactly the thing this phase is supposed to
// avoid, forcing pass 2's dispatch to wait on pass 1's full resolution
// instead of running everything at once. One Promise.all() call, one
// separate .then() afterward to read the result -- nothing else.
function timeBatched(n) {
  var t0 = process.hrtime.bigint();
  var promises = [];
  for (var iter = 0; iter < n; iter++) {
    for (var i = 0; i < bitsList.length; i++) {
      promises.push(FrontendOCR.recognize(bitsList[i]));
    }
  }
  return Promise.all(promises)
    .then(function(results) {
      var t1 = process.hrtime.bigint();
      return { elapsedMs: Number(t1 - t0) / 1e6, results: results.slice(0, bitsList.length) };
    });
}

function timeWasm(n) {
  console.log = function() {};
  var t0 = process.hrtime.bigint();
  var chain = Promise.resolve();
  var lastResults = [];
  for (var iter = 0; iter < n; iter++) {
    chain = chain.then(function() {
      var perMesh = bitsList.map(function(bits) {
        return FrontendOCR.compileAndRun(bits, {}).then(function(inst) {
          var s = inst.exports.recognize(0);
          return typeof s === 'bigint' ? Number(s) : s;
        });
      });
      return Promise.all(perMesh).then(function(r) { lastResults = r; });
    });
  }
  return chain.then(function() {
    var t1 = process.hrtime.bigint();
    console.log = realLog;
    return { elapsedMs: Number(t1 - t0) / 1e6, results: lastResults };
  });
}

var N = 50; // 50 passes x 11 meshes = 550 calls per path

console.log('Agreement check (1 pass, ' + bitsList.length + ' meshes):');
Promise.all([timeSequentialAwait(1), timeWasm(1)]).then(function(r) {
  var fastOne = r[0].results, wasmOne = r[1];
  var allAgree = true;
  for (var i = 0; i < bitsList.length; i++) {
    var f = fastOne[i], expectedScore = wasmOne.results[i];
    var ok = f.score === expectedScore;
    if (!ok) allAgree = false;
    console.log('  mesh ' + i + ': fast.score=' + f.score + '  wasm.score=' + expectedScore + '  ' + (ok ? 'MATCH' : 'MISMATCH'));
  }
  console.log(allAgree ? '  ALL AGREE\n' : '  DISAGREEMENT FOUND\n');

  // shared warm-up: run both paths once, unmeasured, so the JIT is in the
  // same state for both timed runs below -- fixes the cross-process mistake
  // from Phase 1's first number.
  return Promise.all([timeSequentialAwait(5), timeBatched(5)]).then(function() {
    console.log('Timing: ' + N + ' passes x ' + bitsList.length + ' meshes = ' + (N * bitsList.length) + ' calls per path (same process, warmed up)');
    return timeSequentialAwait(N).then(function(seq) {
      return timeBatched(N).then(function(batched) {
        console.log('  sequential await   (' + N * bitsList.length + ' calls, one .then() link at a time): ' + seq.elapsedMs.toFixed(2) + ' ms total, ' + (seq.elapsedMs * 1000 / (N * bitsList.length)).toFixed(2) + ' us/call');
        console.log('  Promise.all() batch (' + N + ' batches of ' + bitsList.length + '):                          ' + batched.elapsedMs.toFixed(2) + ' ms total, ' + (batched.elapsedMs * 1000 / (N * bitsList.length)).toFixed(2) + ' us/call');
        console.log('  ratio: ' + (seq.elapsedMs / batched.elapsedMs).toFixed(2) + 'x');
        console.log('  (Both run recognize()\'s synchronous body on the single JS thread -- no worker threads, no real I/O underneath yet. Any difference here is SCHEDULING overhead, not parallelism: fewer/more microtask hops per call. A ratio near 1x is the expected, honest result at this batch size; it is not evidence Promise.all() is/isn\'t "faster" in general.)');
        return timeWasm(N);
      });
    }).then(function(wasm) {
      console.log('\n  compileAndRun() (full WASM pipeline): ' + wasm.elapsedMs.toFixed(2) + ' ms total, ' + (wasm.elapsedMs * 1000 / (N * bitsList.length)).toFixed(2) + ' us/call -- for reference, unchanged by this phase');
    });
  });
}).catch(function(e) { console.log = realLog; console.log('THREW: ' + e.stack); process.exit(1); });
