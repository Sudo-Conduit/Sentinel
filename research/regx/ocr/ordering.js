// ─── ordering.js — the other half of Selection/Ordering ───────────────
//
// Selection (the Base-3 null gate, already built) decides WHICH meshes get
// touched. Ordering decides the SEQUENCE they're visited in, independent
// of which ones were selected -- same duality as the routed-gemm work
// (diagonal traversal optimal for selection, worst for ordering/cache
// reuse). This file only orders an already-selected (active) mesh list;
// it never re-decides which meshes are active.
//
// Honest scope note: at this dataset's real size (9 active meshes,
// ~14us/call recognize()), an actual wall-clock timing difference between
// orderings would be noise -- V8/JS call overhead dominates completely at
// this N. What's real and measurable here is spatial locality itself:
// total Manhattan distance between consecutively-visited mesh coordinates,
// a genuine proxy for cache-friendliness (smaller = tighter locality),
// not a fabricated timing claim this scale can't actually produce.

function manhattan(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function totalTraversalDistance(orderedMeshes) {
  var total = 0;
  for (var i = 1; i < orderedMeshes.length; i++) total += manhattan(orderedMeshes[i - 1], orderedMeshes[i]);
  return total;
}

function rowMajorOrder(meshes) {
  return meshes.slice().sort(function(a, b) { return (a.row - b.row) || (a.col - b.col); });
}

function columnMajorOrder(meshes) {
  return meshes.slice().sort(function(a, b) { return (a.col - b.col) || (a.row - b.row); });
}

function diagonalOrder(meshes) {
  // sorted by (col+row) "anti-diagonal band", then by col within a band --
  // matches the diagonal-selection pattern from the routed-gemm precedent
  return meshes.slice().sort(function(a, b) { return (a.col + a.row) - (b.col + b.row) || (a.col - b.col); });
}

// Greedy nearest-neighbor: always step to the closest unvisited mesh.
// A real (if heuristic) locality-minimizing order, not just a label --
// this is the one actually trying to minimize totalTraversalDistance.
function nearestNeighborOrder(meshes, startIndex) {
  var remaining = meshes.slice();
  var start = remaining.splice(startIndex || 0, 1)[0];
  var ordered = [start];
  var current = start;
  while (remaining.length) {
    var bestIdx = 0, bestDist = Infinity;
    for (var i = 0; i < remaining.length; i++) {
      var d = manhattan(current, remaining[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    current = remaining.splice(bestIdx, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

module.exports = {
  manhattan: manhattan,
  totalTraversalDistance: totalTraversalDistance,
  rowMajorOrder: rowMajorOrder,
  columnMajorOrder: columnMajorOrder,
  diagonalOrder: diagonalOrder,
  nearestNeighborOrder: nearestNeighborOrder
};
