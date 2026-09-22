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
 * 16 ymm here. But the budget is only half the story and the first version
 * of this file got the other half wrong: it hard-coded ROWS=4 VEC=2 because
 * 4*2 + 2 + 1 = 11 registers fits, and never swept. fold.c exists precisely
 * because that reasoning does not survive contact -- there the optimum moved
 * on every axis tested, and a 16-point grid was the only thing that found it.
 *
 * What the unswept version cost, visible in its own numbers: avx2 measured
 * the SAME as avx (27-32 against 26-30) when FMA should be worth ~2x. A
 * kernel that does not care whether it has FMA is not compute-bound. ROWS*VEC
 * = 8 accumulators, each a one-FMA recurrence, issues 8 ops per k at 2 FMA
 * per cycle = 4 cycles, against an FMA latency of about 4. Marginal, so
 * latency-bound -- the exact mistake peak.c made with ACC=8 and that was
 * retracted earlier in this same session, in a different file.
 *
 * So ROWS and VEC are a grid now, generated inside each tier's translation
 * unit (the -m flags vary per tier, the blocking does not), and selected by
 * name: `dense f16c:6:2 ...`.
 */
#include <immintrin.h>
#include <stdint.h>
#include <stddef.h>

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

#define CAT2(a, b) a##b
#define CAT(a, b) CAT2(a, b)

#if PLAIN
/* The "CPU" baseline: no intrinsics at all, k-outer so the inner loop is
   contiguous and the compiler CAN vectorise it if the target allows. Built
   at -march=x86-64, i.e. SSE2 -- what a portable binary actually gets, and
   the thing an AVX kernel has to beat to be worth carrying. */
void CAT(TIER, _cref)(const float *A, const void *Wv, float *C,
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

/* Panel-ranged: Wp[p][k][64], so stepping k moves 64 contiguous elements
   rather than N. The dense N sweep settled that (2.35x at exactly one page
   of stride); it is not re-litigated per tier.
   R rows x V ymm accumulators. R is compile-time on purpose -- passing the
   row count as a runtime bound is what flattened the entire ROWS axis in
   fold.c, because the compiler stopped unrolling.

   Two constraints the verify pass found rather than the author:
     8*V must divide 64, so V is 1, 2, 4 or 8. V=3 steps jj by 24 and silently
       leaves columns 48..63 unwritten -- it produced a plausible-looking
       matrix that was 1.5 out of 1.8 wrong.
     R need NOT divide the row count, but a bare grid entry then leaves the
       last (i1-i0) mod R rows untouched. That is deliberate: these are
       building blocks and the ladder composes them. It also means a grid
       entry is only meaningful on its own when R divides the range. */
#define FK(R, V)                                                              \
static void CAT(CAT(TIER, _k), CAT(R, CAT(_, V)))                             \
    (const float *A, const void *Wv, float *C,                                \
     int i0, int i1, int p0, int p1, int K, int N)                            \
{                                                                             \
  const WTYPE *Wp = (const WTYPE *)Wv;                                        \
  for (int p = p0; p < p1; p++) {                                             \
    const WTYPE *base = Wp + (size_t)p * K * 64;                              \
    for (int i = i0; i + (R) <= i1; i += (R)) {                               \
      for (int jj = 0; jj < 64; jj += 8 * (V)) {                              \
        __m256 acc[R][V];                                                     \
        for (int t = 0; t < (R); t++)                                         \
          for (int v = 0; v < (V); v++) acc[t][v] = _mm256_setzero_ps();      \
        for (int k = 0; k < K; k++) {                                         \
          const WTYPE *b = base + (size_t)k * 64 + jj;                        \
          __m256 bv[V];                                                       \
          for (int v = 0; v < (V); v++) bv[v] = LOADB(b + 8 * v);             \
          for (int t = 0; t < (R); t++) {                                     \
            __m256 av = _mm256_broadcast_ss(A + (size_t)(i + t) * K + k);     \
            for (int v = 0; v < (V); v++)                                     \
              acc[t][v] = MADD(av, bv[v], acc[t][v]);                         \
          }                                                                   \
        }                                                                     \
        for (int t = 0; t < (R); t++)                                         \
          for (int v = 0; v < (V); v++)                                       \
            _mm256_storeu_ps(C + (size_t)(i + t) * N + p * 64 + jj + 8 * v,   \
                             acc[t][v]);                                      \
      }                                                                       \
    }                                                                         \
  }                                                                           \
}

FK(1,1) FK(1,2) FK(1,4) FK(1,8)
FK(2,1) FK(2,2) FK(2,4)
FK(4,1) FK(4,2) FK(4,4)
FK(6,1) FK(6,2)
FK(8,1)

/* The ladder. A fixed R leaves i1-i0 mod R rows undone; the first version
   handled that with a runtime `nr` clamp inside the blocked kernel, which
   still issued V weight loads per k to serve one row. That is why M=1 lost
   to plain C. Descending through the widths does the leftover rows at the
   widest block that actually fits them -- same fix as vnni:auto. */
#define LADDER_BODY(NAME, R0)                                                 \
static void NAME(const float *A, const void *Wv, float *C,                    \
                 int i0, int i1, int p0, int p1, int K, int N)                \
{                                                                             \
  int i = i0;                                                                 \
  while (i < i1) {                                                            \
    int left = i1 - i, take;                                                  \
    if      (left >= 8 && (R0) >= 8) { take = (left / 8) * 8;                 \
      CAT(TIER, _k8_1)(A, Wv, C, i, i + take, p0, p1, K, N); }                \
    else if (left >= 6) { take = (left / 6) * 6;                              \
      CAT(TIER, _k6_2)(A, Wv, C, i, i + take, p0, p1, K, N); }                \
    else if (left >= 4) { take = 4;                                           \
      CAT(TIER, _k4_2)(A, Wv, C, i, i + take, p0, p1, K, N); }                \
    else if (left >= 2) { take = 2;                                           \
      CAT(TIER, _k2_4)(A, Wv, C, i, i + take, p0, p1, K, N); }                \
    else                { take = 1;                                           \
      CAT(TIER, _k1_8)(A, Wv, C, i, i + take, p0, p1, K, N); }                \
    i += take;                                                                \
  }                                                                           \
}
LADDER_BODY(CAT(TIER, _auto), 6)

/* Exported table, same shape as engines.c's VNNI_VARIANTS. regs is the
   predicted ymm demand (R*V accumulators + V loads + 1 broadcast); the sweep
   is what says whether 16 is really the wall. */
typedef void (*fk_fn)(const float *, const void *, float *,
                      int, int, int, int, int, int);
struct fk_entry { const char *name; fk_fn fn; int rows, vec, regs; };

#define E(R, V) { #R "_" #V, CAT(CAT(TIER, _k), CAT(R, CAT(_, V))), R, V, \
                  (R) * (V) + (V) + 1 }
const struct fk_entry CAT(TIER, _table)[] = {
  E(1,1), E(1,2), E(1,4), E(1,8),
  E(2,1), E(2,2), E(2,4),
  E(4,1), E(4,2), E(4,4),
  E(6,1), E(6,2),
  E(8,1),
  { "auto", CAT(TIER, _auto), 0, 0, 0 },
};
const int CAT(TIER, _count) =
  (int)(sizeof CAT(TIER, _table) / sizeof CAT(TIER, _table)[0]);
#endif
