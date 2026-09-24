# ane-cpe build recipes. Apple Silicon (arm64) only.
#
# Every dylib here is dlopen'd at runtime by the *.mjs providers next to it
# (via koffi), same convention as research/routed-gemm's libroutedgemm.so.
#
# Two real bug classes got found and fixed in this directory, both worth
# knowing before touching the source further:
#
#   SME1/SME2 (sme1_fixed.c, sme2_fixed.c): the ORIGINAL sme1.c/sme2.c (not
#   in this directory -- see the PR description) drained ZA via
#   svread_ver_za32_f32_m(zero, pg, t, 0) then svst1 -- reading a VERTICAL
#   ZA slice with the slice index hardcoded to 0 (so every output row read
#   the same slice) and storing it as if it were a ROW. Fixed via
#   svst1_hor_za32(tile, slice, pg, ptr), unrolled 16x4 because its tile/
#   slice arguments must be compile-time constants. A second, independent
#   bug survived that fix: svcount_t pg_nc = svreinterpret_c(svptrue_b32())
#   bit-reinterprets a single-vector (16-lane) predicate as a "predicate-
#   as-counter" -- svcount_t is a COUNT encoding, not a per-lane mask, and
#   this does not mean "all 4x16=64 elements active" for the svld1_f32_x4
#   load consuming it. Fixed with the real all-true counting-predicate
#   constructor: svptrue_c32(). Verified via validate.c against 5 shapes
#   (aligned, K spanning KC blocks, ragged M/N, one full MC/KC/NC block,
#   fully ragged) -- 0 bad cells, exact, at every shape.
#
#   kernels_fixed.c: sdot_gemm_i8 indexed B along the wrong dimension
#   entirely (B[k, n..n+15], 16 COLUMNS of one row, paired against A's 16
#   K-VALUES of one row -- vdotq_s32 pairing elements that vary along
#   different dimensions is not a valid inner product), and only wrote 4 of
#   every 16 output columns per outer step. bfdot_gemm_bf16's 4 vbfdotq_f32
#   lanes are 4 PARTIAL SUMS of one dot product (different k-offset pairs),
#   mis-stored as 4 different output columns. Both fixed by packing B to
#   [N][K] (K contiguous per column) and reducing to one scalar per (m,n)
#   via horizontal sum, mirroring each other. Verified exact (int8) / to
#   bf16 precision (~2^-8) against scalar references, including K not a
#   multiple of the kernel's native width and fully ragged shapes.
#
#   f16_convert.c: not a bug fix, a from-scratch addition. ane_provider.mjs
#   originally did fp16<->fp32 conversion in JS: a scalar loop that
#   allocated a fresh Float32Array+Uint32Array PER ELEMENT (33.5M
#   allocations/call at 4096x4096), then a fixed allocation-free version
#   that still called Math.pow() per element on the f16->f32 side (387-591ms
#   by itself, dwarfing the ~17ms actual ANE execute() time). Both were
#   software reimplementing what ARM's NEON FP16 hardware extension already
#   does natively -- vcvt_f32_f16/vcvt_f16_f32 compile to a single FCVT
#   instruction per 4 lanes (ARM's equivalent of x86 F16C). Native: 3.91ms
#   and 6.29ms for the same 16.78M elements.
#
# validate.c also had its own bug, independent of every kernel: its test
# data generator computed (i*7919)%101 - 50 where i is size_t (unsigned) --
# subtracting the int literal 50 promotes it to unsigned per the usual
# arithmetic conversions, so 0 - 50 underflows to ~2^64 instead of going
# negative. Fixed with an explicit signed cast before subtracting.

CC = /usr/bin/clang
ARCH = -arch arm64
SME_FLAGS = -mcpu=apple-m4 -msve-vector-bits=512
DYLIB = -dynamiclib -fvisibility=default

.PHONY: all clean verify
all: sme1_fixed.dylib sme2_fixed.dylib kernels_fixed.dylib f16_convert.dylib \
     libane_e5rt_dispatch.dylib validate

sme1_fixed.dylib: sme1_fixed.c
	$(CC) -O3 $(ARCH) $(SME_FLAGS) $(DYLIB) -o $@ $<

sme2_fixed.dylib: sme2_fixed.c
	$(CC) -O3 $(ARCH) $(SME_FLAGS) $(DYLIB) -o $@ $<

# Plain NEON (int8 SDOT, bf16 BFDOT) -- no SME/SVE flags needed, unlike SME1/2.
kernels_fixed.dylib: kernels_fixed.c
	$(CC) -O3 $(ARCH) -mcpu=apple-m4 $(DYLIB) -o $@ $<

f16_convert.dylib: f16_convert.c
	$(CC) -O3 $(ARCH) -mcpu=apple-m4 $(DYLIB) -o $@ $<

# The e5rt dispatch shim (MIT, Spencer H. Bryngelson / ANEForge project --
# see e5rt_vendor/README.md) links Apple's private Espresso.framework via
# dlopen at runtime, not link time, so it must be built on the target Mac.
libane_e5rt_dispatch.dylib: e5rt_vendor/ane_e5rt_dispatch.mm
	/usr/bin/clang++ -O2 -Wall -Wextra $(ARCH) $(DYLIB) -fPIC -fobjc-arc \
	    -framework Foundation \
	    -I e5rt_vendor -o $@ $<

# gpu_provider's libmetalwrapper.dylib is Will's own pre-built Metal wrapper;
# its source isn't vendored here (not part of this fix set). Set
# METALWRAPPER_DIR to point cpu_gpu_providers.mjs at wherever it lives if
# it isn't sitting in this directory.

# validate.c doesn't need SME flags (its dlopen'd targets carry their own).
validate: validate.c
	$(CC) -O3 $(ARCH) -o $@ $<

# Rebuild sme1_fixed/sme2_fixed and rerun validate against both -- the
# check that would have caught every SME bug this file documents above.
verify: sme1_fixed.dylib sme2_fixed.dylib validate
	./validate ./sme1_fixed.dylib
	./validate ./sme2_fixed.dylib

clean:
	rm -f *.dylib validate
