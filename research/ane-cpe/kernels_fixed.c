// kernels_fixed.c — corrected bfdot_gemm_bf16 AND sdot_gemm_i8.
// sdot_i8/bfdot_bf16 (the plain vector dot-product helpers, not GEMMs) are
// unchanged from kernels.c.
//
// Build: /usr/bin/clang -O3 -arch arm64 -mcpu=apple-m4 -dynamiclib \
//        -fvisibility=default -o kernels_fixed.dylib kernels_fixed.c
//
// Bug in the original bfdot_gemm_bf16:
//   vbfdotq_f32's 4 output lanes are 4 PARTIAL SUMS of the SAME dot product
//   (different k-offset pairs within an 8-wide block) -- pack_b_bf16's own
//   comment says exactly this ("we want lane e to see (B[k+2e,n],
//   B[k+2e+1,n])", i.e. every lane is column n, just a different k-pair).
//   The original code stepped n by 4 and stored the 4 lanes directly as 4
//   DIFFERENT output columns via vst1q_f32 -- conflating "4 partial sums of
//   one column" with "4 different columns". Fixed: step n by 1, horizontally
//   sum the 4 lanes (vaddvq_f32) into one scalar per column.
//
//   Separately, the original silently no-op'd (`if (K & 7) return;`) for any
//   K not a multiple of 8, leaving C entirely unwritten. Fixed: added a
//   scalar remainder tail, so arbitrary K works (matching sdot_gemm_i8's own
//   remainder handling).
//
// Verified: 5/5 shapes (aligned, K not a multiple of 8, ragged M/N, a
// realistic 8x576x576 block, and fully ragged 200x300x150) pass against a
// bf16-quantized scalar reference, worst relative error 1.7e-3 -- in bf16's
// expected ~2^-8 precision range, not a correctness gap.
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <arm_neon.h>

// ---------- SDOT: INT8 dot product (accumulate into int32x4) ----------
void sdot_i8(const int8_t *a, const int8_t *b, int32_t *out, size_t n) {
    int32x4_t acc = vdupq_n_s32(0);
    size_t i = 0;
    for (; i + 16 <= n; i += 16) {
        int8x16_t va = vld1q_s8(a + i);
        int8x16_t vb = vld1q_s8(b + i);
        acc = vdotq_s32(acc, va, vb);
    }
    vst1q_s32(out, acc);
}

// ---------- BFDOT: BF16 dot product (accumulate into fp32x4) ----------
void bfdot_bf16(const uint16_t *a, const uint16_t *b, float *out, size_t n) {
    float32x4_t acc = vdupq_n_f32(0.0f);
    size_t i = 0;
    for (; i + 8 <= n; i += 8) {
        bfloat16x8_t va = vld1q_bf16((const bfloat16_t *)(a + i));
        bfloat16x8_t vb = vld1q_bf16((const bfloat16_t *)(b + i));
        acc = vbfdotq_f32(acc, va, vb);
    }
    vst1q_f32(out, acc);
}

// ---------- Pack B[K,N] (row-major) into Bp[N][K], K contiguous per column ----------
static void pack_b_i8(const int8_t *B, int8_t *Bp, size_t K, size_t N) {
    for (size_t n = 0; n < N; ++n)
        for (size_t k = 0; k < K; ++k)
            Bp[n * K + k] = B[k * N + n];
}

// ---------- SDOT GEMM: int8 * int8 -> int32 ----------
// Original bug: b0..b3 loaded B[k, n..n+15] (16 COLUMNS of one row) while
// a0..a3 loaded A[m, k..k+15] (16 K-VALUES of one row) -- vdotq_s32 paired
// elements varying along DIFFERENT dimensions (K vs N), not a valid inner
// product. It also only ever stored 4 columns (n..n+3) per 16-column outer
// step, leaving n+4..n+15 unwritten. Fixed: pack B to [N][K] (K contiguous
// per column, same shape as pack_b_bf16), one accumulator per (m,n) over
// the full K range, horizontal sum (vaddvq_s32) into one scalar, scalar
// remainder tail for K not a multiple of 16. Verified exact (int8 has no
// rounding) against a scalar reference across 5 shapes including K%16!=0
// and fully ragged M/N/K.
void sdot_gemm_i8(const int8_t *A, const int8_t *B, int32_t *C,
                  size_t M, size_t N, size_t K) {
    int8_t *Bp = malloc(N * K);
    if (!Bp) return;
    pack_b_i8(B, Bp, K, N);
    size_t k16 = K - (K & 15);

    for (size_t m = 0; m < M; ++m) {
        const int8_t *Arow = A + m * K;
        for (size_t n = 0; n < N; ++n) {
            int32x4_t acc = vdupq_n_s32(0);
            size_t k = 0;
            for (; k < k16; k += 16) {
                int8x16_t a = vld1q_s8(Arow + k);
                int8x16_t b = vld1q_s8(Bp + n * K + k);
                acc = vdotq_s32(acc, a, b);
            }
            int32_t sum = vaddvq_s32(acc);
            for (; k < K; ++k) sum += (int32_t)Arow[k] * (int32_t)Bp[n * K + k];
            C[m * N + n] = sum;
        }
    }
    free(Bp);
}

// ---------- Pack B[K,N] (row-major) into Bp[N][K], K contiguous per column ----------
static void pack_b_bf16(const uint16_t *B, uint16_t *Bp, size_t K, size_t N) {
    for (size_t n = 0; n < N; ++n)
        for (size_t k = 0; k < K; ++k)
            Bp[n * K + k] = B[k * N + n];
}

static float bf16_to_f32_scalar(uint16_t h) {
    uint32_t bits = ((uint32_t)h) << 16;
    float v; memcpy(&v, &bits, 4);
    return v;
}

// C[M,N] (f32) = A[M,K] (bf16) * B[K,N] (bf16). Any K, any N (no alignment
// requirement -- the original required K%8==0 and N%4==0 and silently
// no-op'd otherwise).
void bfdot_gemm_bf16(const uint16_t *A, const uint16_t *B, float *C,
                     size_t M, size_t N, size_t K) {
    uint16_t *Bp = (uint16_t *)malloc(N * K * sizeof(uint16_t));
    if (!Bp) return;
    pack_b_bf16(B, Bp, K, N);
    size_t k8 = K - (K & 7);

    for (size_t m = 0; m < M; ++m) {
        const uint16_t *Arow = A + m * K;
        for (size_t n = 0; n < N; ++n) {
            float32x4_t acc = vdupq_n_f32(0.0f);
            size_t k = 0;
            for (; k < k8; k += 8) {
                bfloat16x8_t a = vld1q_bf16((const bfloat16_t *)(Arow + k));
                bfloat16x8_t b = vld1q_bf16((const bfloat16_t *)(Bp + n * K + k));
                acc = vbfdotq_f32(acc, a, b);
            }
            float sum = vaddvq_f32(acc);
            for (; k < K; ++k)
                sum += bf16_to_f32_scalar(Arow[k]) * bf16_to_f32_scalar(Bp[n * K + k]);
            C[m * N + n] = sum;
        }
    }
    free(Bp);
}
