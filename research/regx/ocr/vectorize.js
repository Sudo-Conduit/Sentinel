// ─── vectorize.js — Phase 5: SVG/curve generalization, matrix, scalar ──
//
// Generalizes a recognized glyph's raster shape into a resolution-
// independent Bezier curve, built on research/lib/chain's REAL, tested
// Bezier.js (Bernstein/De Casteljau, cross-validated against itself in
// its own 213-test suite) -- not a hand-rolled curve fitter. That curve
// then collapses two ways, per the "even the SVG becomes a matrix or a
// scalar" architecture point:
//   - matrix: the normalized control points themselves (a chain Tensor)
//   - scalar: the curve's total arc length (one number)
//
// Shape extraction is deliberately simple and honest about its scope:
// for each pixel ROW that has any "on" pixel, take the centroid x of the
// "on" pixels in that row. That's a real, deterministic point sequence
// tracing the glyph's vertical spine -- not a production autotrace, but
// enough to test the actual claim this phase exists to test: does the
// SAME normalized curve come out whether the source bitmap is 9x8 or
// scaled up 10x. Full contour tracing is future scope, not needed to
// prove the architecture.
var path = require('path');
var CHAIN_DIR = path.join(__dirname, '..', '..', 'lib', 'chain');
var Bezier = require(path.join(CHAIN_DIR, 'Bezier.js'));
var Tensor = require(path.join(CHAIN_DIR, 'Tensor.js'));

// single source of truth -- frontend_ocr.js's own FONT_5x7, not a separate
// copy. Two copies is exactly how the '3' connectivity fix could silently
// drift out of sync between recognition and vectorization.
var FONT_5x7 = require('./frontend_ocr.js').FONT_5x7;

// Renders glyphChar into a (cellW x cellH) on/off grid, at ANY scale --
// generalizes frontend_ocr.js's canonicalBits (always exactly 9x8) to an
// arbitrary target size, so the same glyph can be tested at 9x8 and, say,
// 90x80 (10x scale) to check for real resolution independence.
function renderGlyphGrid(glyphChar, cellW, cellH) {
  var rows = FONT_5x7[glyphChar];
  if (!rows) throw new Error('no known glyph "' + glyphChar + '"');
  var grid = [];
  for (var y = 0; y < cellH; y++) { var row = []; for (var x = 0; x < cellW; x++) row.push(0); grid.push(row); }

  var fontW = rows[0].length, fontH = rows.length;
  var marginXFrac = 2 / 9, marginYFrac = 1 / 8; // same proportional centering as the 9x8 canonical
  var scaleX = (cellW * (1 - 2 * marginXFrac)) / fontW;
  var scaleY = (cellH * (1 - 2 * marginYFrac)) / fontH;
  var originX = cellW * marginXFrac, originY = cellH * marginYFrac;

  for (var r = 0; r < fontH; r++) {
    for (var c = 0; c < fontW; c++) {
      if (rows[r][c] !== '1') continue;
      var x0 = Math.round(originX + c * scaleX), x1 = Math.round(originX + (c + 1) * scaleX);
      var y0 = Math.round(originY + r * scaleY), y1 = Math.round(originY + (r + 1) * scaleY);
      for (var yy = y0; yy < Math.max(y1, y0 + 1); yy++) {
        for (var xx = x0; xx < Math.max(x1, x0 + 1); xx++) {
          if (yy >= 0 && yy < cellH && xx >= 0 && xx < cellW) grid[yy][xx] = 1;
        }
      }
    }
  }
  return grid;
}

// SUPERSEDED: row-centroid extraction. Averaging a row's "on" x-positions
// into one point breaks the moment a row has two separate strokes -- '3'
// row 5 is "10001" (ink at x=0 and x=4, nothing between), and the centroid
// lands at x=2, a phantom point with no ink at all. That produced a smooth
// blob, not a '3' -- consistent between resolutions (both wrong the same
// way), but not correct. Kept only as the documented reason extractContour
// replaced it, not for use.
function extractNormalizedSpine(grid, width, height) {
  var points = [];
  for (var y = 0; y < height; y++) {
    var sumX = 0, count = 0;
    for (var x = 0; x < width; x++) if (grid[y][x] === 1) { sumX += x; count++; }
    if (count > 0) points.push([(sumX / count) / (width - 1), y / (height - 1)]);
  }
  return points;
}

// Real pixel-boundary contour tracing: for every "on" cell, each side
// touching an "off" (or out-of-grid) neighbor is a boundary edge, given a
// consistent winding (clockwise, y-down). Collecting all such edges and
// walking them corner-to-corner reconstructs the exact outline(s) of the
// "on" region -- handles disconnected strokes and enclosed holes (e.g. 'A')
// correctly, because it traces what's actually there instead of averaging
// row contents into a single point.
function extractContours(grid, width, height) {
  var edges = []; // [[x0,y0],[x1,y1]]
  function isOn(x, y) { return x >= 0 && x < width && y >= 0 && y < height && grid[y][x] === 1; }
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      if (!isOn(x, y)) continue;
      if (!isOn(x, y - 1)) edges.push([[x, y], [x + 1, y]]);         // top
      if (!isOn(x + 1, y)) edges.push([[x + 1, y], [x + 1, y + 1]]); // right
      if (!isOn(x, y + 1)) edges.push([[x + 1, y + 1], [x, y + 1]]); // bottom
      if (!isOn(x - 1, y)) edges.push([[x, y + 1], [x, y]]);         // left
    }
  }

  function key(p) { return p[0] + ',' + p[1]; }
  var fromPoint = {}; // point key -> list of edge indices starting there
  edges.forEach(function(e, i) {
    var k = key(e[0]);
    (fromPoint[k] = fromPoint[k] || []).push(i);
  });

  var used = new Array(edges.length).fill(false);
  var loops = [];
  for (var start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    var loop = [edges[start][0]];
    var cur = start;
    while (!used[cur]) {
      used[cur] = true;
      var next = edges[cur][1];
      loop.push(next);
      var candidates = (fromPoint[key(next)] || []).filter(function(i) { return !used[i]; });
      if (candidates.length === 0) break;
      cur = candidates[0];
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

function normalizeLoop(loop, width, height) {
  return loop.map(function(p) { return [p[0] / width, p[1] / height]; });
}

// Resamples an ordered point list to exactly K points, evenly spaced by
// cumulative arc length along the original polyline. Necessary because a
// Bezier curve's DEGREE is (control-point-count - 1) -- feeding it a raw,
// resolution-dependent number of points (6 at 9x8, 60 at 90x80) produces
// two structurally different curves, not the same shape at two samplings.
// Fixing the control-point count to K before curve construction is what
// actually makes the downstream curve/matrix/scalar resolution-independent.
function resamplePoints(points, K) {
  if (points.length === K) return points.slice();
  if (points.length === 1) { var p = points[0]; return Array(K).fill(0).map(function() { return [p[0], p[1]]; }); }
  var cum = [0];
  for (var i = 1; i < points.length; i++) {
    var dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1];
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  var total = cum[cum.length - 1];
  var out = [];
  for (var k = 0; k < K; k++) {
    var target = total === 0 ? 0 : (total * k) / (K - 1);
    var seg = 0;
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    var segLen = cum[seg + 1] - cum[seg];
    var frac = segLen === 0 ? 0 : (target - cum[seg]) / segLen;
    out.push([
      points[seg][0] + frac * (points[seg + 1][0] - points[seg][0]),
      points[seg][1] + frac * (points[seg + 1][1] - points[seg][1])
    ]);
  }
  return out;
}

function sampleCurve(controlPoints, numSamples) {
  var samples = [];
  for (var i = 0; i < numSamples; i++) {
    var t = i / (numSamples - 1);
    samples.push(Bezier.evaluate(controlPoints, t));
  }
  return samples;
}

function arcLength(samples) {
  var total = 0;
  for (var i = 1; i < samples.length; i++) {
    var dx = samples[i][0] - samples[i - 1][0], dy = samples[i][1] - samples[i - 1][1];
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

// The "matrix" collapse: a real chain Tensor from a point list. Callers
// should pass the SAMPLED CURVE (sampleCurve's output), not the raw
// pre-curve control points -- the raw control points are genuinely
// topology-sensitive (a glyph's contour can decompose into a different
// number of loops at different rasterization scales, e.g. 5 loops at 9x8
// vs 6 at 90x80 for the same '3', from rounding on thin diagonal strokes),
// so they represent a different geometric object at each resolution, not
// two samplings of the same one. The evaluated Bezier curve smooths that
// away and is what's actually resolution-independent; use its points here.
function controlPointsToTensor(points) {
  var flat = [];
  points.forEach(function(p) { flat.push(p[0], p[1]); });
  return new Tensor().init({ shape: [points.length, 2] }, flat);
}

// Minimal SVG <path> (cubic-ish polyline via straight segments between
// sampled curve points -- the generalization claim being tested is
// resolution independence of the underlying curve, not path-command
// minimality) for visual sanity-checking, normalized viewBox so it
// renders identically at any output size.
function toSvgPath(samples) {
  var d = samples.map(function(p, i) {
    return (i === 0 ? 'M ' : 'L ') + p[0].toFixed(4) + ' ' + p[1].toFixed(4);
  }).join(' ');
  return '<svg viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg"><path d="' + d + '" fill="none" stroke="black" stroke-width="0.02"/></svg>';
}

// Filled-outline SVG from one or more closed contour loops -- supports
// multiple sub-paths so a shape with a real hole (e.g. 'A') renders
// correctly via the default nonzero fill rule.
function contoursToSvgFilled(loops) {
  var d = loops.map(function(loop) {
    return loop.map(function(p, i) { return (i === 0 ? 'M ' : 'L ') + p[0].toFixed(4) + ' ' + p[1].toFixed(4); }).join(' ') + ' Z';
  }).join(' ');
  return '<svg width="300" height="300" viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="0" y="0" width="1" height="1" fill="white"/>' +
    '<path d="' + d + '" fill="black"/></svg>';
}

module.exports = {
  FONT_5x7: FONT_5x7,
  renderGlyphGrid: renderGlyphGrid,
  extractNormalizedSpine: extractNormalizedSpine,
  extractContours: extractContours,
  normalizeLoop: normalizeLoop,
  resamplePoints: resamplePoints,
  sampleCurve: sampleCurve,
  arcLength: arcLength,
  controlPointsToTensor: controlPointsToTensor,
  toSvgPath: toSvgPath,
  contoursToSvgFilled: contoursToSvgFilled
};
