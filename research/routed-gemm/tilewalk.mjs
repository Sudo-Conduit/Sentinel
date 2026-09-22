// Brute force, not algebra: for every jump vector on each grid, walk the
// torus from (0,0) and count unique cells before it repeats. CORE 003's
// Coverage Ratio, computed exhaustively.
const gcd = (a,b) => b ? gcd(b, a%b) : a;
function coverage(C, R, sx, sy) {
  const seen = new Set(); let x = 0, y = 0;
  for (let t = 0; t < C*R; t++) {
    const k = y*C + x; if (seen.has(k)) break;
    seen.add(k); x = (x+sx) % C; y = (y+sy) % R;
  }
  return seen.size;
}
// Predicted order of (sx,sy) in Z_C x Z_R
const lcm = (a,b) => a / gcd(a,b) * b;
const predict = (C,R,sx,sy) => lcm(C/gcd(sx,C), R/gcd(sy,R));

for (const [C,R,label] of [[9,8,'9x8'],[90,8,'90x8'],[90,80,'90x80']]) {
  const N = C*R; let best = 0, nFull = 0, mismatch = 0; const bestVecs = [];
  for (let sx = 0; sx < C; sx++) for (let sy = 0; sy < R; sy++) {
    if (sx === 0 && sy === 0) continue;
    const cov = coverage(C,R,sx,sy);
    if (cov !== predict(C,R,sx,sy)) mismatch++;
    if (cov > best) { best = cov; bestVecs.length = 0; }
    if (cov === best && bestVecs.length < 6) bestVecs.push(`(${sx},${sy})`);
    if (cov === N) nFull++;
  }
  console.log(`${label.padEnd(6)} cells=${String(N).padEnd(5)} gcd(C,R)=${gcd(C,R)}  `
    + `max coverage ${best}/${N} = ${(100*best/N).toFixed(1)}%  `
    + `hamiltonian vectors: ${nFull}  e.g. ${bestVecs.join(' ')}`
    + (mismatch ? `  [${mismatch} disagree with lcm formula]` : '  [lcm formula exact]'));
}
console.log('\nWhy: (sx,sy) generates a CYCLIC subgroup of Z_C x Z_R, whose order is');
console.log('lcm(C/gcd(sx,C), R/gcd(sy,R)). That can reach C*R only when Z_C x Z_R is');
console.log('itself cyclic, i.e. gcd(C,R)=1 -- the Chinese Remainder Theorem.');
console.log('9x8: gcd=1, so Z_9 x Z_8 = Z_72 and 72 = 0 (mod 72) is the whole point of');
console.log('9x8_Matrix.html. 90x8 (gcd 2) and 90x80 (gcd 10) are NOT cyclic and no');
console.log('single jump vector can ever be a Hamiltonian cycle on them.');
