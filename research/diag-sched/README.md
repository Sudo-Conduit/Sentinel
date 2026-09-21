# diag-sched — coprime diagonal micro-tile schedule

Engine-agnostic. Header-only. `diag_sched.h` + `verify_sched.c`.

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

**Not traffic.** Measured separately: a diagonal at proper block granularity
moves byte-for-byte the same data as row-major blocking, at every block size
from 8 upward, on real Llama FFN shapes. Anyone expecting a bandwidth win from
the diagonal will not find one.

**The decomposition.** Uniform-cost work units; disjoint by construction rather
than by partition arithmetic; *any* unit count including primes; and a single
integer as the complete position, so a stripe can be checkpointed, resumed,
migrated or replayed from one scalar. A 2D loop nest needs four values to say
where it is.

That matters where static partitioning fails: heterogeneous cores, preemption,
work stealing, or an engine count that isn't a convenient factor — 2 SME units,
3 threads, 13 cores.

## Verify

```
cc -O2 -o verify_sched verify_sched.c && ./verify_sched
```

Checks exact cover, absence of collisions, and load balance for unit counts
1..13 on full 9×8 and on ragged edge grids. Ragged blocks fall back to
row-major, which visits the same tiles in a different order, so correctness
never depends on which branch runs.
