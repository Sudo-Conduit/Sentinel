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

static int amx_ok(void) {
  unsigned a = 7, b = 0, c = 0, d = 0;
  __asm__ __volatile__("cpuid" : "=a"(a), "=b"(b), "=c"(c), "=d"(d)
                       : "a"(7), "c"(0));
  if (!((d >> 25) & 1)) return 0;                 /* AMX-INT8 */
  if (!((d >> 24) & 1)) return 0;                 /* AMX-TILE */
  if (syscall(SYS_arch_prctl, ARCH_REQ_XCOMP_PERM, XFEATURE_XTILEDATA))
    return 0;
  return 1;
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

/* ---- driver ------------------------------------------------------------- */
int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "see header\n"); return 2; }

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

    if (amx_ok()) {
      memset(C, 0, (size_t)TOT * N * 4);
      run_amx(A, Q, C, TOT, K, N, RPB);
      bad = 0;
      for (size_t i = 0; i < (size_t)TOT * N; i++) if (C[i] != ref[i]) bad++;
      printf("amx %s (%zu mismatches)\n", bad ? "FAIL" : "exact", bad);
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

  if (!strcmp(eng, "amx") && !amx_ok()) { printf("n/a\n"); return 0; }

  if (!strcmp(eng, "blasb")) batch_setup(Af, Bf, Cf, TOT, K, N, RPB);

  double best = 1e18;
  for (int r = 0; r < reps; r++) {
    double t0 = now();
    if      (!strcmp(eng, "code")) run_code(A, W, C, TOT, K, N, RPB);
    else if (!strcmp(eng, "vnni")) run_vnni(A, Q, C, TOT, K, N, RPB);
    else if (!strcmp(eng, "blas")) run_blas(Af, Bf, Cf, TOT, K, N, RPB);
    else if (!strcmp(eng, "blasb")) run_blasb();
    else if (!strcmp(eng, "amx"))  run_amx(A, Q, C, TOT, K, N, RPB);
    else { fprintf(stderr, "unknown engine %s\n", eng); return 2; }
    double d = now() - t0;
    if (d < best) best = d;
  }
  printf("%.2f\n", 2.0 * TOT * N * K / best / 1e9);
  return 0;
}
