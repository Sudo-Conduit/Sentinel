// f16_convert.c -- hardware fp16<->fp32 conversion via ARM NEON's native
// FP16 support (ARMv8.2-A FP16 extension, present on Apple Silicon).
// vcvt_f32_f16/vcvt_f16_f32 compile to a single hardware FCVT instruction
// per 4 lanes -- the ARM equivalent of x86's F16C (VCVTPH2PS/VCVTPS2PH).
// Replaces ane_provider.mjs's scalar JS bit-manipulation loops, which were
// doing in software (and, in the f16->f32 case, via Math.pow() per element)
// exactly what this hardware already does natively.
//
// Build: /usr/bin/clang -O3 -arch arm64 -mcpu=apple-m4 -dynamiclib \
//        -fvisibility=default -o f16_convert.dylib f16_convert.c
#include <stdint.h>
#include <stddef.h>
#include <arm_neon.h>

void f32_to_f16_array(const float *src, uint16_t *dst, size_t n) {
    size_t i = 0;
    for (; i + 4 <= n; i += 4) {
        float32x4_t v = vld1q_f32(src + i);
        float16x4_t h = vcvt_f16_f32(v);
        vst1_f16((float16_t *)(dst + i), h);
    }
    for (; i < n; ++i) {
        float16x4_t h = vcvt_f16_f32(vdupq_n_f32(src[i]));
        dst[i] = vget_lane_u16(vreinterpret_u16_f16(h), 0);
    }
}

void f16_to_f32_array(const uint16_t *src, float *dst, size_t n) {
    size_t i = 0;
    for (; i + 4 <= n; i += 4) {
        float16x4_t h = vld1_f16((const float16_t *)(src + i));
        float32x4_t v = vcvt_f32_f16(h);
        vst1q_f32(dst + i, v);
    }
    for (; i < n; ++i) {
        uint16x4_t hb = vdup_n_u16(src[i]);
        float32x4_t v = vcvt_f32_f16(vreinterpret_f16_u16(hb));
        dst[i] = vgetq_lane_f32(v, 0);
    }
}
