# ane-cpe

CPE (`ComputeCore.js`, `pooledimpact/mountainshift/v2/`) unified across six
engines -- ANE, SME1, SME2, SDOT, BFDOT, GPU -- as providers, plus the real,
now-fixed bugs found getting each one to actually compute the right answer.

## What's here

- `ane_provider.mjs` -- real ANE hardware dispatch via `libane_e5rt_dispatch.dylib`
  (vendored from [ANEForge](https://github.com/sbryngelson/ANEForge), MIT --
  see `e5rt_vendor/README.md`). Compiles a hand-authored MIL program per
  distinct `(m,k,n)` shape, caches the compiled program and each expert's
  converted weight by array identity, dispatches through Espresso's `e5rt_*`
  C API -- unentitled, confirmed via the system log (`aned` /
  `ANECompilerService` XPC connections scoped to this exact process's PID).
- `cpu_gpu_providers.mjs` -- SME1, SME2 (ARM SME, native f32), SDOT (int8,
  genuinely lossy), BFDOT (bf16), GPU (Metal, `libmetalwrapper.dylib`, not
  vendored here -- see below) as the same provider shape.
- `f16_convert.c` -- hardware fp16<->fp32 via ARM NEON (`vcvt_f32_f16`/
  `vcvt_f16_f32`), ARM's equivalent of x86 F16C. Not a bug fix -- a
  from-scratch replacement for doing this conversion in JS at all.
- `sme1_fixed.c`, `sme2_fixed.c`, `kernels_fixed.c` -- corrected native
  kernels. See the Makefile header for exactly what was wrong in each and
  how it was found.
- `validate.c` -- the SME correctness harness (also had its own, unrelated
  bug -- see Makefile header). `make verify` runs it against both SME
  dylibs.
- `gemm_bench002.mjs` -- `gemm_bench.mjs`'s shapes, REF table, toggles,
  iters/warmup and output format, unchanged. The one real change: every
  engine dispatches through CPE now instead of some going through direct
  koffi calls and some through CPE -- that split defeated the point of
  having a unifying dispatch layer at all.

## Build

```sh
npm install
make all       # builds every dylib + validate
make verify    # rebuilds SME1/SME2 and checks both against validate.c
```

`libmetalwrapper.dylib` (the GPU provider's Metal backend) isn't vendored --
its source wasn't part of this fix set. Point `cpu_gpu_providers.mjs` at
wherever it lives via `METALWRAPPER_DIR`, or drop it in this directory.

## Run

```sh
node gemm_bench002.mjs                                    # all six engines
SME1=0 SME2=0 SDOT=0 BFDOT=0 GPU=0 node gemm_bench002.mjs  # ANE only
```

## The headline result

Every engine here was broken before this PR except GPU -- SME1/SME2's ZA
drain read the wrong hardware state entirely, SDOT indexed its second
operand along the wrong dimension, BFDOT mis-stored 4 partial sums as 4
different outputs, and ANE's own JS-side fp16 conversion cost 200x more than
the actual hardware execute time. Fixed, on this M4 Pro, at 4096x4096x4096:

| engine | before (broken/JS-bottlenecked) | after |
|---|---|---|
| ANE  | 34.71 GFLOP/s | **5931.92 GFLOP/s** |
| GPU  | 5733.12 GFLOP/s (already correct) | 5733.12 GFLOP/s |
| SME1 | wrong output (`validate.c`: FAIL, every shape) | 1108.13 GFLOP/s, exact |
| SME2 | wrong output (`validate.c`: FAIL, every shape) | 1066.72 GFLOP/s, exact |
| SDOT | wrong output (indexing bug) | 57.83 GFLOP/s, exact (int8) |
| BFDOT | wrong output (lane conflation) | 10.17 GFLOP/s, bf16-precision-exact |

ANE goes from the weakest engine measured to the strongest at scale -- the
34.71 GFLOP/s number was measuring a JS allocation storm and a per-element
`Math.pow()` call, not the ANE silicon, which the direct e5rt path (no JS
in the loop) had already shown at 7936.68 GFLOP/s for this exact shape.
