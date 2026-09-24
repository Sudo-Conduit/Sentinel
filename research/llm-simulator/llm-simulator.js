// ─── llm-simulator.js — deterministic LLM inference performance/cost simulator ──
//
// Same UMD/IIFE shape as every research/regx/ocr/frontend_*.js file: one
// file, no bundler, runs as a browser <script> global, pastes into
// devtools, require()s in Node identically.
//
// The whole chain is deterministic composition, not measurement-per-model:
//   model architecture shape (real config.json, download-verify-freeze)
//   x hardware throughput-by-shape (real measured CPE data, download-verify-freeze)
//   x RAM/concurrency ceilings
//   x watts (measured where available, Teads/CCF-estimated elsewhere)
//   x emissions (CCF operational + embodied)
//   x MAU -> DAU -> concurrent-users funnel
//   x prompt-size tier (full-turn tokens, 50/50 sent/received for now --
//     prefill-weighted splits are a documented future refinement, not
//     implemented here)
// composed once per axis, reusable across every model x hardware x
// deployment-scale combination, rather than benchmarking the full cross
// product.
//
// Scope note: this is the scaffold. Shape derivation and the Teads/CCF
// watts formula are real and working. Embodied emissions, the full
// hardware-throughput-table lookup across backends, and the "optimal
// backend for N concurrent users" selector are stubbed with explicit
// TODOs below -- they need more frozen data (embodied-emissions/server-
// lifetime figures, a real Linux/AMX throughput table) before they can be
// real rather than guessed.

(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LLMSimulator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // ── Prompt-size tiers: full-turn totals, split 50/50 sent/received for
  // now (per explicit agreement -- prefill-weighting is a later refinement,
  // not implemented here). Numbers are the user's own working estimates,
  // not externally benchmarked -- flagged as tentative in the source
  // conversation, may be lowered in a future version. ──
  var PROMPT_TIERS = {
    lite:      { totalTokens: 1200, sentTokens: 600,  receivedTokens: 600 },
    average:   { totalTokens: 1500, sentTokens: 750,  receivedTokens: 750 },
    power:     { totalTokens: 3000, sentTokens: 1500, receivedTokens: 1500 },
    developer: { totalTokens: 4000, sentTokens: 2000, receivedTokens: 2000 }
  };

  // ── MAU -> DAU -> concurrent funnel. Ranges confirmed against real
  // published benchmarks (see research/llm-simulator's originating
  // conversation): DAU/MAU stickiness of 10-33% (3-10x MAU->DAU) sits
  // within the commonly-cited 10-25% standard band; concurrent/DAU of
  // 10-50% (2-10x DAU->concurrent) skews toward the high-concurrency end
  // of the ~10% industry rule-of-thumb baseline, appropriate for a
  // synchronous chat-style workload rather than a typical asynchronous app. ──
  var FUNNEL_RATIOS = {
    mauToDau: { min: 3, max: 10 },       // DAU = MAU / (3 to 10)
    dauToConcurrent: { min: 2, max: 10 } // concurrent = DAU / (2 to 10)
  };

  function deriveConcurrentUsers(mau, opts) {
    opts = opts || {};
    var mauToDau = opts.mauToDau || FUNNEL_RATIOS.mauToDau.max; // default: conservative (low stickiness) end
    var dauToConcurrent = opts.dauToConcurrent || FUNNEL_RATIOS.dauToConcurrent.max; // default: conservative (low concurrency) end
    var dau = mau / mauToDau;
    var concurrent = dau / dauToConcurrent;
    return { mau: mau, dau: dau, concurrent: concurrent, mauToDau: mauToDau, dauToConcurrent: dauToConcurrent };
  }

  // ── Matmul shape derivation from a real, verified model config (see
  // scripts/fetch_model_config.js). Models the real SwiGLU gated-FFN
  // architecture (gate_proj + up_proj + down_proj, matching Qwen2/
  // Llama-family hidden_act:"silu" configs) and real GQA (separate
  // numKeyValueHeads, not assumed equal to numAttentionHeads) -- both
  // verified against Qwen2.5-0.5B's real frozen config
  // (num_key_value_heads=2 vs num_attention_heads=14, a real 7:1 ratio;
  // hidden_act="silu" confirming the 3-matrix gated FFN, not a naive
  // 2-matrix one).
  //
  // seqLen: number of NEW tokens processed this call (prompt length for
  // prefill, always 1 for decode). kvLen: total cached sequence length
  // attention attends over (== seqLen for prefill; grows by 1 each decode
  // step). This is the prefill/decode distinction from the source
  // conversation -- prefill is one call over the whole prompt, decode is
  // one call per output token against a growing cache, and their matmul
  // shapes are genuinely different, not the same loop at different sizes.
  function deriveLayerMatmuls(shape, seqLen, kvLen) {
    var h = shape.hiddenSize;
    var kvDim = shape.numKeyValueHeads * shape.headDim;

    return [
      { name: 'q_proj',    m: seqLen, k: h,   n: h },
      { name: 'k_proj',    m: seqLen, k: h,   n: kvDim },
      { name: 'v_proj',    m: seqLen, k: h,   n: kvDim },
      // attention scores + weighted-value sum, aggregated across all
      // numAttentionHeads (each of headDim width); GQA broadcasts each KV
      // head across numAttentionHeads/numKeyValueHeads query heads, but
      // the aggregate FLOP count is the same as if computed per query head
      { name: 'attn_scores', m: seqLen * shape.numAttentionHeads, k: shape.headDim, n: kvLen },
      { name: 'attn_output', m: seqLen * shape.numAttentionHeads, k: kvLen,         n: shape.headDim },
      { name: 'o_proj',    m: seqLen, k: h,   n: h },
      { name: 'gate_proj', m: seqLen, k: h,   n: shape.intermediateSize },
      { name: 'up_proj',   m: seqLen, k: h,   n: shape.intermediateSize },
      { name: 'down_proj', m: seqLen, k: shape.intermediateSize, n: h }
    ];
  }

  // Full-model matmul list for one forward-pass call (all layers). LM head
  // (hiddenSize x vocabSize, applied to the last position only) is a real
  // matmul too but not yet included here -- TODO, needs a decision on
  // whether prefill computes it for every prompt position or just the last.
  function deriveModelMatmuls(shape, seqLen, kvLen) {
    var perLayer = deriveLayerMatmuls(shape, seqLen, kvLen);
    var all = [];
    for (var layer = 0; layer < shape.numHiddenLayers; layer++) {
      perLayer.forEach(function(mm) {
        all.push({ layer: layer, name: mm.name, m: mm.m, k: mm.k, n: mm.n });
      });
    }
    return all;
  }

  function matmulFlops(mm) {
    // real matmul (M x K) * (K x N) = 2*M*K*N FLOPs (multiply + add per
    // output element per reduction step)
    return 2 * mm.m * mm.k * mm.n;
  }

  // ── Teads/CCF power formula -- real, simple, working. ──
  // Estimated Power (W) = Pidle + (utilization/100) * (Pmax - Pidle)
  function estimateWatts(pIdle, pMax, utilizationPercent) {
    if (pMax <= pIdle) throw new Error('estimateWatts: pMax (' + pMax + ') must exceed pIdle (' + pIdle + ')');
    if (utilizationPercent < 0 || utilizationPercent > 100) throw new Error('estimateWatts: utilizationPercent must be 0-100, got ' + utilizationPercent);
    return pIdle + (utilizationPercent / 100) * (pMax - pIdle);
  }

  // ── CCF operational emissions -- real, working. Embodied emissions is a
  // documented TODO: it needs a server's amortized manufacturing footprint
  // and the caller's fractional share of that server, neither of which is
  // frozen data yet (would come from CCF's embodied-emissions dataset,
  // not yet downloaded). Returning operational-only with that fact stated
  // explicitly in the result, not silently omitted. ──
  function estimateOperationalEmissionsGrams(watts, hours, pue, gridIntensityGCO2PerKWh) {
    var kWh = (watts / 1000) * hours;
    return kWh * pue * gridIntensityGCO2PerKWh;
  }

  function estimateEmissions(watts, hours, opts) {
    opts = opts || {};
    var pue = opts.pue || 1.185; // CCF global default, see data/emissions/aws-instances.json
    if (typeof opts.gridIntensityGCO2PerKWh !== 'number') {
      throw new Error('estimateEmissions: gridIntensityGCO2PerKWh is required -- no default grid-intensity table is frozen yet (varies enormously by region, a hardcoded default would misrepresent real deployments)');
    }
    var operationalGrams = estimateOperationalEmissionsGrams(watts, hours, pue, opts.gridIntensityGCO2PerKWh);
    return {
      operationalGramsCO2e: operationalGrams,
      embodiedGramsCO2e: null, // TODO: needs CCF embodied-emissions dataset, not yet downloaded
      totalGramsCO2e: null,    // left null rather than silently reporting operational-only as "total"
      note: 'embodied emissions not yet implemented -- see TODO in estimateEmissions'
    };
  }

  // ── Backend/default suggestion -- v1, deliberately simple. Optimizes for
  // measured GFLOPS/W where we HAVE real per-backend watts data (currently
  // only ANE on the Mac Mini), falls back to raw GFLOPS otherwise. This is
  // a placeholder selection rule, not the full "optimal for N concurrent
  // users against RAM+concurrency ceilings" selector described in the
  // source conversation -- that needs the concurrency-ceiling and RAM-
  // fit checks wired in as a follow-up, not guessed here. ──
  function suggestBackend(hardwareData, shapeHint) {
    var backends = hardwareData.backends;
    var best = null;
    Object.keys(backends).forEach(function(name) {
      var b = backends[name];
      if (!b.shapes) return; // skip concurrency-only entries like GPU/SME that have no shape table yet
      var nearest = b.shapes[0];
      b.shapes.forEach(function(s) {
        if (Math.abs(s.m - shapeHint.m) < Math.abs(nearest.m - shapeHint.m)) nearest = s;
      });
      var score = nearest.gflopsPerWatt || nearest.gflops; // prefer efficiency where known, else raw throughput
      if (!best || score > best.score) best = { backend: name, shape: nearest, score: score };
    });
    return best;
  }

  return {
    PROMPT_TIERS: PROMPT_TIERS,
    FUNNEL_RATIOS: FUNNEL_RATIOS,
    deriveConcurrentUsers: deriveConcurrentUsers,
    deriveLayerMatmuls: deriveLayerMatmuls,
    deriveModelMatmuls: deriveModelMatmuls,
    matmulFlops: matmulFlops,
    estimateWatts: estimateWatts,
    estimateEmissions: estimateEmissions,
    suggestBackend: suggestBackend
  };
}));
