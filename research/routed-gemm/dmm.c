/*
 * dmm.c -- the routed diagonal (DMM) as a zero-import WASM module.
 *
 * Built to test roadmap conjecture 1b: "WASM is faster than CPU DMM."
 *
 * The mechanism that would make that true is not vector width -- WASM has
 * f32x4 and AVX-512 has f32x16, so on raw lanes the native side wins by 4x
 * before FMA. It is the CALL BOUNDARY. The routed op makes one GEMM call per
 * expert, so at E=64 the native path crosses the FFI boundary 64 times per
 * forward pass, marshalling arguments each time; this module crosses it once
 * and loops inside. If 1b holds, that is why, and the effect should grow with
 * E and shrink with block size.
 *
 * Contract, same shape as wasm/shell.c: zero imports, exports memory and
 * run(ptr,len). The host writes a header plus the matrices into this module's
 * own linear memory and calls run once. Nothing crosses mid-execution.
 *
 * Header at ptr, 8 x i32, all offsets in BYTES from the start of memory:
 *   [0] B      rows (tokens)
 *   [1] K      inner dimension
 *   [2] N      output columns
 *   [3] E      expert count
 *   [4] xOff   X, B*K f32, row-major
 *   [5] wOff   W, E*K*N f32, expert-major then row-major
 *   [6] rtOff  route, B i32, expert index per row
 *   [7] yOff   Y, B*N f32, written
 *
 * run() returns the number of rows it wrote, or a negative error.
 *
 * Build:
 *   clang --target=wasm32 -O3 -msimd128 -ffreestanding -nostdlib \
 *         -Wl,--no-entry -Wl,--export=run -Wl,--export-memory \
 *         -Wl,--initial-memory=268435456 -o dmm.wasm dmm.c
 */

#include <wasm_simd128.h>

typedef unsigned int u32;
typedef int          i32;

#define ERR_BADARG -1

/* One expert's block: rows listed in `rows`, against weight matrix w.
 * Four columns at a time. f32x4 mul + add, no FMA -- WASM's MVP SIMD has
 * none, which is the honest ceiling for this target. */
/* Walk size. The unblocked loop below does one 16-byte load of w for 8
 * flops -- 0.5 flops/byte, which is bandwidth-bound, which is why neither
 * -ffast-math (+3%) nor relaxed-simd FMA (-9%) moved it: you cannot make
 * waiting faster with a better multiply.
 *
 * ROWS rows share each w load instead, giving ROWS*4*2 flops per 16 bytes.
 * At ROWS=4 that is 2.0 flops/byte, 4x the intensity. ROWS also has to fit
 * in registers alongside the operands -- 4 accumulators plus b plus the
 * splats is comfortable for 16 wasm locals, 8 would spill. */
/* -DROWS=n at build time, so the same source produces the whole sweep and
 * the block size can be DERIVED rather than guessed. ROWS is a compile-time
 * constant, so the inner loops over it unroll and `acc` stays in registers.
 *
 * Arithmetic intensity is exactly ROWS/2 flops per byte: each 16-byte load
 * of w feeds ROWS * 4 lanes * 2 flops. That closed form is what makes a
 * one-probe calibration possible -- measure the machine's ridge point and
 * solve ROWS >= 2 * ridge, instead of sweeping every shape. */
#ifndef ROWS
#define ROWS 4
#endif

static void block_rows(const float *X, const float *w, float *Y,
                       const i32 *rows, int r0, int K, int N)
{
    const float *xp[ROWS];
    float       *yp[ROWS];
    for (int t = 0; t < ROWS; t++) {
        xp[t] = X + (u32)rows[r0 + t] * (u32)K;
        yp[t] = Y + (u32)rows[r0 + t] * (u32)N;
    }

    int j = 0;
    for (; j + 4 <= N; j += 4) {
        v128_t acc[ROWS];
        for (int t = 0; t < ROWS; t++) acc[t] = wasm_f32x4_splat(0.0f);
        for (int k = 0; k < K; k++) {
            v128_t b = wasm_v128_load(&w[(u32)k * (u32)N + j]);   /* loaded ONCE */
            for (int t = 0; t < ROWS; t++) {
#ifdef __wasm_relaxed_simd__
                acc[t] = wasm_f32x4_relaxed_madd(wasm_f32x4_splat(xp[t][k]), b, acc[t]);
#else
                acc[t] = wasm_f32x4_add(acc[t],
                             wasm_f32x4_mul(wasm_f32x4_splat(xp[t][k]), b));
#endif
            }
        }
        for (int t = 0; t < ROWS; t++) wasm_v128_store(&yp[t][j], acc[t]);
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

static void block(const float *X, const float *w, float *Y,
                  const i32 *rows, int nrows, int K, int N)
{
    int r = 0;
    for (; r + ROWS <= nrows; r += ROWS) block_rows(X, w, Y, rows, r, K, N);
    for (; r < nrows; r++) {
        const float *xrow = X + (u32)rows[r] * (u32)K;
        float       *yrow = Y + (u32)rows[r] * (u32)N;

        int j = 0;
        for (; j + 4 <= N; j += 4) {
            v128_t acc = wasm_f32x4_splat(0.0f);
            for (int k = 0; k < K; k++) {
                v128_t a = wasm_f32x4_splat(xrow[k]);
                v128_t b = wasm_v128_load(&w[(u32)k * (u32)N + j]);
                /* MVP SIMD has no FMA, so the baseline is a separate mul and
                 * add. relaxed-simd adds one. -ffp-contract cannot fuse these
                 * for us because they are explicit intrinsic calls, not
                 * arithmetic the compiler is free to reassociate -- it has to
                 * be written. Guarded, so one source still builds for both. */
#ifdef __wasm_relaxed_simd__
                acc = wasm_f32x4_relaxed_madd(a, b, acc);
#else
                acc = wasm_f32x4_add(acc, wasm_f32x4_mul(a, b));
#endif
            }
            wasm_v128_store(&yrow[j], acc);
        }
        for (; j < N; j++) {                    /* tail, N not a multiple of 4 */
            float acc = 0.0f;
            for (int k = 0; k < K; k++) acc += xrow[k] * w[(u32)k * (u32)N + j];
            yrow[j] = acc;
        }
    }
}

/* Scratch for the per-expert row lists. Sized for the largest batch this is
 * benchmarked at; a real deployment would take these offsets from the header
 * too rather than reserving statically. */
#define MAX_ROWS 8192
#define MAX_E    256
static i32 g_rows[MAX_ROWS];
static i32 g_start[MAX_E + 1];
static i32 g_fill[MAX_E];

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

    /* Counting sort of rows by expert -- this IS the diagonal: one cell per
     * row, never the grid. Same two passes as the JS version, so the two are
     * measuring the same algorithm and not two different ones. */
    for (int e = 0; e <= E; e++) g_start[e] = 0;
    for (int b = 0; b < B; b++) {
        int e = rt[b];
        if (e < 0 || e >= E) return ERR_BADARG;
        g_start[e + 1]++;
    }
    for (int e = 0; e < E; e++) g_start[e + 1] += g_start[e];
    for (int e = 0; e < E; e++) g_fill[e] = g_start[e];
    for (int b = 0; b < B; b++) g_rows[g_fill[rt[b]]++] = b;

    for (int e = 0; e < E; e++) {
        int n = g_start[e + 1] - g_start[e];
        if (n == 0) continue;
        block(X, W + (u32)e * (u32)K * (u32)N, Y,
              &g_rows[g_start[e]], n, K, N);
    }
    return B;
}

/* Dense reference: every expert against every row into scratch, then select
 * the routed row. Exactly what the JS dense path does, so routed and dense
 * can be diffed inside this module and not only against the host.
 *
 * The scratch buffer is real and written, deliberately: computing rows and
 * then not storing them invites -O3 to delete the arithmetic, which would
 * turn the dense baseline into a measurement of nothing.
 *
 * Header needs a 9th field here: [8] scratch, B*N f32.
 */
__attribute__((used)) __attribute__((visibility("default")))
i32 run_dense(i32 ptr, i32 len)
{
    if (len < 36) return ERR_BADARG;
    const i32 *h = (const i32 *)(unsigned long)ptr;
    int B = h[0], K = h[1], N = h[2], E = h[3];
    if (B <= 0 || K <= 0 || N <= 0 || E <= 0) return ERR_BADARG;
    if (B > MAX_ROWS) return ERR_BADARG;

    const float *X  = (const float *)(unsigned long)h[4];
    const float *W  = (const float *)(unsigned long)h[5];
    const i32   *rt = (const i32   *)(unsigned long)h[6];
    float       *Y  = (float *)(unsigned long)h[7];
    float       *S  = (float *)(unsigned long)h[8];

    for (int b = 0; b < B; b++) g_rows[b] = b;

    for (int e = 0; e < E; e++) {
        block(X, W + (u32)e * (u32)K * (u32)N, S, g_rows, B, K, N);
        for (int b = 0; b < B; b++) {
            if (rt[b] != e) continue;
            const float *src = S + (u32)b * (u32)N;
            float       *dst = Y + (u32)b * (u32)N;
            for (int j = 0; j < N; j++) dst[j] = src[j];
        }
    }
    return B;
}
