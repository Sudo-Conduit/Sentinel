/*
 * peak.c -- measured single-core FLOP ceilings, not paper ones.
 *
 * I have been explaining the BLAS-vs-WASM gap with "AVX-512 is 16 lanes with
 * FMA, f32x4 is 4 lanes without, so 8x". That is arithmetic on a datasheet.
 * This measures both, with no memory traffic at all: N independent
 * accumulators chained so the pipeline stays full and nothing but issue rate
 * and lane count decides the answer.
 *
 * If measured (native peak / wasm peak) matches the observed
 * (BLAS / my-wasm-kernel) ratio, then both kernels sit at the SAME fraction
 * of their respective ceilings and the whole gap is the instruction set --
 * nothing is left to blame on my implementation. If it does not match, the
 * difference is mine to fix.
 *
 * Build native: clang -O3 -march=native -o peak_native peak.c
 * Build wasm:   clang --target=wasm32 -O3 -msimd128 -ffreestanding -nostdlib \
 *                 -Wl,--no-entry -Wl,--export=peak -Wl,--export-memory peak.c
 */

#define ACC 8          /* independent chains -- enough to cover FMA latency */
#define INNER 1000

#ifdef __wasm__
#include <wasm_simd128.h>
#define LANES 4

__attribute__((used)) __attribute__((visibility("default")))
double peak(int iters)
{
    v128_t a[ACC], m;
    for (int i = 0; i < ACC; i++) a[i] = wasm_f32x4_splat((float)(i + 1));
    m = wasm_f32x4_splat(1.0000001f);

    for (int it = 0; it < iters; it++)
        for (int n = 0; n < INNER; n++)
            for (int i = 0; i < ACC; i++)
                a[i] = wasm_f32x4_add(a[i], wasm_f32x4_mul(a[i], m));

    float s = 0;
    for (int i = 0; i < ACC; i++)
        s += wasm_f32x4_extract_lane(a[i], 0) + wasm_f32x4_extract_lane(a[i], 1)
           + wasm_f32x4_extract_lane(a[i], 2) + wasm_f32x4_extract_lane(a[i], 3);
    return (double)s;
}

#else
#include <immintrin.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#define LANES 16

static double now(void) {
    struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + 1e-9 * t.tv_nsec;
}

/* Inline asm, not intrinsics. With intrinsics clang eliminated the whole
 * loop -- proven, not suspected: reported GF/s scaled linearly with `iters`,
 * which means the measured time was constant and equal to timer overhead.
 * Written as asm, exactly iters*INNER*ACC vfmadd231ps instructions execute
 * and the number means something. */
static double peak(int iters)
{
    __m512 a[ACC], m;
    for (int i = 0; i < ACC; i++) a[i] = _mm512_set1_ps((float)(i + 1));
    m = _mm512_set1_ps(1.0000001f);

    for (int it = 0; it < iters; it++)
        for (int n = 0; n < INNER; n++)
            for (int i = 0; i < ACC; i++)
                __asm__ volatile("vfmadd231ps %1, %2, %0"
                                 : "+v"(a[i]) : "v"(m), "v"(m));

    float out[16]; float s = 0;
    for (int i = 0; i < ACC; i++) {
        _mm512_storeu_ps(out, a[i]);
        for (int j = 0; j < 16; j++) s += out[j];
    }
    return (double)s;
}

int main(int argc, char **argv) {
    int iters = argc > 1 ? atoi(argv[1]) : 20000;
    peak(100);                                   /* warm */
    double best = 1e18;
    for (int r = 0; r < 5; r++) {
        double t0 = now();
        volatile double sink = peak(iters);
        double d = now() - t0;
        (void)sink;
        if (d < best) best = d;
    }
    /* 2 flops per element per op: FMA counts as multiply + add */
    double flops = (double)iters * INNER * ACC * LANES * 2.0;
    printf("%.1f\n", flops / best / 1e9);
    return 0;
}
#endif
