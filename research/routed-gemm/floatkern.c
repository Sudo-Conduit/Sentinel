/* floatkern.c -- one kernel, compiled once per ISA tier.
 *
 * The tiers below AVX-512 are not one tier, and the difference is load-
 * bearing for anything that has to run on a machine someone already owns:
 *
 *   AVX      Sandy Bridge, 2011.  256-bit float mul and add. No FMA, and no
 *            256-bit integer at all -- VNNI-style int8 does not merely run
 *            slower here, it does not exist.
 *   +F16C    Ivy Bridge, 2012.    VCVTPH2PS / VCVTPS2PH. Still no FMA.
 *   AVX2+FMA Haswell, 2013.       VFMADD231PS and 256-bit integer.
 *
 * WHY A SEPARATE FILE. The obvious spelling is
 * __attribute__((target("avx"))) on each kernel in dense.c, and it is wrong
 * twice over. First, the attribute ADDS to whatever -march already gave, so
 * with -march=native gcc still had FMA available and contracted
 * _mm256_add_ps(_mm256_mul_ps(a,b),c) into one VFMADD -- objdump showed 8
 * vfmadd inside "kern_avx", the same count as kern_avx2, so the AVX row was
 * measuring Haswell wearing a Sandy Bridge label. Second, the fixes for that
 * both fail: target("arch=sandybridge") resets so far that the SSE2
 * intrinsics in the pack stop inlining, and target("avx,no-fma,...") stops
 * even _mm256_setzero_ps from inlining.
 *
 * A translation unit with real -m flags has none of those problems, cannot
 * contract into an instruction the tier does not have, and is checkable from
 * outside with objdump -- which `make ladder-check` does, because the failure
 * mode is silent: the kernel stays CORRECT when the label is a lie, so no
 * test catches it and only the disassembly does.
 *
 * Build (see Makefile):
 *   -mavx  -mno-fma -mno-avx2 -mno-f16c               -> kern_avx
 *   -mavx  -mf16c -mno-fma -mno-avx2  -DTIER_F16      -> kern_avxf16
 *   -mavx2 -mfma  -mno-avx512f        -DTIER_FMA      -> kern_avx2
 *   -mavx2 -mfma  -mf16c -mno-avx512f -DTIER_FMA -DTIER_F16 -> kern_f16c
 *
 * F16C is a FOOTPRINT change, not a precision change: the arithmetic is
 * identical fp32 and the accumulator never holds a half. Footprint is the
 * variable this project has measured twice already -- int8 weights took two
 * routed shapes from 52% -> 72% and 48% -> 81% purely by cutting traffic,
 * and the dense N sweep found a cliff at exactly one page of stride. Half
 * the weight bytes is half the pages. Against int8 it buys no scales, no
 * zero points, no calibration pass, and 11 mantissa bits instead of 8 bits
 * total; it costs one VCVTPH2PS per 8 columns per k.
 *
 * Register budget is the fourth point on the "structure transfers, constants
 * do not" line: 16 xmm for the wasm JIT, 32 zmm for VNNI, 8 tiles for AMX,
 * 16 ymm here. ROWS*VEC + VEC + 1 <= 16, so ROWS=4 VEC=2 (11) fits and
 * ROWS=3 VEC=4 (17) does not.
 */
#include <immintrin.h>
#include <stdint.h>
#include <stddef.h>

#ifndef ROWS
#define ROWS 4
#endif
#define VEC 2                      /* 8 lanes * VEC = 16 columns per j step */

#if TIER_F16
#  define WTYPE   uint16_t
#  define LOADB(q) _mm256_cvtph_ps(_mm_loadu_si128((const __m128i *)(q)))
#else
#  define WTYPE   float
#  define LOADB(q) _mm256_loadu_ps(q)
#endif

#if TIER_FMA
#  define MADD(a, b, c) _mm256_fmadd_ps(a, b, c)
#else
#  define MADD(a, b, c) _mm256_add_ps(_mm256_mul_ps(a, b), c)
#endif

#ifndef KERNNAME
#define KERNNAME kern_float
#endif

/* Panel-ranged: Wp[p][k][64], so stepping k moves 64 contiguous elements
   rather than N. The dense N sweep settled that this is what matters (2.35x
   at exactly one page of stride); it is not re-litigated per tier. */
#if PLAIN
/* The "CPU" baseline: no intrinsics at all, k-outer so the inner loop is
   contiguous and the compiler CAN vectorise it if the target allows. Built
   at -march=x86-64, i.e. SSE2 -- what a portable binary actually gets, and
   the thing an AVX kernel has to beat to be worth carrying. */
void KERNNAME(const float *A, const void *Wv, float *C,
              int i0, int i1, int p0, int p1, int K, int N)
{
  const float *Wp = (const float *)Wv;
  for (int p = p0; p < p1; p++) {
    const float *base = Wp + (size_t)p * K * 64;
    for (int i = i0; i < i1; i++) {
      float *o = C + (size_t)i * N + p * 64;
      for (int jj = 0; jj < 64; jj++) o[jj] = 0.0f;
      for (int k = 0; k < K; k++) {
        float a = A[(size_t)i * K + k];
        const float *b = base + (size_t)k * 64;
        for (int jj = 0; jj < 64; jj++) o[jj] += a * b[jj];
      }
    }
  }
}
#else
void KERNNAME(const float *A, const void *Wv, float *C,
              int i0, int i1, int p0, int p1, int K, int N)
{
  const WTYPE *Wp = (const WTYPE *)Wv;
  for (int p = p0; p < p1; p++) {
    const WTYPE *base = Wp + (size_t)p * K * 64;
    for (int i = i0; i < i1; i += ROWS) {
      int nr = i1 - i < ROWS ? i1 - i : ROWS;
      for (int jj = 0; jj < 64; jj += 8 * VEC) {
        __m256 acc[ROWS][VEC];
        for (int t = 0; t < ROWS; t++)
          for (int v = 0; v < VEC; v++) acc[t][v] = _mm256_setzero_ps();
        for (int k = 0; k < K; k++) {
          const WTYPE *b = base + (size_t)k * 64 + jj;
          __m256 bv[VEC];
          for (int v = 0; v < VEC; v++) bv[v] = LOADB(b + 8 * v);
          for (int t = 0; t < nr; t++) {
            __m256 av = _mm256_broadcast_ss(A + (size_t)(i + t) * K + k);
            for (int v = 0; v < VEC; v++)
              acc[t][v] = MADD(av, bv[v], acc[t][v]);
          }
        }
        for (int t = 0; t < nr; t++)
          for (int v = 0; v < VEC; v++)
            _mm256_storeu_ps(C + (size_t)(i + t) * N + p * 64 + jj + 8 * v,
                             acc[t][v]);
      }
    }
  }
}
#endif
