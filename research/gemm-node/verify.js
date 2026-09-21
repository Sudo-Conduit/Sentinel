/**
 * Correctness check for libgemm.so — compares the VNNI kernel against a scalar
 * reference on real values. Run before trusting any timing number from main.js.
 */
const koffi = require('koffi');
const lib   = koffi.load(__dirname + '/libgemm.so');
const pack  = lib.func('void pack_b(const int8_t*,int8_t*,int,int)');
const gemm  = lib.func('void gemm_rows(const uint8_t*,const int8_t*,int32_t*,int,int,int,int,int)');
const addr  = lib.func('uintptr_t addr_of(void*)');

const ALIGN = 64;
function aligned(n){
  const s = new SharedArrayBuffer(n + ALIGN);
  const off = (ALIGN - Number(BigInt(addr(Buffer.from(s))) % BigInt(ALIGN))) % ALIGN;
  return Buffer.from(s, off, n);
}
const M = 37, K = 576, N = 576;                 // deliberately non-round M
const A = aligned(M*K), B = aligned(K*N), Q = aligned(K*N), C = aligned(M*N*4);
for (let i=0;i<A.length;i++) A[i] = (i*7) % 251;
for (let i=0;i<B.length;i++) B.writeInt8(((i*13) % 255) - 127, i);
pack(B, Q, K, N);
gemm(A, Q, C, M, K, N, 0, M);

let bad = 0;
for (const [i,j] of [[0,0],[0,3],[1,17],[M-1,N-1],[19,256],[5,575]]) {
  let ref = 0;
  for (let k=0;k<K;k++) ref += A[i*K+k] * B.readInt8(k*N+j);
  const got = C.readInt32LE((i*N+j)*4);
  if (got !== ref) { console.error(`MISMATCH C[${i},${j}] got ${got} want ${ref}`); bad++; }
}
console.log(bad ? `FAIL (${bad} mismatches)` : 'PASS — kernel matches scalar reference at all probes');
process.exit(bad ? 1 : 0);
