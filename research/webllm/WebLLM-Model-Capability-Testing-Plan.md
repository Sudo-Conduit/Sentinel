# WebLLM On-Device Model Capability Testing Plan

**Author:** Will Fobbs III
**Company:** Pooled Impact
**Created Date:** September 13, 2026
**Modified Date:** September 13, 2026
**Version:** 1.0 (Major 1, Minor 0)

---

## Summary

This document specifies a testing methodology for on-device WebLLM models
spanning the size range in the Addendum (135M through 70B parameters). The
plan treats size and capability as two separate, only loosely correlated
axes rather than one — a same-size-class comparison across model families
(SmolLM2-360M vs. Qwen2-0.5B vs. TinyLlama-1.1B) is expected to show real
capability variance for reasons unrelated to parameter count: training
data composition, instruction-tuning quality, and architecture choices all
move independently of size. A test plan built only around "how big does a
model need to be" would miss this; this plan tests both "how big" and
"which one, at that size" as distinct questions.

## 1. Purpose and Scope

The immediate question this plan answers is where the capability floor sits
for specific, narrow task classes this project's architecture actually
delegates to an on-device model — not general-purpose model quality. Two
prior findings from this project's own work set that scope:

- **Task shape, not task importance, determines whether a small model
  suffices.** Mechanical, checkable tasks (call a specific function, verify
  a specific property of the result) are within reach of very small models.
  Open-ended tasks (judge whether something looks wrong, without a stated
  check) are not, regardless of how "important" the task is to the product.
- **Deterministic offloading (CAST-style prompt routing, the graph/tensor
  architecture behind the standardized-test-prep and chemistry-analyzer
  products) narrows what actually reaches the model.** Most of what a
  session does — pattern classification, next-item selection, correctness
  checking — is classical compute, not LLM inference. The on-device model's
  real job in this system is smaller and more specific than "handle the
  conversation," which is what makes a small-model floor a live question
  rather than a foregone "no."

## 2. Task Taxonomy

Every test case is classified into exactly one of two categories before it
is run, following the same distinction the project's own tooling already
demonstrated (`CodeUtils_014.learnMode`'s Phase 1/Phase 2 exercise design):

| Category | Definition | Example |
|---|---|---|
| **Mechanical** | A single correct action exists; success is a checkable property of the output (matches a schema, calls the right function, returns a value satisfying a stated condition). | Tool-call argument construction; slot-filling a hint from a fully-specified template; classifying a short text against a fixed label set. |
| **Open-ended** | No single correct action; success requires judgment not reducible to a stated check. | Free-form explanation generation; identifying whether a piece of unfamiliar code "looks wrong" with no prior list of what wrong looks like; open dialogue. |

Reporting a model's result against the wrong category (crediting an
open-ended answer for matching a mechanical check it was never asked to
satisfy, or penalizing a mechanical failure as if it required judgment) is
the most common way this kind of test produces a misleading conclusion, so
category is recorded per test case, not inferred after the fact.

## 3. Test Harness

`CodeUtils_014.js`'s `learnMode` curriculum is the reference harness for
the mechanical/open-ended split, already built and already validated
against this project's own real bugs:

- **Phase 1** (`discover`, `locate`, `locate-static`, `report`,
  `patch-preview`, `verify`, `find-unnamed`, `report-session`) is entirely
  mechanical — every exercise names a function to call and a checkable
  property of the result.
- **Phase 2**'s `discover-real` and `central-methods` are mechanical in the
  same way, applied to an unfamiliar large file. `real-bug-hunt` is
  explicitly open-ended by the harness's own design ("this is open-ended by
  design" is stated in the exercise text) and is the one exercise expected
  to separate models by capability rather than by tool-following ability
  alone.

Additional domain-specific mechanical suites (LSAT graph-operation
classification, chemistry-analyzer surface-realization from a fully
specified template) follow the same category split once their content
layers exist, per the Engine/Content separation already established for
the standardized-test and chemistry-tutoring architecture.

## 4. Variables Held Constant vs. Swept

The Addendum's own WASM naming convention exposes a real confound that
must be controlled, not ignored: quantization changes model behavior
independently of parameter count. `q0f16`/`q0f32` (full precision) and
`q4f16_1`/`q4f32_1` (4-bit) builds of the same model are not the same test
subject.

- **Held constant within a single comparison:** quantization level, context
  size (`cs1k` unless a task genuinely requires more), task category,
  check criteria.
- **Swept:** model family, parameter count, and — as a second pass once a
  family/size pairing is selected — quantization level, to quantify what
  degrades first as precision drops (a separate, real question from "what
  degrades first as size drops").

## 5. Metrics Captured Per Run

Following directly from the "the test was better than reading the file"
finding earlier in this project's own work — a result is only evidence if
it is a checkable outcome, not an impression — every run records:

1. **Pass/fail against the stated check** (mechanical tasks) or **a plainly
   stated finding, including "found nothing"** (open-ended tasks, per
   `real-bug-hunt`'s own instruction: "If you find nothing, say so plainly
   rather than inventing a finding").
2. **Tool-call count** and whether each call used real, previously-returned
   names (per `discover`'s own instruction: "Do not guess names from
   reading the file by eye").
3. **Wall-clock time** to task completion.
4. **False-positive rate** on open-ended tasks — a claimed finding that
   does not hold up against the real source, the same standard applied to
   the `async`-keyword bug found and verified against ground truth in this
   project's own Phase 2 run.
5. **Which specific finding, by identity, not just count** — this project's
   own informal testing noticed apparent weight-class-specific detection
   differences (different models surfacing different real issues rather
   than a strict smaller-subset relationship) but did not record enough
   detail to confirm it. This field exists specifically to make that
   pattern checkable on a future run, not to assert it is already known.

## 6. Model Roster and Sequencing

Tests proceed in ascending parameter order within each task category,
stopping at the first size where the pass rate meets the product's
required bar for that specific task (not "the largest available" and not
"the smallest available" by default). The Addendum lists every currently
available WASM build; the roster below groups it by size tier for
sequencing purposes.

| Tier | Approx. params | Candidates |
|---|---|---|
| Micro | ≤1B | SmolLM2-135M, SmolLM2-360M, Qwen2-0.5B, Qwen3-0.6B, Qwen3.5-0.8B, GPT2, GPT2-medium, OLMo-2-0425-1B, Gemma3-1b-it, Llama-3.2-1B |
| Small | 1–2B | TinyLlama-1.1B (v0.4, v1.0), StableLM-2-Zephyr-1.6B, Qwen2-1.5B, Qwen3-1.7B, SmolLM2-1.7B |
| Mid | 2–4B | Gemma-2b-it, Gemma-2-2b-it (+ jpn variant), Qwen3.5-2B, Ministral-3-3B (Base, Instruct, Reasoning), Qwen2.5-3B, Qwen3-4B (+ Instruct-2507, Thinking-2507), Qwen3.5-4B, RedPajama-INCITE-Chat-3B, Llama-3.2-3B |
| Large | 7–9B | Mistral-7B-Instruct-v0.3, Llama-3-8B-Instruct, Llama-3.1-8B-Instruct, Phi-3-mini, Phi-3.5-mini, Phi-4-mini, Qwen2-7B, Qwen3-8B, Qwen3.5-9B, Gemma-2-9b-it, OLMo-2-1124-7B |
| XL | 13B+ | Llama-2-13b-chat-hf, Llama-3-70B-Instruct, Llama-3.1-70B-Instruct |
| Specialized | — | Phi-3.5-vision-instruct (multimodal, out of scope for text-only task categories above), Snowflake-Arctic-Embed-M/S (embedding, not generative — separate test design required, not covered by this plan) |

The Reasoning and Thinking variants (`Ministral-3-3B-Reasoning-2512`,
`Qwen3-4B-Thinking-2507`) are kept distinct from their base/instruct
siblings at the same size — a variant specifically tuned for extended
reasoning is a different test subject from its base model even at
identical parameter count, for the same reason the Micro/Small/Mid/Large
grouping is by size and not by family: the roster is organized to let
same-size, different-training comparisons happen, not to obscure them
under one size label.

## 7. Open Items

1. **Weight-class detection-diversity claim** — noticed, not yet formalized
   (Section 5, metric 5 exists to close this gap on a future run).
2. **Content layers** for LSAT and chemistry-analyzer mechanical suites are
   not yet built; this plan's harness section currently only fully covers
   the `CodeUtils_014` reference case.
3. **Quantization-degradation ordering** (Section 4) has not been run as
   its own sweep.
4. **Pass-rate bar per task** — Section 6's stopping rule requires a
   product-defined threshold per task category that has not yet been set.

---

## Addendum: WebLLM WASM Library List — v0.2.84

Context: this is the full set of prebuilt WebGPU-target WASM model
artifacts available through WebLLM at the time of writing. Each row is one
compiled artifact — a given model may appear multiple times at different
quantization levels, each a distinct test subject per Section 4. `cs1k`/
`cs2k`/`ctx512` context-size suffixes describe the artifact's compiled
context window, not a runtime-configurable parameter — a task requiring a
longer context than a given artifact was compiled for needs a different
artifact, not a different setting.

| Model | WASM File | Quantization | Context |
|-------|-----------|--------------|---------|
| **Llama 2** | | | |
| Llama-2-13b-chat-hf | `Llama-2-13b-chat-hf-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Llama-2-13b-chat-hf | `Llama-2-13b-chat-hf-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Llama-2-7b-chat-hf | `Llama-2-7b-chat-hf-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Llama-2-7b-chat-hf | `Llama-2-7b-chat-hf-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **Llama 3** | | | |
| Llama-3-70B-Instruct | `Llama-3-70B-Instruct-q3f16_1_cs1k-webgpu.wasm` | q3f16_1 | cs1k |
| Llama-3-8B-Instruct | `Llama-3-8B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Llama-3-8B-Instruct | `Llama-3-8B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **Llama 3.1** | | | |
| Llama-3.1-70B-Instruct | `Llama-3_1-70B-Instruct-q3f16_1_cs1k-webgpu.wasm` | q3f16_1 | cs1k |
| Llama-3.1-8B-Instruct | `Llama-3_1-8B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Llama-3.1-8B-Instruct | `Llama-3_1-8B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **Llama 3.2** | | | |
| Llama-3.2-1B-Instruct | `Llama-3.2-1B-Instruct-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| Llama-3.2-1B-Instruct | `Llama-3.2-1B-Instruct-q0f32_cs1k-webgpu.wasm` | q0f32 | cs1k |
| Llama-3.2-1B-Instruct | `Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Llama-3.2-1B-Instruct | `Llama-3.2-1B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Llama-3.2-3B-Instruct | `Llama-3.2-3B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Llama-3.2-3B-Instruct | `Llama-3.2-3B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **Mistral / Ministral** | | | |
| Ministral-3-3B-Base-2512 | `Ministral-3-3B-Base-2512-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Ministral-3-3B-Base-2512 | `Ministral-3-3B-Base-2512-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Ministral-3-3B-Instruct-2512-BF16 | `Ministral-3-3B-Instruct-2512-BF16-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Ministral-3-3B-Instruct-2512-BF16 | `Ministral-3-3B-Instruct-2512-BF16-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Ministral-3-3B-Reasoning-2512 | `Ministral-3-3B-Reasoning-2512-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Ministral-3-3B-Reasoning-2512 | `Ministral-3-3B-Reasoning-2512-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Mistral-7B-Instruct-v0.3 | `Mistral-7B-Instruct-v0.3-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Mistral-7B-Instruct-v0.3 | `Mistral-7B-Instruct-v0.3-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **Phi** | | | |
| Phi-1.5 | `phi-1_5-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Phi-1.5 | `phi-1_5-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Phi-2 | `phi-2-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Phi-2 | `phi-2-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Phi-3-mini-4k-instruct | `Phi-3-mini-4k-instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Phi-3-mini-4k-instruct | `Phi-3-mini-4k-instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Phi-3.5-mini-instruct | `Phi-3.5-mini-instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Phi-3.5-mini-instruct | `Phi-3.5-mini-instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Phi-3.5-vision-instruct | `Phi-3.5-vision-instruct-q4f16_1_cs2k-webgpu.wasm` | q4f16_1 | cs2k |
| Phi-3.5-vision-instruct | `Phi-3.5-vision-instruct-q4f32_1_cs2k-webgpu.wasm` | q4f32_1 | cs2k |
| Phi-4-mini-instruct | `Phi-4-mini-instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Phi-4-mini-instruct | `Phi-4-mini-instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **Qwen** | | | |
| Qwen2-0.5B-Instruct | `Qwen2-0.5B-Instruct-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| Qwen2-0.5B-Instruct | `Qwen2-0.5B-Instruct-q0f32_cs1k-webgpu.wasm` | q0f32 | cs1k |
| Qwen2-0.5B-Instruct | `Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen2-0.5B-Instruct | `Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen2-1.5B-Instruct | `Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen2-1.5B-Instruct | `Qwen2-1.5B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen2-7B-Instruct | `Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen2-7B-Instruct | `Qwen2-7B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen2.5-3B-Instruct | `Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen2.5-3B-Instruct | `Qwen2.5-3B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3-0.6B | `Qwen3-0.6B-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| Qwen3-0.6B | `Qwen3-0.6B-q0f32_cs1k-webgpu.wasm` | q0f32 | cs1k |
| Qwen3-0.6B | `Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3-0.6B | `Qwen3-0.6B-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3-1.7B | `Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3-1.7B | `Qwen3-1.7B-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3-4B | `Qwen3-4B-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3-4B | `Qwen3-4B-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3-4B-Instruct-2507 | `Qwen3-4B-Instruct-2507-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3-4B-Instruct-2507 | `Qwen3-4B-Instruct-2507-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3-4B-Thinking-2507 | `Qwen3-4B-Thinking-2507-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3-4B-Thinking-2507 | `Qwen3-4B-Thinking-2507-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3-8B | `Qwen3-8B-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3-8B | `Qwen3-8B-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3.5-0.8B | `Qwen3.5-0.8B-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| Qwen3.5-0.8B | `Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3.5-0.8B | `Qwen3.5-0.8B-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3.5-2B | `Qwen3.5-2B-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3.5-2B | `Qwen3.5-2B-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3.5-4B | `Qwen3.5-4B-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3.5-4B | `Qwen3.5-4B-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Qwen3.5-9B | `Qwen3.5-9B-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Qwen3.5-9B | `Qwen3.5-9B-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **SmolLM** | | | |
| SmolLM2-135M-Instruct | `SmolLM2-135M-Instruct-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| SmolLM2-135M-Instruct | `SmolLM2-135M-Instruct-q0f32_cs1k-webgpu.wasm` | q0f32 | cs1k |
| SmolLM2-135M-Instruct | `SmolLM2-135M-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| SmolLM2-135M-Instruct | `SmolLM2-135M-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| SmolLM2-360M-Instruct | `SmolLM2-360M-Instruct-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| SmolLM2-360M-Instruct | `SmolLM2-360M-Instruct-q0f32_cs1k-webgpu.wasm` | q0f32 | cs1k |
| SmolLM2-360M-Instruct | `SmolLM2-360M-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| SmolLM2-360M-Instruct | `SmolLM2-360M-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| SmolLM2-1.7B-Instruct | `SmolLM2-1.7B-Instruct-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| SmolLM2-1.7B-Instruct | `SmolLM2-1.7B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| SmolLM2-1.7B-Instruct | `SmolLM2-1.7B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **TinyLlama** | | | |
| TinyLlama-1.1B-Chat-v0.4 | `TinyLlama-1.1B-Chat-v0.4-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| TinyLlama-1.1B-Chat-v0.4 | `TinyLlama-1.1B-Chat-v0.4-q0f32_cs1k-webgpu.wasm` | q0f32 | cs1k |
| TinyLlama-1.1B-Chat-v0.4 | `TinyLlama-1.1B-Chat-v0.4-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| TinyLlama-1.1B-Chat-v0.4 | `TinyLlama-1.1B-Chat-v0.4-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| TinyLlama-1.1B-Chat-v1.0 | `TinyLlama-1.1B-Chat-v1.0-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| TinyLlama-1.1B-Chat-v1.0 | `TinyLlama-1.1B-Chat-v1.0-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **Gemma** | | | |
| Gemma-2b-it | `gemma-2b-it-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Gemma-2b-it | `gemma-2b-it-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Gemma-2-2b-it | `gemma-2-2b-it-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Gemma-2-2b-it | `gemma-2-2b-it-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Gemma-2-2b-jpn-it | `gemma-2-2b-jpn-it-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Gemma-2-2b-jpn-it | `gemma-2-2b-jpn-it-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Gemma-2-9b-it | `gemma-2-9b-it-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| Gemma-2-9b-it | `gemma-2-9b-it-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| Gemma3-1b-it | `gemma3-1b-it-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| **Other** | | | |
| GPT2 | `gpt2-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| GPT2-medium | `gpt2-medium-q0f16_cs1k-webgpu.wasm` | q0f16 | cs1k |
| OLMo-2-0425-1B-Instruct | `OLMo-2-0425-1B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| OLMo-2-0425-1B-Instruct | `OLMo-2-0425-1B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| OLMo-2-1124-7B-Instruct | `OLMo-2-1124-7B-Instruct-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| OLMo-2-1124-7B-Instruct | `OLMo-2-1124-7B-Instruct-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| RedPajama-INCITE-Chat-3B-v1 | `RedPajama-INCITE-Chat-3B-v1-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| RedPajama-INCITE-Chat-3B-v1 | `RedPajama-INCITE-Chat-3B-v1-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| StableLM-2-Zephyr-1.6B | `stablelm-2-zephyr-1_6b-q4f16_1_cs1k-webgpu.wasm` | q4f16_1 | cs1k |
| StableLM-2-Zephyr-1.6B | `stablelm-2-zephyr-1_6b-q4f32_1_cs1k-webgpu.wasm` | q4f32_1 | cs1k |
| **Embedding Models** | | | |
| Snowflake-Arctic-Embed-M (batch32) | `snowflake-arctic-embed-m-q0f32-ctx512_cs512_batch32-webgpu.wasm` | q0f32 | ctx512, batch32 |
| Snowflake-Arctic-Embed-M (batch4) | `snowflake-arctic-embed-m-q0f32-ctx512_cs512_batch4-webgpu.wasm` | q0f32 | ctx512, batch4 |
| Snowflake-Arctic-Embed-S (batch32) | `snowflake-arctic-embed-s-q0f32-ctx512_cs512_batch32-webgpu.wasm` | q0f32 | ctx512, batch32 |
| Snowflake-Arctic-Embed-S (batch4) | `snowflake-arctic-embed-s-q0f32-ctx512_cs512_batch4-webgpu.wasm` | q0f32 | ctx512, batch4 |

### WASM Naming Convention

| Part | Meaning | Example |
|------|---------|---------|
| `q4f16_1` | Quantization: 4-bit, float16, version 1 | `q4f16_1` |
| `q4f32_1` | Quantization: 4-bit, float32, version 1 | `q4f32_1` |
| `q3f16_1` | Quantization: 3-bit, float16, version 1 | `q3f16_1` |
| `q0f16` | Quantization: 0-bit (full), float16 | `q0f16` |
| `q0f32` | Quantization: 0-bit (full), float32 | `q0f32` |
| `cs1k` | Context size: 1024 tokens | `cs1k` |
| `cs2k` | Context size: 2048 tokens | `cs2k` |
| `cs512` | Context size: 512 tokens | `cs512` |
| `ctx512` | Context size: 512 tokens | `ctx512` |
| `batch32` | Batch size: 32 (embedding models) | `batch32` |
| `batch4` | Batch size: 4 (embedding models) | `batch4` |
| `webgpu` | Target: WebGPU | `webgpu` |

---

## Version History

| Version | Date | Notes |
|---|---|---|
| 1.0 | September 13, 2026 | Initial plan: task taxonomy, `CodeUtils_014.learnMode` reference harness, metrics, model roster by size tier, WASM library Addendum. |
