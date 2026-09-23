# diag-sched — the diagonal is a SELECTION, not a traversal

> **Read this first.** Everything below was written treating the diagonal as an
> *order to visit tiles*. That framing is wrong and was measured wrong four
> separate ways (simulated L2 traffic, simulated FFN shapes, wall-clock GOPS on
> the reference shapes, and whole-output vs blocked at M=720). Reordering work
> you still perform does not reduce work. A Hamiltonian path over 72 tiles costs
> exactly what row-major over 72 tiles costs.
>
> **What a diagonal actually is:** the set of cells you need out of a grid you
> would otherwise compute in full.
>
> ```
> diag(A·B)_i = sum_k A[i,k]·B[k,i]      n·k flops, not n·k·n
> ```
>
> You never form the product. Measured: einsum 'ik,ki->i' is 6.3x faster than
> np.diag(A@B) at n=512, and n-fold fewer flops.
>
> **Where inference needs this:** any place a full grid is computed to use one
> cell per row — MoE expert routing, per-token LoRA adapters, speculative-decode
> verification, mixed quantization across a batch. Reshape to (row x variant),
> take the routed diagonal, save the variant count. Measured on routed MoE
> (B=720, d=2048, E=8): **8x fewer flops**, exactly E.
>
> **Two corrections to the geometry while we are here.** Any p x q grid splits
> into exactly `gcd(p,q)` diagonals of length `lcm(p,q)`, always, with no gaps —
> coprimality is not a requirement, it is just the gcd=1 case. And 720 is a
> **length**, not a batch size: lcm(90,80) = 720, and a 720-token x 8-expert
> routing grid is likewise 8 diagonals of length 720.
>
> The scheduling material below still holds as *scheduling* — uniform disjoint
> work units, any unit count, one integer as position. It simply never was a
> speedup, and should not be read as one.

---


Engine-agnostic. Header-only. `diag_sched.h` + `verify_sched.c`.

## The shortcut: pick the batch, not the blocking

Everything below manufactures a coprime grid out of `MC`/`NC` when the shape
does not have one. But if you control the **batch** dimension you get it for
free, over the whole output, with no blocking at all:

```
M = 720, micro-tile 16 rows   ->  720/16 = 45 = 3^2·5   (odd)
N = 2048, micro-tile 64 cols  ->  2048/64 = 32 = 2^5
gcd(45, 32) = 1  ->  45 x 32 = 1440 tiles, ONE diagonal over the entire output
```

The rule is symmetric — **one of the two tile counts must be odd**:

| dimension | gives | axis |
|---|---|---|
| N = 576 = 9·64 | 9 tile-cols (odd) | columns |
| M = 720 = 45·16 | 45 tile-rows (odd) | rows |

720 is 4pi in degrees. It holds on every engine whose micro-tile is **16 rows**
(SME2 ZA tile, AMX 1x2 TMM block, a 16-row VNNI kernel); it fails on a 32-row
AMX 2x2 block (720/32 = 22.5) and an 8-row VNNI kernel (90x32, gcd 2). So:
**batch 720, micro-tile 16 rows** and the structure is native everywhere.

By contrast 4096^3 = 2^36 has a 256x64 tile grid, gcd 64 — the worst case
possible. The same work is 22.76 ops of 720x2048x2048, each perfectly coprime.

Batch 720 also clears the roofline threshold (>=143 for int8 7B) for getting
off the memory wall, so it satisfies the structure and the economics at once.

## The idea

A GEMM has exactly two numbers the programmer freely chooses: the cache-block
dimensions `MC` and `NC`. Model dimensions are given (4096, 11008). Micro-tile
shapes are given by the ISA (16×16 ZA, 16×16 TMM). Cache sizes are given by the
part. So if a coprime structure is going to exist anywhere in the stack, `MC`
and `NC` are the only place it can be put.

```
grid = (MC / tile_rows) × (NC / tile_cols)
MC = 9 × tile_rows,  NC = 8 × tile_cols   →   9×8 = 72 tiles, gcd(9,8) = 1
t = 0..71   →   (t % 9, t % 8)            bijection onto the grid, by CRT
unit u runs the t where t % nunits == u
```

## Per engine

| engine | micro-tile | MC | NC | panels | L2 |
|---|---|---|---|---|---|
| SME2 fp32 (4× ZA tiles) | 16×64 | 144 | 512 | 656 K @KC=256 | 16 M |
| AMX int8 (2×2 TMM block) | 32×32 | 288 | 256 | 272 K @KC=512 | 2 M |
| AMX bf16 (2×2 TMM block) | 32×32 | 288 | 256 | 544 K @KC=512 | 2 M |
| AVX-512 VNNI (8×64 kernel) | 8×64 | 72 | 512 | 292 K @KC=512 | 2 M |

## Why 9×8 and not another coprime pair

72 is the smallest coprime product above 64, so a 64-core machine gets at least
one tile per core with none idle, at aspect ratio 1.12 so the A-panel and
B-panel stay balanced. 7×8 = 56 starves cores on a 64-way part; 11×12 = 132
over-fragments.

## What it buys, and what it does not

**Not throughput.** Confirmed three independent ways: simulated L2 traffic
(byte-identical to row-major at every block size from 8 upward), simulated on
real Llama FFN shapes (identical), and measured wall-clock GOPS on the
reference shape set (-10% to +12%, entirely inside this machine's +/-15% run
variance). No shape, no grid choice, no thread count showed a real gain.
Anyone expecting a speedup from the diagonal will not find one.

Measured VNNI int8, 4 threads, median of 5 runs, GOPS:

| shape | 9x8 rowmajor | 9x8 diag | 8x9 rowmajor | 8x9 diag |
|---|---|---|---|---|
| 1x576x576 | 3.7 | 3.3 | 3.2 | 5.3 |
| 32x576x576 | 107.2 | 112.3 | 104.3 | 107.1 |
| 1024x576x576 | 564.7 | 630.9 | 577.1 | 521.7 |
| 2048x1024x1024 | 553.1 | 509.2 | 524.1 | 489.6 |
| 4096x2048x2048 | 248.3 | 251.7 | 253.7 | 254.0 |

**The decomposition.** Uniform-cost work units; disjoint by construction rather
than by partition arithmetic; *any* unit count including primes; and a single
integer as the complete position, so a stripe can be checkpointed, resumed,
migrated or replayed from one scalar. A 2D loop nest needs four values to say
where it is.

That matters where static partitioning fails: heterogeneous cores, preemption,
work stealing, or an engine count that isn't a convenient factor — 2 SME units,
3 threads, 13 cores.

## Use an ODD tile-column count

The grid must satisfy `gcd(tile_rows, tile_cols) == 1` — it does **not** have to
be literally 9x8. M-remainders come out even (a 32-row tail is 2 tile-rows, a
4096 tail is 4), and even against 8 shares a factor. So put the odd number on
the **columns**:

| MC | NC | grid | worst-case coverage |
|---|---|---|---|
| 144 | 512 | 9x8 | **11.1%** |
| **128** | **576** | **8x9** | **100%** |

Same 72 tiles. `576 = 9x64`; when 1024 splits under NC=576 the remainder is
`448 = 7x64`, also odd, so `gcd(8,9) = gcd(8,7) = 1`. Every block coprime.

## Coverage on real shapes

Tested against the reference shape set, measuring the fraction of FLOPs that
land in full 9x8 blocks (where the diagonal actually engages) rather than in
ragged edge blocks (where it falls back to row-major):

| shape | 9x8 (MC=144 NC=512) | 8x9 (MC=128 NC=576) |
|---|---|---|
| 1x576x576 | 0.0% | 0.0% |
| 32x576x576 | 0.0% | 0.0% |
| 1024x576x576 | 87.5% | **100.0%** |
| 2048x1024x1024 | **98.4%** | 56.2% |
| 4096x2048x2048 | **98.4%** | 84.4% |
| 4096x4096x4096 | **98.4%** | 98.4% |

`NC=512` is the better default because 512 divides 1024, 2048 and 4096 exactly.
`NC=576` is perfect on 576-wide (576 = 9x64, no remainder) but leaves a 7-col
stub on 1024-wide. Selecting NC per shape is a one-line dispatch on N.

**Hard limit: M <= 32 gets 0% under every configuration.** Nine tile-rows
requires M >= 9 x tile_rows (144 for SME2, 288 for AMX int8, 72 for VNNI).
Below that the grid has no diagonal to walk and the schedule degenerates to
row-major. Decode-shape parallelism has to come from splitting N, or from
batching requests -- not from this.

## Verify

```
cc -O2 -o verify_sched verify_sched.c && ./verify_sched
```

Checks exact cover, absence of collisions, and load balance for unit counts
1..13 on full 9×8 and on ragged edge grids. Ragged blocks fall back to
row-major, which visits the same tiles in a different order, so correctness
never depends on which branch runs.
