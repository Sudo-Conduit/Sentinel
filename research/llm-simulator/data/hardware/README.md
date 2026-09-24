# Hardware throughput-by-shape data

Each file here is a real machine's measured matmul throughput, per backend,
per shape -- not a synthesized or published spec-sheet estimate. GFLOPS
is not a fixed number per backend; it depends on how well a given M/N/K
shape tiles onto that backend's execution units (the whole reason this
simulator indexes by shape rather than a single number per backend).

## Status

- `mac-mini-apple-silicon.json` -- real numbers, reported by the user this
  session, cross-verified (math outputs checked, not just timing) before
  being trusted.
- Linux/Sentinel AMX-equipped box -- **not yet benchmarked**. The CPU flags
  (`amx_tile`, `amx_bf16`, `amx_int8`, `avx512_vnni`) confirm the hardware
  capability exists (verified via `/proc/cpuinfo` + `lscpu`), but no real
  GEMM throughput numbers have been measured on it yet. Do not add a file
  for it until real numbers exist -- a placeholder with invented figures
  would defeat the entire point of this dataset.
