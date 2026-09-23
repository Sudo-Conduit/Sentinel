/*
 * isolate.c -- is WASM slow, or is my kernel slow?
 *
 * The conjecture-1 run compared a naive f32x4 WASM loop against OpenBLAS's
 * hand-tuned AVX-512 assembly and called the difference "WASM vs CPU". That
 * conflates two things. This file separates them by compiling the SAME
 * scalar source for three targets:
 *
 *   native-scalar  -O3 -fno-tree-vectorize   one lane, no FMA
 *   native-auto    -O3 -march=native         auto-vectorized to AVX-512 + FMA
 *   wasm-auto      -O3 -msimd128             auto-vectorized to SIMD128
 *
 * Then:
 *   wasm-auto vs native-scalar  -> what the WASM RUNTIME costs
 *   native-auto vs wasm-auto    -> what the ISA is worth
 *   BLAS vs native-auto         -> what hand tuning is worth
 *
 * No intrinsics anywhere, so the compiler makes the same decisions from the
 * same code on both targets and the only variable is the target.
 */

typedef unsigned int u32;
typedef int          i32;

#define MAX_ROWS 8192
#define MAX_E    256
static i32 g_rows[MAX_ROWS];
static i32 g_start[MAX_E + 1];
static i32 g_fill[MAX_E];

/* Deliberately the plainest expression of the thing: one accumulator, B
 * reloaded every k, no blocking of any kind. This is the kernel whose cost
 * is being attributed, so it must not be secretly tuned. */
static void block(const float *X, const float *w, float *Y,
                  const i32 *rows, int nrows, int K, int N)
{
    for (int r = 0; r < nrows; r++) {
        const float *xrow = X + (u32)rows[r] * (u32)K;
        float       *yrow = Y + (u32)rows[r] * (u32)N;
        for (int j = 0; j < N; j++) {
            float acc = 0.0f;
            for (int k = 0; k < K; k++) acc += xrow[k] * w[(u32)k * (u32)N + j];
            yrow[j] = acc;
        }
    }
}

__attribute__((used)) __attribute__((visibility("default")))
i32 run(i32 ptr, i32 len)
{
    if (len < 32) return -1;
    const i32 *h = (const i32 *)(unsigned long)ptr;
    int B = h[0], K = h[1], N = h[2], E = h[3];
    if (B <= 0 || K <= 0 || N <= 0 || E <= 0) return -1;
    if (B > MAX_ROWS || E > MAX_E)            return -1;

    const float *X  = (const float *)(unsigned long)h[4];
    const float *W  = (const float *)(unsigned long)h[5];
    const i32   *rt = (const i32   *)(unsigned long)h[6];
    float       *Y  = (float *)(unsigned long)h[7];

    for (int e = 0; e <= E; e++) g_start[e] = 0;
    for (int b = 0; b < B; b++) {
        int e = rt[b];
        if (e < 0 || e >= E) return -1;
        g_start[e + 1]++;
    }
    for (int e = 0; e < E; e++) g_start[e + 1] += g_start[e];
    for (int e = 0; e < E; e++) g_fill[e] = g_start[e];
    for (int b = 0; b < B; b++) g_rows[g_fill[rt[b]]++] = b;

    for (int e = 0; e < E; e++) {
        int n = g_start[e + 1] - g_start[e];
        if (n == 0) continue;
        block(X, W + (u32)e * (u32)K * (u32)N, Y, &g_rows[g_start[e]], n, K, N);
    }
    return B;
}

#ifndef __wasm__
/* Native driver: same data generator as conjecture.mjs, so the numbers are
 * comparable across the two harnesses rather than merely similar. */
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static double now(void) {
    struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + 1e-9 * t.tv_nsec;
}

int main(int argc, char **argv) {
    int B = argc > 1 ? atoi(argv[1]) : 720;
    int K = argc > 2 ? atoi(argv[2]) : 512;
    int N = argc > 3 ? atoi(argv[3]) : 512;
    int E = argc > 4 ? atoi(argv[4]) : 64;
    int reps = argc > 5 ? atoi(argv[5]) : 3;

    float *X = aligned_alloc(64, (size_t)B * K * 4);
    float *W = aligned_alloc(64, (size_t)E * K * N * 4);
    float *Y = aligned_alloc(64, (size_t)B * N * 4);
    i32   *rt = aligned_alloc(64, (size_t)B * 4);
    if (!X || !W || !Y || !rt) { fprintf(stderr, "alloc\n"); return 1; }

    for (size_t i = 0; i < (size_t)B * K; i++) X[i] = ((i * 37) % 1000) / 1000.0f - 0.5f;
    for (int e = 0; e < E; e++)
        for (size_t i = 0; i < (size_t)K * N; i++)
            W[(size_t)e * K * N + i] = ((i + (size_t)e * 7919) % 997) / 997.0f - 0.5f;
    for (int b = 0; b < B; b++) rt[b] = (b * 31 + 7) % E;

    i32 hdr[8];
    hdr[0] = B; hdr[1] = K; hdr[2] = N; hdr[3] = E;
    hdr[4] = (i32)(unsigned long)X;  hdr[5] = (i32)(unsigned long)W;
    hdr[6] = (i32)(unsigned long)rt; hdr[7] = (i32)(unsigned long)Y;

    /* 32-bit header fields cannot hold a 64-bit host pointer, so the native
     * build calls block() through its own path rather than through run(). */
    (void)hdr;

    double best = 1e18;
    for (int r = 0; r < reps; r++) {
        for (int e = 0; e <= E; e++) g_start[e] = 0;
        for (int b = 0; b < B; b++) g_start[rt[b] + 1]++;
        for (int e = 0; e < E; e++) g_start[e + 1] += g_start[e];
        for (int e = 0; e < E; e++) g_fill[e] = g_start[e];
        for (int b = 0; b < B; b++) g_rows[g_fill[rt[b]]++] = b;

        double t0 = now();
        for (int e = 0; e < E; e++) {
            int n = g_start[e + 1] - g_start[e];
            if (n == 0) continue;
            block(X, W + (size_t)e * K * N, Y, &g_rows[g_start[e]], n, K, N);
        }
        double d = now() - t0;
        if (d < best) best = d;
    }

    double denseFlops = 2.0 * B * E * K * N;
    printf("%.1f\n", denseFlops / best / 1e9);
    return 0;
}
#endif
