// sme2_fixed.c — corrected drain for the SME2 f32 GEMM.
//
// Same packing/blocking/accumulate as sme2.c. ONLY the ZA drain changed:
//   sme2.c:  svread_ver_za32_f32_m(zero, pg, t, 0)  then svst1   [2 instr/vec]
//            - reads a VERTICAL slice (a column) but writes it to a ROW of C
//            - slice index hardcoded 0, so all 16 rows get slice 0
//            - predicate svwhilelt(i,16) shrinks as i grows
//   here:    svst1_hor_za32(t, i, pg, ptr)                        [1 instr/vec]
//            - horizontal slice i == row i of C, which is what FMOPA produced
//            - 64 stores instead of 64 reads + 64 stores
//
// Build: clang -O3 -arch arm64 -mcpu=apple-m4 -msve-vector-bits=512 \
//        -dynamiclib -fvisibility=default -o sme2_fixed.dylib sme2_fixed.c
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <arm_sme.h>

#ifdef SME_DEBUG
#include <stdio.h>
#define SME_TRACE(I, T, off, lanes, ptr) \
    fprintf(stderr, "STORE_TILE row=%d tile=%d off=%zu lanes=%zu ptr_off=%td\n", \
            (int)(I), (int)(T), (size_t)(off), (size_t)(lanes), (ptr) - C)
#else
#define SME_TRACE(I, T, off, lanes, ptr) do {} while (0)
#endif

#define MC 128
#define KC 256
#define NC 256

static void pack_a_f32(const float *A, float *Ap, size_t M, size_t K) {
    size_t m_blocks = (M + MC - 1) / MC, k_blocks = (K + KC - 1) / KC;
    for (size_t mb = 0; mb < m_blocks; ++mb) {
        size_t m0 = mb * MC, m_rem = (M - m0 < MC) ? M - m0 : MC;
        for (size_t kb = 0; kb < k_blocks; ++kb) {
            size_t k0 = kb * KC, k_rem = (K - k0 < KC) ? K - k0 : KC;
            float *dst = Ap + (mb * k_blocks + kb) * (MC * KC);
            for (size_t kk = 0; kk < k_rem; ++kk) {
                const float *src = A + m0 * K + (k0 + kk);
                for (size_t mm = 0; mm < m_rem; ++mm) dst[kk * MC + mm] = src[mm * K];
            }
        }
    }
}
static void pack_b_f32(const float *B, float *Bp, size_t K, size_t N) {
    size_t k_blocks = (K + KC - 1) / KC, n_blocks = (N + NC - 1) / NC;
    for (size_t kb = 0; kb < k_blocks; ++kb) {
        size_t k0 = kb * KC, k_rem = (K - k0 < KC) ? K - k0 : KC;
        for (size_t nb = 0; nb < n_blocks; ++nb) {
            size_t n0 = nb * NC, n_rem = (N - n0 < NC) ? N - n0 : NC;
            float *dst = Bp + (kb * n_blocks + nb) * (KC * NC);
            for (size_t kk = 0; kk < k_rem; ++kk)
                memcpy(dst + kk * NC, B + (k0 + kk) * N + n0, n_rem * sizeof(float));
        }
    }
}

__arm_locally_streaming __arm_new("za")
static void sme2_gemm_packed(const float *Ap, const float *Bp, float *C,
                             size_t M, size_t N, size_t K) {
    size_t m_blocks = (M + MC - 1) / MC;
    size_t k_blocks = (K + KC - 1) / KC;
    size_t n_blocks = (N + NC - 1) / NC;

    for (size_t mb = 0; mb < m_blocks; ++mb) {
        size_t m0 = mb * MC, m_rem = (M - m0 < MC) ? M - m0 : MC;
        for (size_t nb = 0; nb < n_blocks; ++nb) {
            size_t n0 = nb * NC, n_rem = (N - n0 < NC) ? N - n0 : NC;

            for (size_t mm = 0; mm < m_rem; mm += 16) {
                size_t mr = (m_rem - mm < 16) ? m_rem - mm : 16;
                for (size_t nn = 0; nn < n_rem; nn += 64) {
                    size_t nr = (n_rem - nn < 64) ? n_rem - nn : 64;

                    svbool_t pg_m   = svwhilelt_b32((uint32_t)0, (uint32_t)mr);
                    svbool_t pg_n   = svptrue_b32();
                    // svcount_t is a COUNT encoding, not a per-lane bitmask --
                    // reinterpret-casting a single-vector (16-lane) svbool_t
                    // into it does not mean "all 4x16=64 elements active" for
                    // this x4 load. Use the real all-true counting-predicate
                    // constructor for the load's actual multiplicity instead.
                    svcount_t pg_nc = svptrue_c32();

                    svzero_za();
                    for (size_t kb = 0; kb < k_blocks; ++kb) {
                        size_t k_rem = (K - kb * KC < KC) ? K - kb * KC : KC;
                        const float *a_blk = Ap + (mb * k_blocks + kb) * (MC * KC) + mm;
                        const float *b_blk = Bp + (kb * n_blocks + nb) * (KC * NC) + nn;
                        for (size_t kk = 0; kk < k_rem; ++kk) {
                            svfloat32_t   a  = svld1(pg_m, a_blk + kk * MC);
                            svfloat32x4_t b4 = svld1_f32_x4(pg_nc, b_blk + kk * NC);
                            svmopa_za32_f32_m(0, pg_m, pg_n, a, svget4(b4, 0));
                            svmopa_za32_f32_m(1, pg_m, pg_n, a, svget4(b4, 1));
                            svmopa_za32_f32_m(2, pg_m, pg_n, a, svget4(b4, 2));
                            svmopa_za32_f32_m(3, pg_m, pg_n, a, svget4(b4, 3));
                        }
                    }

                    // --- drain: horizontal slice i IS row i of C ---
                    // svst1_hor_za32's tile-group and slice arguments must be
                    // compile-time constants (an ISA/intrinsic restriction,
                    // not a style choice) -- a runtime loop over i/t does not
                    // compile. Fully unrolled instead; STORE_TILE's own `if`
                    // is the runtime bound (mr, nr) that the loop version was
                    // trying to express.
                    #define STORE_TILE(I, T) do { \
                        if ((I) < mr) { \
                            size_t off = (size_t)(T) * 16; \
                            if (off < nr) { \
                                size_t lanes = (nr - off < 16) ? nr - off : 16; \
                                svbool_t pg_s = svwhilelt_b32((uint32_t)0, (uint32_t)lanes); \
                                float *_ptr = C + (m0 + mm + (I)) * N + n0 + nn + off; \
                                SME_TRACE(I, T, off, lanes, _ptr); \
                                svst1_hor_za32((T), (I), pg_s, _ptr); \
                            } \
                        } \
                    } while (0)
                    #define STORE_ROW(I) do { \
                        STORE_TILE(I, 0); STORE_TILE(I, 1); STORE_TILE(I, 2); STORE_TILE(I, 3); \
                    } while (0)
                    STORE_ROW(0);  STORE_ROW(1);  STORE_ROW(2);  STORE_ROW(3);
                    STORE_ROW(4);  STORE_ROW(5);  STORE_ROW(6);  STORE_ROW(7);
                    STORE_ROW(8);  STORE_ROW(9);  STORE_ROW(10); STORE_ROW(11);
                    STORE_ROW(12); STORE_ROW(13); STORE_ROW(14); STORE_ROW(15);
                    #undef STORE_ROW
                    #undef STORE_TILE
                }
            }
        }
    }
}

void sme2_gemm_f32(const float *A, const float *B, float *C,
                   size_t M, size_t N, size_t K) {
    size_t m_blocks = (M + MC - 1) / MC, k_blocks = (K + KC - 1) / KC,
           n_blocks = (N + NC - 1) / NC;
    float *Ap = malloc(m_blocks * k_blocks * MC * KC * sizeof(float));
    float *Bp = malloc(k_blocks * n_blocks * KC * NC * sizeof(float));
    if (!Ap || !Bp) { free(Ap); free(Bp); return; }
    pack_a_f32(A, Ap, M, K);
    pack_b_f32(B, Bp, K, N);
    memset(C, 0, M * N * sizeof(float));
    sme2_gemm_packed(Ap, Bp, C, M, N, K);
    free(Ap); free(Bp);
}
