// Real end-to-end proof of frontend_ocr.js against 90x80_001_ng.png (the
// RD test file): decode the PNG, extract each active mesh's 72-bit on/off
// pattern via the same Base-3 null gate (pure white = 0), run it through
// FrontendOCR.parse (discrete recognition) and FrontendOCR.compileAndRun
// (real compiled WASM computing the actual agreement score), and check
// results. Same PASS/FAIL convention as every other test*.js here.
var zlib = require('zlib');
var fs = require('fs');
var path = require('path');

var ExtendX = require('../ExtendX.js');
global.self = global;
self.ExtendX = ExtendX;
var RegX = require('../RegX.js');
var FrontendOCR = require('./frontend_ocr.js');

var failures = 0;
function check(label, actual, expected) {
  var ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + actual + ' want=' + expected);
}

// ---------- minimal PNG decoder (8-bit RGB, non-interlaced) ----------
function readPng(p) {
  var buf = fs.readFileSync(p);
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('not a PNG');
  var off = 8, width, height, bitDepth, colorType;
  var idatChunks = [];
  while (off < buf.length) {
    var len = buf.readUInt32BE(off);
    var type = buf.toString('ascii', off + 4, off + 8);
    var data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idatChunks.push(data);
    else if (type === 'IEND') break;
    off += 8 + len + 4;
  }
  if (bitDepth !== 8 || colorType !== 2) throw new Error('unsupported PNG: bitDepth=' + bitDepth + ' colorType=' + colorType);
  var raw = zlib.inflateSync(Buffer.concat(idatChunks));
  var bpp = 3, stride = width * bpp;
  var pixels = new Uint8Array(width * height * 3);
  function paeth(a, b, c) { var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
  var prevRow = new Uint8Array(stride);
  for (var y = 0; y < height; y++) {
    var rowStart = y * (1 + stride), filter = raw[rowStart], row = new Uint8Array(stride);
    for (var x = 0; x < stride; x++) {
      var rb = raw[rowStart + 1 + x];
      var a = x >= bpp ? row[x - bpp] : 0, b = prevRow[x], c = x >= bpp ? prevRow[x - bpp] : 0;
      var v;
      switch (filter) {
        case 0: v = rb; break;
        case 1: v = (rb + a) & 0xFF; break;
        case 2: v = (rb + b) & 0xFF; break;
        case 3: v = (rb + ((a + b) >> 1)) & 0xFF; break;
        case 4: v = (rb + paeth(a, b, c)) & 0xFF; break;
        default: throw new Error('bad filter ' + filter);
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

var cases = [
  { col: 0, row: 0, label: "diagonal '0'", expectGlyph: '0' },
  { col: 1, row: 1, label: "diagonal '1'", expectGlyph: '1' },
  { col: 2, row: 2, label: "diagonal '2'", expectGlyph: '2' },
  { col: 3, row: 3, label: "diagonal '3' (red)", expectGlyph: '3' },
  { col: 4, row: 4, label: "diagonal '4'", expectGlyph: '4' },
  { col: 5, row: 5, label: "diagonal '5'", expectGlyph: '5' },
  { col: 6, row: 6, label: "diagonal '6'", expectGlyph: '6' },
  { col: 7, row: 7, label: "diagonal '7'", expectGlyph: '7' },
  { col: 1, row: 8, label: "off-diagonal 'A'", expectGlyph: 'A' },
  { col: 8, row: 8, label: 'diagonal blank (null)', expectGlyph: null },
  { col: 0, row: 1, label: 'plain background', expectGlyph: null },
];

Promise.resolve()
  .then(function loop() {
    return cases.reduce(function(p, c) {
      return p.then(function() {
        var bits = meshBits(img, c.col, c.row);
        var parsed = FrontendOCR.parse(bits);
        check(c.label + ': recognized glyph', parsed.recognizedGlyph, c.expectGlyph);
        return FrontendOCR.compileAndRun(bits, {}).then(function(inst) {
          var score = inst.exports.recognize(0);
          var normalized = typeof score === 'bigint' ? Number(score) : score;
          var expectedScore = c.expectGlyph ? FrontendOCR.CELL_W * FrontendOCR.CELL_H : -1;
          check(c.label + ': WASM-computed score', normalized, expectedScore);
        });
      });
    }, Promise.resolve());
  })
  .then(function() {
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(function(err) {
    console.log('THREW (unexpected): ' + err.stack);
    process.exit(1);
  });
