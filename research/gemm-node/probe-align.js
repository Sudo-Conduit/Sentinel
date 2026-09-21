/**
 * probe-align.js — measure how Node's allocator actually lands, on THIS machine.
 * No benchmark, no load. Run on each target (x86 Linux, Apple ARM) before
 * assuming any alignment constant.
 *
 *   npm i koffi && node probe-align.js
 */
const koffi = require('koffi');
const { execSync } = require('child_process');

// tiny inline lib just to read back a real pointer value
const os = process.platform;
const libm = koffi.load(os === 'darwin' ? 'libSystem.dylib' : 'libc.so.6');
const memcpy = libm.func('void *memcpy(void *, const void *, size_t)');
const ptrOf = b => BigInt(koffi.address(b));      // koffi exposes the address directly

function lineSize() {
  try {
    if (os === 'darwin') return +execSync('sysctl -n hw.cachelinesize').toString().trim();
    return +execSync('cat /sys/devices/system/cpu/cpu0/cache/index0/coherency_line_size').toString().trim();
  } catch { return null; }
}
const L = lineSize() || 64;
console.log(`platform ${os} ${process.arch}   cache line = ${L} B   node ${process.version}\n`);

const kinds = {
  'Buffer.alloc(1MB)':        () => Buffer.alloc(1 << 20),
  'Buffer.allocUnsafe(1MB)':  () => Buffer.allocUnsafe(1 << 20),
  'Buffer.allocUnsafeSlow':   () => Buffer.allocUnsafeSlow(1 << 20),
  'SharedArrayBuffer(1MB)':   () => Buffer.from(new SharedArrayBuffer(1 << 20)),
  'ArrayBuffer(1MB)':         () => Buffer.from(new ArrayBuffer(1 << 20)),
};
// vector widths that matter per ISA
const loads = { 'NEON/SDOT 16B': 16, 'SVE/SME 64B': 64, 'AVX-512 64B': 64 };

console.log(`${'allocator'.padEnd(26)} ${('addr%'+L).padStart(8)}   straddle risk for a load of...`);
for (const [name, mk] of Object.entries(kinds)) {
  const offs = [];
  for (let i = 0; i < 8; i++) offs.push(Number(ptrOf(mk()) % BigInt(L)));   // sample, allocators vary
  const uniq = [...new Set(offs)];
  const risk = Object.entries(loads)
    .filter(([, w]) => w <= L)
    .map(([n, w]) => `${n}:${uniq.some(o => o !== 0 && (o % w !== 0 || o + w > L)) ? 'YES' : 'no '}`)
    .join('  ');
  console.log(`${name.padEnd(26)} ${uniq.join(',').padStart(8)}   ${risk}`);
}
console.log(`\nAligned view costs one over-allocation of ${L} B:`);
console.log(`  const s = new SharedArrayBuffer(n + ${L});`);
console.log(`  const off = (${L} - Number(koffi.address(Buffer.from(s)) % ${L}n)) % ${L};`);
console.log(`  const buf = Buffer.from(s, off, n);          // hand THIS to the kernel`);
