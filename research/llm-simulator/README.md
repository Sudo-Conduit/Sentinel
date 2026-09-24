# LLM Simulator

A deterministic LLM inference performance/cost simulator: given a model and
a hardware target, predict latency, throughput, power draw, and CO2e
emissions without running the model -- by composing real, verified data
along independent axes rather than benchmarking every model x hardware
combination directly.

## The chain

```
model architecture shape (real config.json)
  x hardware throughput-by-shape (real measured GFLOPS)
  x RAM / concurrency ceilings
  x watts (measured where available, Teads/CCF-estimated elsewhere)
  x emissions (CCF operational + embodied)
  x MAU -> DAU -> concurrent-users funnel
  x prompt-size tier (full-turn tokens, 50/50 sent/received)
```

Each axis is measured or derived once and reused across every combination
-- the model doesn't need re-benchmarking per machine, and the hardware
doesn't need re-benchmarking per model.

## Data discipline: download, verify, freeze

Nothing here is vendored (copied as-is and trusted) or fetched live at
call time. Each dataset is downloaded from its real authoritative source,
verified against sanity checks specific to what the simulator actually
needs from it, then frozen into a static JSON file under `data/`. This
means:

- **Offline-first.** The UMD/IIFE tool (`llm-simulator.js`) needs zero
  network access to run -- it runs as a browser `<script>` global, pastes
  into devtools, or `require()`s in Node, identically, using only frozen
  data.
- **Verified, not assumed.** Every acquisition script in `scripts/` checks
  real invariants (row counts, required fields present, GQA/head-dim
  divisibility, Pmax > Pidle, plausible ranges) before freezing anything,
  and a companion `test_*.js` re-checks the frozen file against the same
  rules so a hand-edit or corrupted freeze is caught immediately.
- **Re-runnable.** Re-run the fetch script any time to refresh a dataset
  against its live source; the freeze is a snapshot, not a one-way export.

## Structure

- `llm-simulator.js` -- the UMD/IIFE tool itself.
- `scripts/fetch_model_config.js` -- downloads + verifies + freezes a real
  Hugging Face model's `config.json` (the machine-readable transformers
  AutoConfig format, not the prose Model Card) into `data/models/`.
- `scripts/fetch_emissions_coefficients.js` -- downloads + verifies +
  freezes the real Teads/Cloud-Carbon-Footprint `aws-instances.csv`
  (Pidle/Pmax per real AWS instance type, plus the global PUE constant)
  into `data/emissions/`.
- `data/hardware/` -- real measured GFLOPS-by-shape tables, hand-authored
  from real benchmark runs (not downloaded from a third party) -- see
  `data/hardware/README.md` for what's measured vs. not-yet-benchmarked.
- `test_llm_simulator.js`, `scripts/test_model_data.js`,
  `scripts/test_emissions_data.js` -- real verification, same PASS/FAIL
  convention as `research/regx/ocr`'s tests.

## Status

Working end-to-end for one model (Qwen2.5-0.5B) and one real emissions
data point: real config.json -> real per-layer matmul shape derivation
(including GQA and the real 3-matrix SwiGLU gated FFN, not a naive
uniform-heads/2-matrix-FFN assumption) -> real FLOP counts for both
prefill and decode phases -> real Teads/CCF watts formula against real
constants -> emissions formula (operational component real and working;
embodied component is an explicit, honestly-reported `null` pending the
CCF embodied-emissions dataset, not yet downloaded).

Open, explicitly documented next steps (see inline `TODO`s in
`llm-simulator.js`):
- Embodied emissions (needs CCF's embodied-emissions dataset).
- Grid carbon-intensity table (needs a real per-region source; the
  emissions formula currently requires the caller to supply this rather
  than defaulting it, since a hardcoded default would misrepresent real
  deployments).
- Real Linux/AMX-equipped hardware throughput table (CPU flags confirm
  `amx_tile`/`amx_bf16`/`amx_int8`/`avx512_vnni` support, but no real GEMM
  benchmark has been run on it yet -- deliberately not faked).
- The full "optimal backend for N concurrent users against RAM +
  concurrency ceilings" selector (`suggestBackend` is a v1 placeholder
  that optimizes GFLOPS/W where known, without yet checking concurrency
  ceilings or per-user KV-cache RAM fit).
- LM head matmul (hiddenSize x vocabSize) not yet included in
  `deriveModelMatmuls`.
- Prefill-weighted (non-50/50) prompt-tier splits.
