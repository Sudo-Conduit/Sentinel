// Coverage of a HIERARCHICAL tile grid, which is what an image actually is.
//
// The first version of this file flattened 90x80 into one Z_90 x Z_80 torus,
// found gcd=10, and reported 10% max coverage as a hard constraint. That was
// the wrong object. 90x80 is (10*9) x (10*8): a 10x10 arrangement of 9x8
// tiles -- 100 cells of 9x8. It is the same two-level structure as the GEMM
// work queue, where MBLK x NBLK units each carry an internal ROWS x VEC
// register block, and nobody asks a single jump vector to cover both levels.
//
// So there are two independent walks and the gcd argument applies to each:
//   inner  within a tile, over C x R cells
//   outer  across tiles, over TC x TR tiles
// Composite coverage is the product. A level is fully walkable by a single
// jump vector iff its two dimensions are coprime (CRT: Z_a x Z_b is cyclic
// iff gcd(a,b)=1).
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const lcm = (a, b) => a / gcd(a, b) * b;

function coverage(C, R, sx, sy) {           // brute force, not algebra
  const seen = new Set(); let x = 0, y = 0;
  for (let t = 0; t < C * R; t++) {
    const k = y * C + x; if (seen.has(k)) break;
    seen.add(k); x = (x + sx) % C; y = (y + sy) % R;
  }
  return seen.size;
}
function best(C, R) {                        // best single jump vector
  let b = 0, n = 0;
  for (let sx = 0; sx < C; sx++) for (let sy = 0; sy < R; sy++) {
    if (!sx && !sy) continue;
    const c = coverage(C, R, sx, sy);
    if (c > b) { b = c; n = 0; }
    if (c === b) n++;
  }
  return { cov: b, n };
}

const cases = [
  ['9x8',   9, 8,  1,  1],
  ['90x8',  9, 8, 10,  1],
  ['90x80', 9, 8, 10, 10],
  ['81x64', 9, 8,  9,  8],      // tiles arranged 9x8 as well
];
console.log('grid    pixels  inner(9x8)        outer(tiles)        composite');
for (const [label, C, R, TC, TR] of cases) {
  const inner = best(C, R), outer = TC * TR === 1 ? { cov: 1, n: 1 } : best(TC, TR);
  const cells = C * R * TC * TR;
  const comp = inner.cov * outer.cov;
  const fmt = (o, t) => `${o.cov}/${t} ${(100 * o.cov / t).toFixed(0)}%`.padEnd(12);
  console.log(label.padEnd(8) + String(cells).padEnd(8)
    + fmt(inner, C * R) + '(' + inner.n + ' vec)  '
    + (TC * TR === 1 ? 'n/a (single)'.padEnd(12) + '        '
       : fmt(outer, TC * TR) + '(' + outer.n + ' vec)  ')
    + `${comp}/${cells} ${(100 * comp / cells).toFixed(0)}%`);
}
console.log('\nEvery level is 9x8 or a product of coprime dims -> every level is');
console.log('cyclic -> the composite walk covers everything. 10x10 (gcd 10) is the');
console.log('one arrangement above that is NOT cyclic at the outer level, so its');
console.log('outer walk needs a raster or a second generator -- but that costs');
console.log('nothing, because visiting all tiles is not the hard part. The inner');
console.log('walk is what has to be cyclic, and 9x8 always is.');
