// validate.c — the check that gemm_bench.mjs is missing.
// Compares a kernel dylib against a scalar reference. Run this BEFORE timing
// anything; a wrong kernel can post any GFLOPS number you like.
//
//   clang -O3 -arch arm64 -o validate validate.c -ldl
//   ./validate ./sme2.dylib          # the current one
//   ./validate ./sme2_fixed.dylib    # the corrected one
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <string.h>
#include <dlfcn.h>

typedef void (*gemm_fn)(const float*, const float*, float*, size_t, size_t, size_t);

static int check(gemm_fn f, size_t M, size_t N, size_t K, const char *tag) {
    float *A = malloc(M*K*4), *B = malloc(K*N*4), *C = calloc(M*N,4), *R = calloc(M*N,4);
    // (i*7919)%101 is size_t (unsigned); subtracting the int literal 50
    // promotes 50 to unsigned per the usual arithmetic conversions, so
    // 0 - 50 underflows to ~2^64 instead of going negative. Cast to a
    // signed type before subtracting.
    for (size_t i=0;i<M*K;i++) A[i] = (float)((long long)((i*7919)%101) - 50) / 50.0f;
    for (size_t i=0;i<K*N;i++) B[i] = (float)((long long)((i*6271)%97)  - 48) / 48.0f;
    for (size_t i=0;i<M;i++)                       // scalar reference
        for (size_t k=0;k<K;k++) {
            float a = A[i*K+k];
            for (size_t j=0;j<N;j++) R[i*N+j] += a * B[k*N+j];
        }
    f(A,B,C,M,N,K);
    double worst=0; size_t wi=0, wj=0, bad=0;
    for (size_t i=0;i<M;i++) for (size_t j=0;j<N;j++) {
        double d = fabs((double)C[i*N+j] - R[i*N+j]);
        double rel = d / (fabs((double)R[i*N+j]) + 1e-6);
        if (rel > 1e-4) bad++;
        if (rel > worst) { worst = rel; wi=i; wj=j; }
    }
    printf("  %-16s %-14s  bad %6zu/%-8zu  worst rel %.3e at C[%zu,%zu] got %.5f want %.5f\n",
           tag, bad ? "*** FAIL ***" : "pass", bad, M*N, worst, wi, wj,
           C[wi*N+wj], R[wi*N+wj]);
    free(A);free(B);free(C);free(R);
    return bad != 0;
}

int main(int argc, char **argv) {
    const char *lib = argc>1 ? argv[1] : "./sme2.dylib";
    void *h = dlopen(lib, RTLD_NOW);
    if (!h) { fprintf(stderr,"dlopen %s: %s\n", lib, dlerror()); return 2; }
    gemm_fn f = (gemm_fn)dlsym(h, "sme2_gemm_f32");
    if (!f) f = (gemm_fn)dlsym(h, "sme1_gemm_f32");
    if (!f) { fprintf(stderr,"no sme{1,2}_gemm_f32 in %s\n", lib); return 2; }
    printf("\nvalidating %s\n", lib);
    int fails = 0;
    fails |= check(f,  16,  64,  32, "16x32x64");     // exactly one ZA tile group
    fails |= check(f,  16,  64, 300, "16x300x64");    // k spans KC blocks
    fails |= check(f,  37,  91,  64, "37x64x91");     // ragged m and n
    fails |= check(f, 128, 256, 256, "128x256x256");  // one full MC/KC/NC block
    fails |= check(f, 200, 300, 150, "200x150x300");  // ragged everything
    printf("\n%s\n\n", fails ? "RESULT: FAIL — do not trust any timing from this build"
                             : "RESULT: all shapes pass");
    return fails;
}
