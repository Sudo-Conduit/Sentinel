/* diag_sched.h — coprime diagonal micro-tile schedule, engine-agnostic.
 *
 * Every matrix engine fixes a native micro-tile shape. The cache-block
 * parameters MC and NC are the ONLY two numbers in a GEMM that the programmer
 * freely chooses -- model dimensions are given, tile shapes are given by the
 * ISA, cache sizes are given by the part. So if a coprime structure is going
 * to exist anywhere in the stack, it has to be placed here.
 *
 *   grid = (MC / tile_rows) x (NC / tile_cols)
 *   pick MC = 9*tile_rows, NC = 8*tile_cols  ->  9x8 = 72 tiles, gcd(9,8)=1
 *   t = 0..71  ->  (t % 9, t % 8) is a bijection onto the grid (CRT)
 *
 * 72 is the smallest coprime product above 64, so a 64-core machine gets at
 * least one tile per core with none idle, at aspect 1.12 (balanced panels).
 *
 *   engine                    micro-tile   MC    NC    panels @KC
 *   SME2 fp32 (4x ZA tiles)      16x64     144   512   656K  (KC=256)
 *   AMX int8  (2x2 TMM block)    32x32     288   256   272K  (KC=512)
 *   AMX bf16  (2x2 TMM block)    32x32     288   256   544K  (KC=512)
 *   AVX512-VNNI (8x64 kernel)     8x64      72   512   292K  (KC=512)
 *
 * What this buys is NOT traffic -- a diagonal at proper block granularity moves
 * byte-for-byte the same data as row-major (measured). It buys the
 * decomposition: uniform-cost units, disjoint by construction rather than by
 * partition arithmetic, any unit count, and a single integer as the complete
 * position (checkpoint, resume, migrate, replay).
 */
#ifndef DIAG_SCHED_H
#define DIAG_SCHED_H
#include <stddef.h>

#define DIAG_TR 9
#define DIAG_TC 8
#define DIAG_NTILE (DIAG_TR * DIAG_TC)          /* 72 */

/* MC/NC for an engine whose micro-tile is TROWS x TCOLS */
#define DIAG_MC(TROWS) ((size_t)DIAG_TR * (TROWS))
#define DIAG_NC(TCOLS) ((size_t)DIAG_TC * (TCOLS))

/* Position of step t. Full 9x8 block -> CRT diagonal. Ragged edge block ->
 * row-major over the tiles that exist. Both visit every tile exactly once;
 * only the order differs, so correctness never depends on which branch runs. */
static inline void diag_pos(size_t t, size_t tr, size_t tc,
                            size_t *ti, size_t *tj) {
    if (tr == DIAG_TR && tc == DIAG_TC) { *ti = t % DIAG_TR; *tj = t % DIAG_TC; }
    else                                { *ti = t / tc;      *tj = t % tc;      }
}

/* Iterate stripe `unit` of `nunits` over a tr x tc micro-tile grid.
 * Stripes are disjoint for any nunits -- no partition arithmetic, no ragged
 * work units, every unit the same cost.
 *
 *   DIAG_FOR_EACH(t, ti, tj, tr, tc, unit, nunits) { ... }
 */
#define DIAG_FOR_EACH(T, TI, TJ, TR_, TC_, UNIT, NUNITS)                     \
    for (size_t T = (UNIT), TI = 0, TJ = 0,                                  \
         _n_ = (size_t)(TR_) * (size_t)(TC_);                                \
         T < _n_ ? (diag_pos(T, (TR_), (TC_), &TI, &TJ), 1) : 0;             \
         T += (NUNITS))

#endif /* DIAG_SCHED_H */
