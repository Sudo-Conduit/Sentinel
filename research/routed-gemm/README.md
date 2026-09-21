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

## Which engine to route it through

The routed op hands the backend E short dense matmuls instead of one tall one,
so the only question that matters about a backend is: **what happens to its
rate when the block gets short?** `engines.c` answers it directly — total rows
held fixed at 720, `K=N=2048`, single thread, only the rows-per-block varied,
every backend verified against the plain-C baseline before being timed.

`node engines.js`, median of 5 x best-of-3:

| rows/block | E implied | code | VNNI | BLAS | BLAS batch | AMX |
|---|---|---|---|---|---|---|
| 720 | 1 | 22.5 (100%) | 61.3 (100%) | 120.2 (100%) | 117.9 (100%) | n/a |
| 90 | 8 | 22.4 (99%) | 62.6 (102%) | 79.0 (66%) | 78.8 (67%) | n/a |
| 45 | 16 | 22.4 (99%) | 60.3 (98%) | 57.4 (48%) | 54.4 (46%) | n/a |
| 16 | 45 | 22.4 (100%) | 61.0 (99%) | 30.2 (25%) | 30.4 (26%) | n/a |
| 12 | 60 | 22.4 (99%) | 56.8 (93%) | 24.6 (20%) | 25.8 (22%) | n/a |
| 6 | 120 | 22.4 (99%) | 55.4 (90%) | 12.1 (10%) | 12.5 (11%) | n/a |
| 3 | 240 | 22.4 (99%) | 63.3 (103%) | 7.4 (6%) | 6.7 (6%) | n/a |
| 1 | 720 | 22.4 (100%) | 59.2 (97%) | 2.8 (2%) | 3.4 (3%) | n/a |

code and VNNI are int8 GOPS; BLAS is fp32 GFLOPS. The **percentages** are each
engine against its own one-block rate, and those *are* comparable across
engines — that column is the whole finding. AMX is `n/a` because this box has
`avx512_vnni` and no AMX-INT8; the kernel is compiled in and gated at runtime
on both the CPUID bit and the kernel's `XTILEDATA` grant, so running the same
binary on the AMX box fills the column.

BLAS is not on our side here. It has the highest peak of anything measured —
120 GFLOPS, double the VNNI kernel — and the steepest cliff: **2% of its own
dense rate at one row per block.** Batched BLAS does not rescue it.
`cblas_sgemm_batch` was given all 720 GEMMs in a single call, with the group
descriptors built once outside the timing loop, and landed at 3.4 — inside
noise of the 2.8 it was supposed to fix. The per-call cost is not call
overhead, so batching cannot amortize it.

What it *is*: re-streaming the weight matrix. Hold the block at one row and
shrink `K=N` instead —

| K=N | bytes in B | 720 rows/block | 1 row/block | retained |
|---|---|---|---|---|
| 2048 | 16 MB | 118.7 | 2.9 | 2% |
| 512 | 1 MB | 113.1 | 41.2 | 36% |
| 128 | 64 KB | 111.4 | 51.1 | 46% |

The cliff tracks the size of `B`, not the number of calls. A blocked GEMM pays
`O(K·N)` to pack and stream the weights and amortizes it over the rows in the
block; give it one row and it pays the whole thing for one row of output. This
OpenBLAS exports no `sgemm_pack`/`sgemm_compute` pair, so there is no way to
hoist that cost out of the call from the outside.

**So the flatness is not an ISA property — it is whether the kernel amortizes
the weight matrix across rows.** This VNNI kernel does not. It re-streams `B`
for every row at every block size, which is exactly why it is stuck at 62 GOPS
when BLAS reaches 120, and exactly why it has nothing left to lose when the
block goes to one row. Flat and lower beats steep and higher below the
crossover, and the crossover here is ~45 rows per block.

Where the ISA does come in is which of the two kernels is natural to write.
`VPDPBUSD` broadcasts a 4-byte scalar from A against a 512-bit vector of B, so
the row dimension is an ordinary loop — a non-amortizing kernel is the obvious
one, and a one-row block is a first-class case. AMX's `TDPBSSD` consumes a
16x64 tile; a one-row block cannot be expressed without discarding 15/16 of
the tile, so on AMX the amortizing kernel is the only sensible one and the
cliff should look like the BLAS column. That is a prediction, not a
measurement — this box cannot run it.

Practical reading, per shape and not per machine:

- `B/E >= 45` — use BLAS (or AMX). Highest absolute rate, cliff not yet biting.
- `B/E < 45` — use VNNI. At 11 rows per expert, the shape a 64-expert model
  actually produces, BLAS is at ~22% of its dense rate and VNNI at ~93%.
- `B/E == 1` — VNNI by 21x, and nothing else is close.

The honest caveat on the harness: it shares one weight matrix across all
blocks, which isolates *block height* as the variable. A real MoE gives each
expert its own weights, so the total weight traffic is `E·K·N` either way and
the amortizing engines have less to gain at the top end than the 720-row row
suggests. That makes the cliff worse for them in practice, not better.

## No-C version: `routed-node.js`

The op is a selection and a matmul. Only the selection is ours, and a
selection is index arithmetic — so it belongs in Node. The matmul is a GEMM
that is already compiled and sitting on the machine, reached with koffi.

No gcc, no `.so` of ours, no node-gyp, no second language in the repo:

```
node routed-node.js --b 720 --k 512 --n 512 --e 8
```

`ArrayBuffer` and typed-array views only — no `Buffer`. The target runtime is
WebLLM in a browser, where `Buffer` does not exist, so the same source has to
run in both. Alignment to 64 bytes is done by over-allocating and taking a
view at the next boundary (backing stores land at `addr % 64 == 32` here).

Measured, fp32 via OpenBLAS, every shape exact against the dense reference:

| B | K=N | E | rows/expert | dense | routed | speedup |
|---|---|---|---|---|---|---|
| 720 | 512 | 8 | 90 | 7.9 ms | 2.5 ms | 3.2x |
| 720 | 512 | 60 | 12 | 54.3 ms | 7.3 ms | 7.4x |
| 720 | 512 | 64 | 11 | 57.7 ms | 7.1 ms | 8.1x |
| 4096 | 512 | 8 | 512 | 41.7 ms | 15.9 ms | 2.6x |
| 720 | 1024 | 8 | 90 | 28.8 ms | 7.3 ms | 3.9x |

Lower than the C path's 6.5-41.6x, and the engine table above says exactly
why: at E=64 the C path runs VNNI, which is flat, and gets 41x; this path
runs BLAS on 11-row blocks, which retains ~22%, and gets 8x. The two results
explain each other rather than disagreeing.

Which also says what MKL buys here, and it is not raw speed. `cblas_gemm_s8u8s32`
is a plain C ABI that MKL dispatches internally to VNNI and to AMX, so int8
and the tile engines are reachable with zero C — and, per the table, a flatter
curve is worth more than a higher peak once the blocks are short. That path is
bound in `routed-node.js` and gated behind a known-answer self-check against a
pure-JS reference, because MKL is not on this container and a backend that
cannot prove itself should be dropped, not trusted for having compiled.

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
