/* membw.c -- the missing half of a machine fingerprint.
 *
 * Two dense tables in one session, recorded 12 hours apart, carried the
 * IDENTICAL host record:
 *
 *   {"model":"Intel(R) Xeon(R) Processor @ 2.10GHz","cores":4,"threads":4,
 *    "features":["avx512f","avx512_vnni","amx_tile","amx_int8","amx_bf16"]}
 *
 * and disagreed by 28-42% on every large shape:
 *
 *   4096^3     AMX-INT8 5141 -> 3024   AMX-BF16 2081 -> 1381   BLAS 722 -> 514
 *   4096x2048  AMX-INT8 6230 -> 3601   AMX-BF16 2562 -> 1497   BLAS 675 -> 489
 *
 * Three independent engines -- two tile kernels of ours and a third-party
 * library -- moving together rules out any one of them being at fault. These
 * containers land on different physical hosts with the same CPUID string,
 * and `results/` keyed on that string silently merged two machines. That is
 * how "BLAS is horrible" and "BLAS is fine" were both true.
 *
 * So a fingerprint has to be MEASURED. Compute peak already has a probe --
 * peak_native, from peak.c -- and this file deliberately does NOT reimplement
 * it. Three attempts to do so all read ~45 GF/core against peak_native's 185
 * because the accumulator array spilled, and objdump showed 24 memory moves
 * around 10 FMAs each time. Compile-time chain counts did not fix it and
 * removing a printf from the body did not fix it. The lesson taken was not
 * "debug harder" but "stop rewriting a verified probe": the harness runs
 * peak_native once for single-core and N copies at once for all-core.
 *
 * What is left is the axis nothing here measured: memory bandwidth. It is
 * also the axis that separates these two hosts -- the SMALL shapes fell
 * 12-23%, roughly the clock difference, while the LARGE ones fell 28-42%,
 * and the gap between those two is memory.
 *
 *   membw [threads]  -> GB/s, STREAM triad on every core
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <time.h>
#include <unistd.h>

static double now(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + 1e-9 * t.tv_nsec;
}

/* ---- STREAM triad, all cores ------------------------------------------- */
static int g_T;
static size_t g_n; static float *g_a, *g_b, *g_c; static double g_bw[64];

/* STREAM triad, each thread on its own third of three arrays sized to blow
   past any cache. 24 bytes moved per element: two reads and a write. */
static void *bw_thread(void *p) {
  long id = (long)p;
  size_t lo = g_n * id / g_T, hi = g_n * (id + 1) / g_T;
  double best = 0;
  for (int r = 0; r < 5; r++) {
    double t0 = now();
    for (size_t i = lo; i < hi; i++) g_a[i] = g_b[i] + 3.0f * g_c[i];
    double d = now() - t0;
    double gb = (double)(hi - lo) * 12.0 / d / 1e9;   /* per-thread share */
    if (gb > best) best = gb;
  }
  g_bw[id] = best;
  return NULL;
}

int main(int argc, char **argv) {
  int T = argc > 1 ? atoi(argv[1]) : (int)sysconf(_SC_NPROCESSORS_ONLN);
  int json = argc > 2 && !strcmp(argv[2], "--json");
  if (T > 64) T = 64;
  g_T = T;
  pthread_t th[64];

  /* 3 arrays x 64M floats = 768MB total, far past any L3 here. */
  g_n = 64u << 20;
  g_a = aligned_alloc(64, g_n * 4);
  g_b = aligned_alloc(64, g_n * 4);
  g_c = aligned_alloc(64, g_n * 4);
  if (!g_a || !g_b || !g_c) { fprintf(stderr, "alloc\n"); return 1; }
  for (size_t i = 0; i < g_n; i++) { g_b[i] = 1.0f; g_c[i] = 2.0f; g_a[i] = 0.0f; }
  for (long t = 1; t < T; t++) pthread_create(&th[t], NULL, bw_thread, (void *)t);
  bw_thread((void *)0);
  for (long t = 1; t < T; t++) pthread_join(th[t], NULL);
  double bw = 0; for (int t = 0; t < T; t++) bw += g_bw[t];

  if (json) printf("{\"bw\":%.1f,\"threads\":%d}\n", bw, T);
  else      printf("%.1f\n", bw);
  return 0;
}
