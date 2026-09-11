# Compute Revenue Streams: PNode, BNode, CNode

**MountainShift OS — Solar+Compute & Distributed Inference Economics**

---

## 1. Overview

MountainShift's compute revenue is built on three distinct node types, each with a different capital structure, risk profile, and portfolio role:

- **PNode** — owned edge hardware, physically co-located with solar generation (Solar+Compute bundle). Lowest margin, subject to seasonal/regional/latency variance, but the only node type that touches a real deal's balance sheet — financeable, appraisable, ONOMO-legible.
- **BNode** — rented backbone servers (vendor-leased GPU VPS/dedicated hardware). Most stable of the three; a real hedge that smooths the mesh's overall variance between PNode's regional exposure and CNode's volatility.
- **CNode** — ephemeral, volunteer/idle compute (a SETI@home-style model) contributed by students, schools, and companies during real idle windows (sleep, off-hours), compensated in Rewards points redeemable against App subscription cost, not cash.

All three feed the same underlying inference-capacity formula (compute floor → concurrent users → DAU → MAU → ARPU-stacked revenue), but differ in cost structure: BNode/PNode carry a real dollar cost (lease or capex), CNode carries a non-cash rewards-points liability bounded by the subscription revenue it discounts.

Both PNode and BNode/CNode revenue are **house money** relative to any individual deal — only PNode capex belongs on a specific deal's balance sheet (e.g. ONOMO-style hotel developments); BNode/CNode strengthen the overall network without diluting deal capital structure.

---

## 2. The Three Streams, Side by Side

| Node Type | Capital Structure | Margin Profile | Risk Character | Portfolio Role |
|---|---|---|---|---|
| **PNode** | Owned hardware, capex | Lowest margin of the three | Seasonal, regional, latency-exposed | Best rollup vehicle for the Fund — real, financeable asset |
| **BNode** | Rented (monthly lease, no capex) | High, scales with tier | Vendor/lease-rate risk only | The hedge — most stable, smooths the mesh |
| **CNode** | Volunteer/idle, points liability only | Highest margin (no cash cost) | Availability/reliability risk | Opportunistic layer — house money |

---

## 3. Server Alpha — DataMart GPU Tier Pricing

Running the same revenue/margin formula down a single vendor's own published GPU rental tier table reveals real, repeatable mispricing — a mechanical way to find alpha with no proprietary hardware knowledge required.

### 3.1 Legacy/EOL Tier Ladder

| Tier | Lease/mo | GPU Floor (GFlops, FP32) | Revenue/mo (est.) | Margin/mo | Rev/$ Leased |
|---|---|---|---|---|---|
| Express 2GB (GT730/P600/K620) | $14.50 | ~500 (conservative) | ~$295 | ~$280.50 (95.1%) | **20.3x** |
| P1000 | $37.00 | 1,894 | ~$995 | ~$958 (96.3%) | **26.9x** |
| K80 | $64.50 | 8,730 | ~$4,290 | ~$4,225.50 (98.5%) | **66.5x** |
| RTX A5000 | $174.50 | 27,800 (FP32 only) | ~$13,825 | ~$13,650.50 (98.7%) | **79.2x** |

### 3.2 Current-Gen (Blackwell) Tier Ladder — For Comparison

| Tier | Lease/mo | Rev/$ Leased |
|---|---|---|
| RTX 5060 | $85 | ~112x |
| RTX Pro 2000 | $99 | ~110x |
| RTX Pro 4000 | $159 | ~131x |
| RTX Pro 5000 | $269 | ~123x |

**The finding:** the legacy ladder's Rev/$ multiple climbs steeply and monotonically (20x → 27x → 66x → 79x) rather than staying flat — the vendor prices roughly linearly by their own hardware cost basis, while real inference revenue scales super-linearly with compute *and* memory. The current-gen ladder, by contrast, is flat (~110–131x across all tiers) — no exploitable curvature, because new inventory is priced tightly to its real value.

**Root cause, confirmed by testing the memory-normalization hypothesis:** price ÷ memory holds at the low end but breaks completely at the high end. K80→A5000 is the clean tell — **identical 24GB** of GPU memory, yet price nearly triples, because that jump is priced entirely on GPU generation (Kepler vs. Ampere), not memory. P1000→K80 is the inverse: a 6x memory jump for almost no price increase, because K80 is depreciated end-of-life Kepler silicon that happens to carry generous memory from its original dual-GPU (2×GK210) design era.

**The repeatable alpha-hunting rule:** any EOL/legacy-generation GPU tier that retained high memory from its original (server/dual-GPU) design is a candidate mispricing pocket — independent of vendor or specific silicon. New-generation inventory tends to be priced efficiently; legacy inventory is priced by age, not by what it can still deliver.

---

## 4. Approximate GFlops by Model Size

Compute demand scales directly with model parameter count. Required GFlops per generated token follows the standard `2 × N_params` relation; the table below gives illustrative floors at a representative target throughput.

| Model Size | Params (approx.) | GFlops per Token (2×N) | GFlops @ 300 tok/response |
|---|---|---|---|
| 125M | 0.125B | 0.25 | 75 |
| 0.5B | 0.5B | 1.0 | 300 |
| 1B | 1.0B | 2.0 | 600 |
| 3B | 3.0B | 6.0 | 1,800 |
| 7B | 7.0B | 14.0 | 4,200 |

**Note on real-world sizing:** the true cost driver is **tokens/response** (a simple chat reply may run ~50–300 tokens; a generated markdown document or long-form output can run several thousand), not the perceived streaming tok/s rate a user experiences. Real capacity planning should always be based on total tokens generated per interaction, amortized over the real idle gap between requests (a burst-then-idle model), not a flat continuous-streaming assumption.

---

## 5. GFlops per 100 CUDA Cores

A fast scaling heuristic for estimating an unfamiliar GPU's real compute floor from its CUDA core count alone, without needing the full datasheet — valid **within a single microarchitecture generation** only (tensor-core efficiency per CUDA core shifts materially across generations, e.g. Kepler → Ampere → Blackwell).

| GPU Reference | Microarchitecture | CUDA Cores | GFlops per 100 Cores |
|---|---|---|---|
| Jetson Orin Nano (reference) | Ampere | 1,024 | ~6,543 (INT8 tensor-driven TOPS) |
| Tesla K80 (per GK210 die, ×2) | Kepler | 2,496 ×2 = 4,992 | ~174.9 (FP32 CUDA-core-driven) |

**Caveat:** the Orin Nano figure reflects tensor-core INT8 throughput; the K80 figure reflects raw CUDA-core FP32 throughput — these are different precision paths and not directly comparable across the table without adjusting for architecture generation. Use this heuristic only to compare GPUs of the *same* generation and measurement basis.

---

## 6. Use Case: Grade School Computer Lab (CNode)

A grade-school computer lab represents genuine untapped CNode supply: school-owned desktops/laptops sit idle overnight, on weekends, and during summer break — long, highly predictable idle windows with real network/power infrastructure already in place.

- **Contribution model:** school opts a lab into the CNode pool; devices contribute idle cycles during non-instructional hours only, never during active class use.
- **Compensation:** Rewards points accrue to the school's account, redeemable against MSOS App subscription costs (Adaptive Learning App, Office-like Suite, etc.) — directly offsetting the district's own software spend rather than paying cash.
- **Value proposition:** a school effectively "earns" its own educational software licenses from hardware it already owns and already leaves idle — zero new capital outlay, direct budget relief.
- **Risk profile:** availability is lower and less predictable than BNode/PNode (school holidays, hardware refresh cycles, IT policy changes), consistent with CNode's position as the ephemeral, opportunistic layer of the three-node model.

---

## 7. Use Case: University / Students (CNode)

The original SETI@home-style constituency — university students with capable laptops (e.g. Apple Silicon M-series with a Neural Engine) generate real idle compute during predictable daily windows: overnight sleep and class hours when the laptop is not in active use.

- **Device profile:** a modern student laptop (e.g. M3/M4-class ANE) delivers on the order of 2–3 TFlops of real usable compute, derated ~30% for consumer thermal/OS overhead — meaningfully more capable per-device than a school lab desktop.
- **Idle window:** roughly 12 hours/day (8hr sleep + 4–6hr class time), a real and repeatable pattern across a large population, which smooths out any single device's unpredictability at scale.
- **Compensation:** points redeemable against subscription costs for exactly the kind of software a student already needs — Translate, GMAT/test-prep, Office-like Suite, Chat.
- **Strategic value:** students are also the natural user base for MSOS's other verticals (Adaptive Learning, test-prep add-ons), so CNode contribution and App consumption reinforce each other within the same population — a self-sustaining loop rather than two disconnected programs.

---

## 8. Use Case: Generic Solar Farm (PNode)

The PNode/Solar+Compute bundle: PNode hardware is physically deployed on a solar generation site, drawing a fixed allocation of the farm's excess generation capacity (headroom above pre-existing PPA commitments) to power inference compute.

- **Unit economics reference:** ~$1,000 all-in per node (hardware + install + logistics), 1:1 energy production/consumption parity with its allocated solar share.
- **Revenue split:** PNode compute revenue is anchored at the ComputeNodeDeployment entity; a fixed share (illustrative: 90% house / 10% EPC-Owner) flows to the solar site's EPC/Owner as a real, ongoing revenue stream layered on top of their existing panel-generation income — typically 2–3x the EPC/Owner's baseline per-panel revenue for the allocated footprint, even at a minority revenue share, because compute revenue scales with demand rather than only with energy price.
- **Ancillary revenue (same PNode footprint, no incremental hardware):** carbon credits (Green AI/compute offset), sensor telemetry (irradiance, panel health, thermal, dust/soiling, air quality/particulate), and indirect financing optionality (a diversified, non-weather-correlated cash flow improves an Asset-Backed Finance appetite for the underlying deal).
- **Balance sheet treatment:** PNode capex is the only node type that appears directly on a real deal's balance sheet (e.g. an ONOMO-style hotel/hospitality development with an attached solar site) — a genuine, appraisable, financeable asset, distinct from BNode/CNode's house-money treatment.
- **Risk character:** seasonal (solar generation variance), regional (site-specific PPA terms and grid conditions), and latency-exposed (physical distance from end users) — the reason PNode carries the lowest margin of the three streams, offset by its unique standing as a real financeable asset for Fund rollup purposes.

---

*Document prepared for MountainShift OS internal reference. Figures marked "illustrative" or "estimate" should be replaced with real vendor/deal-specific inputs before use in any external presentation or underwriting context.*
