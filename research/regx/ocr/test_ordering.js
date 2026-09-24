// Real Selection + Ordering, composed: scan the full 10x10 mesh field of
// 90x80_001_ng.png, apply the Base-3 null gate to get the SAME 9 active
// meshes as every earlier script (Selection), then compare four real
// Ordering strategies on that exact set by total Manhattan traversal
// distance (Ordering).
var path = require('path');
var IR = require('./image_reference.js');
var Ordering = require('./ordering.js');

var pngPath = path.join(__dirname, '90x80_001_ng.png');
var loaded = IR.loadAsChainData(pngPath);
var img = loaded.img;

var COLS = img.width / IR.CELL_W, ROWS = img.height / IR.CELL_H;

// ── Selection: same null gate as rgb_bm25.mjs -- active iff any non-null pixel ──
var active = [];
for (var row = 0; row < ROWS; row++) {
  for (var col = 0; col < COLS; col++) {
    var t = IR.meshTensor(img, col, row);
    var hasInk = false;
    t.forEach(function(v) { if (v === 1) hasInk = true; });
    if (hasInk) active.push({ col: col, row: row });
  }
}

console.log('Selection: ' + active.length + ' active meshes / ' + (COLS * ROWS) + ' total (' +
  (100 * (1 - active.length / (COLS * ROWS))).toFixed(0) + '% gated out before Ordering even runs)');
console.log('Active meshes: ' + active.map(function(m) { return '(' + m.col + ',' + m.row + ')'; }).join(' '));
console.log();

// ── Ordering: same active set, four strategies, real distance numbers ──
var strategies = {
  'row-major': Ordering.rowMajorOrder(active),
  'column-major': Ordering.columnMajorOrder(active),
  'diagonal-band': Ordering.diagonalOrder(active),
  'nearest-neighbor (greedy)': Ordering.nearestNeighborOrder(active, 0)
};

console.log('Ordering comparison (total Manhattan distance between consecutive visits -- lower = tighter locality):');
Object.keys(strategies).forEach(function(name) {
  var ordered = strategies[name];
  var dist = Ordering.totalTraversalDistance(ordered);
  var seq = ordered.map(function(m) { return '(' + m.col + ',' + m.row + ')'; }).join(' -> ');
  console.log('  ' + name.padEnd(26) + ' total=' + String(dist).padStart(3) + '   ' + seq);
});
