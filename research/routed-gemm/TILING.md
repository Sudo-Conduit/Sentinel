# Image tiling as a routed diagonal — what checks out and what does not

Conjecture put forward: an image converted to RGB and tiled into 9x8 (or
90x8, 90x80) grids can leverage the diagonal with `async()` to define
patterns in each tile and across the image; each 9x8 tile is a flat array
tensor, and together they form a Hilbert -> Hamiltonian space.

Three separable claims. One is exactly decidable and came back with a hard
constraint, one is measurable and came back well, one is untested and is the
actual research question.

## 1. The grid choice is not free — only 9x8 is Hamiltonian

`tilewalk.mjs` walks every jump vector on each grid and counts unique cells,
brute force rather than algebra. CORE 003's Coverage Ratio, exhaustively:

| grid | cells | gcd(C,R) | max coverage | Hamiltonian vectors |
|---|---|---|---|---|
| 9x8 | 72 | 1 | **72/72 = 100%** | **24** |
| 90x8 | 720 | 2 | 360/720 = 50% | 0 |
| 90x80 | 7200 | 10 | 720/7200 = 10% | 0 |

A jump vector `(sx,sy)` generates a *cyclic* subgroup of `Z_C x Z_R`, of
order `lcm(C/gcd(sx,C), R/gcd(sy,R))`. That reaches `C*R` only when
`Z_C x Z_R` is itself cyclic, i.e. **gcd(C,R) = 1** — the Chinese Remainder
Theorem. The measured coverage agrees with that formula on all 7992 vectors
tested, with no exceptions.

So 9x8 is not an arbitrary tile size. `gcd(9,8)=1` makes `Z_9 x Z_8 = Z_72`,
which is exactly the `72 = 0 (mod 72)` that `9x8_Matrix.html` opens the CORE
series with. **90x8 and 90x80 cannot host a single-vector Hamiltonian cycle
at all** — not "less efficiently", not ever. Covering those needs more than
one generator, or a construction that is not a constant jump vector.

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
