/*
 * autovec.c -- can the stride-N access be made auto-vectorizable?
 *
 * The scalar source in isolate.c has j outer, k inner:
 *
 *     for (j) { acc = 0; for (k) acc += xrow[k] * w[k*N + j]; yrow[j] = acc; }
 *
 * The k loop walks w with a stride of N floats, so consecutive iterations
 * touch non-adjacent memory. That is a gather, and it is also a reduction.
 * Clang vectorizes innermost loops, so it sees a strided reduction and
 * declines -- measured: iso.wasm contains ZERO f32x4.mul/add.
 *
 * But the stride is an artefact of the loop ORDER, not of the problem.
 * Interchange to k outer, j inner:
 *
 *     for (k) { a = xrow[k]; for (j) yrow[j] += a * w[k*N + j]; }
 *
 * Now the inner loop walks w[k*N + j] and yrow[j] contiguously in j. It is
 * a plain scaled-vector-add over contiguous memory -- the textbook
 * auto-vectorizable shape, no intrinsics, no pragma.
 *
 * What it costs: the accumulator no longer lives in a register across k.
 * Every k re-reads and re-writes the whole output row, so y traffic becomes
 * K*N loads plus K*N stores instead of N stores. That is fine while the
 * output row is cache-resident and expensive when it is not -- which makes
 * this a shape-dependent choice, like the block size.
 *
 * ROWS blocking applies here too: hoisting ROWS rows into the k loop shares
 * each w load across ROWS scaled adds, same as the intrinsic kernel.
 */

typedef unsigned int u32;
typedef int          i32;

#ifndef ROWS
#define ROWS 4
#endif

#define MAX_ROWS 8192
#define MAX_E    256
static i32 g_rows[MAX_ROWS];
static i32 g_start[MAX_E + 1];
static i32 g_fill[MAX_E];

#define ERR_BADARG -1

/* k outer, j inner. No intrinsics anywhere -- if this vectorizes, the
 * compiler did it. */
static void block(const float *X, const float *w, float *Y,
                  const i32 *rows, int nrows, int K, int N)
{
    int r = 0;
    for (; r + ROWS <= nrows; r += ROWS) {
        const float *xp[ROWS];
        float       *yp[ROWS];
        for (int t = 0; t < ROWS; t++) {
            xp[t] = X + (u32)rows[r + t] * (u32)K;
            yp[t] = Y + (u32)rows[r + t] * (u32)N;
            for (int j = 0; j < N; j++) yp[t][j] = 0.0f;
        }
        for (int k = 0; k < K; k++) {
            const float *wk = w + (u32)k * (u32)N;
            for (int t = 0; t < ROWS; t++) {
                const float a = xp[t][k];
                float *y = yp[t];
                for (int j = 0; j < N; j++) y[j] += a * wk[j];   /* contiguous */
            }
        }
    }
    for (; r < nrows; r++) {
        const float *xrow = X + (u32)rows[r] * (u32)K;
        float       *yrow = Y + (u32)rows[r] * (u32)N;
        for (int j = 0; j < N; j++) yrow[j] = 0.0f;
        for (int k = 0; k < K; k++) {
            const float a = xrow[k];
            const float *wk = w + (u32)k * (u32)N;
            for (int j = 0; j < N; j++) yrow[j] += a * wk[j];
        }
    }
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
