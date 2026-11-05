# Local Inference Architecture — Heterogeneous Compute, Batch Depth, Runtime Composition

## How 1–5B models are served on owned silicon: six engines behind one dispatch layer, throughput bought with batch depth, specialization resolved before the first token

**Author:** Will Fobbs
**Company:** Pooled Impact
**Document Type:** Architecture Document
**Version:** 1.0
**Date:** 2026-11-05
**Companion Documents:** `research/ane-cpe/README.md`; `research/routed-gemm/README.md` and `results/NUMBERS.md`; `ExtendX.js` v1.6.0; `pooledimpact/mountainshift/v2/llmd.js` v1.0.0

> **Units.** GOPS for int8 engines (AMX-INT8, VNNI, SDOT), GFLOPS for everything else. A GOPS figure counts the same multiply-adds as a GFLOPS figure, so the two compare as work rate but not as precision. Every number below is sourced; §9 separates what was measured from what is assumed.

---

## 1. Thesis

Three claims, in dependency order.

1. **The compute is already owned.** A single M4 Pro measures **15.5 TFLOPS** across ANE, GPU and the two SME engines, verified exact. A $56.99/year Xeon measures **1,409 GOPS** on AMX. Neither is rented by the hour.

2. **Batch-1 decode cannot reach it.** Generating one token re-reads every weight, so throughput is set by memory bandwidth, not arithmetic. On the M4 Pro at 1.5B that is 331 tok/s against a 4,444 tok/s compute ceiling — **93% of the silicon idle**, and the ratio holds at 3B and 5B.

3. **Batch depth is the only lever that moves it, and specialization must not break it.** The same silicon runs 33 GOPS at one row per block and 1,409 at 720 — a **42× swing**. Any scheme that gives each concurrent context its own full weight set destroys that. Specialization therefore has to be a *delta on a shared base*, resolved before the first message, leaving one weight read per batched pass.

The architecture is the consequence: six engines behind one provider interface, a scheduler that groups contexts into batched passes, and configuration that resolves to state outside the context window rather than to weights inside it.

**Ordering matters, and it is the opposite of the obvious one.** A scheduler only pays off if the compute layer can place its batches on more than one surface. Today the shipped layer registers two providers; the six-engine set is proven in research and not folded in. Batching into a single-provider layer buys the weight-read amortization and none of the 15.5 TFLOPS. The surfaces come first.

---

## 2. The compute substrate

### 2.1 Apple M4 Pro, measured

4096×4096×4096, owner's runs, from `research/ane-cpe/README.md`. Every engine except GPU was producing wrong answers before the fix set; the "after" column is validated against `validate.c`.

| engine | before | after | note |
|---|---|---|---|
| ANE (via CPE) | 34.71 GFLOP/s | **5,931.92** | before-figure was a JS allocation storm, not silicon |
| ANE (direct e5rt, no JS in loop) | — | **7,936.68** | the hardware's own rate at this shape |
| GPU (Metal) | 5,733.12 | 5,733.12 | already correct; a later run of the same path read 5,394.46 |
| SME1 | FAIL, every shape | **1,108.13**, exact | ZA drain read the wrong hardware state |
| SME2 | FAIL, every shape | **1,066.72**, exact | same |
| SDOT (int8) | FAIL (indexing) | 57.83, exact | second operand indexed on the wrong dimension |
| BFDOT (bf16) | FAIL (lane conflation) | 10.17, bf16-exact | 4 partial sums stored as 4 outputs |

**ANE is not a model runner here.** The provider compiles a hand-authored MIL program *per distinct `(m, k, n)` shape*, caches the compiled program and each expert's converted weight by array identity, and dispatches through Espresso's `e5rt_*` C API — unentitled, confirmed via `aned` / `ANECompilerService` XPC connections scoped to the dispatching PID. It is a GEMM primitive, reachable per-op like any other provider.

That is the finding the rest of this document rests on: **the ANE's 7.9 TFLOPS is addressable, not stranded behind whole-model compilation.**

Usable concurrent total, ANE + GPU + SME1 + SME2: **≈ 15.5 TFLOPS** on one laptop, taking the lower of the two recorded GPU figures. The record carries both 5,733.12 (`ane-cpe/README.md`) and 5,394.46 (`routed-gemm/results/reported.json`, noting the earlier run) for the same path; the conservative figure is used throughout and the discrepancy is unresolved.

### 2.2 Intel Xeon with AMX, measured

`research/routed-gemm/results/`, 4-core Xeon @2.10GHz, `amx_tile amx_int8 amx_bf16 avx512_vnni`. Dense 4096³, median (best): AMX-INT8 **2,110.7 (3,024.3)** GOPS, AMX-BF16 1,272.6 (1,380.5), VNNI panel 1,941.9 (2,168), BLAS fp32 449.2 (514).

The same virtual host measured 28–42% higher twelve hours earlier. Containers land on different physical machines behind one CPUID string. **Treat absolute figures from virtual hosts as a range, not a point** — `amxprobe.c` exists to confirm a box actually executes AMX rather than merely advertising it.

### 2.3 Unified dispatch

CPE (`ComputeCore.js`) presents all six engines as providers behind one interface. The device contract used by the browser-side backends — `createBuffer` / `createBindGroup` / `createCommandEncoder` / `queue.submit` — is backend-agnostic, confirmed by independent correct implementations. **Engine selection is a configuration decision, not a code path.**

---

## 3. The binding constraint

Decode at batch 1 re-reads the full weight set per token. Compute is therefore irrelevant until the read is amortized.

| model | GFLOP/token | weights (Q4) | bandwidth-bound | compute ceiling | idle |
|---|---|---|---|---|---|
| 1.5B | 3.0 | 0.83 GB | **331 tok/s** | 4,444 tok/s | 93% |
| 3B | 6.0 | 1.65 GB | 165 tok/s | 2,222 tok/s | 93% |
| 5B | 10.0 | 2.75 GB | 99 tok/s | 1,333 tok/s | 93% |

The idle fraction is constant because both ceilings scale with parameter count. **Adding compute does not help a single stream. It is already there and unused.**

Independent corroboration from a different machine: a live `llama.cpp` run on a 7-vCPU / 4 GB VPS measured Qwen2.5-1.5B Q4_K_M at **16.33 tok/s per stream** and ≈100 GFLOP/s achieved — about 7% of that box's AMX peak.

---

## 4. Batch depth is the lever

Block-height sweep, 720 rows, K=N=2048, AMX Xeon. `numbers.js` labels this axis directly: *one row is decode.*

| rows/block | AMX 2×2 | AMX auto | VNNI 6×4 | BLAS |
|---|---|---|---|---|
| 1 (decode) | 33.2 | 60.25 | 60.6 | 5.41 |
| 6 | 198.71 | 351.69 | 305.02 | 26.18 |
| 90 | 835.94 | 1,178.71 | 302.92 | 129.91 |
| 720 | **1,408.64** | **1,469.42** | 321 | 172.77 |
| **swing** | **42.4×** | 24.4× | 5.3× | 31.9× |

Two consequences.

**AMX loses at decode.** 33.2 against VNNI's 61.81. A tile engine with nothing to fill it is worse than a vector engine. Engine choice is therefore batch-dependent, which is what the `auto` paths exist to handle.

**The crossover is computable.** The weight read is one pass regardless of batch; compute scales with it. On the M4 Pro the balance sits at **B ≈ 13**, and it is 13 at 1.5B, 3B and 5B alike — the balance point is a property of the hardware's FLOP-to-byte ratio, not of the model. At that depth: **4,444 tok/s aggregate at 1.5B, 13.4× batch-1.**

---

## 5. Two sources of batch

Client and server are **mirror-image constrained**, which is why both are worth running rather than one being a weaker copy of the other.

| | user machine (M4 Pro, 1.5B) | shared server (4 GB Xeon) |
|---|---|---|
| binds on | **bandwidth** — 331 tok/s vs 4,444 compute | **RAM** — ~7 contexts vs 30 the silicon feeds |
| abundant | RAM: 73 / 113 / 233 contexts at 16 / 24 / 48 GB | compute: AMX 2×2 at 1,409 GOPS |
| batch comes from | concurrent **agents and apps** | concurrent **customers** |
| headroom over one 15 t/s reader | 22× | 15× in concurrency |

The user machine has RAM it cannot feed. The server has compute it cannot hold. A split that routes by *which resource is scarce* therefore beats one that routes by load. Server-side, this is already recorded as unquantified upside: *"capable devices run inference client-side; the split to server is adaptive and configurable, not fixed."*

1–5B is the band where both halves work. At 1.5B a user machine clears a reader by 22×; by 5B that is 7×. Above the band, Llama-3.1-8B measured **8.29 GiB RSS** — over twice the cheap server's RAM before a single concurrent slot.

---

## 6. Composition: one base, many configurations

### 6.1 The invariant

Everything in §4 and §5 depends on one weight read serving the whole batch. The cost of breaking it, 1.5B at 273 GB/s:

| batch | shared base + deltas | separate fine-tunes | penalty |
|---|---|---|---|
| 1 | 0.85 GB → 3.1 ms | 0.83 GB → 3.0 ms | 1.0× |
| 13 | 1.12 GB → 4.1 ms | 10.79 GB → 39.5 ms | **9.7×** |
| 32 | 1.53 GB → 5.6 ms | 26.56 GB → 97.3 ms | **17.3×** |

**Specialization and throughput are in direct conflict unless specialization is a delta on a shared base.** This is the architecture's single hard rule:

> A per-context configuration may add state. It may not add a weight read.

### 6.2 Configurations resolve before the first message

Most of a configuration is not a per-token operation. It is work done once, at composition time, and amortized:

| configuration element | resolves to | hot-path cost |
|---|---|---|
| instruction / example prefix | cached KV tensor | none — KV already exists per context |
| shape specialization | compiled MIL program, cached per `(m,k,n)` | none — dispatch only |
| engine selection | provider handle (ANE / SME2 / GPU / AMX) | none |
| behavioural layers | ExtendX mask bits | none — memoized per mask |
| routing table, tool manifest | lookup structure | none |
| low-rank weight delta *(optional)* | small tensor | thin GEMM per token |

Prefix economics, 1.5B, 28 layers, kvDim 256, fp16:

| prefix | KV cache | prefill | at 13.3 TFLOPS | amortized over 100 turns |
|---|---|---|---|---|
| 500 tok | 14 MB | 1.5 TFLOP | 113 ms | 1.1 ms/turn |
| 2,000 tok | 57 MB | 6.0 TFLOP | 450 ms | **4.5 ms/turn** |
| 8,000 tok | 229 MB | 24.0 TFLOP | 1,800 ms | 18 ms/turn |

**Prefill is the batched end of the sweep.** A 2,000-token prefix is 2,000 rows — the regime where AMX reads 1,409 GOPS rather than 33. The expensive half of a configuration runs where the silicon is 42× better; the cheap half stays on the shared base. For comparison, a rank-16 LoRA on a 1.5B base is ~22 MB against 830 MB — roughly **37 specializations in the footprint of one extra model**, and a cached prefix at 57 MB sits in the same class while remaining evictable, which a weight delta is not.

This is what separates a configuration from a prompt-resident skill: **a skill costs context every turn; a configuration costs memory once.**

### 6.3 ExtendX is the same primitive at the object layer

`ExtendX.extend()` composes per *instance* by bitmask. `enableLayer` / `disableLayer` flip bits in `getMask(this)`; the resolved method chain is memoized on `prop | tokenFor(mask) | REGISTRY_GENERATION`. Two instances of one composed class with different masks get different pipelines, resolved once per distinct mask.

Three systems, one shape:

| | ExtendX | routed-gemm | per-context configuration |
|---|---|---|---|
| shared | `BaseClass.prototype` | weight set | base weights |
| per-item index | mixin bits in `getMask` | `route[b]` | configuration id |
| composed | at call, by mask | at dispatch, by gather | at prefill, by id |
| resolution | once per distinct mask | once per expert group | once per configuration |

`mixin.locked` transfers directly: a layer that refuses runtime toggling is the distinction between a system layer and a user-selectable one, enforced by the engine rather than by convention.

**The mask is the batching key.** `tokenFor(mask)` already groups instances by identical configuration — the same equivalence class a batching scheduler needs to gather rows by. The grouping index is not new work; it exists.

---

## 7. Components that exist

| component | state |
|---|---|
| `research/ane-cpe/` | six engines as providers, each validated exact; ANE as GEMM primitive via e5rt |
| `research/routed-gemm/` | `Y[b] = X[b]·W[route[b]]`; gather / one GEMM per group / scatter; 5.1–22.1× dense-equivalent |
| `ExtendX.js` v1.6.0 | per-instance composition by mask, two-level memo, `locked` layers, stacked dispose |
| `llmd.js` v1.0.0 | one shared engine in a service worker; per-`contextId` conversations; kernel job control; IndexedDB session branches |
| `Terminal.dc.html` | `system.llmd` injected into every command; `llm` REPL — AI as a system call |
| `SMatrix.html` | research instrument: `top_logprobs` → sparse Frobenius ΔS per token, per layer |
| `amxprobe.c` | executes AMX and checks the arithmetic, rather than asking CPUID |

### 7.1 What the shipped compute layer actually reaches

`ComputeCore.js` registers **two** providers — `js` and `blas`. The six-engine set lives in `research/ane-cpe/` as separate modules and has not been folded back in.

| surface | reachable in shipped CPE | via |
|---|---|---|
| BLAS fp32 | yes | `cblas_sgemm`; one ABI covers MKL, OpenBLAS, Accelerate |
| VNNI + AMX int8 | yes | MKL dispatches `cblas_gemm_s8u8s32` — no C of ours required |
| portable JS | yes | reference path, no FFI, no build |
| ANE, 7,936 GFLOPS | **no** | `research/ane-cpe/ane_provider.mjs` |
| SME1 + SME2, 2,175 GFLOPS | **no** | `research/ane-cpe/cpu_gpu_providers.mjs` |
| Metal GPU, ~5,400 GFLOPS | **no** | needs `libmetalwrapper.dylib`, not vendored |
| WebGPU | **no** | no provider |

Roughly **15.5 TFLOPS proven, two providers shipped.** A scheduler feeding this layer today would hand every batch to BLAS.

The research instrument and the application surface are deliberately separate. S-Matrix requests `logprobs: true, top_logprobs: 5` and reads distributions; `llmd.chat()` requests `{messages, stream:true}` and hands back strings. **An app surface should not carry inference internals; an instrument must.**

---

## 8. What is missing, in dependency order

Three stages. Each is a precondition for the next; doing them out of order wastes the one after it.

### Stage 1 — fold the research providers into the shipped compute layer

The surfaces must exist before anything can place work on them. `ane_provider.mjs`, `cpu_gpu_providers.mjs` and the Metal wrapper are already written and validated exact against `validate.c`; what is missing is that they are research modules rather than registered CPE providers.

The design rule makes this tractable and is the reason the layer stays small:

> **Every engine is only ever asked for a normal matmul.**

A provider is `{ id, kind, detail, matmul(m,n,k,A,lda,B,ldb,C,ldc) }` and nothing more. Virtualization does not mean exposing what each engine is uniquely good at — it means narrowing the interface to the one operation all of them do well and composing above it. `routed` is therefore a mixin over `matmul`, not a kernel: gather the rows an expert owns into a contiguous block, hand the engine a plain GEMM, scatter back. BLAS retained **2% of its dense rate** at one row per block, and the cause was weight re-streaming, not call overhead — so the fix is never to hand it a ragged block.

**Deliverable:** one provider registration path, six providers behind it, each verified by the existing harness on the host it claims.

### Stage 2 — shape- and depth-aware provider selection

With several surfaces present, which one runs a given GEMM stops being fixed. §4 shows the choice is not stable across shapes: AMX leads by 42× at 720 rows per block and *loses to VNNI* at one. Apple-side the split differs again — ANE leads at 4096³ while the SME engines carry smaller shapes.

This is `route[]` a third time. Expert → adapter → **engine**. The same gather-group-dispatch structure, indexed by the cheapest provider for the block actually in hand.

**Deliverable:** a selection function over (m, k, n, dtype, rows-per-block) → provider, with the `auto` block-height paths beneath it, measured rather than assumed.

### Stage 3 — the batching scheduler in `llmd`

Only now does batching convert into throughput. Today `llmd` holds N contexts against one engine but serializes them: `ctx.busy` guards a single context, and two contexts calling `chat()` both reach `engine.chat.completions.create()` independently. The RAM figures in §5 are a *budget*, not achieved concurrency — the daemon gives many conversations per weight set, not many tokens per forward pass.

1. Collect pending turns across contexts into a scheduling window.
2. Group by configuration id — the equivalence class `tokenFor(mask)` already computes.
3. Per group, one batched forward pass: gather one row per context, one GEMM on the shared base, scatter back. This is routed-gemm's structure in its simpler form, where every row shares the weights and `B` is the number of active contexts.
4. Hand the resulting block to Stage 2's selector rather than to a fixed engine.
5. Where a group carries low-rank deltas, apply routed-gemm unchanged with `route` indexing configurations instead of experts.

Nothing in any stage is new kernel research. The kernels, the dispatch abstraction, the composition engine and the context structure all exist; what is missing is registration, selection, and the loop that joins them.

**Known shape risk:** low-rank deltas are skinny (K → 16), landing in the regime the sweep shows collapsing — VNNI 6×4 falls to 63.29 GOPS and AMX to 98.9 at 3 rows per block. Stage 2's selector is what this depends on, and the hot path should prefer configurations that resolve to state (§6.2) over those that resolve to tensors.

## 9. Measured, derived, assumed

**Measured, on real hardware, by the owner:** every figure in §2.1 and §2.2; the block-height sweep in §4; the `llama.cpp` VPS figures in §3; the dense-equivalent routed-gemm results.

**Derived from those measurements:** the crossover `B ≈ 13`; aggregate tok/s at depth; adapter and prefix footprints; contexts-per-machine.

**Assumed, and load-bearing:**

- **273 GB/s** M4 Pro unified bandwidth is a published specification, not an owner measurement. If real achievable bandwidth is lower, the crossover B *rises* and §8 matters more, not less. **This is the first thing to measure.**
- **~2 FLOP per parameter per token**, and Q4_K_M at ~4.4 bits/parameter. Standard, unverified here.
- **Amdahl applies and is not modelled.** The 100 GFLOP/s `llama.cpp` figure is whole-pipeline — attention, sampling, tokenization included. Substituting a GEMM rate for it is an upper bound. If GEMM is 80–90% of decode time, a 14× GEMM win is **4–6× overall**, not 14×.
- **GOPS are not GFLOPS.** int8 engine rates are not interchangeable with fp32/bf16 rates at equal precision.
- **Per-context KV cost is assumed and the record disagrees.** §5's contexts-per-machine uses ~0.12 GB/context (1.5B, 28 layers, kvDim 256, fp16, ~2K context). The `llama.cpp` VPS measurement implies ~0.43 GiB/stream at its own default context length — 3.5× higher. Until one figure is measured at a fixed context length, treat §5's 73 / 113 / 233 as an upper bound; at the VPS-implied rate the same machines hold 20 / 31 / 65.
- Virtual-host absolute figures are ranges (§2.2), and the two GPU figures above differ by 6%.

---

## 10. Open

1. Measure achievable memory bandwidth on the target machines. Every crossover in this document depends on it.
2. Measure per-context KV at a fixed context length, and reconcile the 3.5× gap between the two estimates in §9.
3. Register the research providers in shipped CPE (§8 Stage 1); confirm each on its host with the existing harness.
4. Build the Stage 2 selector, then the Stage 3 scheduler; measure realized concurrency against the §5 RAM budget.
5. Quantify the GEMM fraction of decode time, to replace the Amdahl estimate with a number.
6. Characterize the thin-GEMM corner for low-rank deltas on each provider.
7. Define the client/server split policy by scarce resource rather than by load, and quantify the share of turns served locally.
8. Re-measure the AMX engine table on a probe-confirmed host; the current table carries a known 28–42% host-variance band.

---

*Numbers in this document are reproducible from `research/routed-gemm/results/` via `node numbers.js`, and from `research/ane-cpe/` via `node gemm_bench002.mjs`. Where a figure could not be reproduced from the repository, §9 says so.*
