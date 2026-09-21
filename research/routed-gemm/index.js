/* routed-gemm — Node binding for the routed-diagonal op.
 *
 *   Y[b] = X[b] · W[route[b]]
 *
 * Buffers are 64-byte aligned before crossing the FFI boundary: Node hands
 * back allocations at addr%64 == 16 on x86_64 Linux, which straddles a cache
 * line on every 512-bit load and costs ~2x. See research/gemm-node.
 */
const koffi = require('koffi');
const lib = koffi.load(__dirname + '/libroutedgemm.so');

const addr = b => BigInt(koffi.address(b));
const ALIGN = 64;
function aligned(n) {
  const sab = new SharedArrayBuffer(n + ALIGN);
  const off = Number((BigInt(ALIGN) - (addr(Buffer.from(sab)) % BigInt(ALIGN))) % BigInt(ALIGN));
  return Buffer.from(sab, off, n);
}

const _routed = lib.func('int routed_gemm(const uint8_t*, const int8_t*, const int*, int32_t*, int,int,int,int,int,int)');
const _dense  = lib.func('int dense_gemm (const uint8_t*, const int8_t*, const int*, int32_t*, int,int,int,int,int,int)');
const _packW  = lib.func('void pack_w(const int8_t*, int8_t*, int,int,int)');

/** Pack E expert weight matrices into the VNNI layout. Do this once at load. */
function packWeights(W, K, N, E) { const Q = aligned(E*K*N); _packW(W, Q, K, N, E); return Q; }

/** Y[b] = X[b] · W[route[b]]. Computes only the routed diagonal. */
function routedGemm(X, Wp, route, Y, {B, K, N, E, topk = 1, threads = 4}) {
  const rc = _routed(X, Wp, route, Y, B, K, N, E, topk, threads);
  if (rc) throw new Error(`routed_gemm returned ${rc}`);
  return Y;
}
/** Reference: every token against every expert, then select. E times the work. */
function denseGemm(X, Wp, route, Y, {B, K, N, E, topk = 1, threads = 4}) {
  const rc = _dense(X, Wp, route, Y, B, K, N, E, topk, threads);
  if (rc) throw new Error(`dense_gemm returned ${rc}`);
  return Y;
}
module.exports = { aligned, packWeights, routedGemm, denseGemm };
