/*
 * dmm8.c -- int8 weights, fp32 accumulate. The mechanical fix for the two
 * bandwidth-bound shapes.
 *
 * Measured with fp32 weights, % of the 27.8 GF/core f32x4 ceiling tracks
 * rows-per-expert, because each expert's weights are read once and serve
 * only rows_per_expert rows -- intensity is rows_per_expert/2 flops per
 * weight byte. Two shapes sat at 48-52%, waiting on weights:
 *
 *   B=720 K=N=512  E=64   W = 64 MB   11.3 rows/expert   52%
 *   B=512 K=N=1024 E=8    W = 32 MB   64   rows/expert   48%
 *
 * int8 weights divide the weight traffic by 4 and put both under 16 MB:
 * 64 -> 16, 32 -> 8. Intensity quadruples to 2*rows_per_expert flops per
 * weight byte at no change to the shape.
 *
 * The cost is ALU: one i8x16 load has to be widened to four f32x4 before it
 * can be used, roughly ten extra instructions per sixteen weights. That is
 * a bad trade when compute-bound and the right one when bandwidth-bound,
 * so this should HELP the 48-52% shapes and HURT the 78-81% ones. If it
 * helps everywhere, the bandwidth story was wrong; if it hurts everywhere,
 * the widening is costlier than modelled. Either way the sign is the test.
 *
 * Numerics: weights are int8 with one fp32 scale per expert, applied once
 * to the accumulator at the end rather than per multiply. Activations stay
 * fp32 -- this isolates the weight-bandwidth variable and nothing else.
 */

#include <wasm_simd128.h>

typedef unsigned int   u32;
typedef int            i32;
typedef signed char    i8;

#ifndef ROWS
#define ROWS 2
#endif

#define MAX_ROWS 8192
#define MAX_E    256
static i32 g_rows[MAX_ROWS];
static i32 g_start[MAX_E + 1];
static i32 g_fill[MAX_E];
#define ERR_BADARG -1

/* 16 columns per step: exactly one i8x16 load of w per k, widened to four
 * f32x4. Wider would need more than one load and gains nothing. */
static void block_rows(const float *X, const i8 *w, float *Y, float scale,
                       const i32 *rows, int r0, int K, int N)
{
    const float *xp[ROWS];
    float       *yp[ROWS];
    for (int t = 0; t < ROWS; t++) {
        xp[t] = X + (u32)rows[r0 + t] * (u32)K;
        yp[t] = Y + (u32)rows[r0 + t] * (u32)N;
    }
    const v128_t vs = wasm_f32x4_splat(scale);

    int j = 0;
    for (; j + 16 <= N; j += 16) {
        v128_t acc[ROWS][4];
        for (int t = 0; t < ROWS; t++)
            for (int q = 0; q < 4; q++) acc[t][q] = wasm_f32x4_splat(0.0f);

        for (int k = 0; k < K; k++) {
            const v128_t w8 = wasm_v128_load(&w[(u32)k * (u32)N + j]);  /* 16 bytes */
            const v128_t lo = wasm_i16x8_extend_low_i8x16(w8);
            const v128_t hi = wasm_i16x8_extend_high_i8x16(w8);
            const v128_t f0 = wasm_f32x4_convert_i32x4(wasm_i32x4_extend_low_i16x8(lo));
            const v128_t f1 = wasm_f32x4_convert_i32x4(wasm_i32x4_extend_high_i16x8(lo));
            const v128_t f2 = wasm_f32x4_convert_i32x4(wasm_i32x4_extend_low_i16x8(hi));
            const v128_t f3 = wasm_f32x4_convert_i32x4(wasm_i32x4_extend_high_i16x8(hi));
            for (int t = 0; t < ROWS; t++) {
                const v128_t a = wasm_f32x4_splat(xp[t][k]);
                acc[t][0] = wasm_f32x4_add(acc[t][0], wasm_f32x4_mul(a, f0));
                acc[t][1] = wasm_f32x4_add(acc[t][1], wasm_f32x4_mul(a, f1));
                acc[t][2] = wasm_f32x4_add(acc[t][2], wasm_f32x4_mul(a, f2));
                acc[t][3] = wasm_f32x4_add(acc[t][3], wasm_f32x4_mul(a, f3));
            }
        }
        for (int t = 0; t < ROWS; t++)
            for (int q = 0; q < 4; q++)
                wasm_v128_store(&yp[t][j + 4 * q], wasm_f32x4_mul(acc[t][q], vs));
    }
    for (; j < N; j++) {
        float s[ROWS];
        for (int t = 0; t < ROWS; t++) s[t] = 0.0f;
        for (int k = 0; k < K; k++) {
            const float bv = (float)w[(u32)k * (u32)N + j];
            for (int t = 0; t < ROWS; t++) s[t] += xp[t][k] * bv;
        }
        for (int t = 0; t < ROWS; t++) yp[t][j] = s[t] * scale;
    }
}

static void block(const float *X, const i8 *w, float *Y, float scale,
                  const i32 *rows, int nrows, int K, int N)
{
    int r = 0;
    for (; r + ROWS <= nrows; r += ROWS) block_rows(X, w, Y, scale, rows, r, K, N);
    for (; r < nrows; r++) {
        const float *xrow = X + (u32)rows[r] * (u32)K;
        float       *yrow = Y + (u32)rows[r] * (u32)N;
        int j = 0;
        for (; j + 16 <= N; j += 16) {
            v128_t acc[4];
            for (int q = 0; q < 4; q++) acc[q] = wasm_f32x4_splat(0.0f);
            for (int k = 0; k < K; k++) {
                const v128_t w8 = wasm_v128_load(&w[(u32)k * (u32)N + j]);
                const v128_t lo = wasm_i16x8_extend_low_i8x16(w8);
                const v128_t hi = wasm_i16x8_extend_high_i8x16(w8);
                const v128_t a  = wasm_f32x4_splat(xrow[k]);
                acc[0] = wasm_f32x4_add(acc[0], wasm_f32x4_mul(a,
                    wasm_f32x4_convert_i32x4(wasm_i32x4_extend_low_i16x8(lo))));
                acc[1] = wasm_f32x4_add(acc[1], wasm_f32x4_mul(a,
                    wasm_f32x4_convert_i32x4(wasm_i32x4_extend_high_i16x8(lo))));
                acc[2] = wasm_f32x4_add(acc[2], wasm_f32x4_mul(a,
                    wasm_f32x4_convert_i32x4(wasm_i32x4_extend_low_i16x8(hi))));
                acc[3] = wasm_f32x4_add(acc[3], wasm_f32x4_mul(a,
                    wasm_f32x4_convert_i32x4(wasm_i32x4_extend_high_i16x8(hi))));
            }
            for (int q = 0; q < 4; q++)
                wasm_v128_store(&yrow[j + 4 * q], wasm_f32x4_mul(acc[q], wasm_f32x4_splat(scale)));
        }
        for (; j < N; j++) {
            float acc = 0.0f;
            for (int k = 0; k < K; k++) acc += xrow[k] * (float)w[(u32)k * (u32)N + j];
            yrow[j] = acc * scale;
        }
    }
}

/* header: [0..8] as dmm.c, plus [9] = fp32 scale bits (one per run, all
 * experts share it here -- a real deployment carries one per expert). */
__attribute__((used)) __attribute__((visibility("default")))
i32 run(i32 ptr, i32 len)
{
    if (len < 40) return ERR_BADARG;
    const i32 *h = (const i32 *)(unsigned long)ptr;
    int B = h[0], K = h[1], N = h[2], E = h[3];
    if (B <= 0 || K <= 0 || N <= 0 || E <= 0) return ERR_BADARG;
    if (B > MAX_ROWS || E > MAX_E)            return ERR_BADARG;

    const float *X  = (const float *)(unsigned long)h[4];
    const i8    *W  = (const i8 *)(unsigned long)h[5];
    const i32   *rt = (const i32 *)(unsigned long)h[6];
    float       *Y  = (float *)(unsigned long)h[7];
    float scale; __builtin_memcpy(&scale, &h[9], 4);

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
        block(X, W + (u32)e * (u32)K * (u32)N, Y, scale, &g_rows[g_start[e]], n, K, N);
    }
    return B;
}
