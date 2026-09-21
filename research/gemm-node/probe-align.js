/**
 * probe-align.js — does Node's allocator land where your SIMD loads care?
 *
 *   npm i koffi && node probe-align.js
 *
 * Reports three facts and whether they collide: the allocator's offset,
 * your cache line size, and the load widths that matter per ISA.
 * No benchmark, no load on the machine.
 */
const koffi = require('koffi');
const { execSync } = require('child_process');

const lineSize = () => {
  try {
    return process.platform === 'darwin'
      ? +execSync('sysctl -n hw.cachelinesize').toString().trim()
      : +execSync('cat /sys/devices/system/cpu/cpu0/cache/index0/coherency_line_size').toString().trim();
  } catch { return null; }
};
const L = lineSize() || 64;
const addr = b => BigInt(koffi.address(b));

console.log(`\nplatform ${process.platform} ${process.arch}   node ${process.version}   cache line = ${L} B\n`);

const allocators = {
  'Buffer.alloc':            n => Buffer.alloc(n),
  'Buffer.allocUnsafe':      n => Buffer.allocUnsafe(n),
  'Buffer.allocUnsafeSlow':  n => Buffer.allocUnsafeSlow(n),
  'SharedArrayBuffer':       n => Buffer.from(new SharedArrayBuffer(n)),
  'ArrayBuffer':             n => Buffer.from(new ArrayBuffer(n)),
};
const loads = [
  ['NEON / SDOT / BDOT', 16],
  ['SVE / SME (SVL=512b)', 64],
  ['AVX-512 / AMX tile row', 64],
];

// a load of width w starting at offset o crosses a line iff o+w > L
const straddles = (o, w) => o !== 0 && (o % L) + w > L;

const width = Math.max(...Object.keys(allocators).map(s => s.length));
console.log(`${'allocator'.padEnd(width)}  ${('addr%' + L).padStart(8)}`);
const offsets = new Set();
for (const [name, mk] of Object.entries(allocators)) {
  const seen = new Set();
  for (const n of [1 << 16, 1 << 20, 1 << 22]) seen.add(Number(addr(mk(n)) % BigInt(L)));
  [...seen].forEach(o => offsets.add(o));
  console.log(`${name.padEnd(width)}  ${[...seen].join(',').padStart(8)}`);
}

console.log(`\n${'load'.padEnd(24)} ${'width'.padStart(6)}   straddles a cache line?`);
for (const [name, w] of loads) {
  const bad = [...offsets].filter(o => straddles(o, w));
  console.log(`${name.padEnd(24)} ${(w + ' B').padStart(6)}   ` +
    (bad.length ? `YES at offset ${bad.join(',')}  -> align, ~2x on the table`
                : `no  -> nothing to fix`));
}

const worst = [...offsets].find(o => loads.some(([, w]) => straddles(o, w)));
console.log(worst === undefined
  ? `\nVERDICT: your buffers are fine as-is on this platform.\n`
  : `\nVERDICT: align buffers before handing them to a SIMD kernel:
  const s   = new SharedArrayBuffer(n + ${L});
  const off = (${L} - Number(BigInt(koffi.address(Buffer.from(s))) % ${L}n)) % ${L};
  const buf = Buffer.from(s, off, n);     // hand THIS to the kernel
  // workers: pass \`off\` in workerData and rebuild the same view\n`);
