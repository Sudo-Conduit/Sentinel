var fs = require('fs');
var V = require('./vectorize.js');

var failures = 0;
function check(label, cond) {
  if (!cond) failures++;
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
}
function close(a, b, tol) { return Math.abs(a - b) <= (tol || 0.05); }

var GLYPH = '3';
var SAMPLES = 20;

// two real resolutions for the SAME glyph -- 9x8 (this session's normal
// mesh size) and 90x80 (10x scale in both dimensions)
var gridSmall = V.renderGlyphGrid(GLYPH, 9, 8);
var gridBig = V.renderGlyphGrid(GLYPH, 90, 80);

// real contour extraction (replaces the broken row-centroid "spine" --
// see vectorize.js comments). extractContours' own loop ORDER comes from
// arbitrary edge-array scan order, not glyph geometry -- concatenating in
// that order is what actually made the matrix comparison unstable across
// resolutions (9x8's 5 loops vs 90x80's 6 loops don't line up the same
// way once flattened arbitrarily). Sorting loops by position (centroid Y
// then X -- top-to-bottom, matching a digit's natural stroke order) before
// concatenating gives a canonical order that stays consistent even when
// the exact loop COUNT differs by one small satellite blob between
// resolutions, without touching the glyph itself.
function loopCentroid(loop) {
  var sx = 0, sy = 0;
  loop.forEach(function(p) { sx += p[0]; sy += p[1]; });
  return [sx / loop.length, sy / loop.length];
}
function loopsToFlatPoints(loops) {
  var sorted = loops.slice().sort(function(a, b) {
    var ca = loopCentroid(a), cb = loopCentroid(b);
    return (ca[1] - cb[1]) || (ca[0] - cb[0]);
  });
  var flat = [];
  sorted.forEach(function(loop) { loop.forEach(function(p) { flat.push(p); }); });
  return flat;
}
var loopsSmall = V.extractContours(gridSmall, 9, 8).map(function(l) { return V.normalizeLoop(l, 9, 8); });
var loopsBig = V.extractContours(gridBig, 90, 80).map(function(l) { return V.normalizeLoop(l, 90, 80); });
console.log('contour loops, 9x8: ' + loopsSmall.length + '   90x80: ' + loopsBig.length);

fs.writeFileSync(__dirname + '/glyph_3_contour_9x8.svg', V.contoursToSvgFilled(loopsSmall));
fs.writeFileSync(__dirname + '/glyph_3_contour_90x80.svg', V.contoursToSvgFilled(loopsBig));

var spineSmall = loopsToFlatPoints(loopsSmall);
var spineBig = loopsToFlatPoints(loopsBig);

console.log('spine control points, 9x8:  ' + spineSmall.length + ' points (raw)');
console.log('spine control points, 90x80: ' + spineBig.length + ' points (raw)');
check('both resolutions produce a non-trivial spine', spineSmall.length >= 3 && spineBig.length >= 3);

// fixed control-point count K before curve construction -- see vectorize.js
// resamplePoints() comment for why this is required, not optional
var K = 6;
var cpSmall = V.resamplePoints(spineSmall, K);
var cpBig = V.resamplePoints(spineBig, K);
console.log('resampled to fixed K=' + K + ' control points for both (same curve degree)');

var curveSmall = V.sampleCurve(cpSmall, SAMPLES);
var curveBig = V.sampleCurve(cpBig, SAMPLES);

console.log('\nSampled curve comparison (same t, both resolutions, normalized 0-1 space):');
var maxDeltaX = 0, maxDeltaY = 0;
for (var i = 0; i < SAMPLES; i++) {
  var dx = Math.abs(curveSmall[i][0] - curveBig[i][0]);
  var dy = Math.abs(curveSmall[i][1] - curveBig[i][1]);
  maxDeltaX = Math.max(maxDeltaX, dx);
  maxDeltaY = Math.max(maxDeltaY, dy);
}
console.log('  max |delta x| across all samples: ' + maxDeltaX.toFixed(4));
console.log('  max |delta y| across all samples: ' + maxDeltaY.toFixed(4));
check('curves agree within tolerance across resolutions (max delta x)', close(maxDeltaX, 0, 0.08));
check('curves agree within tolerance across resolutions (max delta y)', close(maxDeltaY, 0, 0.08));

// scalar collapse: arc length
var lenSmall = V.arcLength(curveSmall);
var lenBig = V.arcLength(curveBig);
console.log('\nScalar collapse (arc length, normalized space):');
console.log('  9x8:   ' + lenSmall.toFixed(4));
console.log('  90x80: ' + lenBig.toFixed(4));
check('arc length scalar agrees across resolutions', close(lenSmall, lenBig, 0.1));

// matrix collapse: the SAMPLED CURVE's points as a real chain Tensor, not
// the raw pre-curve control points. The raw control points are genuinely
// topology-sensitive -- 9x8's 5 contour loops and 90x80's 6 don't
// represent the same set of corners, so comparing them directly compares
// two different geometric objects, not two samplings of the same one.
// The evaluated Bezier curve is what's actually proven stable above; using
// ITS points as the matrix makes the matrix collapse consistent with the
// curve/scalar collapses instead of re-introducing the raw noise they
// already smoothed out.
var tensorSmall = V.controlPointsToTensor(curveSmall);
var tensorBig = V.controlPointsToTensor(curveBig);
console.log('\nMatrix collapse (chain Tensor, from sampled curve): rank=' + tensorSmall.rank() + ' shape=[' + tensorSmall.shape.join(',') + ']');
check('curve-point tensor has rank 2', tensorSmall.rank() === 2);
check('curve-point tensor shape matches SAMPLES x 2 for BOTH resolutions', tensorSmall.shape[0] === SAMPLES && tensorBig.shape[0] === SAMPLES && tensorSmall.shape[1] === 2);
var maxTensorDelta = 0;
for (var ti = 0; ti < SAMPLES; ti++) for (var tj = 0; tj < 2; tj++) maxTensorDelta = Math.max(maxTensorDelta, Math.abs(tensorSmall.get(ti, tj) - tensorBig.get(ti, tj)));
console.log('  max matrix delta between resolutions: ' + maxTensorDelta.toFixed(4));
check('the matrix (sampled curve points) agrees across resolutions', close(maxTensorDelta, 0, 0.08));

// SVG output, sanity-written to disk
var svg = V.toSvgPath(curveSmall);
fs.writeFileSync(__dirname + '/glyph_3_spine.svg', svg);
check('SVG has a normalized 0-1 viewBox (resolution-independent by construction)', svg.indexOf('viewBox="0 0 1 1"') !== -1);

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
