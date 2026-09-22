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

Open item, stated rather than quietly left: `routed_gemm.c`'s VNNI kernel has
the **same unblocked shape** the `engines.c` one had, and the engine table
below shows that costs 5x. These numbers therefore under-report the C path by
roughly that factor; the "230-270 GOPS on a plain dense int8 GEMM" scale
figure is this box's *unblocked* rate, not its rate. Porting the blocking
into `routed_gemm.c` is mechanical and has not been done.

## The constraint that matters

The flop saving is exactly E. The **time** saving is less when `B/E` gets
small, because each per-expert matmul shrinks: at B=720 and E=64 each expert
sees ~11 rows, and the routed path drops from ~238 GOPS to ~119. Keep roughly
128 rows per expert — `B >= 128·E` — or accept the degradation knowingly.

## The CPU side, finished

`node finaltable.mjs --runs 7` — seven processes, each a median of three
in-process reps, every path verified against the same pure-JS reference
before it is timed (worst error 1.6e-6). Dense-equivalent GFLOPS throughout
(`2·B·E·K·N / t`), except `real GF` which is the arithmetic actually
performed.

| B | K=N | E | rows/E | W MB | pure JS | BLAS dense | BLAS DMM | WASM fp32 | WASM int8 | best | real GF | % ceil | DMM/dense | spread |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 720 | 512 | 8 | 90 | 8 | 9.2 | 165.8 | 849.8 | 228.8 | 160.2 | f_4_2 | 28.6 | 81% | 5.1x | ±5% |
| 720 | 512 | 64 | 11.3 | 64 | 73.3 | 160.8 | 2019.1 | 860.0 | 1086.7 | dmm8 | 17.0 | 48% | 12.6x | ±16% |
| 720 | 256 | 64 | 11.3 | 16 | 74.2 | 161.8 | 3575.0 | 1544.5 | 1215.3 | f_4_2 | 24.1 | 68% | 22.1x | ±10% |
| 2048 | 512 | 8 | 256 | 8 | 9.0 | 159.7 | 1026.9 | 247.1 | 157.7 | f_4_2 | 30.9 | 87% | 6.4x | ±5% |
| 4096 | 512 | 8 | 512 | 8 | 9.2 | 164.3 | 1035.6 | 244.2 | 159.1 | f_4_2 | 30.5 | 86% | 6.3x | ±10% |
| 512 | 1024 | 8 | 64 | 32 | 9.0 | 154.6 | 824.6 | 116.1 | 150.6 | av4 | 18.8 | 53% | 5.3x | ±10% |

Conjecture (a) — the routed diagonal beats a dense MoE in dense-equivalent
GFLOPS — **holds at 5.1x to 22.1x**, and it is engine-independent: the
`DMM/dense` column is BLAS against BLAS.

Conjecture (b) — WASM faster than the CPU DMM — **does not hold, and the gap
decomposes exactly.** BLAS leads by 1.9x to 5.5x depending on shape, and that
number is the 5.7x ISA ceiling ratio times BLAS's efficiency over the WASM
kernel's:

```
BLAS / WASM  =  (199 GF native ceiling / 35.0 GF f32x4 ceiling)
                x (BLAS % of its ceiling / WASM % of its ceiling)
```

At B=720 K=N=512 E=8 that is `5.69 x (53% / 81%) = 3.7`, measured 3.7. The
WASM kernel runs at a *higher* fraction of its own ceiling than BLAS does of
its own on every shape here (48-87% against 16-65%), which is why the gap is
smaller than the ISA ratio everywhere. On the shapes already at 81-87% there
is at most 1.2x left in tuning; on the 48-68% ones there is 1.5-2x, and int8
is what takes it — that is the whole of the remaining single-core headroom.
Everything past it is peers.

Pure JS is worth having as a baseline and is not a strawman: **~1.1 real GF on
every shape**, given the better of its two loop orders, which is 63% of
unvectorized native C. BLAS DMM is 27-114x it and the WASM kernel 15-27x —
the spread is E, not the engines, since dense-equivalent GFLOPS scales with E
while JS's real rate does not move.

### The ceiling that number is divided by was wrong

The `% ceil` column is `real GF` over the measured f32x4 single-core ceiling.
That ceiling was reported as 27.8 GF for most of this work and it is **35.0**.
`peak.wasm` had `ACC 8` with the comment "enough to cover FMA latency", which
is true of the native probe — `vfmadd231ps a, m, m` is a one-op recurrence —
and false of the wasm one, which has no FMA and must write `a = a + a*m`, a
two-op recurrence of about 8 cycles. Eight chains issue 16 ops per pass; at
the 3 vector ops/cycle this core sustains that is 5.3 cycles of work against
an 8-cycle recurrence, so the probe was measuring its own dependency chain.
Kernels then came in at **121% of the "ceiling"**, which is how it was
caught — not by care.

`make ceiling` sweeps it now:

| ACC | wasm f32x4 GF | | ACC | native AVX-512 GF |
|---|---|---|---|---|
| 4 | 15.0 | | 4 | 106.8 |
| 8 | 25.4 | | 8 | 198.1 |
| 12 | 34.6 | | 12 | 199.2 |
| 14 | 35.0 | | 16 | 199.3 |
| 16 | 35.0 | | 32 | 193.0 |

So the native number was right all along (it saturates at ACC=8, as its
comment claimed) and only the wasm one was short. **The ISA ratio is 5.7x,
not the 7.2x reported earlier**, and 5.7 is close to the 5.33 the datasheet
gives for 2 AVX-512 FMAs/cycle against 1.5 f32x4 mul+add pairs/cycle. A
ceiling you have not swept is a lower bound on a ceiling.

### What `-ffast-math` bought

Nothing measurable. It was worth trying — the kernels use explicit intrinsics
but the tails and the autovec form do not — and `fm_f_4_2` takes the median
on five of six shapes. It also **flips with the plain `f_4_2` build from run
to run** on four of those five, which is what a difference inside the ±5-16%
spread looks like. Reported as a no-result rather than as a win, and the
build rule is kept (`make fastmath`) so the next box can re-ask.

The one real caveat on this table: "best of seven variants" is itself a
biased estimator — picking the max of several noisy measurements reports
noise. The `best` column names which variant won the median and the flip list
at the bottom of `finaltable.mjs` says where that choice was not stable.
`f_4_2` (ROWS=4, VEC=2) is the honest single answer for every shape with 8
experts; `av4` (the k-outer auto-vectorized form, no intrinsics) wins the
32MB shape.

### Build recipes are part of the measurement

The `.wasm` files were built by hand from the shell, so the flags lived only
in scrollback, and `f_*.wasm` is in `.gitignore` as build output. Both of
those turned out to matter: the ROWS x VEC grid sitting on this container
**predated the last edit to `fold.c`**, so every `f_<ROWS>_<VEC>` with
ROWS >= 2 was a stale binary and `f_4_2` — which the table above now names as
the winner — had never been measured in its current form. (ROWS=1 matched
because its tail is unreachable and gets eliminated, which is why the
staleness was invisible.) The `Makefile` is the fix; `make verify` rebuilds
the three tracked `.wasm` and diffs them against what is committed, and they
reproduce byte for byte.

## Which engine to route it through

The routed op hands the backend E short dense matmuls instead of one tall one,
so the only question that matters about a backend is: **what happens to its
rate when the block gets short?** `engines.c` answers it directly — total rows
held fixed at 720, `K=N=2048`, single thread, only the rows-per-block varied,
every backend verified against the plain-C baseline before being timed.

`node engines.js`, median of 3 x best-of-3, on a box that *does* have AMX-INT8
(these containers are not the same CPU twice — `results/` is keyed by the box
each run landed on):

| rows/block | E implied | code | VNNI 1x4 | VNNI 6x4 | VNNI auto | BLAS | BLAS batch | AMX 1x1 | AMX 2x2 | AMX auto |
|---|---|---|---|---|---|---|---|---|---|---|
| 720 | 1 | 23.0 (100%) | 60.2 (100%) | 321.0 (100%) | 315.9 (100%) | 172.8 (100%) | 175.0 (100%) | 529.2 (100%) | 1408.6 (100%) | 1469.4 (100%) |
| 90 | 8 | 22.6 (98%) | 63.1 (105%) | 302.9 (94%) | 282.4 (89%) | 129.9 (75%) | 131.1 (75%) | 495.8 (94%) | 835.9 (59%) | 1178.7 (80%) |
| 45 | 16 | 22.7 (98%) | 62.5 (104%) | 252.4 (79%) | 272.3 (86%) | 101.3 (59%) | 94.4 (54%) | 490.1 (93%) | 816.1 (58%) | 1105.2 (75%) |
| 16 | 45 | 22.7 (99%) | 62.8 (104%) | 156.2 (49%) | 303.5 (96%) | 60.5 (35%) | 62.0 (35%) | 532.4 (101%) | 528.6 (38%) | 876.7 (60%) |
| 12 | 60 | 22.6 (98%) | 64.9 (108%) | 325.2 (101%) | 276.2 (87%) | 53.8 (31%) | 53.6 (31%) | 399.7 (76%) | 396.9 (28%) | 682.9 (46%) |
| 6 | 120 | 22.6 (98%) | 65.0 (108%) | 305.0 (95%) | 314.9 (100%) | 26.2 (15%) | 26.6 (15%) | 202.9 (38%) | 198.7 (14%) | 351.7 (24%) |
| 3 | 240 | 22.8 (99%) | 64.5 (107%) | 63.3 (20%) | 95.3 (30%) | 13.7 (8%) | 13.7 (8%) | 98.9 (19%) | 100.4 (7%) | 177.6 (12%) |
| 1 | 720 | 22.7 (99%) | 61.8 (103%) | 60.6 (19%) | 65.4 (21%) | 5.4 (3%) | 5.4 (3%) | 33.6 (6%) | 33.2 (2%) | 60.3 (4%) |

code, VNNI and AMX are int8 GOPS; BLAS is fp32 GFLOPS. The **percentages** are
each engine against its own one-block rate, and those *are* comparable across
engines.

**Retracted from the earlier version of this table: "BLAS has the highest peak
of anything measured — 120 GFLOPS, double the VNNI kernel", and the practical
rule built on it ("`B/E >= 45` — use BLAS").** Both were true of the kernel
that was there and false of the ISA. The old `vnni` column is the `VNNI 1x4`
column here: one row at a time, four zmm accumulators. It holds ONE row block,
so every 64-byte weight load feeds one row and the load-to-MAC ratio never
improves no matter how wide the column step gets — the same mistake, in
different registers, that cost the f32x4 WASM kernel 1.8x. The paragraph
below this table already said so ("this VNNI kernel does not [amortize] ...
which is exactly why it is stuck at 62 GOPS when BLAS reaches 120") and then
drew a conclusion about BLAS from it anyway. Blocking four to six rows into
registers takes the same kernel from 60 to **321 GOPS**, which is not double
BLAS's peak, it is 1.9x *above* it.

The register budget is the one thing that does not port. fold.c settled
ROWS x VEC against the 16 xmm the wasm JIT exposes; here it is 32 zmm and
`ROWS*VEC + VEC + ROWS <= 32`, so the same reasoning gives a different answer
— 6x4 needs 34 registers and still wins at full blocks, 8x4 needs 44 and does
not. Structure transfers, constants do not.

AMX is no longer a prediction. Wired the same way — 1x1 is one A, one B, one C
tile, a 2:1 load-to-MAC ratio; 2x2 fills all eight tiles at 1:1 — it goes
**529 to 1409 GOPS**, and the effect is bigger than on VNNI because the ratio
halves rather than shrinking by a fraction.

The `auto` columns are the ragged tail done properly. A fixed block height
collapses the moment the block is shorter than it: VNNI 6x4 does 325 GOPS at
12 rows per block and 156 at 16, because 16 rows is two blocks of 6 plus four
rows running at 63, and `12/325 + 4/63` is exactly the measured time. So
descend through the widths (8, 6, 4, 2, 1) instead of falling off the end of
one. That is the same tail idea I claimed and retracted in fold.c — there the
tail was 1 row in 11 and could not have mattered; here it is up to R-1 rows in
R at a 5x rate difference, and the arithmetic says so before the run rather
than after.

Batched BLAS still does not rescue BLAS. `cblas_sgemm_batch` was given all 720
GEMMs in a single call, with the group descriptors built once outside the
timing loop, and landed within noise of the unbatched number at every block
height. The per-call cost is not call overhead, so batching cannot amortize
it.

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
the weight matrix across rows.** That sentence survives; the conclusion drawn
from it did not. The unblocked VNNI kernel re-streams `B` for every row at
every block size, which is why it is flat at 62 GOPS *and* why it is only 62:
the same property is the cost and the immunity. A blocked kernel amortizes
across ROWS rows and is therefore both faster and, down to ROWS rows per
block, just as flat. Flat and lower does not have to beat steep and higher —
that was a choice presented as a tradeoff, and the tradeoff was an artefact of
which kernels happened to be written.

Where the ISA does come in is which kernel is natural to write, and that part
held up. `VPDPBUSD` broadcasts a 4-byte scalar from A against a 512-bit vector
of B, so the row dimension is an ordinary loop, the non-amortizing kernel is
the obvious one, and a one-row block is a first-class case — which is exactly
why the unblocked kernel was the one sitting in this file for a month. AMX's
`TDPBSSD` consumes a 16x64 tile; a one-row block cannot be expressed without
discarding 15/16 of it. That prediction is now measured: AMX at 6 rows per
block retains 24-38%, and 6/16 = 38% is the tile occupancy. The floor is the
tile, and no arrangement of accumulators moves it — the one place the WASM
lesson does not transfer, because an f32x4 ladder reaches one row at full
width and AMX cannot.

Practical reading, per shape and not per machine:

- **AMX if the box has it**, at every block height down to 3 rows. `amx:auto`
  is 1469 GOPS at one block and still 1105 at 45 rows per block, against BLAS
  at 173 and 101. Check `engines amxinfo` — the CPUID bit and the kernel's
  `XTILEDATA` grant are separate failures and look identical from `amx 0`.
- **Otherwise `vnni:auto`**, not BLAS, at every block height. It beats BLAS
  1.8x at one block and 5-12x below 45 rows per block.
- `B/E == 1` — `vnni:auto` by 12x over BLAS, and AMX is no better than VNNI
  there because a 16-row tile carrying one row is 1/16 occupied.
- BLAS remains the right answer for one thing only: fp32 without a
  quantization step. Every column above it is int8.

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
