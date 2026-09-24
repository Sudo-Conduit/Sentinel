// sme1_fixed.c — same two fixes as sme2_fixed.c, applied to SME1.
//
//   1. Drain: svread_ver_za32_f32_m(zero, pg, t, 0) then svst1 read a
//      VERTICAL slice (slice index hardcoded 0, so every row got the same
//      slice) and stored it as if it were a ROW. Replaced with
//      svst1_hor_za32(t, i, pg, ptr) -- horizontal slice i IS row i, which
//      is what FMOPA actually produced. Unrolled (tile/slice args to
//      svst1_hor_za32 must be compile-time constants).
//
//   2. Predicate: svcount_t pg_n_c = svreinterpret_c(pg_n) bit-reinterprets
//      a single-vector (16-lane) svbool_t as a "predicate-as-counter".
//      svcount_t is a COUNT encoding, not a per-lane mask -- this does not
//      mean "all 4x16=64 elements active" for the x4 load that consumes it,
//      so tiles 1-3 loaded from stale/undefined data. Use the real all-true
//      counting-predicate constructor for the load's actual multiplicity:
//      svptrue_c32().
//
// The unused sme1_micro_16x64 helper (dead code -- never called by
// sme1_gemm_f32) is fixed identically for consistency, though it has no
// effect on sme1_gemm_f32's behavior.
//
// Build: clang -O3 -arch arm64 -mcpu=apple-m4 -msve-vector-bits=512 \
//        -dynamiclib -fvisibility=default -o sme1_fixed.dylib sme1_fixed.c
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <arm_sme.h>

#define MC 128
#define KC 256
#define NC 256

static void pack_a_f32(const float *A, float *Ap, size_t M, size_t K) {
    size_t m_blocks = (M + MC - 1) / MC;
    size_t k_blocks = (K + KC - 1) / KC;
    for (size_t mb = 0; mb < m_blocks; ++mb) {
        size_t m0 = mb * MC;
        size_t m_rem = (M - m0 < MC) ? M - m0 : MC;
        for (size_t kb = 0; kb < k_blocks; ++kb) {
            size_t k0 = kb * KC;
            size_t k_rem = (K - k0 < KC) ? K - k0 : KC;
            float *dst = Ap + (mb * k_blocks + kb) * (MC * KC);
            for (size_t kk = 0; kk < k_rem; ++kk) {
                const float *src = A + m0 * K + (k0 + kk);
                for (size_t mm = 0; mm < m_rem; ++mm) dst[kk * MC + mm] = src[mm * K];
            }
        }
    }
}

static void pack_b_f32(const float *B, float *Bp, size_t K, size_t N) {
    size_t k_blocks = (K + KC - 1) / KC;
    size_t n_blocks = (N + NC - 1) / NC;
    for (size_t kb = 0; kb < k_blocks; ++kb) {
        size_t k0 = kb * KC;
        size_t k_rem = (K - k0 < KC) ? K - k0 : KC;
        for (size_t nb = 0; nb < n_blocks; ++nb) {
            size_t n0 = nb * NC;
            size_t n_rem = (N - n0 < NC) ? N - n0 : NC;
            float *dst = Bp + (kb * n_blocks + nb) * (KC * NC);
            for (size_t kk = 0; kk < k_rem; ++kk)
                memcpy(dst + kk * NC, B + (k0 + kk) * N + n0, n_rem * sizeof(float));
        }
    }
}

#define STORE_TILE(I, T) do { \
    if ((I) < mr) { \
        size_t off = (size_t)(T) * 16; \
        if (off < nr) { \
            size_t lanes = (nr - off < 16) ? nr - off : 16; \
            svbool_t pg_s = svwhilelt_b32((uint32_t)0, (uint32_t)lanes); \
            svst1_hor_za32((T), (I), pg_s, C + (m0 + mm + (I)) * ldc + n0 + nn + off); \
        } \
    } \
} while (0)
#define STORE_ROW(I) do { \
    STORE_TILE(I, 0); STORE_TILE(I, 1); STORE_TILE(I, 2); STORE_TILE(I, 3); \
} while (0)
#define DRAIN_16_ROWS() do { \
    STORE_ROW(0);  STORE_ROW(1);  STORE_ROW(2);  STORE_ROW(3); \
    STORE_ROW(4);  STORE_ROW(5);  STORE_ROW(6);  STORE_ROW(7); \
    STORE_ROW(8);  STORE_ROW(9);  STORE_ROW(10); STORE_ROW(11); \
    STORE_ROW(12); STORE_ROW(13); STORE_ROW(14); STORE_ROW(15); \
} while (0)

__arm_locally_streaming
__arm_new("za") static void sme1_micro_16x64(
    const float *a_blk, const float *b_blk, float *C, size_t ldc,
    size_t m0, size_t n0, size_t m_rem, size_t n_rem, size_t k_len)
{
    (void)n_rem;
    svbool_t pg_m = svwhilelt_b32((uint32_t)0, (uint32_t)m_rem);
    svcount_t pg_nc = svptrue_c32();

    svzero_za();

    for (size_t kk = 0; kk < k_len; ++kk) {
        svfloat32_t a = svld1(pg_m, a_blk + kk * MC);
        svfloat32x4_t b4 = svld1_f32_x4(pg_nc, b_blk + kk * NC);

        svmopa_za32_f32_m(0, pg_m, svptrue_b32(), a, svget4(b4, 0));
        svmopa_za32_f32_m(1, pg_m, svptrue_b32(), a, svget4(b4, 1));
        svmopa_za32_f32_m(2, pg_m, svptrue_b32(), a, svget4(b4, 2));
        svmopa_za32_f32_m(3, pg_m, svptrue_b32(), a, svget4(b4, 3));
    }

    size_t mr = m_rem, nr = 64, mm = 0, nn = 0;
    DRAIN_16_ROWS();
}

__arm_locally_streaming
__arm_new("za") static void sme1_gemm_packed(
    const float *Ap, const float *Bp, float *C, size_t M, size_t N, size_t K)
{
    size_t m_blocks = (M + MC - 1) / MC;
    size_t k_blocks = (K + KC - 1) / KC;
    size_t n_blocks = (N + NC - 1) / NC;

    for (size_t mb = 0; mb < m_blocks; ++mb) {
        size_t m0 = mb * MC;
        size_t m_rem = (M - m0 < MC) ? M - m0 : MC;
        for (size_t nb = 0; nb < n_blocks; ++nb) {
            size_t n0 = nb * NC;
            size_t n_rem = (N - n0 < NC) ? N - n0 : NC;
            size_t ldc = N;

            for (size_t mm = 0; mm < m_rem; mm += 16) {
                size_t mr = (m_rem - mm < 16) ? m_rem - mm : 16;
                for (size_t nn = 0; nn < n_rem; nn += 64) {
                    size_t nr = (n_rem - nn < 64) ? n_rem - nn : 64;

                    svzero_za();
                    for (size_t kb = 0; kb < k_blocks; ++kb) {
                        size_t k_rem = (K - kb * KC < KC) ? K - kb * KC : KC;
                        const float *a_blk = Ap + (mb * k_blocks + kb) * (MC * KC) + mm;
                        const float *b_blk = Bp + (kb * n_blocks + nb) * (KC * NC) + nn;

                        svbool_t pg_m = svwhilelt_b32((uint32_t)0, (uint32_t)mr);
                        svcount_t pg_nc = svptrue_c32();

                        for (size_t kk = 0; kk < k_rem; ++kk) {
                            svfloat32_t a = svld1(pg_m, a_blk + kk * MC);
                            svfloat32x4_t b4 = svld1_f32_x4(pg_nc, b_blk + kk * NC);
                            svmopa_za32_f32_m(0, pg_m, svptrue_b32(), a, svget4(b4, 0));
                            svmopa_za32_f32_m(1, pg_m, svptrue_b32(), a, svget4(b4, 1));
                            svmopa_za32_f32_m(2, pg_m, svptrue_b32(), a, svget4(b4, 2));
                            svmopa_za32_f32_m(3, pg_m, svptrue_b32(), a, svget4(b4, 3));
                        }
                    }
                    DRAIN_16_ROWS();
                }
            }
        }
    }
}

#undef DRAIN_16_ROWS
#undef STORE_ROW
#undef STORE_TILE

void sme1_gemm_f32(const float *A, const float *B, float *C, size_t M, size_t N, size_t K) {
    size_t m_blocks = (M + MC - 1) / MC, k_blocks = (K + KC - 1) / KC, n_blocks = (N + NC - 1) / NC;
    float *Ap = malloc(m_blocks * k_blocks * MC * KC * sizeof(float));
    float *Bp = malloc(k_blocks * n_blocks * KC * NC * sizeof(float));
    if (!Ap || !Bp) { free(Ap); free(Bp); return; }
    pack_a_f32(A, Ap, M, K);
    pack_b_f32(B, Bp, K, N);
    memset(C, 0, M * N * sizeof(float));
    sme1_gemm_packed(Ap, Bp, C, M, N, K);
    free(Ap); free(Bp);
}
