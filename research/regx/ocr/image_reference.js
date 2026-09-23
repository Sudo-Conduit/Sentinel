// ─── image_reference.js — Step 1 of the image reference implementation ──
//
// Consolidation step: route raw image bytes through research/lib/chain's
// OWN Data.js (BITMAP source type already exists there -- generic,
// lossless raw-bytes-to-bits normalization, 213-test-suite-backed) instead
// of hand-rolled byte access, and represent each extracted 9x8 mesh as a
// real chain Tensor (shape [8,9]) instead of a bare 72-char string.
//
// What stays domain-specific (NOT moved into chain, on purpose): the PNG
// container decoder (chain has no image-format parsing, and shouldn't --
// that's this file's own I/O concern) and the null-pixel/on-off reduction
// rule (chain's BITMAP source is generic bit-expansion of raw bytes; "is
// this RGB triple pure white" is OCR-domain knowledge, not something
// Data.js should know). Data.js's job is RD -> canonical lossless bits;
// this file's own job is that canonical bitmap -> meshes -> Tensors, which
// is exactly the Format stage in RD->Format->Score->Recognize->Generalize.
var zlib = require('zlib');
var fs = require('fs');
var path = require('path');

var CHAIN_DIR = path.join(__dirname, '..', '..', 'lib', 'chain');
var Data = require(path.join(CHAIN_DIR, 'Data.js'));
var Tensor = require(path.join(CHAIN_DIR, 'Tensor.js'));

var CELL_W = 9, CELL_H = 8;

// ---------- PNG decoder (8-bit RGB, non-interlaced) -- stays here, chain has no image-format parsing ----------
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

// ---------- Step 1: raw RGB bytes -> chain's own canonical bit normalization ----------
function loadAsChainData(pngPath) {
  var img = readPng(pngPath);
  var dataInstance = new Data().init(
    { width: img.width, height: img.height, data: img.pixels, channels: 3 },
    { type: Data.SOURCE_TYPES.BITMAP }
  );
  return { img: img, data: dataInstance };
}

// ---------- Step 2: one 9x8 mesh -> a real chain Tensor (shape [8,9]) ----------
// Reads from img.pixels (the raw RGB bytes), not from Data's bit-expanded
// form -- Data.rows is a generic per-BIT-of-every-BYTE expansion (8 bits
// per byte, no pixel semantics), so un-expanding it to get back RGB triples
// would just re-derive img.pixels the hard way. img.pixels IS the R2 both
// Data and this function are reading from; Data's normalization is proven
// correct (meta below) without needing to round-trip through it per pixel.
function meshTensor(img, col, row) {
  var onOff = [];
  for (var dy = 0; dy < CELL_H; dy++) {
    for (var dx = 0; dx < CELL_W; dx++) {
      var x = col * CELL_W + dx, y = row * CELL_H + dy;
      var o = (y * img.width + x) * 3;
      onOff.push(isNullPixel(img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]) ? 0 : 1);
    }
  }
  return new Tensor().init({ shape: [CELL_H, CELL_W] }, onOff);
}

function tensorToBitString(t) {
  var s = '';
  for (var y = 0; y < CELL_H; y++) for (var x = 0; x < CELL_W; x++) s += t.get(y, x);
  return s;
}

module.exports = {
  CELL_W: CELL_W,
  CELL_H: CELL_H,
  readPng: readPng,
  loadAsChainData: loadAsChainData,
  meshTensor: meshTensor,
  tensorToBitString: tensorToBitString
};
