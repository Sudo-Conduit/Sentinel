/* engines.c -- how much does each matmul engine care about SHORT blocks?
 *
 * The routed op replaces one B-row matmul with E blocks of B/E rows. So the
 * question for a backend is not peak rate, it is: what happens to that rate
 * when the block gets short? Total rows are held fixed; only rows-per-block
 * varies. Single thread throughout, so this measures the kernel and nothing
 * about scheduling.
 *
 *   code -- plain C triple loop, int32 accumulate. The baseline.
 *   vnni -- AVX-512 VPDPBUSD, int8 x int8 -> int32.
 *   blas -- cblas_sgemm, fp32, single-threaded.
 *   amx  -- AMX-INT8 TDPBSSD, 16x64 tiles. Compiled always, run only where
 *           the CPU has it and the kernel grants XTILEDATA.
 *
 * usage: engines caps
 *        engines amxinfo                              -> why AMX is/isn't usable
 *        engines verify <TOT> <K> <N> <RPB>
 *        engines <engine> <TOT> <K> <N> <RPB> <reps>   -> prints GOPS
 */
#define _GNU_SOURCE
#include <immintrin.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <unistd.h>
#include <sys/syscall.h>

#include <dlfcn.h>

#define CBLAS_ROW_MAJOR 101
#define CBLAS_NO_TRANS  111

/* BLAS is dlopen'd, not linked. Whatever OpenBLAS is already on the box is
   the one under test -- no install, no build dependency. The scipy/numpy
   builds are ILP64 with 64_-suffixed symbols; a distro build is ILP32 with
   plain names. Both are handled. Override the search with BLAS_SO=<path>. */
typedef long i64;
typedef void (*sgemm32_t)(int, int, int, int, int, int, float,
                          const float *, int, const float *, int,
                          float, float *, int);
typedef void (*sgemm64_t)(i64, i64, i64, i64, i64, i64, float,
                          const float *, i64, const float *, i64,
                          float, float *, i64);
typedef void (*batch64_t)(i64, const int *, const int *, const i64 *,
                          const i64 *, const i64 *, const float *,
                          const float **, const i64 *, const float **,
                          const i64 *, const float *, float **, const i64 *,
                          i64, const i64 *);

static void *blas_h;
static sgemm32_t blas_sgemm32;
static sgemm64_t blas_sgemm64;
static batch64_t blas_batch64;
static const char *blas_path, *blas_kind = "none";

static const char *BLAS_CANDIDATES[] = {
  "/usr/local/lib/python3.11/dist-packages/numpy.libs/"
  "libscipy_openblas64_-32a4b2a6.so",
  "libopenblas.so.0", "libopenblas.so", "libblas.so.3", "libmkl_rt.so",
  NULL
};

static int blas_init(void) {
  if (blas_kind[0] != 'n') return 1;
  /* Single thread is the point of this harness. The env var is the lever
     that actually works on every build; setenv before dlopen so the pool is
     never created. 0 = do not override a value the caller set deliberately. */
  setenv("OPENBLAS_NUM_THREADS", "1", 0);
  setenv("OMP_NUM_THREADS", "1", 0);
  const char *env = getenv("BLAS_SO");
  for (int pass = 0; pass < 2 && !blas_h; pass++) {
    for (int i = 0; ; i++) {
      const char *p = pass == 0 ? env : BLAS_CANDIDATES[i];
      if (pass == 0 && (!p || i)) break;
      if (pass == 1 && !p) break;
      blas_h = dlopen(p, RTLD_NOW | RTLD_LOCAL);
      if (blas_h) { blas_path = p; break; }
    }
  }
  if (!blas_h) return 0;

  /* Name mangling varies by build: numpy/scipy wheels prefix scipy_ and
     suffix 64_ (ILP64); a distro build uses the plain cblas_ names. */
  static const char *g64[] = { "scipy_cblas_sgemm64_", "cblas_sgemm64_", NULL };
  static const char *b64[] = { "scipy_cblas_sgemm_batch64_",
                               "cblas_sgemm_batch64_", NULL };
  static const char *g32[] = { "cblas_sgemm", NULL };
  static const char *nt[]  = { "scipy_openblas_set_num_threads64_",
                               "openblas_set_num_threads64_",
                               "openblas_set_num_threads", NULL };

  for (int i = 0; g64[i] && !blas_sgemm64; i++)
    blas_sgemm64 = (sgemm64_t)dlsym(blas_h, g64[i]);
  if (blas_sgemm64) {
    blas_kind = "ilp64";
    for (int i = 0; b64[i] && !blas_batch64; i++)
      blas_batch64 = (batch64_t)dlsym(blas_h, b64[i]);
  } else {
    for (int i = 0; g32[i] && !blas_sgemm32; i++)
      blas_sgemm32 = (sgemm32_t)dlsym(blas_h, g32[i]);
    if (!blas_sgemm32) { dlclose(blas_h); blas_h = NULL; return 0; }
    blas_kind = "lp64";
  }
  void (*setnt)(i64) = NULL;
  for (int i = 0; nt[i] && !setnt; i++) setnt = dlsym(blas_h, nt[i]);
  if (setnt) setnt(1);
  return 1;
}

static void sgemm(int m, int n, int k, const float *A, int lda,
                  const float *B, int ldb, float *C, int ldc) {
  if (blas_sgemm64)
    blas_sgemm64(CBLAS_ROW_MAJOR, CBLAS_NO_TRANS, CBLAS_NO_TRANS,
                 m, n, k, 1.0f, A, lda, B, ldb, 0.0f, C, ldc);
  else
    blas_sgemm32(CBLAS_ROW_MAJOR, CBLAS_NO_TRANS, CBLAS_NO_TRANS,
                 m, n, k, 1.0f, A, lda, B, ldb, 0.0f, C, ldc);
}

static double now(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + 1e-9 * t.tv_nsec;
}

/* ---- AMX availability: the ISA bit AND the kernel's permission ---------- */
#define ARCH_REQ_XCOMP_PERM 0x1023
#define XFEATURE_XTILEDATA  18

#define ARCH_GET_XCOMP_PERM 0x1022

static void cpuid_(unsigned lf, unsigned sub, unsigned *r) {
  __asm__ __volatile__("cpuid" : "=a"(r[0]), "=b"(r[1]), "=c"(r[2]), "=d"(r[3])
                       : "a"(lf), "c"(sub));
}

static int amx_ok(void) {
  unsigned r[4];
  cpuid_(7, 0, r);
  if (!((r[3] >> 24) & 1)) return 0;              /* AMX-TILE */
  if (!((r[3] >> 25) & 1)) return 0;              /* AMX-INT8 */
  if (syscall(SYS_arch_prctl, ARCH_REQ_XCOMP_PERM, XFEATURE_XTILEDATA))
    return 0;                                     /* kernel withheld the grant */
  unsigned lo, hi;
  __asm__ __volatile__("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0));
  unsigned long long xcr0 = ((unsigned long long)hi << 32) | lo;
  if (!((xcr0 >> 17) & 1) || !((xcr0 >> 18) & 1)) return 0;   /* TILE state off */
  return 1;
}

/* Says WHY, not just whether. A hypervisor that masks CPUID and a kernel that
   withholds XTILEDATA look identical from `amx 0`, and they are not the same
   problem. Run this on the box you think has AMX. */
static void amx_report(void) {
  unsigned r[4];
  cpuid_(0, 0, r);
  printf("max cpuid leaf     : %u%s\n", r[0],
         r[0] < 0x1d ? "  (< 0x1d: AMX palette leaves not even enumerable)" : "");
  cpuid_(7, 0, r);
  printf("leaf 7.0 edx       : 0x%08x  AMX-TILE(24)=%u AMX-INT8(25)=%u "
         "AMX-BF16(22)=%u\n", r[3], (r[3] >> 24) & 1, (r[3] >> 25) & 1,
         (r[3] >> 22) & 1);
  cpuid_(0xd, 0, r);
  printf("leaf D.0 xcr0 mask : 0x%08x  XTILECFG(17)=%u XTILEDATA(18)=%u\n",
         r[0], (r[0] >> 17) & 1, (r[0] >> 18) & 1);
  unsigned lo, hi;
  __asm__ __volatile__("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0));
  unsigned long long xcr0 = ((unsigned long long)hi << 32) | lo;
  printf("XCR0 (live)        : 0x%llx  bit17=%llu bit18=%llu\n",
         xcr0, (xcr0 >> 17) & 1, (xcr0 >> 18) & 1);
  long rc = syscall(SYS_arch_prctl, ARCH_REQ_XCOMP_PERM, XFEATURE_XTILEDATA);
  unsigned long long perm = 0;
  syscall(SYS_arch_prctl, ARCH_GET_XCOMP_PERM, &perm);
  printf("XTILEDATA grant    : req=%ld perm=0x%llx\n", rc, perm);
  printf("verdict            : %s\n", amx_ok() ? "AMX-INT8 usable"
                                               : "AMX-INT8 NOT usable here");
}

/* ---- backends ----------------------------------------------------------- */
/* All int8 backends consume the same VNNI-packed weights Q: for k4 in K/4,
   for j in N, four consecutive k-bytes of column j. AMX reads the same bytes
   as 16 rows of 64B (16 columns x 4 k), which is exactly that layout. */

static void pack_vnni(const int8_t *W, int8_t *Q, int K, int N) {
  for (int k4 = 0; k4 < K / 4; k4++)
    for (int j = 0; j < N; j++)
      for (int t = 0; t < 4; t++)
        Q[((size_t)k4 * N + j) * 4 + t] = W[(size_t)(k4 * 4 + t) * N + j];
}

static void run_code(const uint8_t *A, const int8_t *W, int32_t *C,
                     int TOT, int K, int N, int RPB) {
  for (int blk = 0; blk < TOT; blk += RPB) {
    int hi = blk + RPB > TOT ? TOT : blk + RPB;
    for (int i = blk; i < hi; i++) {
      const uint8_t *a = A + (size_t)i * K;
      int32_t *o = C + (size_t)i * N;
      for (int j = 0; j < N; j++) o[j] = 0;
      for (int k = 0; k < K; k++) {
        int32_t av = a[k];
        const int8_t *w = W + (size_t)k * N;
        for (int j = 0; j < N; j++) o[j] += av * w[j];
      }
    }
  }
}

static void run_vnni(const uint8_t *A, const int8_t *Q, int32_t *C,
                     int TOT, int K, int N, int RPB) {
  for (int blk = 0; blk < TOT; blk += RPB) {
    int hi = blk + RPB > TOT ? TOT : blk + RPB;
    for (int i = blk; i < hi; i++) {
      const uint8_t *a = A + (size_t)i * K;
      for (int j = 0; j + 64 <= N; j += 64) {
        __m512i c0 = _mm512_setzero_si512(), c1 = _mm512_setzero_si512();
        __m512i c2 = _mm512_setzero_si512(), c3 = _mm512_setzero_si512();
        for (int k4 = 0; k4 < K / 4; k4++) {
          __m512i av = _mm512_set1_epi32(*(const int32_t *)(a + k4 * 4));
          const int8_t *b = Q + ((size_t)k4 * N + j) * 4;
          c0 = _mm512_dpbusd_epi32(c0, av, _mm512_loadu_si512((void *)b));
          c1 = _mm512_dpbusd_epi32(c1, av, _mm512_loadu_si512((void *)(b + 64)));
          c2 = _mm512_dpbusd_epi32(c2, av, _mm512_loadu_si512((void *)(b + 128)));
          c3 = _mm512_dpbusd_epi32(c3, av, _mm512_loadu_si512((void *)(b + 192)));
        }
        int32_t *o = C + (size_t)i * N + j;
        _mm512_storeu_si512((void *)o, c0);
        _mm512_storeu_si512((void *)(o + 16), c1);
        _mm512_storeu_si512((void *)(o + 32), c2);
        _mm512_storeu_si512((void *)(o + 48), c3);
      }
    }
  }
}

/* ---- the WASM finding, ported ------------------------------------------
 *
 * run_vnni above is ROWS=1, VEC=4 in the vocabulary fold.c settled on: one
 * row at a time, four zmm accumulators, 64 columns per j step. That is the
 * same shape the f32x4 kernel started in, and it is the shape that cost that
 * kernel 1.8x. Each 64-byte load of Q feeds exactly one row, so arithmetic
 * intensity is 2 ops per weight byte no matter how wide the j step gets --
 * VEC buys access granularity, ROWS buys intensity, and only ROWS was
 * missing. The README's explanation for why this kernel sits at 62 GOPS
 * while BLAS reaches 120 is exactly that ("it re-streams B for every row"),
 * so the fix is not a new idea, it is the idea already written down.
 *
 * What does NOT transfer is the constant. x86-64 exposes 32 zmm to this
 * kernel against the 16 xmm the wasm JIT exposes, and a VNNI accumulator is
 * 512 bits, so the budget is ROWS*VEC + VEC + ROWS <= 32 -- a different
 * optimum from the wasm one, in the same units. The sweep decides, as it did
 * there: ROWS=4,VEC=4 needs 24 registers and should fit, ROWS=8,VEC=4 needs
 * 44 and should spill, and if the measurement disagrees with that the model
 * is wrong, not the measurement.
 *
 * One asymmetry worth stating up front, because it predicts the shape of the
 * result rather than being explained by it: VPDPBUSD accumulates four k
 * steps per instruction, so a K/4 loop already does what a k-unrolled f32x4
 * loop has to be written to do. The row blocking is the part that was
 * genuinely absent.
 */
typedef void (*int8_kernel)(const uint8_t *, const int8_t *, int32_t *,
                            int, int, int, int);

/* Rows that do not fill a block of R. Same inner kernel at ROWS=1 so the
 * tail costs bandwidth but not vector width -- the fold.c tail lesson. */
static void vnni_tail(const uint8_t *A, const int8_t *Q, int32_t *C,
                      int i0, int i1, int K, int N) {
  for (int i = i0; i < i1; i++) {
    const uint8_t *a = A + (size_t)i * K;
    int j = 0;
    for (; j + 64 <= N; j += 64) {
      __m512i c0 = _mm512_setzero_si512(), c1 = _mm512_setzero_si512();
      __m512i c2 = _mm512_setzero_si512(), c3 = _mm512_setzero_si512();
      for (int k4 = 0; k4 < K / 4; k4++) {
        __m512i av = _mm512_set1_epi32(*(const int32_t *)(a + k4 * 4));
        const int8_t *b = Q + ((size_t)k4 * N + j) * 4;
        c0 = _mm512_dpbusd_epi32(c0, av, _mm512_loadu_si512((void *)b));
        c1 = _mm512_dpbusd_epi32(c1, av, _mm512_loadu_si512((void *)(b + 64)));
        c2 = _mm512_dpbusd_epi32(c2, av, _mm512_loadu_si512((void *)(b + 128)));
        c3 = _mm512_dpbusd_epi32(c3, av, _mm512_loadu_si512((void *)(b + 192)));
      }
      int32_t *o = C + (size_t)i * N + j;
      _mm512_storeu_si512((void *)o, c0);
      _mm512_storeu_si512((void *)(o + 16), c1);
      _mm512_storeu_si512((void *)(o + 32), c2);
      _mm512_storeu_si512((void *)(o + 48), c3);
    }
    for (; j < N; j++) {                      /* N not a multiple of 64 */
      int32_t s = 0;
      for (int k = 0; k < K; k++)
        s += (int32_t)a[k] * (int32_t)Q[((size_t)(k / 4) * N + j) * 4 + (k & 3)];
      C[(size_t)i * N + j] = s;
    }
  }
}

/* R rows and V zmm accumulators per j step. R and V are macro arguments, not
 * parameters: passing the row count in as a runtime value is what flattened
 * the whole ROWS axis in fold.c -- the compiler stopped unrolling and ROWS=1
 * appeared to win everywhere. That was a harness artefact and it is not
 * repeated here. */
#define VNNI_BLOCKED(R, V)                                                    \
static void run_vnni_##R##_##V(const uint8_t *A, const int8_t *Q, int32_t *C, \
                               int TOT, int K, int N, int RPB) {              \
  const int STEP = 16 * (V);                                                  \
  for (int blk = 0; blk < TOT; blk += RPB) {                                  \
    int hi = blk + RPB > TOT ? TOT : blk + RPB;                               \
    int i = blk;                                                              \
    for (; i + (R) <= hi; i += (R)) {                                         \
      int j = 0;                                                              \
      for (; j + STEP <= N; j += STEP) {                                      \
        __m512i acc[R][V];                                                    \
        for (int t = 0; t < (R); t++)                                         \
          for (int v = 0; v < (V); v++) acc[t][v] = _mm512_setzero_si512();   \
        for (int k4 = 0; k4 < K / 4; k4++) {                                  \
          const int8_t *b = Q + ((size_t)k4 * N + j) * 4;                     \
          __m512i bv[V];                                                      \
          for (int v = 0; v < (V); v++)                                       \
            bv[v] = _mm512_loadu_si512((void *)(b + 64 * v));                 \
          for (int t = 0; t < (R); t++) {                                     \
            __m512i av = _mm512_set1_epi32(                                   \
                *(const int32_t *)(A + (size_t)(i + t) * K + k4 * 4));        \
            for (int v = 0; v < (V); v++)                                     \
              acc[t][v] = _mm512_dpbusd_epi32(acc[t][v], av, bv[v]);          \
          }                                                                   \
        }                                                                     \
        for (int t = 0; t < (R); t++)                                         \
          for (int v = 0; v < (V); v++)                                       \
            _mm512_storeu_si512(                                              \
                (void *)(C + (size_t)(i + t) * N + j + 16 * v), acc[t][v]);   \
      }                                                                       \
      if (j < N) vnni_tail(A, Q, C, i, i + (R), K, N);   /* rare: N % STEP */ \
    }                                                                         \
    if (i < hi) vnni_tail(A, Q, C, i, hi, K, N);                              \
  }                                                                           \
}

VNNI_BLOCKED(1, 1) VNNI_BLOCKED(1, 2) VNNI_BLOCKED(1, 4)
VNNI_BLOCKED(2, 1) VNNI_BLOCKED(2, 2) VNNI_BLOCKED(2, 4)
VNNI_BLOCKED(4, 1) VNNI_BLOCKED(4, 2) VNNI_BLOCKED(4, 4)
VNNI_BLOCKED(6, 2) VNNI_BLOCKED(6, 4)
VNNI_BLOCKED(8, 2) VNNI_BLOCKED(8, 4)

/* The ladder. A fixed R collapses the moment the block is shorter than R:
 * the leftover rows fall to the ROWS=1 tail, which runs at a fifth of the
 * blocked rate, and the block-height sweep shows it exactly -- VNNI 6x4 does
 * 318 GOPS at 12 rows per block and 166 at 16, because 16 rows is two full
 * blocks of 6 plus four rows at 63. That is not a cliff in the ISA, it is
 * 12/318 + 4/63 seconds of arithmetic, and the arithmetic says the fix:
 * descend through the widths instead of falling off the end of one.
 *
 * This is the fold.c ragged-tail lesson taken seriously. There I widened the
 * tail to the same VEC as the main path and claimed +15.6%, then retracted
 * it -- at 11 rows per expert the tail was 1 row in 11 and could never have
 * been worth 26 points. Here the tail is up to R-1 rows in R, which at a
 * 5x rate difference is the whole measurement. Same idea, and this time the
 * arithmetic says before the run that it should matter. */
static void run_vnni_auto(const uint8_t *A, const int8_t *Q, int32_t *C,
                          int TOT, int K, int N, int RPB);

static const struct { const char *name; int8_kernel fn; int regs; }
VNNI_VARIANTS[] = {
  { "vnni:1:1", run_vnni_1_1,  3 }, { "vnni:1:2", run_vnni_1_2,  5 },
  { "vnni:1:4", run_vnni_1_4,  9 }, { "vnni:2:1", run_vnni_2_1,  5 },
  { "vnni:2:2", run_vnni_2_2,  8 }, { "vnni:2:4", run_vnni_2_4, 14 },
  { "vnni:4:1", run_vnni_4_1,  9 }, { "vnni:4:2", run_vnni_4_2, 14 },
  { "vnni:4:4", run_vnni_4_4, 24 }, { "vnni:6:2", run_vnni_6_2, 20 },
  { "vnni:6:4", run_vnni_6_4, 34 }, { "vnni:8:2", run_vnni_8_2, 26 },
  { "vnni:8:4", run_vnni_8_4, 44 }, { "vnni:auto", run_vnni_auto, 34 },
};
#define N_VNNI (int)(sizeof VNNI_VARIANTS / sizeof VNNI_VARIANTS[0])

static void run_vnni_auto(const uint8_t *A, const int8_t *Q, int32_t *C,
                          int TOT, int K, int N, int RPB) {
  for (int blk = 0; blk < TOT; blk += RPB) {
    int hi = blk + RPB > TOT ? TOT : blk + RPB;
    int i = blk;
    while (i < hi) {
      int left = hi - i;
      int8_kernel f; int take;
      if      (left >= 8) { f = run_vnni_8_4; take = (left / 8) * 8; }
      else if (left >= 6) { f = run_vnni_6_4; take = 6; }
      else if (left >= 4) { f = run_vnni_4_4; take = 4; }
      else if (left >= 2) { f = run_vnni_2_4; take = 2; }
      else                { f = run_vnni_1_4; take = 1; }
      f(A + (size_t)i * K, Q, C + (size_t)i * N, take, K, N, take);
      i += take;
    }
  }
}


static void run_blas(const float *Af, const float *Bf, float *Cf,
                     int TOT, int K, int N, int RPB) {
  for (int blk = 0; blk < TOT; blk += RPB) {
    int m = blk + RPB > TOT ? TOT - blk : RPB;
    sgemm(m, N, K, Af + (size_t)blk * K, K, Bf, N, Cf + (size_t)blk * N, N);
  }
}

/* One cblas_sgemm_batch for every block, instead of one call per block.
   This is the shape the routed op actually produces: E independent small
   GEMMs, known up front, sharing nothing but the weight matrix. */
static int *bi_ta, *bi_tb;
static i64 *bi_m, *bi_n, *bi_k, *bi_lda, *bi_ldb, *bi_ldc,
           *bi_gs;
static float *bi_alpha, *bi_beta;
static const float **bi_a, **bi_b;
static float **bi_c;
static i64 bi_groups;

static void batch_setup(const float *Af, const float *Bf, float *Cf,
                        int TOT, int K, int N, int RPB) {
  int g = (TOT + RPB - 1) / RPB;
  bi_groups = g;
  bi_ta = malloc(sizeof(int) * g);  bi_tb  = malloc(sizeof(int) * g);
  bi_m  = malloc(sizeof(i64) * g);  bi_n   = malloc(sizeof(i64) * g);
  bi_k  = malloc(sizeof(i64) * g);  bi_lda = malloc(sizeof(i64) * g);
  bi_ldb= malloc(sizeof(i64) * g);  bi_ldc = malloc(sizeof(i64) * g);
  bi_gs = malloc(sizeof(i64) * g);
  bi_alpha = malloc(sizeof(float) * g); bi_beta = malloc(sizeof(float) * g);
  bi_a = malloc(sizeof(float *) * g);   bi_b = malloc(sizeof(float *) * g);
  bi_c = malloc(sizeof(float *) * g);
  for (int i = 0; i < g; i++) {
    int blk = i * RPB;
    int m = blk + RPB > TOT ? TOT - blk : RPB;
    bi_ta[i] = CBLAS_NO_TRANS; bi_tb[i] = CBLAS_NO_TRANS;
    bi_m[i] = m; bi_n[i] = N; bi_k[i] = K;
    bi_lda[i] = K; bi_ldb[i] = N; bi_ldc[i] = N;
    bi_alpha[i] = 1.0f; bi_beta[i] = 0.0f;
    bi_gs[i] = 1;
    bi_a[i] = Af + (size_t)blk * K;
    bi_b[i] = Bf;
    bi_c[i] = Cf + (size_t)blk * N;
  }
}

static void run_blasb(void) {
  blas_batch64(CBLAS_ROW_MAJOR, bi_ta, bi_tb, bi_m, bi_n, bi_k, bi_alpha,
               bi_a, bi_lda, bi_b, bi_ldb, bi_beta, bi_c, bi_ldc,
               bi_groups, bi_gs);
}

/* AMX. Tiles: 0 = C (rows_m x 16 int32), 1 = A (rows_m x 64 int8),
   2 = B (16 x 64 int8). Tile shape is configured once per distinct block
   height, so what this measures is under-occupancy, not LDTILECFG churn. */
typedef struct {
  uint8_t palette, start_row, rsvd[14];
  uint16_t colsb[16];
  uint8_t rows[16];
} tilecfg;

static void amx_config(int rows_m) {
  tilecfg c; memset(&c, 0, sizeof c);
  c.palette = 1;
  c.rows[0] = rows_m; c.colsb[0] = 64;   /* C */
  c.rows[1] = rows_m; c.colsb[1] = 64;   /* A */
  c.rows[2] = 16;     c.colsb[2] = 64;   /* B */
  _tile_loadconfig(&c);
}

static void run_amx(const uint8_t *A, const int8_t *Q, int32_t *C,
                    int TOT, int K, int N, int RPB) {
  int cur = -1;
  for (int blk = 0; blk < TOT; blk += RPB) {
    int hi = blk + RPB > TOT ? TOT : blk + RPB;
    for (int i0 = blk; i0 < hi; i0 += 16) {
      int m = hi - i0 > 16 ? 16 : hi - i0;
      if (m != cur) { amx_config(m); cur = m; }
      for (int j = 0; j + 16 <= N; j += 16) {
        _tile_zero(0);
        for (int k0 = 0; k0 + 64 <= K; k0 += 64) {
          _tile_loadd(1, A + (size_t)i0 * K + k0, K);
          _tile_loadd(2, Q + ((size_t)(k0 / 4) * N + j) * 4, (size_t)N * 4);
          _tile_dpbssd(0, 1, 2);
        }
        _tile_stored(0, C + (size_t)i0 * N + j, (size_t)N * 4);
      }
    }
  }
  _tile_release();
}

/* ---- the same finding on AMX -------------------------------------------
 *
 * run_amx above uses three of the eight tiles: one A, one B, one C. That
 * means every TDPBSSD is preceded by two TILELOADDs, a 2:1 load-to-MAC
 * ratio, and it is the tile-register spelling of exactly the mistake the
 * f32x4 kernel made -- each weight load feeds one output block instead of
 * several. On AMX the accumulator blocking is not ROWS and VEC, it is how
 * many C tiles are live at once, but the budget arithmetic is the same
 * shape: RT*CT + RT + CT <= 8.
 *
 *   1:1   3 tiles, 2 loads per MAC     (what is there now)
 *   1:2   5 tiles, 1.5 loads per MAC
 *   2:2   8 tiles, 1 load per MAC      (the canonical AMX GEMM shape)
 *
 * Tile indices must be immediates, so these are written out rather than
 * generated -- a macro cannot pass a loop variable to _tile_dpbssd.
 *
 * NOT MEASURED. This box reports AMX-TILE=0 (`engines amxinfo`), so nothing
 * below has executed. It is wired into `engines verify` so the first AMX box
 * it meets checks it against the plain-C reference before any number is
 * taken, because an untested tile kernel that merely compiles has proven
 * nothing. What IS predicted, and what the sweep on that box should show:
 * the same ordering as VNNI (more live accumulators wins until the register
 * file runs out), a bigger effect than on VNNI because the load:MAC ratio
 * halves rather than shrinking by a fraction, and a WORSE ragged tail than
 * either -- TDPBSSD consumes a 16-row tile, so a block of 11 rows, which is
 * what a 64-expert model at B=720 actually produces, discards 5/16 of every
 * multiply no matter how the accumulators are arranged.
 */
static void amx_config_n(int rows_a0, int rows_a1, int nc, int na, int nb) {
  tilecfg c; memset(&c, 0, sizeof c);
  c.palette = 1;
  for (int t = 0; t < nc; t++) {           /* C tiles, row-major over RT x CT */
    c.rows[t] = (na == 2 && t >= nc / 2) ? rows_a1 : rows_a0;
    c.colsb[t] = 64;
  }
  c.rows[nc] = rows_a0; c.colsb[nc] = 64;                  /* A0 */
  if (na == 2) { c.rows[nc + 1] = rows_a1; c.colsb[nc + 1] = 64; }
  for (int v = 0; v < nb; v++) { c.rows[nc + na + v] = 16;
                                 c.colsb[nc + na + v] = 64; }
  _tile_loadconfig(&c);
}

/* 1 row-tile, 2 column-tiles: tmm0,1 = C; tmm2 = A; tmm3,4 = B. */
static void run_amx_1_2(const uint8_t *A, const int8_t *Q, int32_t *C,
                        int TOT, int K, int N, int RPB) {
  int cur = -1;
  for (int blk = 0; blk < TOT; blk += RPB) {
    int hi = blk + RPB > TOT ? TOT : blk + RPB;
    for (int i0 = blk; i0 < hi; i0 += 16) {
      int m = hi - i0 > 16 ? 16 : hi - i0;
      if (m != cur) { amx_config_n(m, 0, 2, 1, 2); cur = m; }
      int j = 0;
      for (; j + 32 <= N; j += 32) {
        _tile_zero(0); _tile_zero(1);
        for (int k0 = 0; k0 + 64 <= K; k0 += 64) {
          _tile_loadd(2, A + (size_t)i0 * K + k0, K);
          _tile_loadd(3, Q + ((size_t)(k0 / 4) * N + j) * 4, (size_t)N * 4);
          _tile_loadd(4, Q + ((size_t)(k0 / 4) * N + j + 16) * 4, (size_t)N * 4);
          _tile_dpbssd(0, 2, 3);
          _tile_dpbssd(1, 2, 4);
        }
        _tile_stored(0, C + (size_t)i0 * N + j, (size_t)N * 4);
        _tile_stored(1, C + (size_t)i0 * N + j + 16, (size_t)N * 4);
      }
      if (j < N) { _tile_release(); cur = -1;
                   run_amx(A, Q, C, i0 + 16 > hi ? hi - i0 : 16, K, N, RPB); }
    }
  }
  _tile_release();
}

/* 2 row-tiles, 2 column-tiles -- all eight tiles live, one load per MAC.
   tmm0..3 = C in (row-tile, col-tile) order; tmm4,5 = A; tmm6,7 = B. */
static void run_amx_2_2(const uint8_t *A, const int8_t *Q, int32_t *C,
                        int TOT, int K, int N, int RPB) {
  int cur0 = -1, cur1 = -1;
  for (int blk = 0; blk < TOT; blk += RPB) {
    int hi = blk + RPB > TOT ? TOT : blk + RPB;
    int i0 = blk;
    for (; i0 + 32 <= hi; i0 += 32) {
      if (cur0 != 16 || cur1 != 16) { amx_config_n(16, 16, 4, 2, 2);
                                      cur0 = cur1 = 16; }
      int j = 0;
      for (; j + 32 <= N; j += 32) {
        _tile_zero(0); _tile_zero(1); _tile_zero(2); _tile_zero(3);
        for (int k0 = 0; k0 + 64 <= K; k0 += 64) {
          _tile_loadd(4, A + (size_t)i0 * K + k0, K);
          _tile_loadd(5, A + (size_t)(i0 + 16) * K + k0, K);
          _tile_loadd(6, Q + ((size_t)(k0 / 4) * N + j) * 4, (size_t)N * 4);
          _tile_loadd(7, Q + ((size_t)(k0 / 4) * N + j + 16) * 4, (size_t)N * 4);
          _tile_dpbssd(0, 4, 6);
          _tile_dpbssd(1, 4, 7);
          _tile_dpbssd(2, 5, 6);
          _tile_dpbssd(3, 5, 7);
        }
        _tile_stored(0, C + (size_t)i0 * N + j, (size_t)N * 4);
        _tile_stored(1, C + (size_t)i0 * N + j + 16, (size_t)N * 4);
        _tile_stored(2, C + (size_t)(i0 + 16) * N + j, (size_t)N * 4);
        _tile_stored(3, C + (size_t)(i0 + 16) * N + j + 16, (size_t)N * 4);
      }
      if (j < N) { _tile_release(); cur0 = cur1 = -1;
                   run_amx(A, Q, C, 32, K, N, RPB); }
    }
    if (i0 < hi) {                        /* fewer than 32 rows left */
      _tile_release(); cur0 = cur1 = -1;
      run_amx(A + (size_t)i0 * K, Q, C + (size_t)i0 * N,
              hi - i0, K, N, hi - i0);
    }
  }
  _tile_release();
}

/* Same ladder as vnni:auto, on tiles. 2x2 needs 32 rows, 1x2 needs 16, and
   below 16 every variant is padding a 16-row tile whatever it does -- that
   floor is the ISA and no arrangement of accumulators moves it. Which is the
   one place the WASM lesson does NOT transfer: an f32x4 kernel with a
   descending ladder reaches rows=1 at full width, and AMX cannot. */
static void run_amx_auto(const uint8_t *A, const int8_t *Q, int32_t *C,
                         int TOT, int K, int N, int RPB) {
  for (int blk = 0; blk < TOT; blk += RPB) {
    int hi = blk + RPB > TOT ? TOT : blk + RPB;
    int i = blk;
    while (i < hi) {
      int left = hi - i, take;
      if (left >= 32) take = (left / 32) * 32;
      else            take = left;
      if (take >= 32)
        run_amx_2_2(A + (size_t)i * K, Q, C + (size_t)i * N, take, K, N, take);
      else
        run_amx_1_2(A + (size_t)i * K, Q, C + (size_t)i * N, take, K, N, take);
      i += take;
    }
  }
}

/* ---- driver ------------------------------------------------------------- */
int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "see header\n"); return 2; }

  if (!strcmp(argv[1], "amxinfo")) { amx_report(); return 0; }

  if (!strcmp(argv[1], "caps")) {
    int b = blas_init();
    printf("code 1\nvnni 1\nblas %d\nblasb %d\namx %d\n",
           b, b && blas_batch64 != NULL, amx_ok());
    printf("# blas: %s (%s)\n", b ? blas_path : "not found", blas_kind);
    return 0;
  }

  int verify = !strcmp(argv[1], "verify");
  const char *eng = verify ? "all" : argv[1];
  int base = verify ? 2 : 2;
  int TOT = atoi(argv[base]), K = atoi(argv[base + 1]);
  int N = atoi(argv[base + 2]), RPB = atoi(argv[base + 3]);
  int reps = verify ? 1 : atoi(argv[base + 4]);

  uint8_t *A = aligned_alloc(64, (size_t)TOT * K);
  int8_t  *W = aligned_alloc(64, (size_t)K * N);
  int8_t  *Q = aligned_alloc(64, (size_t)K * N);
  int32_t *C = aligned_alloc(64, (size_t)TOT * N * 4);
  if (!A || !W || !Q || !C) { fprintf(stderr, "alloc\n"); return 1; }

  srand(1234);
  for (size_t i = 0; i < (size_t)TOT * K; i++) A[i] = rand() & 0x1f;
  for (size_t i = 0; i < (size_t)K * N; i++) W[i] = (rand() & 0x1f) - 16;
  pack_vnni(W, Q, K, N);

  float *Af = NULL, *Bf = NULL, *Cf = NULL;
  int want_blas = verify || !strcmp(eng, "blas") || !strcmp(eng, "blasb");
  if (want_blas) {
    if (!blas_init()) { printf("n/a\n"); return 0; }
    if (!strcmp(eng, "blasb") && !blas_batch64) { printf("n/a\n"); return 0; }
    Af = aligned_alloc(64, (size_t)TOT * K * 4);
    Bf = aligned_alloc(64, (size_t)K * N * 4);
    Cf = aligned_alloc(64, (size_t)TOT * N * 4);
    if (!Af || !Bf || !Cf) { fprintf(stderr, "alloc\n"); return 1; }
    for (size_t i = 0; i < (size_t)TOT * K; i++) Af[i] = (float)A[i];
    for (size_t i = 0; i < (size_t)K * N; i++) Bf[i] = (float)W[i];
  }

  if (verify) {
    int32_t *ref = aligned_alloc(64, (size_t)TOT * N * 4);
    run_code(A, W, ref, TOT, K, N, RPB);

    memset(C, 0, (size_t)TOT * N * 4);
    run_vnni(A, Q, C, TOT, K, N, RPB);
    size_t bad = 0;
    for (size_t i = 0; i < (size_t)TOT * N; i++) if (C[i] != ref[i]) bad++;
    printf("vnni %s (%zu mismatches)\n", bad ? "FAIL" : "exact", bad);

    /* Every blocked variant is checked, not just the default one. A register
       blocking that is fast and wrong is the failure mode these kernels
       actually have -- an off-by-one in the tail writes plausible numbers. */
    for (int v = 0; v < N_VNNI; v++) {
      memset(C, 0, (size_t)TOT * N * 4);
      VNNI_VARIANTS[v].fn(A, Q, C, TOT, K, N, RPB);
      bad = 0;
      for (size_t i = 0; i < (size_t)TOT * N; i++) if (C[i] != ref[i]) bad++;
      printf("%-9s %s (%zu mismatches)\n", VNNI_VARIANTS[v].name,
             bad ? "FAIL" : "exact", bad);
    }

    if (amx_ok()) {
      struct { const char *n; void (*f)(const uint8_t *, const int8_t *,
                                        int32_t *, int, int, int, int); } av[] = {
        { "amx", run_amx }, { "amx:1:2", run_amx_1_2 }, { "amx:2:2", run_amx_2_2 },
        { "amx:auto", run_amx_auto },
      };
      for (int v = 0; v < 4; v++) {
        memset(C, 0, (size_t)TOT * N * 4);
        av[v].f(A, Q, C, TOT, K, N, RPB);
        bad = 0;
        for (size_t i = 0; i < (size_t)TOT * N; i++) if (C[i] != ref[i]) bad++;
        printf("%-9s %s (%zu mismatches)\n", av[v].n, bad ? "FAIL" : "exact", bad);
      }
    } else {
      printf("amx skipped (no AMX-INT8 on this cpu)\n");
    }

    run_blas(Af, Bf, Cf, TOT, K, N, RPB);
    double worst = 0;
    for (size_t i = 0; i < (size_t)TOT * N; i++) {
      double d = Cf[i] - (double)ref[i];
      if (d < 0) d = -d;
      double r = d / (ref[i] ? (ref[i] < 0 ? -(double)ref[i] : ref[i]) : 1);
      if (r > worst) worst = r;
    }
    printf("blas %s (max rel err %.2e, fp32)\n", worst < 1e-4 ? "match" : "FAIL", worst);

    if (blas_batch64) {
      memset(Cf, 0, (size_t)TOT * N * 4);
      batch_setup(Af, Bf, Cf, TOT, K, N, RPB);
      run_blasb();
      worst = 0;
      for (size_t i = 0; i < (size_t)TOT * N; i++) {
        double d = Cf[i] - (double)ref[i]; if (d < 0) d = -d;
        double r = d / (ref[i] ? (ref[i] < 0 ? -(double)ref[i] : ref[i]) : 1);
        if (r > worst) worst = r;
      }
      printf("blasb %s (max rel err %.2e, fp32)\n",
             worst < 1e-4 ? "match" : "FAIL", worst);
    } else {
      printf("blasb skipped (no cblas_sgemm_batch64_ in %s)\n", blas_path);
    }
    return 0;
  }

  if (!strncmp(eng, "amx", 3) && !amx_ok()) { printf("n/a\n"); return 0; }

  if (!strcmp(eng, "blasb")) batch_setup(Af, Bf, Cf, TOT, K, N, RPB);

  double best = 1e18;
  for (int r = 0; r < reps; r++) {
    double t0 = now();
    if      (!strcmp(eng, "code")) run_code(A, W, C, TOT, K, N, RPB);
    else if (!strcmp(eng, "vnni")) run_vnni(A, Q, C, TOT, K, N, RPB);
    else if (!strcmp(eng, "blas")) run_blas(Af, Bf, Cf, TOT, K, N, RPB);
    else if (!strcmp(eng, "blasb")) run_blasb();
    else if (!strcmp(eng, "amx"))  run_amx(A, Q, C, TOT, K, N, RPB);
    else if (!strcmp(eng, "amx:1:2")) run_amx_1_2(A, Q, C, TOT, K, N, RPB);
    else if (!strcmp(eng, "amx:2:2")) run_amx_2_2(A, Q, C, TOT, K, N, RPB);
    else if (!strcmp(eng, "amx:auto")) run_amx_auto(A, Q, C, TOT, K, N, RPB);
    else if (!strncmp(eng, "vnni:", 5)) {
      int v = 0;
      for (; v < N_VNNI && strcmp(eng, VNNI_VARIANTS[v].name); v++) {}
      if (v == N_VNNI) { fprintf(stderr, "unknown vnni variant %s\n", eng); return 2; }
      VNNI_VARIANTS[v].fn(A, Q, C, TOT, K, N, RPB);
    }
    else { fprintf(stderr, "unknown engine %s\n", eng); return 2; }
    double d = now() - t0;
    if (d < best) best = d;
  }
  printf("%.2f\n", 2.0 * TOT * N * K / best / 1e9);
  return 0;
}
