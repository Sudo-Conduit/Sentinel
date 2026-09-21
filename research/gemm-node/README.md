# gemm-node — int8 GEMM from Node via koffi

A minimal AVX-512 VNNI int8 GEMM (`u8 × s8 → s32`) reached from Node through
koffi, used to measure three things that turn out to matter far more than the
kernel itself.

```
npm run build && npm run verify        # verify checks against a scalar reference
node main.js <M> <K> <N> <P> <MODE> <REPS> <PIN>
#   MODE 0 = one GEMM split across P workers
#   MODE 1 = P independent GEMMs (one worker each)
#   PIN  1 = pin each worker to a core
```

All numbers below: 4-core Sapphire Rapids (AVX-512 VNNI, no AMX), P=4,
median of 5 runs, min-of-5 internal reps. GOPS.

## 1. Node buffers are misaligned, and it costs ~2x

**Every** Node buffer — `SharedArrayBuffer`, `Buffer.alloc`, `Buffer.allocUnsafe` —
lands at `addr % 64 == 16` on this platform. Each 512-bit load therefore straddles
a cache line and fetches twice.

| shape | misaligned | 64B aligned | gain |
|---|---|---|---|
| 32×576×576 | 214.9 | 284.5 | 1.32x |
| 1024×576×576 | 317.6 | **824.1** | **2.59x** |
| 2048×1024×1024 | 265.0 | **570.6** | **2.15x** |
| 4096×2048×2048 | 171.0 | 290.1 | 1.70x |

The fix is to over-allocate by 64, read the true address back through FFI, and
hand the kernel an offset view (`alignedSab` in `main.js`; workers rebuild the
same view from `offset` passed in `workerData`).

This never presents as a bug. It presents as "Node is slow, rewrite in C" —
and that conclusion is wrong by a factor of two. Aligned Node **beats** the
equivalent native C harness at 1024×576×576 (824 vs 677) and 2048×1024×1024
(571 vs 494), and ties at 4096×2048×2048.

## 2. Submission shape beats kernel tuning

Parallelising *across* independent GEMMs vs *within* one GEMM, at equal cores:

| shape | split-M | independent | winner |
|---|---|---|---|
| 1×576×576 | 6.0 | **16.1** | independent 2.7x |
| 32×576×576 | 131.1 | **284.5** | independent 2.2x |
| 1024×576×576 | 720.6 | **824.1** | independent 1.14x |
| 2048×1024×1024 | 570.6 | 570.2 | tie |
| 4096×2048×2048 | 290.1 | 283.4 | tie |

Smaller shapes want more independent processes; larger shapes want fewer.
Crossover on this machine is ~1024×576×576. Splitting M across workers when
M is small is actively harmful — at M=1, four workers are ~40% *slower* than one.

## 3. Pinning pays only at the small end

`pin_to_cpu()` (per-thread `sched_setaffinity`, called from inside each worker)
is worth 1.25x at M=1 and 1.10x at M=32, and nothing at all from 1024 up:
microsecond kernels can't amortise a scheduler migration, millisecond kernels can.

## What this is not

Not a competitive GEMM. It exists to isolate alignment, submission shape and
affinity from kernel quality. A tuned library will beat the kernel; the three
findings above apply to it regardless.
