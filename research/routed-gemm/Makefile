# routed-gemm build recipes.
#
# Finishing item. Every .wasm and every native probe in this directory was
# built by hand from the shell in the session that produced it, so the flags
# lived only in scrollback. Everything measured here is one binary against
# another, and a comparison between binaries built with unrecorded flags is
# not a measurement. This file is the record, and it is a verified one: each
# rule below reproduces the checked-in artifact byte for byte apart from the
# module name the linker writes into the name section from the output path.
#
#   make wasm     the zero-import kernels + the ROWSxVEC grid
#   make native   the native probes and the engine driver
#   make verify   rebuild every .wasm and diff it against what is committed
#   make clean
#
# House convention for the kernels (wasm/shell.c and friends): imports NONE,
# exports memory + run. No WASI, no libc, no JS glue in the contract. The
# host owns parallelism, allocation and I/O; the module owns arithmetic.

CC   ?= clang
WCC  ?= clang

# -fno-builtin  keeps the import list empty. Without it clang turns the
#               zeroing loops into calls to memset, which -nostdlib cannot
#               resolve, and the module either fails to link or acquires an
#               import -- either way it stops being a zero-import module.
#               (-mbulk-memory also links, by lowering to memory.fill, but
#               that changes the emitted code and so changes the numbers.)
# NO -ffast-math. isolate.c depends on it being off: the whole point of that
#               file is that the same scalar source compiles to three targets
#               and the wasm one contains ZERO f32x4 ops, which is what makes
#               the k-outer interchange in autovec.c a finding rather than a
#               compiler flag. Turning reassociation on globally would erase
#               the thing being measured. It is tested separately -- see
#               `make fastmath` below.
# --initial-memory=256MB  the largest shape measured (B=720 K=N=512 E=64) is
#               67MB of weights alone, and growing memory mid-run would move
#               the backing store out from under a live typed-array view.
WBASE = --target=wasm32 -O3 -msimd128 -fno-builtin -nostdlib -Wl,--no-entry
WMEM  = -Wl,--initial-memory=268435456
WRUN  = -Wl,--export=run -Wl,--export=__heap_base
NFLAGS = -O3 -march=native

ROWSET = 1 2 4 8
VECSET = 1 2 4 8
SWEEP  = $(foreach r,$(ROWSET),$(foreach v,$(VECSET),f_$(r)_$(v).wasm))
KERNELS = dmm.wasm dmm8.wasm av1.wasm av4.wasm iso.wasm peak.wasm

.PHONY: all wasm native sweep verify fastmath ceiling clean
all: wasm native
wasm: $(KERNELS) $(SWEEP)
sweep: $(SWEEP)

# dmm.c exports run_dense as well -- the dense comparison runs inside the
# same module so both paths see the same memory and the same JIT.
dmm.wasm: dmm.c
	$(WCC) $(WBASE) $(WRUN) -Wl,--export=run_dense $(WMEM) -o $@ $<

dmm8.wasm: dmm8.c
	$(WCC) $(WBASE) $(WRUN) $(WMEM) -o $@ $<

# ROWS=1 is the unblocked baseline; ROWS=4 is the one that shares each w load
# across four rows. The pair is the measurement, not either one alone.
av1.wasm: autovec.c
	$(WCC) $(WBASE) $(WRUN) $(WMEM) -DROWS=1 -o $@ $<
av4.wasm: autovec.c
	$(WCC) $(WBASE) $(WRUN) $(WMEM) -DROWS=4 -o $@ $<

iso.wasm: isolate.c
	$(WCC) $(WBASE) $(WRUN) $(WMEM) -o $@ $<

# No memory traffic at all, so no --initial-memory: two pages is the whole
# footprint and asking for 256MB would only slow the instantiate.
peak.wasm: peak.c
	$(WCC) $(WBASE) -Wl,--export=peak -o $@ $<

# The ceiling sweep. ACC is the number of independent chains; too few and the
# probe measures its own dependency chain instead of the machine, which is
# exactly what happened at the default of 8. ACC*1 + 1 registers must fit the
# 16 xmm the wasm JIT exposes, so 14 is the last honest point.
ACCSET = 4 8 12 14 16
CEIL = $(foreach a,$(ACCSET),peak_$(a).wasm)
ceiling: $(CEIL)
define PEAK_RULE
peak_$(1).wasm: peak.c
	$$(WCC) $$(WBASE) -DACC=$(1) -Wl,--export=peak -o $$@ $$<
endef
$(foreach a,$(ACCSET),$(eval $(call PEAK_RULE,$(a))))

# f_<ROWS>_<VEC>.wasm -- the register-blocking grid. ROWS*VEC + VEC past ~12
# should spill against the 16 xmm registers the wasm JIT exposes; the sweep
# is what shows whether it does, so the grid is built, not chosen.
define FOLD_RULE
f_$(1)_$(2).wasm: fold.c
	$$(WCC) $$(WBASE) $$(WRUN) $$(WMEM) -DROWS=$(1) -DVEC=$(2) -o $$@ $$<
endef
$(foreach r,$(ROWSET),$(foreach v,$(VECSET),$(eval $(call FOLD_RULE,$(r),$(v)))))

# Only dmm.wasm, iso.wasm and peak.wasm are tracked; .gitignore treats
# f_*.wasm and av*.wasm as build output, which is why the sweep grid sitting
# on a container can silently predate the last edit to fold.c. It did: the
# grid on disk when this Makefile was written was built before the ragged
# tail changed, so every f_<ROWS>_<VEC> with ROWS >= 2 was a stale binary
# (ROWS=1 matched because its tail is unreachable and gets eliminated). Run
# `make sweep` before trusting a sweep result.
#
# Rebuild into a temp dir and compare. The name section carries the output
# path, so a rebuild to a different filename differs by exactly that string;
# comparing same-named copies makes the check exact.
VERIFY = dmm.wasm dmm8.wasm iso.wasm peak.wasm
verify:
	@d=$$(mktemp -d); rc=0; \
	for f in $(VERIFY); do \
	  cp $$f $$d/$$f.committed; \
	  $(MAKE) -s --always-make $$f >/dev/null 2>&1; \
	  if cmp -s $$f $$d/$$f.committed; then echo "  ok   $$f"; \
	  else echo "  DIFF $$f"; rc=1; fi; \
	  cp $$d/$$f.committed $$f; \
	done; rm -rf $$d; exit $$rc

# The one flag that was suggested and never tested. Built beside the normal
# kernels rather than replacing them, so both can be timed in one run.
fastmath: fold.c dmm.c
	$(WCC) $(WBASE) -ffast-math $(WRUN) -Wl,--export=run_dense $(WMEM) -o fm_dmm.wasm dmm.c
	$(WCC) $(WBASE) -ffast-math $(WRUN) $(WMEM) -DROWS=4 -DVEC=2 -o fm_f_4_2.wasm fold.c
	$(WCC) $(WBASE) -ffast-math $(WRUN) $(WMEM) -DROWS=1 -DVEC=8 -o fm_f_1_8.wasm fold.c
	$(WCC) $(WBASE) -ffast-math $(WRUN) $(WMEM) -DROWS=4 -o fm_av4.wasm autovec.c

native: peak_native iso_scalar iso_auto engines libroutedgemm.so

# Inline asm, not intrinsics: an FMA chain whose result is never read is dead
# code and clang removed it, which showed up as GF/s scaling linearly with
# the iteration count. peak.c carries the asm for that reason.
peak_native: peak.c
	$(CC) $(NFLAGS) -o $@ $<

# The pair that separates "what the WASM runtime costs" from "what the ISA is
# worth". Same source, same -O3, only vectorisation differs.
iso_scalar: isolate.c
	$(CC) $(NFLAGS) -fno-tree-vectorize -o $@ $<
iso_auto: isolate.c
	$(CC) $(NFLAGS) -o $@ $<

# BLAS is reached with dlopen at runtime, not linked: the library measured is
# whichever one is already on the machine (here numpy's bundled
# libscipy_openblas64_), so -lopenblas would measure a different library from
# the one the deployment actually has.
engines: engines.c
	gcc $(NFLAGS) -mavx512vnni -mamx-tile -mamx-int8 -o $@ $< -ldl -lm

libroutedgemm.so: routed_gemm.c
	gcc $(NFLAGS) -mavx512vnni -shared -fPIC -pthread -o $@ $<

clean:
	rm -f $(KERNELS) $(SWEEP) fm_*.wasm peak_*.wasm \
	      peak_native iso_scalar iso_auto engines libroutedgemm.so
