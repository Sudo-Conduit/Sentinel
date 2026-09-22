# Image tiling as a routed diagonal — what checks out and what does not

Conjecture put forward: an image converted to RGB and tiled into 9x8 (or
90x8, 90x80) grids can leverage the diagonal with `async()` to define
patterns in each tile and across the image; each 9x8 tile is a flat array
tensor, and together they form a Hilbert -> Hamiltonian space.

Three separable claims. One is exactly decidable, one is measurable and came
back well, one is untested and is the actual research question.

Section 1 below is a correction: the first version of it flattened the
hierarchy, treated 90x80 as one torus, and reported a constraint that does
not exist.

## 1. It is a hierarchy, and it is the one we already built

**Corrected.** The first version of this section flattened 90x80 into a
single `Z_90 x Z_80` torus, found gcd 10, and reported 10% max coverage as a
hard constraint. Wrong object. **90x80 is (10*9) x (10*8) — a 10x10
arrangement of 9x8 tiles, 100 cells of 9x8.** 90x8 is a 10x1 row of them.
Flattening threw away the structure and then blamed the structure.

It is also the same two-level shape this directory has been building all
along, and the correspondence is exact:

| image tiling | routed-gemm |
|---|---|
| 9x8 tile, walked internally | `ROWS x VEC` register block |
| grid of tiles, each visited once | `MBLK x NBLK` work-unit queue |
| tile routed to one of E patterns | the routed diagonal, `B x E` |

Nobody asks a single jump vector to cover a register block *and* the work
queue. Two walks, and the gcd argument applies to **each level
independently** (CRT: `Z_a x Z_b` is cyclic iff `gcd(a,b) = 1`).
`tilewalk.mjs` brute-forces both:

| grid | pixels | inner (9x8) | outer (tiles) | composite |
|---|---|---|---|---|
| 9x8 | 72 | 72/72 = 100%, 24 vectors | — | **100%** |
| 90x8 | 720 | 100% | 10/10 = 100%, 4 vectors | **100%** |
| 90x80 | 7200 | 100% | 10/100 by one vector | inner 100%, outer rasters |
| 81x64 | 5184 | 100% | 72/72 = 100%, 24 vectors | **100%** |

So the two claims in the previous version were both wrong: 90x8 is fully
walkable (I said 50%), and 90x80's inner walk is fully cyclic with only its
*outer* arrangement non-cyclic (I said 10% and called it impossible).

What survives, and it is the useful half:

- **The inner walk is the one that must be cyclic, and 9x8 always is.**
  `gcd(9,8)=1` gives `Z_9 x Z_8 = Z_72`, which is the `72 = 0 (mod 72)` that
  `9x8_Matrix.html` opens the CORE series with. 24 of the 72 jump vectors are
  Hamiltonian cycles on it. That is why 9x8 is the tile and not an arbitrary
  rectangle.
- **The outer walk only has to visit every tile**, which any raster does, and
  which the GEMM work queue already does without caring about order. A
  non-cyclic tile arrangement like 10x10 costs nothing.
- **81x64 is the self-similar option**: 9x8 tiles arranged 9x8, both levels
  cyclic, 5184 = 72^2 cells, a single jump vector valid at each level. If a
  fully generated address ordering is ever wanted rather than a raster, that
  is the shape that gives it.

## 2. The compute shape is healthy

Tiling an RGB image into 9x8 tiles gives `K = 9*8*3 = 216` and one row per
tile:

| image | tiles (B) | B/E at E=8 | B/E at E=64 |
|---|---|---|---|
| 1080p | 28,755 | 3594 | 449 |
| 4K | 115,020 | 14378 | 1797 |
| 512x512 | 3,584 | 448 | 56 |

Measured, 4 cores, GFLOPS (int8 column GOPS):

| M x K x N | f16c | avx2 | cref | vnnip |
|---|---|---|---|---|
| 28672x256x64 | 299.5 | 232.4 | 69.7 | 2267 |
| 28672x256x128 | 313.1 | 238.4 | 68.7 | 1639 |
| 448x256x128 | 307.3 | 325.1 | 61.4 | 1576 |

The last row is one expert's share at E=64 on 1080p, and it runs at full
rate. That is the opposite of the MoE case, where 11 rows per expert was the
shape that hurt: an image gives **449 rows per expert**, comfortably past the
point where short blocks cost anything.

Two shape facts that follow from existing results rather than new ones:

- **N=64..128 means a k-stride of 256-512 bytes**, well under a page, so the
  page-stride cliff that cost the dense VNNI kernel 2.35x does not arise here
  at all. Panel packing still applies and costs nothing.
- **K=216 is 8*27, not a multiple of 64.** An AMX tile consumes 64 int8 or 32
  bf16 per row, so AMX cannot take 216 without padding to 256 — 18.5% of
  every multiply wasted. VNNI needs only `K%4==0` (216 is fine) and the AVX
  ladder needs nothing of K. **On this shape the tile engines are the wrong
  choice and the vector engines are the right one**, which inverts the
  ordering that holds everywhere else in this directory.

`async()` transfers unchanged: slicing by tile is disjoint the same way
slicing by expert was, so it needs no coordination and `Promise.all` is the
right shape for it.

## 3. Hilbert and Hamiltonian are two different spaces, and that is the useful part

The framing separates cleanly onto the two axes this directory already has:

- **Within a tile** — a flat 72-vector (216 with RGB) in a finite-dimensional
  inner-product space. "Pattern" means coordinates in some basis, and the
  routed diagonal computes exactly one projection per tile. This is the `K`
  axis.
- **Across tiles** — a lattice with a traversal order. "Hamiltonian" here is
  a path visiting each tile once, which is §1's jump vector. This is the `B`
  axis.

The routed op acts on the first; the walk acts on the second. They compose
and neither constrains the other.

## The caveat that decides whether this works at all

**The E-fold saving exists only because the diagonal commits to one pattern
per tile.** `Y[b] = X[b] . W[route[b]]` is topk=1: it computes the tile's
projection onto *one* basis element and never forms the others. If what you
want is "which of E patterns does this tile most resemble, given a cheap
router", the diagonal is exactly right and is E times cheaper. If what you
want is the full descriptor — the tile's coordinates in all E directions —
that is the dense case, the saving is zero, and the diagonal is the wrong
operator.

Everything in §1 and §2 is settled: the grid arithmetic is exact and the
throughput is measured. **Whether a one-pattern-per-tile descriptor actually
characterises image structure is untested here**, and it is a quality
question rather than a throughput one — it needs images, a basis, and a task
to score against. Nothing measured above speaks to it.

## 4. The diagonal is optimal for *selection* and the worst for *ordering*

CORE 001-030 is a catalogue of ways to walk a torus and the diagonal is only
one of them. Enumerated from the series itself rather than from memory: a
linear step counter (`9x8_Matrix`), an axial column sweep, a radial pulse and
a helical orbit (002), arbitrary jump vectors with gcd-governed coverage
(003), concentric shells and rings throughout — "shell" and "ring" appear 134
and 132 times across the docs, far more than jump vectors — and in 010,
polygon rings with shortcut vertices framed explicitly as **traversal cost**:
72 steps for a full walk against 4-12 via shortcuts. That last one is the
routed diagonal's E-fold saving stated in the series' own language.

`dense.c` now implements six of them as work-unit orders (`ORDER=`), each a
verified **permutation** of the units — identical arithmetic, identical
results, only the sequence differs, so anything measured is the walk alone.
4096^3, vnni panel-packed, 4 threads, median of 5 invocations of best-of-7:

| order | median GOPS | vs best | from |
|---|---|---|---|
| `col` | **2238** | — | axial column sweep, 002 |
| `morton` | 2195 | -2% | Z-order (locality in both axes) |
| `shell` | 2112 | -6% | concentric rings, 002 onward |
| `row` | 2082 | -7% | linear step counter, `9x8_Matrix` |
| `jump` | 1968 | -12% | jump vector, 003 |
| `diag` | 1961 | -12% | helical orbit, 002 |

Two things fall out, and the second one is the point.

**Order matters, but an order of magnitude less than the inner walk.** The
*k*-stride inside a work unit was worth **2.35x** (the panel pack). The order
*between* work units is worth **1.14x**. Same lesson as the tile hierarchy in
§1: the inner walk is the one that has to be right, and the outer walk is a
refinement. Fixing them in the wrong order wastes the effort.

**Coverage and reuse are opposed, and the diagonal sits at the wrong end.**
CORE 003's Coverage Ratio rewards a jump vector for visiting a *new* cell
every step — maximum spread. That is precisely minimum residency: `diag` and
`jump` touch a fresh (row block, column block) pair every step, so neither
the A rows nor the B panel stay hot, and they are reliably the two slowest of
the six. `col` wins because it is the opposite — one column panel of weights
held while every row block runs through it.

So the diagonal is doing two different jobs and is graded oppositely on them:

- **Selection** — *which* cells to compute. `Y[b] = X[b] . W[route[b]]` takes
  B of the B*E cells, and the saving is exactly E. Optimal, and the whole
  basis of this directory.
- **Ordering** — *what sequence* to compute them in. Here maximum spread is
  exactly what a cache does not want, and the diagonal is the worst measured
  option.

They are independent choices. Routing on the diagonal and traversing by
column is not a contradiction; it is picking each for the job it is good at.
