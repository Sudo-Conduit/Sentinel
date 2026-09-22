/* blasprobe.c -- which OpenBLAS is this, really?
 *
 * Before concluding a BLAS number is bad, ask the library what it thinks it
 * is. DYNAMIC_ARCH builds pick a kernel at load time from CPUID, and on a
 * virtualized host with a masked leaf that detection can fall back to a
 * generic kernel -- which looks exactly like 'BLAS is slow'.
 *
 * On this box it reports:
 *   OpenBLAS 0.3.31 USE64BITINT DYNAMIC_ARCH NO_AFFINITY SkylakeX MAX_THREADS=64
 *   corename SkylakeX, 4 procs, 4 threads, pthreads
 * i.e. the AVX-512 kernel, correctly dispatched. So a disappointing number
 * here is not an unoptimized build, and that had to be checked rather than
 * assumed.
 *
 *   blasprobe <path-to-libopenblas.so>
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <dlfcn.h>
#include <string.h>
static void *try_sym(void *h, const char **names) {
  for (int i = 0; names[i]; i++) { void *p = dlsym(h, names[i]); if (p) return p; }
  return NULL;
}
int main(int argc, char **argv) {
  const char *path = argv[1];
  void *h = dlopen(path, RTLD_NOW);
  if (!h) { printf("dlopen failed: %s\n", dlerror()); return 1; }
  const char *cfg[]  = {"scipy_openblas_get_config64_","openblas_get_config64_","openblas_get_config",NULL};
  const char *core[] = {"scipy_openblas_get_corename64_","openblas_get_corename64_","openblas_get_corename",NULL};
  const char *nth[]  = {"scipy_openblas_get_num_threads64_","openblas_get_num_threads64_","openblas_get_num_threads",NULL};
  const char *npr[]  = {"scipy_openblas_get_num_procs64_","openblas_get_num_procs64_","openblas_get_num_procs",NULL};
  const char *par[]  = {"scipy_openblas_get_parallel64_","openblas_get_parallel64_","openblas_get_parallel",NULL};
  char *(*f_cfg)(void)  = try_sym(h, cfg);
  char *(*f_core)(void) = try_sym(h, core);
  int  (*f_nth)(void)   = try_sym(h, nth);
  int  (*f_npr)(void)   = try_sym(h, npr);
  int  (*f_par)(void)   = try_sym(h, par);
  printf("config    : %s\n", f_cfg  ? f_cfg()  : "(symbol not found)");
  printf("corename  : %s\n", f_core ? f_core() : "(symbol not found)");
  printf("num_procs : %d\n", f_npr  ? f_npr()  : -1);
  printf("num_thread: %d\n", f_nth  ? f_nth()  : -1);
  printf("parallel  : %d  (0=sequential 1=pthreads 2=openmp)\n", f_par ? f_par() : -1);
  return 0;
}
