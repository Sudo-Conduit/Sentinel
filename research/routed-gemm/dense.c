/* dense.c -- plain dense M x K x N, multi-core, three tile/vector engines.
 *
 * Everything else in this directory measures the ROUTED op and holds total
 * rows fixed while block height varies. This file measures the ordinary
 * dense matmul at fixed shapes, on all cores, so the numbers line up against
 * a history of dense measurements taken elsewhere. Different question, so a
 * different program rather than another flag on engines.c.
 *
 *   amx    AMX-INT8   TDPBF16PS's integer sibling TDPBSSD, 2x2 tiles
 *   vnni   AVX-512 VNNI VPDPBUSD, register-blocked (no AMX)
 *   bf16   AMX-BF16   TDPBF16PS, 2x2 tiles
 *   blas   cblas_sgemm fp32, dlopen'd, for reference
 *
 * usage: dense caps
 *        dense verify <M> <K> <N> <T>
 *        dense <engine> <M> <K> <N> <T> <reps>   -> prints "median best" GOPS
 *
 * Parallelism is a dynamic 2-D work queue over (row block, column block).
 * Static splitting is wrong here on purpose: M=1 has no row parallelism at
 * all and N=576 is nine 64-column blocks over four threads, so a static
 * split hands one thread 3/9 of the work and the other three 2/9 each. The
 * queue does not fix the imbalance -- nothing can, at nine units -- but it
 * stops the imbalance from also depending on which thread the scheduler
 * happens to start first.
 */
#define _GNU_SOURCE
#include <immintrin.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <dlfcn.h>

typedef long i64;
typedef uint16_t bf16;

#define CBLAS_ROW_MAJOR 101
#define CBLAS_NO_TRANS  111

/* ---- BLAS, dlopen'd (same policy as engines.c: measure the library that is
       already on the box, not one we installed) ---------------------------- */
typedef void (*sgemm64_t)(i64, i64, i64, i64, i64, i64, float, const float *,
                          i64, const float *, i64, float, float *, i64);
typedef void (*sgemm32_t)(int, int, int, int, int, int, float, const float *,
                          int, const float *, int, float, float *, int);
static sgemm64_t blas64; static sgemm32_t blas32;
static const char *blas_path = NULL;
static const char *BLAS_CANDIDATES[] = {
  "/usr/local/lib/python3.11/dist-packages/numpy.libs/"
  "libscipy_openblas64_-32a4b2a6.so",
  "libopenblas.so.0", "libopenblas.so", "libblas.so.3", "libmkl_rt.so", NULL };

static int blas_init(int threads) {
  static int done = 0; if (done) return blas64 || blas32; done = 1;
  char nt[16]; snprintf(nt, sizeof nt, "%d", threads);
  setenv("OPENBLAS_NUM_THREADS", nt, 1);
  setenv("OMP_NUM_THREADS", nt, 1);
  void *h = NULL; const char *env = getenv("BLAS_SO");
  if (env) { h = dlopen(env, RTLD_NOW); if (h) blas_path = env; }
  for (int i = 0; !h && BLAS_CANDIDATES[i]; i++)
    if ((h = dlopen(BLAS_CANDIDATES[i], RTLD_NOW))) blas_path = BLAS_CANDIDATES[i];
  if (!h) return 0;
  const char *g64[] = { "scipy_cblas_sgemm64_", "cblas_sgemm64_", NULL };
  for (int i = 0; g64[i] && !blas64; i++) blas64 = (sgemm64_t)dlsym(h, g64[i]);
  if (!blas64) blas32 = (sgemm32_t)dlsym(h, "cblas_sgemm");
  const char *snt[] = { "scipy_openblas_set_num_threads64_",
                        "openblas_set_num_threads64_",
                        "openblas_set_num_threads", NULL };
  void (*set)(i64) = NULL;
  for (int i = 0; snt[i] && !set; i++) set = dlsym(h, snt[i]);
  if (set) set(threads);
  return blas64 || blas32;
}

static double now(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + 1e-9 * t.tv_nsec;
}

/* ---- AMX availability (ISA bits AND the kernel's XTILEDATA grant) -------- */
#define ARCH_REQ_XCOMP_PERM 0x1023
#define XFEATURE_XTILEDATA  18
static void cpuid_(unsigned lf, unsigned sub, unsigned *r) {
  __asm__ __volatile__("cpuid" : "=a"(r[0]), "=b"(r[1]), "=c"(r[2]), "=d"(r[3])
                       : "a"(lf), "c"(sub));
}
static int amx_have(int bf) {
  unsigned r[4]; cpuid_(7, 0, r);
  if (!((r[3] >> 24) & 1)) return 0;                       /* AMX-TILE */
  if (!((r[3] >> (bf ? 22 : 25)) & 1)) return 0;           /* BF16 / INT8 */
  if (syscall(SYS_arch_prctl, ARCH_REQ_XCOMP_PERM, XFEATURE_XTILEDATA)) return 0;
  unsigned lo, hi;
  __asm__ __volatile__("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0));
  unsigned long long x = ((unsigned long long)hi << 32) | lo;
  return ((x >> 17) & 1) && ((x >> 18) & 1);
}

/* ---- packing ------------------------------------------------------------
 * Both tile engines and VNNI want the same thing: the k dimension folded
 * into the innermost bytes of a column so one 64-byte load carries several
 * k steps for 16 columns. int8 folds 4 k per dword, bf16 folds 2 per dword.
 * Identical stride (N*4 bytes) either way, which is why the two tile kernels
 * below are the same loop with a different mnemonic. */
static void pack_i8(const int8_t *W, int8_t *Q, int K, int N) {
  for (int k = 0; k < K; k++)
    for (int j = 0; j < N; j++)
      Q[((size_t)(k / 4) * N + j) * 4 + (k & 3)] = W[(size_t)k * N + j];
}
/* Panel-packed, and this is the whole finding of the N sweep.
 *
 * pack_i8 above folds 4 k into a dword so one 64-byte load carries 16
 * columns -- but it leaves the k dimension strided by the FULL row, N*4
 * bytes. Sweeping N at fixed M and K is not a gradient, it is a step:
 *
 *     N=576   stride 2304B  = 0.56 pages   2249 GOPS
 *     N=1024  stride 4096B  = 1.00 page     957      <- cliff
 *     N=2048  stride 8192B  = 2.00 pages   1032
 *     N=4096  stride 16384B = 4.00 pages   1016
 *
 * It does not keep getting worse with more pages per step, because there is
 * nothing worse than "every step lands on a new page": the hardware
 * prefetcher does not cross page boundaries, so at one page per step it
 * stops following and never starts again. 2.35x, at one threshold.
 *
 * This is the CORE 003 coverage argument with the page as the modulus. A
 * jump vector whose stride is congruent to the grid's period visits a new
 * cell every step and re-uses nothing; the Coverage Ratio of the walk over
 * a page is 1/64 lines instead of 64/64. The fix is not a faster kernel, it
 * is a different walk: pack per 64-column panel so that stepping k moves
 * 256 contiguous bytes instead of N*4 strided ones. The panel then has one
 * stream, in order, and the page boundary stops being an event.
 *
 * The inner loop does not change at all -- it already reads b, b+64, b+128,
 * b+192, which is 256 contiguous bytes. Only the stride between k steps
 * changes, and only the pack decides that. */
static void pack_i8_panel(const int8_t *W, int8_t *Qp, int K, int N) {
  int P = N / 64;
  for (int p = 0; p < P; p++)
    for (int k = 0; k < K; k++)
      for (int jj = 0; jj < 64; jj++)
        Qp[((size_t)p * (K / 4) + k / 4) * 256 + jj * 4 + (k & 3)]
          = W[(size_t)k * N + p * 64 + jj];
}

static void pack_bf(const bf16 *W, bf16 *Q, int K, int N) {
  for (int k = 0; k < K; k++)
    for (int j = 0; j < N; j++)
      Q[((size_t)(k / 2) * N + j) * 2 + (k & 1)] = W[(size_t)k * N + j];
}
static bf16 f2b(float f) {                       /* round to nearest even */
  uint32_t x; memcpy(&x, &f, 4);
  return (bf16)((x + 0x7fff + ((x >> 16) & 1)) >> 16);
}
static float b2f(bf16 b) { uint32_t x = (uint32_t)b << 16; float f;
                           memcpy(&f, &x, 4); return f; }

/* ---- VNNI, register blocked --------------------------------------------
 * The engines.c finding, restated for a column range: R rows and 4 zmm
 * accumulators (64 columns) per step, descending 6->4->2->1 so a row count
 * that is not a multiple of R degrades instead of falling to the unblocked
 * kernel. R*4 + 4 + R registers against 32 zmm puts the ceiling at R=6. */
#define VNNI_KERN(R)                                                          \
static void vnni_##R(const uint8_t *A, const int8_t *Q, int32_t *C,           \
                     int i0, int j0, int j1, int K, int N) {                  \
  for (int j = j0; j + 64 <= j1; j += 64) {                                   \
    __m512i acc[R][4];                                                        \
    for (int t = 0; t < (R); t++)                                             \
      for (int v = 0; v < 4; v++) acc[t][v] = _mm512_setzero_si512();         \
    for (int k4 = 0; k4 < K / 4; k4++) {                                      \
      const int8_t *b = Q + ((size_t)k4 * N + j) * 4;                         \
      __m512i bv[4];                                                          \
      for (int v = 0; v < 4; v++)                                             \
        bv[v] = _mm512_loadu_si512((const void *)(b + 64 * v));               \
      for (int t = 0; t < (R); t++) {                                         \
        __m512i av = _mm512_set1_epi32(                                       \
            *(const int32_t *)(A + (size_t)(i0 + t) * K + k4 * 4));           \
        for (int v = 0; v < 4; v++)                                           \
          acc[t][v] = _mm512_dpbusd_epi32(acc[t][v], av, bv[v]);              \
      }                                                                       \
    }                                                                         \
    for (int t = 0; t < (R); t++)                                             \
      for (int v = 0; v < 4; v++)                                             \
        _mm512_storeu_si512((void *)(C + (size_t)(i0 + t) * N + j + 16 * v),  \
                            acc[t][v]);                                       \
  }                                                                           \
}
VNNI_KERN(1) VNNI_KERN(2) VNNI_KERN(4) VNNI_KERN(6)

#define VNNI_PANEL(R)                                                         \
static void vnnip_##R(const uint8_t *A, const int8_t *Qp, int32_t *C,         \
                      int i0, int p0, int p1, int K, int N) {                 \
  for (int p = p0; p < p1; p++) {                                             \
    const int8_t *base = Qp + (size_t)p * (K / 4) * 256;                      \
    int j = p * 64;                                                           \
    __m512i acc[R][4];                                                        \
    for (int t = 0; t < (R); t++)                                             \
      for (int v = 0; v < 4; v++) acc[t][v] = _mm512_setzero_si512();         \
    for (int k4 = 0; k4 < K / 4; k4++) {                                      \
      const int8_t *b = base + (size_t)k4 * 256;      /* +256, not +N*4 */    \
      __m512i bv[4];                                                          \
      for (int v = 0; v < 4; v++)                                             \
        bv[v] = _mm512_loadu_si512((const void *)(b + 64 * v));               \
      for (int t = 0; t < (R); t++) {                                         \
        __m512i av = _mm512_set1_epi32(                                       \
            *(const int32_t *)(A + (size_t)(i0 + t) * K + k4 * 4));           \
        for (int v = 0; v < 4; v++)                                           \
          acc[t][v] = _mm512_dpbusd_epi32(acc[t][v], av, bv[v]);              \
      }                                                                       \
    }                                                                         \
    for (int t = 0; t < (R); t++)                                             \
      for (int v = 0; v < 4; v++)                                             \
        _mm512_storeu_si512((void *)(C + (size_t)(i0 + t) * N + j + 16 * v),  \
                            acc[t][v]);                                       \
  }                                                                           \
}
VNNI_PANEL(1) VNNI_PANEL(2) VNNI_PANEL(4) VNNI_PANEL(6)

/* Columns left over when (j1-j0) is not a multiple of 64. N=576 is 9x64 and
   every shape measured here divides, but a kernel that is only correct on
   the shapes it was demoed with is not a kernel. */
static void vnni_scalar(const uint8_t *A, const int8_t *Q, int32_t *C,
                        int i0, int i1, int j0, int j1, int K, int N) {
  for (int i = i0; i < i1; i++)
    for (int j = j0; j < j1; j++) {
      int32_t s = 0;
      for (int k = 0; k < K; k++)
        s += (int32_t)A[(size_t)i * K + k]
           * (int32_t)Q[((size_t)(k / 4) * N + j) * 4 + (k & 3)];
      C[(size_t)i * N + j] = s;
    }
}

static void kern_vnni(const uint8_t *A, const int8_t *Q, int32_t *C,
                      int i0, int i1, int j0, int j1, int K, int N) {
  int jfull = j0 + ((j1 - j0) / 64) * 64;
  int i = i0;
  while (i < i1) {
    int left = i1 - i, take;
    if      (left >= 6) { take = 6; vnni_6(A, Q, C, i, j0, jfull, K, N); }
    else if (left >= 4) { take = 4; vnni_4(A, Q, C, i, j0, jfull, K, N); }
    else if (left >= 2) { take = 2; vnni_2(A, Q, C, i, j0, jfull, K, N); }
    else                { take = 1; vnni_1(A, Q, C, i, j0, jfull, K, N); }
    i += take;
  }
  if (jfull < j1) vnni_scalar(A, Q, C, i0, i1, jfull, j1, K, N);
}

static void kern_vnnip(const uint8_t *A, const int8_t *Qp, int32_t *C,
                       int i0, int i1, int j0, int j1, int K, int N) {
  int p0 = j0 / 64, p1 = j1 / 64;          /* callers pass 64-aligned ranges */
  int i = i0;
  while (i < i1) {
    int left = i1 - i, take;
    if      (left >= 6) { take = 6; vnnip_6(A, Qp, C, i, p0, p1, K, N); }
    else if (left >= 4) { take = 4; vnnip_4(A, Qp, C, i, p0, p1, K, N); }
    else if (left >= 2) { take = 2; vnnip_2(A, Qp, C, i, p0, p1, K, N); }
    else                { take = 1; vnnip_1(A, Qp, C, i, p0, p1, K, N); }
    i += take;
  }
}

/* ---- the AVX ladder: the tiers most machines actually are ---------------
 *
 * Everything above needs AVX-512 (VNNI) or tile registers (AMX). Below that
 * there are three distinct generations, and they are NOT one tier:
 *
 *   avx      Sandy Bridge, 2011.  256-bit float mul and add. No FMA, and no
 *            256-bit integer at all, so VNNI-style int8 is not merely slower
 *            here, it does not exist.
 *   avxf16   Ivy Bridge, 2012.    + F16C: VCVTPH2PS / VCVTPS2PH. Still no FMA.
 *   avx2     Haswell, 2013.       + FMA3 and 256-bit integer.
 *   f16c     Haswell.             + F16C on top of FMA.
 *
 * Each kernel carries its own __attribute__((target("arch=..."))). The arch=
 * form is load-bearing and the obvious spelling is wrong: target("avx") ADDS
 * avx to whatever -march already gave, it does not reset to it. Built with
 * -march=native and target("avx"), gcc still had FMA available and contracted
 * _mm256_add_ps(_mm256_mul_ps(a,b),c) into a single VFMADD -- objdump showed
 * 8 vfmadd in kern_avx, the same count as kern_avx2, so the "AVX" row was
 * measuring Haswell wearing a Sandy Bridge label. target("arch=sandybridge")
 * does reset it, but resets too far -- the SSE2 intrinsics inside the fp16
 * pack then fail to inline ("target specific option mismatch"). What works
 * is naming the negatives explicitly: "avx,no-fma,no-avx2,no-f16c" keeps the
 * baseline intact and removes exactly the instructions that would make the
 * label a lie.
 *
 * `make ladder-check` greps the disassembly for exactly this, because the
 * failure is silent: the kernel is correct either way and only the label is
 * a lie. One binary still runs everywhere; dispatch is at runtime on CPUID,
 * same as AMX.
 *
 * F16C is a FOOTPRINT change, not a precision change -- the arithmetic is
 * identical fp32, and the accumulator never sees a half. Footprint is the
 * variable this project has already measured twice: int8 weights took two
 * routed shapes from 52% -> 72% and 48% -> 81% purely by cutting traffic,
 * and the dense N sweep found a cliff at exactly one page of stride. Half the
 * weight bytes is half the pages. What fp16 buys over int8 for the same
 * halving is no scales, no zero points, no calibration pass, and 11 bits of
 * mantissa instead of 8 bits total. What it costs is one VCVTPH2PS per 8
 * columns per k -- the same trade dmm8.c made with its widening chain, and
 * won.
 *
 * Register budget is the fourth point on the "structure transfers, constants
 * do not" line: 16 xmm for the wasm JIT, 32 zmm for VNNI, 8 tiles for AMX,
 * 16 ymm here. ROWS*VEC + VEC + 1 <= 16, so ROWS=4 VEC=2 (11) fits and
 * ROWS=3 VEC=4 (17) does not.
 *
 * All four are panel-packed. The N sweep settled that; re-litigating it per
 * engine would be measuring the same thing four more times.
 */
#define AVX_ROWS 4
#define AVX_VEC  2           /* 8 lanes * VEC = 16 columns per j step */

/* Panel pack for the float paths. No k-folding -- there is no dot-product
   instruction to feed, so the only job is making the k step contiguous:
   Wp[p][k][64] means stepping k moves 64 elements, not N. */
static void pack_f32_panel(const float *W, float *Wp, int K, int N) {
  int P = N / 64;
  for (int p = 0; p < P; p++)
    for (int k = 0; k < K; k++)
      for (int jj = 0; jj < 64; jj++)
        Wp[((size_t)p * K + k) * 64 + jj] = W[(size_t)k * N + p * 64 + jj];
}
/* Software fp32 -> fp16, round to nearest even. Deliberately NOT VCVTPS2PH:
   the pack is one-time setup, never timed, and giving it a target attribute
   made an always_inline SSE2 intrinsic fail to inline under the restricted
   ISA. A setup routine is not worth a target constraint. */
static uint16_t f2h(float f) {
  uint32_t x; memcpy(&x, &f, 4);
  uint32_t sign = (x >> 16) & 0x8000u;
  int32_t  e    = (int32_t)((x >> 23) & 0xff) - 127 + 15;
  uint32_t m    = x & 0x7fffffu;
  if (e >= 31) return (uint16_t)(sign | 0x7c00u);          /* inf / overflow */
  if (e <= 0) {                                            /* subnormal */
    if (e < -10) return (uint16_t)sign;
    m |= 0x800000u;
    uint32_t sh = (uint32_t)(14 - e);
    uint32_t h  = m >> sh;
    if ((m >> (sh - 1)) & 1u) h++;
    return (uint16_t)(sign | h);
  }
  uint32_t h = ((uint32_t)e << 10) | (m >> 13);
  uint32_t r = m & 0x1fffu;
  if (r > 0x1000u || (r == 0x1000u && (h & 1u))) h++;
  return (uint16_t)(sign | h);
}
static void pack_f16_panel(const float *W, uint16_t *Wp, int K, int N) {
  int P = N / 64;
  for (int p = 0; p < P; p++)
    for (int k = 0; k < K; k++)
      for (int jj = 0; jj < 64; jj++)
        Wp[((size_t)p * K + k) * 64 + jj] = f2h(W[(size_t)k * N + p * 64 + jj]);
}

/* The tiers live in floatkern.c, compiled once per ISA with real -m flags,
   each exporting a ROWS x VEC grid. See that file for why a target attribute
   cannot do this job, and why the grid is swept rather than assumed. */
typedef void (*fk_fn)(const float *, const void *, float *,
                      int, int, int, int, int, int);
struct fk_entry { const char *name; fk_fn fn; int rows, vec, regs; };
extern const struct fk_entry avx_table[], avxf16_table[],
                             avx2_table[], f16c_table[];
extern const int avx_count, avxf16_count, avx2_count, f16c_count;
extern void cref_cref(const float *, const void *, float *,
                      int, int, int, int, int, int);

/* Selected once in main, used by every worker. */
static fk_fn g_fk;
static const void *g_fkw;

/* Runtime feature detection for the ladder. Leaf 1 ECX: AVX(28), FMA(12),
   F16C(29). Leaf 7.0 EBX: AVX2(5). XCR0 bits 1 and 2 must both be set or the
   OS is not saving ymm and every one of these faults. */
static int have_avx(void) {
  unsigned r[4]; cpuid_(1, 0, r);
  if (!((r[2] >> 28) & 1)) return 0;
  if (!((r[2] >> 27) & 1)) return 0;                 /* OSXSAVE */
  unsigned lo, hi;
  __asm__ __volatile__("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0));
  return ((lo >> 1) & 1) && ((lo >> 2) & 1);
}
static int have_f16c(void) {
  unsigned r[4]; cpuid_(1, 0, r);
  return have_avx() && ((r[2] >> 29) & 1);
}
static int have_fma(void) {
  unsigned r[4]; cpuid_(1, 0, r);
  return have_avx() && ((r[2] >> 12) & 1);
}
static int have_avx2(void) {
  unsigned r[4]; cpuid_(7, 0, r);
  return have_fma() && ((r[1] >> 5) & 1);
}

static void ref_f32(const float *A, const float *W, float *C,
                    int M, int K, int N) {
  for (int i = 0; i < M; i++) {
    float *o = C + (size_t)i * N;
    for (int j = 0; j < N; j++) o[j] = 0.0f;
    for (int k = 0; k < K; k++) {
      float a = A[(size_t)i * K + k];
      const float *w = W + (size_t)k * N;
      for (int j = 0; j < N; j++) o[j] += a * w[j];
    }
  }
}

/* ---- AMX ---------------------------------------------------------------
 * 2 row tiles x 2 column tiles = 4 C tiles + 2 A + 2 B = all eight, which is
 * one TILELOADD per TDP. The 1x1 arrangement is two loads per TDP and is
 * what the naive kernel does; that difference measured 2.7x on the routed
 * harness and is the whole reason this file exists in blocked form.
 *
 * int8: k step 64 (4 per dword). bf16: k step 32 (2 per dword). Same tile
 * geometry, same strides, different mnemonic. */
typedef struct { uint8_t palette, start_row, rsvd[14];
                 uint16_t colsb[16]; uint8_t rows[16]; } tilecfg;

static void tile_setup(int ra, int rb) {
  tilecfg c; memset(&c, 0, sizeof c);
  c.palette = 1;
  c.rows[0] = ra; c.colsb[0] = 64;   /* C00 */
  c.rows[1] = ra; c.colsb[1] = 64;   /* C01 */
  c.rows[2] = rb; c.colsb[2] = 64;   /* C10 */
  c.rows[3] = rb; c.colsb[3] = 64;   /* C11 */
  c.rows[4] = ra; c.colsb[4] = 64;   /* A0  */
  c.rows[5] = rb; c.colsb[5] = 64;   /* A1  */
  c.rows[6] = 16; c.colsb[6] = 64;   /* B0  */
  c.rows[7] = 16; c.colsb[7] = 64;   /* B1  */
  _tile_loadconfig(&c);
}

#define AMX_BODY(LOADA, LOADB, DP)                                            \
  for (int j = j0; j + 32 <= j1; j += 32) {                                   \
    _tile_zero(0); _tile_zero(1); _tile_zero(2); _tile_zero(3);               \
    for (int k0 = 0; k0 + KSTEP <= K; k0 += KSTEP) {                          \
      LOADA(4, i0, k0); if (two) LOADA(5, i0 + 16, k0);                       \
      LOADB(6, k0, j);  LOADB(7, k0, j + 16);                                 \
      DP(0, 4, 6); DP(1, 4, 7);                                               \
      if (two) { DP(2, 5, 6); DP(3, 5, 7); }                                  \
    }                                                                         \
    _tile_stored(0, C + (size_t)i0 * N + j, (size_t)N * 4);                   \
    _tile_stored(1, C + (size_t)i0 * N + j + 16, (size_t)N * 4);              \
    if (two) {                                                                \
      _tile_stored(2, C + (size_t)(i0 + 16) * N + j, (size_t)N * 4);          \
      _tile_stored(3, C + (size_t)(i0 + 16) * N + j + 16, (size_t)N * 4);     \
    }                                                                         \
  }

static void kern_amx_i8(const uint8_t *A, const int8_t *Q, int32_t *C,
                        int i0b, int i1, int j0, int j1, int K, int N) {
  const int KSTEP = 64;
  for (int i0 = i0b; i0 < i1; i0 += 32) {
    int ra = i1 - i0 > 16 ? 16 : i1 - i0;
    int two = i1 - i0 > 16;
    int rb = two ? (i1 - i0 - 16 > 16 ? 16 : i1 - i0 - 16) : 1;
    tile_setup(ra, rb);
#define LA(t, i, k) _tile_loadd(t, A + (size_t)(i) * K + (k), K)
#define LB(t, k, j) _tile_loadd(t, Q + ((size_t)((k) / 4) * N + (j)) * 4, \
                                (size_t)N * 4)
#define DPI(c, a, b) _tile_dpbssd(c, a, b)
    AMX_BODY(LA, LB, DPI)
#undef LA
#undef LB
#undef DPI
  }
  _tile_release();
}

static void kern_amx_bf(const bf16 *A, const bf16 *Q, float *C,
                        int i0b, int i1, int j0, int j1, int K, int N) {
  const int KSTEP = 32;
  for (int i0 = i0b; i0 < i1; i0 += 32) {
    int ra = i1 - i0 > 16 ? 16 : i1 - i0;
    int two = i1 - i0 > 16;
    int rb = two ? (i1 - i0 - 16 > 16 ? 16 : i1 - i0 - 16) : 1;
    tile_setup(ra, rb);
#define LA(t, i, k) _tile_loadd(t, A + (size_t)(i) * K + (k), K * 2)
#define LB(t, k, j) _tile_loadd(t, Q + ((size_t)((k) / 2) * N + (j)) * 2, \
                                (size_t)N * 4)
#define DPB(c, a, b) _tile_dpbf16ps(c, a, b)
    AMX_BODY(LA, LB, DPB)
#undef LA
#undef LB
#undef DPB
  }
  _tile_release();
}

/* ---- plain C reference, k-outer so it auto-vectorises ------------------- */
static void ref_i32(const uint8_t *A, const int8_t *W, int32_t *C,
                    int M, int K, int N) {
  for (int i = 0; i < M; i++) {
    int32_t *o = C + (size_t)i * N;
    for (int j = 0; j < N; j++) o[j] = 0;
    for (int k = 0; k < K; k++) {
      int32_t a = A[(size_t)i * K + k];
      const int8_t *w = W + (size_t)k * N;
      for (int j = 0; j < N; j++) o[j] += a * w[j];
    }
  }
}
static void ref_bf(const bf16 *A, const bf16 *W, float *C,
                   int M, int K, int N) {
  for (int i = 0; i < M; i++) {
    float *o = C + (size_t)i * N;
    for (int j = 0; j < N; j++) o[j] = 0.0f;
    for (int k = 0; k < K; k++) {
      float a = b2f(A[(size_t)i * K + k]);
      const bf16 *w = W + (size_t)k * N;
      for (int j = 0; j < N; j++) o[j] += a * b2f(w[j]);
    }
  }
}

/* ---- the work queue ----------------------------------------------------- */
/* The walk. CORE 003 is the reference: a fixed jump vector (stepX, stepY) on
 * a torus covers only what its gcd with the grid dimensions allows, and the
 * Coverage Ratio -- unique cells visited over 72 -- is the metric that says
 * whether the walk is doing its job. The same arithmetic governs this loop.
 * The grid is (M/MBLK) x (N/NBLK) work units, the jump vector is (MBLK,
 * NBLK), and the residues M mod MBLK, N mod NBLK and units mod threads are
 * the cells the walk fails to cover cleanly.
 *
 * MBLK 96 = lcm(32, 6), the AMX row pair and the VNNI ladder's widest rung,
 * so no unit starts ragged in the row dimension. That is the static part and
 * it is correct. What a static vector cannot do is stay inside the cache as
 * the shape grows, which is the second axis of the same problem -- so both
 * are knobs and the sweep decides, per CORE 003 rather than per intuition. */
static int MBLK = 96, NBLK = 64;

/* ---- work-unit traversal order -----------------------------------------
 * CORE 001-030 is a catalogue of ways to walk a torus and the diagonal is
 * only one of them. The series shows a linear step counter (9x8_Matrix), an
 * axial column sweep and a helical orbit (002), arbitrary jump vectors whose
 * coverage is governed by gcd (003), concentric shells and rings throughout,
 * and in 010 polygon rings with shortcut vertices framed explicitly as
 * traversal COST -- 72 steps for a full walk against 4-12 via shortcuts,
 * which is the routed diagonal's E-fold saving in the series' own language.
 *
 * Every order below is a PERMUTATION of the work units: identical arithmetic,
 * identical results, only the sequence differs. So any difference measured is
 * the walk and nothing else -- which is worth testing, because changing a
 * walk is exactly what took the VNNI kernel 2.35x once already.
 *
 *   row     mi outer, ni inner. The raster, and what this file has always done.
 *   col     ni outer, mi inner. The axial sweep of 002: one column panel of
 *           weights held while every row block runs through it.
 *   diag    anti-diagonals. The helical band of 002.
 *   jump    u -> (u*g) mod units with gcd(g,units)=1. CORE 003 applied to the
 *           flat index, where coprimality guarantees full coverage.
 *   morton  Z-order. Locality-preserving in BOTH axes at once, which no
 *           single jump vector is.
 *   shell   concentric rings out from the centre -- the series' dominant
 *           traversal, and the only one here that is not axis-aligned.
 *
 * Set with ORDER=<name>. An order that is not a permutation would be fast and
 * wrong, so the table is checked before use. */
static int *g_order;
static int g_order_n;

static unsigned morton_key(unsigned x, unsigned y) {
  unsigned k = 0;
  for (int b = 0; b < 16; b++)
    k |= ((x >> b) & 1u) << (2 * b) | ((y >> b) & 1u) << (2 * b + 1);
  return k;
}

static int cmp_key(const void *a, const void *b) {
  const unsigned long long *x = a, *y = b;
  return *x < *y ? -1 : *x > *y ? 1 : 0;
}

/* Builds a permutation of [0,units) as (key,unit) pairs sorted by key, so
   every order shares one code path and none can drop or repeat a unit. */
static void build_order(const char *mode, int mb, int nb) {
  int units = mb * nb;
  static int cap;
  if (units > cap) { free(g_order); g_order = malloc((size_t)units * 4);
                     cap = units; }
  g_order_n = units;
  unsigned long long *k = malloc((size_t)units * 8);
  int gstep = 1;
  if (!strcmp(mode, "jump")) {                 /* smallest g coprime to units */
    for (gstep = (int)(units * 0.618) | 1; gstep < units; gstep++) {
      int a = gstep, b = units; while (b) { int t = a % b; a = b; b = t; }
      if (a == 1) break;
    }
    if (gstep >= units) gstep = 1;
  }
  for (int u = 0; u < units; u++) {
    int mi = u / nb, ni = u % nb;
    unsigned long long key;
    if      (!strcmp(mode, "col"))  key = (unsigned long long)ni * mb + mi;
    else if (!strcmp(mode, "diag")) key = (unsigned long long)(mi + ni) * units
                                        + mi;
    else if (!strcmp(mode, "jump")) {
      /* rank of u in the multiplicative walk: invert by walking once */
      key = 0;                                  /* filled below */
    }
    else if (!strcmp(mode, "morton")) key = morton_key((unsigned)mi,
                                                       (unsigned)ni);
    else if (!strcmp(mode, "shell")) {
      int dm = mi - mb / 2, dn = ni - nb / 2;
      int am = dm < 0 ? -dm : dm, an = dn < 0 ? -dn : dn;
      int r = am > an ? am : an;                /* Chebyshev ring index */
      key = (unsigned long long)r * units + u;
    }
    else key = u;                               /* row */
    k[u] = (key << 20) | (unsigned)u;           /* unit in the low bits */
  }
  if (!strcmp(mode, "jump")) {
    int pos = 0;
    for (int i = 0, u = 0; i < units; i++) { k[u] = ((unsigned long long)pos++ << 20)
                                                    | (unsigned)u;
                                             u = (int)(((long)u + gstep) % units); }
  }
  qsort(k, (size_t)units, 8, cmp_key);
  for (int i = 0; i < units; i++) g_order[i] = (int)(k[i] & 0xfffff);
  free(k);
  /* permutation check -- an order that drops a unit is fast and wrong */
  char *seen = calloc((size_t)units, 1);
  for (int i = 0; i < units; i++) {
    int u = g_order[i];
    if (u < 0 || u >= units || seen[u]) {
      fprintf(stderr, "ORDER=%s is not a permutation at %d\n", mode, i);
      exit(2);
    }
    seen[u] = 1;
  }
  free(seen);
}

static struct {
  int eng, M, K, N, mb, nb, units;
  const void *A, *Q; void *C;
  volatile int next;
} G;

static void drain(void) {
  for (;;) {
    int q = __atomic_fetch_add(&G.next, 1, __ATOMIC_RELAXED);
    if (q >= G.units) break;
    int u = g_order[q];
    int mi = u / G.nb, ni = u % G.nb;
    int i0 = mi * MBLK, i1 = i0 + MBLK > G.M ? G.M : i0 + MBLK;
    int j0 = ni * NBLK, j1 = j0 + NBLK > G.N ? G.N : j0 + NBLK;
    if (G.eng == 0)
      kern_vnni(G.A, G.Q, G.C, i0, i1, j0, j1, G.K, G.N);
    else if (G.eng == 3)
      kern_vnnip(G.A, G.Q, G.C, i0, i1, j0, j1, G.K, G.N);
    else if (G.eng == 1)
      kern_amx_i8(G.A, G.Q, G.C, i0, i1, j0, j1, G.K, G.N);
    else if (G.eng == 2)
      kern_amx_bf(G.A, G.Q, G.C, i0, i1, j0, j1, G.K, G.N);
    else                         /* the AVX ladder, all panel-ranged */
      g_fk(G.A, G.Q, G.C, i0, i1, j0 / 64, j1 / 64, G.K, G.N);
  }
}

/* Persistent pool, spin-signalled. pthread_create costs 30-100us per thread;
 * at M=1 K=N=576 the whole matmul is ~12us of arithmetic, so spawning per
 * call would report the cost of creating threads and call it a GEMM rate.
 * That is the shape the small-M rows of this table exist to measure, so the
 * pool has to outlive the call. Spinning rather than condvars for the same
 * reason -- a futex wake is the same order as the work unit. */
static volatile int g_gen, g_done, g_stop, g_threads;

static void *worker(void *arg) {
  long id = (long)arg; (void)id;
  int seen = 0;
  for (;;) {
    while (__atomic_load_n(&g_gen, __ATOMIC_ACQUIRE) == seen) {
      if (__atomic_load_n(&g_stop, __ATOMIC_RELAXED)) return NULL;
      __builtin_ia32_pause();
    }
    seen = __atomic_load_n(&g_gen, __ATOMIC_ACQUIRE);
    drain();
    __atomic_add_fetch(&g_done, 1, __ATOMIC_RELEASE);
  }
}

static void pool_start(int T) {
  static pthread_t th[64];
  g_threads = T > 64 ? 64 : T;
  for (long t = 1; t < g_threads; t++)
    pthread_create(&th[t], NULL, worker, (void *)t);
}
static void pool_stop(void) { __atomic_store_n(&g_stop, 1, __ATOMIC_RELAXED); }

/* "avx", "f16c:6:2", "avx2:auto" -- tier, then optionally the blocking.
   Bare tier means :auto, which is the descending ladder. */
static int g_fk_rows;            /* 0 = auto/ladder, handles any M */
static int fk_select(const char *eng, int *is_float) {
  const struct fk_entry *tab = NULL; int n = 0;
  char tier[16]; const char *colon = strchr(eng, ':');
  size_t tl = colon ? (size_t)(colon - eng) : strlen(eng);
  if (tl >= sizeof tier) return 0;
  memcpy(tier, eng, tl); tier[tl] = 0;
  *is_float = 1;
  g_fk_rows = 0;
  if      (!strcmp(tier, "cref"))   { g_fk = cref_cref; return 1; }
  else if (!strcmp(tier, "avx"))    { tab = avx_table;    n = avx_count; }
  else if (!strcmp(tier, "avxf16")) { tab = avxf16_table; n = avxf16_count; }
  else if (!strcmp(tier, "avx2"))   { tab = avx2_table;   n = avx2_count; }
  else if (!strcmp(tier, "f16c"))   { tab = f16c_table;   n = f16c_count; }
  else { *is_float = 0; return 0; }
  const char *want = colon ? colon + 1 : "auto";
  for (int i = 0; i < n; i++)
    if (!strcmp(tab[i].name, want)) {
      g_fk = tab[i].fn; g_fk_rows = tab[i].rows; return 1; }
  return 0;
}

static void run_parallel(int eng, const void *A, const void *Q, void *C,
                         int M, int K, int N, int T) {
  (void)T;
  G.eng = eng; G.A = A; G.Q = Q; G.C = C; G.M = M; G.K = K; G.N = N;
  G.mb = (M + MBLK - 1) / MBLK; G.nb = (N + NBLK - 1) / NBLK;
  G.units = G.mb * G.nb;
  { const char *o = getenv("ORDER"); if (!o) o = "row";
    if (g_order_n != G.units) build_order(o, G.mb, G.nb); }
  __atomic_store_n(&G.next, 0, __ATOMIC_RELAXED);
  __atomic_store_n(&g_done, 0, __ATOMIC_RELAXED);
  __atomic_add_fetch(&g_gen, 1, __ATOMIC_RELEASE);
  drain();
  while (__atomic_load_n(&g_done, __ATOMIC_ACQUIRE) < g_threads - 1)
    __builtin_ia32_pause();
}

/* ---- driver ------------------------------------------------------------- */
int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "see header\n"); return 2; }

  if (!strcmp(argv[1], "caps")) {
    printf("cref 1\navx %d\navxf16 %d\navx2 %d\nf16c %d\n",
           have_avx(), have_f16c(), have_avx2(), have_avx2() && have_f16c());
    printf("vnni 1\nvnnip 1\namx %d\nbf16 %d\n", amx_have(0), amx_have(1));
    printf("blas %d\n", blas_init(1));
    printf("# blas: %s\n", blas_path ? blas_path : "not found");
    return 0;
  }

  int verify = !strcmp(argv[1], "verify");
  const char *eng = argv[1];
  if (argc < (verify ? 6 : 7)) { fprintf(stderr, "see header\n"); return 2; }
  { const char *e;
    if ((e = getenv("MBLK"))) MBLK = atoi(e);
    if ((e = getenv("NBLK"))) NBLK = atoi(e);
    if (MBLK % 96 || NBLK % 64) {
      fprintf(stderr, "MBLK must be a multiple of 96 and NBLK of 64\n");
      return 2; } }
  int M = atoi(argv[2]), K = atoi(argv[3]), N = atoi(argv[4]);
  int T = atoi(argv[5]);
  int reps = verify ? 1 : atoi(argv[6]);
  if (K % 64 || N % 16) { fprintf(stderr, "K must be a multiple of 64 and "
                                  "N of 16 (tile geometry)\n"); return 2; }

  int want_i8 = verify || !strcmp(eng, "vnni") || !strcmp(eng, "vnnip")
                     || !strcmp(eng, "amx");
  /* blas has no data of its own: it reads the bf16 operands widened to
     fp32, so the fp32 reference column is computing the same numbers the
     tile engine is, not a differently-generated matrix. */
  int want_bf = verify || !strcmp(eng, "bf16") || !strcmp(eng, "blas");
  int want_bl = verify || !strcmp(eng, "blas");
  /* One fp32 weight set feeds avx / avx2 / f16c / avxf16 / blas, so every
     float path computes the same numbers and shares one reference. */
  int is_float = 0;
  int fk_ok = fk_select(eng, &is_float);
  int want_f32 = verify || want_bl || is_float;

  if (!strcmp(eng, "amx")  && !amx_have(0)) { printf("n/a\n"); return 0; }
  if (!strcmp(eng, "vnnip") && N % 64) { printf("n/a\n"); return 0; }
  if (is_float && !verify) {
    if (!fk_ok)                 { printf("n/a\n"); return 0; }   /* no such R:V */
    if (N % 64)                 { printf("n/a\n"); return 0; }
    /* A bare grid entry skips the last (M mod R) rows by design -- the ladder
       is what covers them. Timing one where R does not divide M measures a
       kernel doing LESS than the GOPS formula assumes, and when R > M it
       measures an empty loop: the sweep that found this reported 4443 GOPS
       at M=1 for a kernel that never executed its body. Refuse instead. */
    if (g_fk_rows && M % g_fk_rows) { printf("n/a\n"); return 0; }
    if (!strncmp(eng, "avx", 3) && !have_avx())  { printf("n/a\n"); return 0; }
    if (strstr(eng, "f16")      && !have_f16c()) { printf("n/a\n"); return 0; }
    if (!strncmp(eng, "avx2", 4) && !have_avx2()){ printf("n/a\n"); return 0; }
  }
  if (!strcmp(eng, "bf16") && !amx_have(1)) { printf("n/a\n"); return 0; }

  uint8_t *A8 = NULL; int8_t *W8 = NULL, *Q8 = NULL, *Qp8 = NULL;
  int32_t *C32 = NULL;
  bf16 *Ab = NULL, *Wb = NULL, *Qb = NULL; float *Cf = NULL;
  float *Af32 = NULL, *Wf32 = NULL, *Cf32 = NULL, *Wp32 = NULL;
  uint16_t *Wp16 = NULL;

  srand(1234);
  if (want_i8) {
    A8  = aligned_alloc(64, (size_t)M * K);
    W8  = aligned_alloc(64, (size_t)K * N);
    Q8  = aligned_alloc(64, (size_t)K * N);
    C32 = aligned_alloc(64, (size_t)M * N * 4);
    if (!A8 || !W8 || !Q8 || !C32) { fprintf(stderr, "alloc\n"); return 1; }
    for (size_t i = 0; i < (size_t)M * K; i++) A8[i] = rand() & 0x1f;
    for (size_t i = 0; i < (size_t)K * N; i++) W8[i] = (rand() & 0x1f) - 16;
    pack_i8(W8, Q8, K, N);
    if (N % 64 == 0) {
      Qp8 = aligned_alloc(64, (size_t)K * N);
      if (!Qp8) { fprintf(stderr, "alloc\n"); return 1; }
      pack_i8_panel(W8, Qp8, K, N);
    }
  }
  if (want_bf) {
    Ab = aligned_alloc(64, (size_t)M * K * 2);
    Wb = aligned_alloc(64, (size_t)K * N * 2);
    Qb = aligned_alloc(64, (size_t)K * N * 2);
    Cf = aligned_alloc(64, (size_t)M * N * 4);
    if (!Ab || !Wb || !Qb || !Cf) { fprintf(stderr, "alloc\n"); return 1; }
    for (size_t i = 0; i < (size_t)M * K; i++)
      Ab[i] = f2b(((i * 37) % 1000) / 1000.0f - 0.5f);
    for (size_t i = 0; i < (size_t)K * N; i++)
      Wb[i] = f2b(((i * 53) % 997) / 997.0f - 0.5f);
    pack_bf(Wb, Qb, K, N);
  }
  if (want_bl && !blas_init(T) && !verify) { printf("n/a\n"); return 0; }
  if (want_f32) {
    Af32 = aligned_alloc(64, (size_t)M * K * 4);
    Wf32 = aligned_alloc(64, (size_t)K * N * 4);
    Cf32 = aligned_alloc(64, (size_t)M * N * 4);
    if (!Af32 || !Wf32 || !Cf32) { fprintf(stderr, "alloc\n"); return 1; }
    for (size_t i = 0; i < (size_t)M * K; i++)
      Af32[i] = ((i * 37) % 1000) / 1000.0f - 0.5f;
    for (size_t i = 0; i < (size_t)K * N; i++)
      Wf32[i] = ((i * 53) % 997) / 997.0f - 0.5f;
    if (N % 64 == 0) {
      Wp32 = aligned_alloc(64, (size_t)K * N * 4);
      Wp16 = aligned_alloc(64, (size_t)K * N * 2);
      if (!Wp32 || !Wp16) { fprintf(stderr, "alloc\n"); return 1; }
      pack_f32_panel(Wf32, Wp32, K, N);
      /* fp16 is packed FROM the fp32 set, so the only difference between the
         avx2 and f16c rows is the storage width -- not a different matrix. */
      pack_f16_panel(Wf32, Wp16, K, N);
    }
  }

  /* The pool spins, so it must not exist while BLAS runs -- three spinning
     threads against OpenBLAS's own four is not a measurement of OpenBLAS.
     Started after the operands are built, for the same reason. */
  if (verify || strcmp(eng, "blas")) pool_start(T);

  if (verify) {
    int32_t *ref = aligned_alloc(64, (size_t)M * N * 4);
    ref_i32(A8, W8, ref, M, K, N);
    const int ids[] = { 0, 3, 1 };
    const char *names[] = { "vnni", "vnnip", "amx" };
    for (int e = 0; e < 3; e++) {
      if (ids[e] == 1 && !amx_have(0)) { printf("amx   skipped (no AMX-INT8)\n"); continue; }
      if (ids[e] == 3 && !Qp8) { printf("vnnip skipped (N %% 64)\n"); continue; }
      memset(C32, 0, (size_t)M * N * 4);
      run_parallel(ids[e], A8, ids[e] == 3 ? Qp8 : Q8, C32, M, K, N, T);
      size_t bad = 0;
      for (size_t i = 0; i < (size_t)M * N; i++) if (C32[i] != ref[i]) bad++;
      printf("%-5s %s (%zu mismatches)\n", names[e], bad ? "FAIL" : "exact", bad);
    }
    free(ref);

    if (Wp32) {
      float *rf = aligned_alloc(64, (size_t)M * N * 4);
      ref_f32(Af32, Wf32, rf, M, K, N);
      /* Every grid point is checked, not just the default blocking. A wrong
         ROWS x VEC is fast and wrong -- an off-by-one in a tail writes
         plausible numbers -- which is the failure mode blocking actually has. */
      const struct { const char *n; const struct fk_entry *t; const int *c;
                     int ok; const void *w; } fl[] = {
        { "cref",   NULL,         NULL,          1,                          Wp32 },
        { "avx",    avx_table,    &avx_count,    have_avx(),                 Wp32 },
        { "avxf16", avxf16_table, &avxf16_count, have_f16c(),                Wp16 },
        { "avx2",   avx2_table,   &avx2_count,   have_avx2(),                Wp32 },
        { "f16c",   f16c_table,   &f16c_count,   have_avx2() && have_f16c(), Wp16 },
      };
      for (int e = 0; e < 5; e++) {
        if (!fl[e].ok) { printf("%-6s skipped (no ISA)\n", fl[e].n); continue; }
        int nv = fl[e].t ? *fl[e].c : 1;
        double wv = 0, sv = 0; int bad = 0; const char *badn = NULL;
        int skipped = 0;
        for (int g = 0; g < nv; g++) {
        /* A bare grid entry leaves (rows mod R) undone by design -- the
           ladder is what covers them -- so it is only checkable standalone
           when R divides M. `auto` (rows == 0) is always checkable. */
        if (fl[e].t && fl[e].t[g].rows && M % fl[e].t[g].rows) { skipped++; continue; }
        g_fk = fl[e].t ? fl[e].t[g].fn : cref_cref;
        memset(Cf32, 0, (size_t)M * N * 4);
        run_parallel(4, Af32, fl[e].w, Cf32, M, K, N, T);
        double worst = 0, scale = 0;
        for (size_t i = 0; i < (size_t)M * N; i++) {
          double d = Cf32[i] - rf[i]; if (d < 0) d = -d;
          if (d > worst) worst = d;
          double v = rf[i] < 0 ? -rf[i] : rf[i]; if (v > scale) scale = v;
        }
        /* fp16 storage rounds the weights, so the f16 rows are held to 1e-3
           of result scale and the fp32 rows to 1e-5. Both are tolerances, not
           equality: the reference sums in a different order. */
        double bar = strstr(fl[e].n, "f16") ? 1e-3 : 1e-5;
        if (worst / scale >= bar) { bad++; badn = fl[e].t ? fl[e].t[g].name : "-"; }
        if (worst > wv) wv = worst;
        sv = scale;
        }
        printf("%-6s %s (%d blockings checked, %d skipped, worst err %.2e"
               " of scale %.2e%s%s)\n", fl[e].n, bad ? "FAIL" : "match",
               nv - skipped, skipped, wv / (sv ? sv : 1), sv,
               bad ? ", first bad: " : "", bad ? badn : "");
      }
      free(rf);
    }

    if (amx_have(1)) {
      float *rb = aligned_alloc(64, (size_t)M * N * 4);
      ref_bf(Ab, Wb, rb, M, K, N);
      memset(Cf, 0, (size_t)M * N * 4);
      run_parallel(2, Ab, Qb, Cf, M, K, N, T);
      double worst = 0, scale = 0;
      for (size_t i = 0; i < (size_t)M * N; i++) {
        double d = Cf[i] - rb[i]; if (d < 0) d = -d;
        if (d > worst) worst = d;
        double v = rb[i] < 0 ? -rb[i] : rb[i]; if (v > scale) scale = v;
      }
      /* Tolerance, not equality: the reference accumulates bf16 products in
         fp32 in a different order than the tile does, so the two disagree in
         the last bits by construction. 1e-5 of the result SCALE (not per
         element -- these outputs straddle zero) is the bar. */
      printf("bf16  %s (max err %.2e of scale %.2e)\n",
             worst / scale < 1e-5 ? "match" : "FAIL", worst / scale, scale);
      free(rb);
    } else printf("bf16  skipped (no AMX-BF16)\n");
    pool_stop();
    return 0;
  }

  double best = 1e18, tot[64]; int nt = 0;
  for (int r = 0; r < reps; r++) {
    double t0 = now();
    if      (!strcmp(eng, "vnni")) run_parallel(0, A8, Q8, C32, M, K, N, T);
    else if (!strcmp(eng, "vnnip")) run_parallel(3, A8, Qp8, C32, M, K, N, T);
    else if (is_float) run_parallel(4, Af32,
               strstr(eng, "f16") ? (const void *)Wp16 : (const void *)Wp32,
               Cf32, M, K, N, T);
    else if (!strcmp(eng, "amx"))  run_parallel(1, A8, Q8, C32, M, K, N, T);
    else if (!strcmp(eng, "bf16")) run_parallel(2, Ab, Qb, Cf,  M, K, N, T);
    else if (!strcmp(eng, "blas")) {
      if (blas64) blas64(CBLAS_ROW_MAJOR, CBLAS_NO_TRANS, CBLAS_NO_TRANS,
                         M, N, K, 1.0f, Af32, K, Wf32, N, 0.0f, Cf32, N);
      else        blas32(CBLAS_ROW_MAJOR, CBLAS_NO_TRANS, CBLAS_NO_TRANS,
                         M, N, K, 1.0f, Af32, K, Wf32, N, 0.0f, Cf32, N);
    }
    else { fprintf(stderr, "unknown engine %s\n", eng); return 2; }
    double d = now() - t0;
    if (d < best) best = d;
    if (nt < 64) tot[nt++] = d;
  }
  for (int i = 1; i < nt; i++) {            /* insertion sort, nt is small */
    double v = tot[i]; int j = i - 1;
    while (j >= 0 && tot[j] > v) { tot[j + 1] = tot[j]; j--; }
    tot[j + 1] = v;
  }
  double ops = 2.0 * M * K * N;
  printf("%.1f %.1f\n", ops / tot[nt / 2] / 1e9, ops / best / 1e9);
  if (strcmp(eng, "blas")) pool_stop();
  return 0;
}
