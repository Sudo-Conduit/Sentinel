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

| config | B | E | dense ms | routed ms | **dense-equiv GFLOPS** | GB/s not moved | speedup |
|---|---|---|---|---|---|---|---|
| Mixtral-ish | 720 | 8 | 233.5 | 32.2 | **1,502** | 1.3 | 7.3x |
| fine-grained | 720 | 64 | 1907.3 | 45.8 | **8,433** | 8.1 | 41.6x |
| Qwen-ish | 720 | 60 | 412.2 | 12.8 | **9,766** | 18.8 | 32.3x |
| big batch | 4096 | 8 | 1203.3 | 184.6 | **1,489** | 1.3 | 6.5x |

**dense-equiv GFLOPS** = `2·B·E·K·N / routed_time` — the arithmetic a dense
implementation *must* perform to produce the same answer, over the time the
routed op actually took. **GB/s not moved** = the intermediate tensor never
allocated, written, or read back.

For scale: this box measures **230-270 GOPS** on a plain dense int8 GEMM. The
routed op delivers **9,766 GFLOPS-equivalent** on the same four cores — about
36x its own dense ceiling. The silicon did not get faster; the work was not
done.

Caveat on that number: it is measured against a *naive dense* MoE. A production
GPU MoE kernel also routes, so this is not 9.8 TF against a GPU at its best —
it is 9.8 TF against the implementation most stacks ship. That is the
commercially relevant comparison, not a silicon one.

Raw rates, for honesty about what the kernel itself is doing: performed GOPS
are 212-274 dense and 135-231 routed. At E=64 the routed path is the **slower**
kernel (135 vs 212) because 11-row per-expert blocks are inefficient. It wins
by 41x anyway, because the dense path throws away (E-1)/E = **98.4%** of what
it computes.

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
