# routed-gemm — compute the diagonal, not the grid

```
Y[b] = X[b] · W[route[b]]          b = 0..B-1
```

A dense implementation computes `X·W[e]` for **every** expert and then selects.
That is E times the arithmetic and E times the intermediate tensor. This
computes only the routed diagonal of the (token × expert) grid: gather rows by
expert, one dense matmul per expert, scatter back.

int8 × int8 → int32, AVX-512 VNNI, threading and gather/scatter internal.
Node binding via koffi.

```js
const { aligned, packWeights, routedGemm } = require('./routed-gemm');
const Wp = packWeights(W, K, N, E);              // once, at model load
routedGemm(X, Wp, route, Y, { B, K, N, E, threads: 4 });
```

## Measured

From Node, 4 threads, median of 3, every config verified exact against the
dense reference (not assumed — `bench.js` compares element-wise):

| | | | | | performed GOPS | | useful GOPS | | | |
| config | B | E | dense ms | routed ms | dense | routed | dense | routed | speedup | MB |
|---|---|---|---|---|---|---|---|---|---|---|
| Mixtral-ish | 720 | 8 | 207.0 | 26.1 | 233 | 231 | **29** | **231** | **7.9x** | 47.2 → 5.9 |
| fine-grained | 720 | 64 | 1825.6 | 44.9 | 212 | 135 | **3** | **135** | **40.7x** | 377.5 → 5.9 |
| Qwen-ish | 720 | 60 | 454.5 | 13.9 | 274 | 149 | **5** | **149** | **32.6x** | 243.3 → 4.1 |
| big batch | 4096 | 8 | 1207.3 | 172.0 | 228 | 200 | **28** | **200** | **7.0x** | 268.4 → 33.6 |

- **performed GOPS** — flops each path actually executes. A measure of kernel
  efficiency, and the two paths are *the same*: 212-274 dense, 135-231 routed.
  At E=64 the routed path is the **slower** kernel (135 vs 212) because 11-row
  per-expert blocks are inefficient.
- **useful GOPS** — `2·B·K·N / time`, the work the answer actually requires.
  Here they differ by 40x.

The dense path at E=64 sustains 212 GOPS of arithmetic and delivers 3 GOPS of
answer: **98.4% of what it computes is thrown away**, exactly (E-1)/E. This is
not a faster kernel. It is a slower kernel doing 64x less work, winning by 40x.

The intermediate is never allocated, never written, never read back. On a
GPU-less server that is DRAM bandwidth not spent, which is the binding
constraint for 7B inference below batch ~143.

## The constraint that matters

The flop saving is exactly E. The **time** saving is less when `B/E` gets
small, because each per-expert matmul shrinks: at B=720 and E=64 each expert
sees ~11 rows, and the routed path drops from ~238 GOPS to ~119. Keep roughly
128 rows per expert — `B >= 128·E` — or accept the degradation knowingly.

## Limits

- `topk = 1` only. Mixtral routes top-2 of 8, so the saving there is E/k = 4x,
  not 8x. The parameter is in the ABI; the gather-with-multiplicity is not
  implemented.
- `N` must be a multiple of 64, `K` a multiple of 4.
- Weights must be pre-packed with `packWeights` (VNNI layout, one block per
  expert). Static weights, so this is a load-time cost.

## Alignment

`index.js` aligns every buffer to 64 bytes before it crosses the FFI boundary.
Node returns allocations at `addr % 64 == 16` on x86_64 Linux, which straddles
a cache line on every 512-bit load and costs ~2x. Measured in
`research/gemm-node`; `probe-align.js` there checks any target.

## Where else this shape appears

Anywhere a full grid is computed to use one cell per row: per-token LoRA
adapters, speculative-decode verification, mixed quantization across a batch.
Same reshape, same diagonal, saving equals the variant count.
