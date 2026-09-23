/*
 * fold.c -- feed SIMD what it actually wants, then measure what falls out.
 *
 * Two separate findings so far, reported as a choice rather than folded:
 *
 *   k-outer (autovec.c)  walks w fully sequentially -> prefetcher happy,
 *                        but the accumulator lives in MEMORY, so it pays
 *                        K*N read-modify-writes on y.
 *   k-inner (dmm.c)      keeps the accumulator in REGISTERS, but consumes
 *                        only 16 bytes of w per stride of N*4 -- a strided
 *                        walk in tiny chunks, which defeats prefetch.
 *
 * Both wins are available at once. Keep k inner (registers), and widen the
 * COLUMN tile so each stride consumes 16*VEC contiguous bytes instead of 16.
 *
 *   ROWS  rows held in registers per block
 *   VEC   v128s per j step, i.e. 4*VEC columns
 *
 * Arithmetic intensity is ROWS/2 flops per byte regardless of VEC -- each k
 * loads 16*VEC bytes and does ROWS*VEC*4*2 flops. So VEC does not change
 * intensity at all; it changes ACCESS GRANULARITY, which is the thing the
 * hardware prefetcher actually responds to. ROWS and VEC are therefore
 * independent knobs pulling on different limits, which is why sweeping one
 * of them (as I did) could not find this.
 *
 * Register budget: ROWS*VEC accumulators, plus VEC loads of w, plus a
 * splat. x86-64 exposes 16 xmm registers to the wasm JIT, so ROWS*VEC + VEC
 * much past ~12 should spill and the sweep should show it.
 */

#include <wasm_simd128.h>

typedef unsigned int u32;
typedef int          i32;

#ifndef ROWS
#define ROWS 4
#endif
#ifndef VEC
#define VEC 2
#endif

#define MAX_ROWS 8192
#define MAX_E    256
static i32 g_rows[MAX_ROWS];
static i32 g_start[MAX_E + 1];
static i32 g_fill[MAX_E];
#define ERR_BADARG -1

/* nr MUST be the compile-time ROWS here, not a runtime count. An earlier
 * version passed the tail length in as a parameter so one function could
 * serve both paths; that made every `for (t < nr)` runtime-bounded, the
 * compiler stopped unrolling them, and the whole ROWS axis flattened --
 * ROWS=1 appeared to win at every VEC, contradicting the earlier sweep
 * where ROWS=4 beat ROWS=1 by 1.8x. That was an artefact of the harness,
 * not a result. Tail rows get the scalar path below instead. */
static void block_rows(const float *X, const float *w, float *Y,
                       const i32 *rows, int r0, int K, int N)
{
    const float *xp[ROWS];
    float       *yp[ROWS];
    for (int t = 0; t < ROWS; t++) {
        xp[t] = X + (u32)rows[r0 + t] * (u32)K;
        yp[t] = Y + (u32)rows[r0 + t] * (u32)N;
    }

    const int STEP = 4 * VEC;
    int j = 0;
    for (; j + STEP <= N; j += STEP) {
        v128_t acc[ROWS][VEC];
        for (int t = 0; t < ROWS; t++)
            for (int v = 0; v < VEC; v++) acc[t][v] = wasm_f32x4_splat(0.0f);

        for (int k = 0; k < K; k++) {
            const float *wk = w + (u32)k * (u32)N + j;
            v128_t b[VEC];
            for (int v = 0; v < VEC; v++) b[v] = wasm_v128_load(&wk[4 * v]);
            for (int t = 0; t < ROWS; t++) {
                v128_t a = wasm_f32x4_splat(xp[t][k]);
                for (int v = 0; v < VEC; v++)
                    acc[t][v] = wasm_f32x4_add(acc[t][v], wasm_f32x4_mul(a, b[v]));
            }
        }
        for (int t = 0; t < ROWS; t++)
            for (int v = 0; v < VEC; v++) wasm_v128_store(&yp[t][j + 4 * v], acc[t][v]);
    }
    for (; j < N; j++) {
        float s[ROWS];
        for (int t = 0; t < ROWS; t++) s[t] = 0.0f;
        for (int k = 0; k < K; k++) {
            float bv = w[(u32)k * (u32)N + j];
            for (int t = 0; t < ROWS; t++) s[t] += xp[t][k] * bv;
        }
        for (int t = 0; t < ROWS; t++) yp[t][j] = s[t];
    }
}

/* Column panelling. Without it, each row-block walks the whole of w before
 * the next block starts, so at 512 rows/expert w is streamed 256 times and
 * evicted between every pass -- measured as throughput FLAT at ~21 real GF
 * from 32 to 512 rows/expert, when more rows per expert should mean more
 * reuse and more speed.
 *
 * With it, a panel of w (K * JPANEL * 4 bytes) is held while every row-block
 * runs through it. At K=512, JPANEL=64 that is 128KB -- L2-resident -- so
 * the second and later row-blocks hit cache instead of DRAM, and rows per
 * expert finally buys something.
 *
 * -DJPANEL=n to set it; 0 means no panelling, which is the old behaviour. */
#ifndef JPANEL
#define JPANEL 0
#endif

/* Same register kernel as block_rows, restricted to columns [j0,j1). The
 * caller sweeps panels outside the row loop so the panel stays resident. */
static void block_panel(const float *X, const float *w, float *Y,
                        const i32 *rows, int r0, int K, int N, int j0, int j1)
{
    const float *xp[ROWS];
    float       *yp[ROWS];
    for (int t = 0; t < ROWS; t++) {
        xp[t] = X + (u32)rows[r0 + t] * (u32)K;
        yp[t] = Y + (u32)rows[r0 + t] * (u32)N;
    }
    const int STEP = 4 * VEC;
    int j = j0;
    for (; j + STEP <= j1; j += STEP) {
        v128_t acc[ROWS][VEC];
        for (int t = 0; t < ROWS; t++)
            for (int v = 0; v < VEC; v++) acc[t][v] = wasm_f32x4_splat(0.0f);
        for (int k = 0; k < K; k++) {
            const float *wk = w + (u32)k * (u32)N + j;
            v128_t b[VEC];
            for (int v = 0; v < VEC; v++) b[v] = wasm_v128_load(&wk[4 * v]);
            for (int t = 0; t < ROWS; t++) {
                v128_t a = wasm_f32x4_splat(xp[t][k]);
                for (int v = 0; v < VEC; v++)
                    acc[t][v] = wasm_f32x4_add(acc[t][v], wasm_f32x4_mul(a, b[v]));
            }
        }
        for (int t = 0; t < ROWS; t++)
            for (int v = 0; v < VEC; v++) wasm_v128_store(&yp[t][j + 4 * v], acc[t][v]);
    }
    for (; j < j1; j++) {
        float s[ROWS];
        for (int t = 0; t < ROWS; t++) s[t] = 0.0f;
        for (int k = 0; k < K; k++) {
            float bv = w[(u32)k * (u32)N + j];
            for (int t = 0; t < ROWS; t++) s[t] += xp[t][k] * bv;
        }
        for (int t = 0; t < ROWS; t++) yp[t][j] = s[t];
    }
}

static void block(const float *X, const float *w, float *Y,
                  const i32 *rows, int nrows, int K, int N)
{
    int r = 0;
#if JPANEL > 0
    const int full = nrows - (nrows % ROWS);
    if (full > 0) {
        for (int jp = 0; jp < N; jp += JPANEL) {
            int jend = jp + JPANEL < N ? jp + JPANEL : N;
            for (int rb = 0; rb + ROWS <= full; rb += ROWS)
                block_panel(X, w, Y, rows, rb, K, N, jp, jend);
        }
        r = full;
    }
#else
    for (; r + ROWS <= nrows; r += ROWS) block_rows(X, w, Y, rows, r, K, N);
#endif
    /* Ragged tail. Was ROWS=1/VEC=1 -- the slowest kernel in this file, and
     * at E=64 it runs on 1 row in every 11, dragging the shape to 52% of
     * ceiling. Same VEC width as the main path now, so the tail costs
     * bandwidth but not vector width. */
#if OLDTAIL
    for (; r < nrows; r++) {
        const float *xrow = X + (u32)rows[r] * (u32)K;
        float       *yrow = Y + (u32)rows[r] * (u32)N;
        int j = 0;
        for (; j + 4 <= N; j += 4) {
            v128_t acc = wasm_f32x4_splat(0.0f);
            for (int k = 0; k < K; k++)
                acc = wasm_f32x4_add(acc, wasm_f32x4_mul(
                          wasm_f32x4_splat(xrow[k]),
                          wasm_v128_load(&w[(u32)k * (u32)N + j])));
            wasm_v128_store(&yrow[j], acc);
        }
        for (; j < N; j++) {
            float acc = 0.0f;
            for (int k = 0; k < K; k++) acc += xrow[k] * w[(u32)k * (u32)N + j];
            yrow[j] = acc;
        }
    }
#else
    for (; r < nrows; r++) {
        const float *xrow = X + (u32)rows[r] * (u32)K;
        float       *yrow = Y + (u32)rows[r] * (u32)N;
        const int STEP = 4 * VEC;
        int j = 0;
        for (; j + STEP <= N; j += STEP) {
            v128_t acc[VEC];
            for (int v = 0; v < VEC; v++) acc[v] = wasm_f32x4_splat(0.0f);
            for (int k = 0; k < K; k++) {
                const float *wk = w + (u32)k * (u32)N + j;
                v128_t a = wasm_f32x4_splat(xrow[k]);
                for (int v = 0; v < VEC; v++)
                    acc[v] = wasm_f32x4_add(acc[v], wasm_f32x4_mul(a, wasm_v128_load(&wk[4*v])));
            }
            for (int v = 0; v < VEC; v++) wasm_v128_store(&yrow[j + 4*v], acc[v]);
        }
        for (; j < N; j++) {
            float acc = 0.0f;
            for (int k = 0; k < K; k++) acc += xrow[k] * w[(u32)k * (u32)N + j];
            yrow[j] = acc;
        }
    }
#endif
}

__attribute__((used)) __attribute__((visibility("default")))
i32 run(i32 ptr, i32 len)
{
    if (len < 32) return ERR_BADARG;
    const i32 *h = (const i32 *)(unsigned long)ptr;
    int B = h[0], K = h[1], N = h[2], E = h[3];
    if (B <= 0 || K <= 0 || N <= 0 || E <= 0) return ERR_BADARG;
    if (B > MAX_ROWS || E > MAX_E)            return ERR_BADARG;

    const float *X  = (const float *)(unsigned long)h[4];
    const float *W  = (const float *)(unsigned long)h[5];
    const i32   *rt = (const i32   *)(unsigned long)h[6];
    float       *Y  = (float *)(unsigned long)h[7];

    for (int e = 0; e <= E; e++) g_start[e] = 0;
    for (int b = 0; b < B; b++) {
        int e = rt[b];
        if (e < 0 || e >= E) return ERR_BADARG;
        g_start[e + 1]++;
    }
    for (int e = 0; e < E; e++) g_start[e + 1] += g_start[e];
    for (int e = 0; e < E; e++) g_fill[e] = g_start[e];
    for (int b = 0; b < B; b++) g_rows[g_fill[rt[b]]++] = b;

    int e0 = 0, e1 = E;
    if (len >= 44) {
        e0 = h[9]; e1 = h[10];
        if (e0 < 0 || e1 > E || e0 > e1) return ERR_BADARG;
    }
    i32 done = 0;
    for (int e = e0; e < e1; e++) {
        int n = g_start[e + 1] - g_start[e];
        if (n == 0) continue;
        block(X, W + (u32)e * (u32)K * (u32)N, Y, &g_rows[g_start[e]], n, K, N);
        done += n;
    }
    return (e0 == 0 && e1 == E) ? B : done;
}
