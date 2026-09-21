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

| config | B | E | dense | routed | speedup | dense MB | routed MB |
|---|---|---|---|---|---|---|---|
| Mixtral-ish | 720 | 8 | 184.5 ms | 24.9 ms | **7.4x** | 47.2 | 5.9 |
| fine-grained | 720 | 64 | 2325.9 ms | 47.4 ms | **49.1x** | 377.5 | 5.9 |
| Qwen-ish | 720 | 60 | 473.9 ms | 14.6 ms | **32.4x** | 243.3 | 4.1 |
| big batch | 4096 | 8 | 1389.7 ms | 134.7 ms | **10.3x** | 268.4 | 33.6 |

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
