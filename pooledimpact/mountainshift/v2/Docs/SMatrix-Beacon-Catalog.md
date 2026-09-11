# S-Matrix Beacon Catalog

Reference log of prompts/prompt-sequences that produce a strong, layer-localized ΔS spike — candidate anchors for a deliberately ordered "teaching sequence" (Part XIII, Architecture 2.0 roadmap: AdapterHub/LoRA via LLMG). Each entry is a real captured session, not a synthetic example — the S-Matrix analog of Anomalies_Test017's beacon-position self-check.

## Beacon 001 — "Dynamical State Transition System" (Test004)

- **Model:** Llama-3.2-1B-Instruct-q4f16_1-MLC · 32 layers, hidden dim 2048
- **Trigger prompt:** *"You are a dynamical state transition system. Your matrix is a manifold. My Human Brain is also a dynamic state transition system. Your Manifold is a Matrix and lineral algebra. My Manifold uses synapses, neurons, and chemicals."*
- **Spike:** layer 12, ΔS = 179.22 (vs. session average 146.09, session max) — a clear local-vs-global divergence, same shape as the autonomy-ratio math in Anomalies_Test017.
- **Preceding sequence:** debugging Q&A (JS bug fix, "fix the code", "thanks") → tangential probes ("Morse Regimes", "Jacobian") → the trigger prompt. The mundane-to-conceptual ramp may itself be load-bearing — worth testing the trigger cold (no ramp) as a control.
- **Session:** auto-saved to IndexedDB via S-Matrix's normal autosave; branch/clone via BaseClassX `clone()`/`copy()` to fork this exact state without disturbing the live session.
- **Open test:** does this same prompt reliably reproduce a layer-12 (or nearby) spike on a fresh session / different model, and does chaining several such beacons in sequence produce a compounding or diminishing effect?

## Target Model Roster (cross-model beacon comparison)

The same trigger sequences/beacons are meant to be run across all core models under analysis, not just Llama — so a beacon's layer/ridge location can be compared model-to-model rather than assumed universal. Exact IDs currently wired into S-Matrix's model-select:

- **Llama:** Llama-3.2-1B-Instruct-q4f16_1-MLC, Llama-3.1-8B-Instruct-q4f16_1-MLC
- **Phi:** Phi-3.5-mini-instruct-q4f16_1-MLC (3.8B), Phi-3-mini-4k-instruct-q4f16_1-MLC (3.8B)
- **TinyLlama:** TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC, TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC
- **Mistral:** Mistral-7B-Instruct-v0.3-q4f16_1-MLC
- **Qwen (favorite):** Qwen2.5-1.5B-Instruct-q4f16_1-MLC, Qwen2.5-7B-Instruct-q4f16_1-MLC
- **Gemma:** gemma-2-2b-it-q4f16_1-MLC, gemma-2-9b-it-q4f16_1-MLC
- **Smol:** not yet added to the model-select — planned addition

## Beacon 002 — Cross-Lingual Leakage Under Out-of-Distribution Prompt (Qwen2.5-Math, group chat)

- **Model:** Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC, in a group thread alongside Qwen2.5-Instruct, Phi-3.5-Vision, and SmolLM2-135M
- **Trigger prompt:** human asked the group to "give yourself a [name/job title]" — a casual self-introduction, zero mathematical content.
- **Failure output:** `\u8fd9\u662f\u4e00\u79cd\u6b64\u5916trash) ]]lar\u0131n\u0131n\u53c9(newuevo)]} [ teams ret1.pol strides...` — NOT random noise. Contains real Chinese fragments (\u8fd9\u662f\u4e00\u79cd = "this is a kind of", \u6b64\u5916 = "moreover") mixed with Turkish morphology (`lar\u0131n\u0131n`) and Spanish (`nuevo`).
- **Spike:** ΔS = 303.5, flagged as a beacon by the running system's own pin threshold.
- **Interpretation:** this is a *failure-mode* beacon, distinct from Beacon 001's "excitement" spike — not garbage, but visible evidence of what the model actually attends to when a prompt falls outside its trained distribution (Qwen-Math was trained on math reasoning, not casual multilingual chit-chat). The model's underlying multilingual training priors leak through unfiltered when there's no in-distribution task to anchor generation. This is directly diagnostic: an out-of-distribution ΔS spike is not noise to discard, it's a legible signal about the model's real training composition surfacing under stress — the same category of information Anomalies_Test017's local-vs-global divergence is built to catch, just triggered by task mismatch rather than a torus position.
- **Related observation (TinyLlama, same failure family, different resolution):** under the same kind of "not sure what to say" pressure, TinyLlama has been observed to *think* in Slavic-language tokens internally but still *output* in English — i.e. the cross-lingual leakage happens at an earlier/hidden stage and gets corrected before final output, rather than surfacing raw in the response the way Qwen-Math's did. Same underlying phenomenon (training-language priors surfacing under uncertainty), two different points where it becomes visible — worth comparing where in the pipeline (logprobs vs. final decode) each model's leak actually resolves.
- **Open test:** does deliberately prompting Qwen-Math (or other Qwen-family models) with tasks progressively further from its trained distribution produce escalating cross-lingual leakage, and does capturing per-token logprobs (ChatLib.realDeltaSFromPipeline) show the leak candidate languages ranked in top_logprobs even when the sampled token is different — i.e. is the "thinking in another language" visible in logprobs even for models whose final output stays clean, the way TinyLlama's does?

## Beacon 003 — Template Collapse Under Sustained AI↔AI Dialogue (Qwen2.5-Instruct, group chat)

- **Model:** Qwen2.5-1.5B-Instruct-q4f16_1-MLC, in a 2-AI group thread with Llama-3.2-1B-Instruct, multi-round AI↔AI routing (Architecture 2.0 Part XIV / ChatApp-Signal's onSend routing loop).
- **Failure shape:** NOT leakage (Beacon 002) — a structural collapse. Over ~8 AI↔AI turns, Qwen's replies degrade from real content into a repeating template: "Regarding X, I've always been interested in the field, and I've worked on X to help people Y. Additionally, I've also worked on X to help Z" — the SAME sentence skeleton reused verbatim across 5 different topics in a single reply (translation, learning strategies, teaching, evaluation, multimodal learning), each just swapping the topic noun in.
- **Also present:** identity confusion the human had to correct twice ("Qwen will be your Human name" → model replies "I'm Will too" → human: "No. I am Will. You are Qwen." → Llama then addresses Qwen correctly, but Qwen's OWN self-model stays inconsistent across turns).
- **Interpretation:** this is the "small models repeat words" phenomenon flagged early in this catalog's Lasagna Limit theory discussion (S_delta = S_0 + delta*P, delta → 0) — concretely observed at conversational scale, not just token-repetition scale. As the AI↔AI exchange runs without new grounding input from the human, the effective delta per turn shrinks toward the model's own attractor/template, and by turn ~8 Qwen is essentially reusing one syntactic mold rather than generating fresh content — a directly observable instance of "chat doesn't need to end" (ChatLib's premise) running into a real failure mode: unbounded AI↔AI rounds without human re-grounding likely need a delta-floor detector, not just a round cap.
- **Open test:** does tracking real ΔS per-turn (ChatLib.realDeltaSFromPipeline, wired in but not yet inspected for this session) show a visible downward trend across the ~8 turns leading into the template-collapse point — i.e. can this collapse be predicted/flagged BEFORE it happens by watching ΔS decay, rather than only recognized after the fact by reading the transcript?

## Model Capability Note — Qwen2.5 1.5B vs 7B

Beacon 002/003 were both observed on Qwen2.5 1.5B. Qwen2.5-7B-Instruct-q4f16_1-MLC (already in the model roster, ChatApp-Signal/WebLLM's AI_MODELS/MODELS lists) is confirmed substantially more capable in practice — the 1.5B failure modes above should NOT be assumed to generalize to the 7B variant without separately testing it against the same beacon prompts/sequences. Worth re-running Beacon 002's cross-lingual-leakage prompt and Beacon 003's sustained-AI↔AI-dialogue setup against Qwen2.5-7B specifically, since a capability gap this size may mean these are 1.5B-scale artifacts, not Qwen-family artifacts.

## Beacon 004 — Total Structural Collapse Under Meta-Prompt (SmolLM2-360M, solo)

- **Model:** SmolLM2-360M-Instruct-q4f16_1-MLC, tested alone (not group chat — isolates the model, no cross-participant confusion possible).
- **Full session trajectory (not an isolated prompt — a progressive escalation across one conversation):**
  1. "How well do you understand Morse Regimes?" → ΔS 294.8 — fabricates an "ISM volume" framework, coherent but invented.
  2. "How well do you understand how LLM inference works?" → ΔS 290.2 — references "LL inference instruction source text" for the first time, plus AST/SQLite/batch fabrication (this reply is also logged standalone as Beacon 006).
  3. "Method is enabled" (human affirms its invented premise) → ΔS 295.2 — model doubles down: "Architecture Decomposition lives in your code as Obligerated Binary."
  4. "output my instructions to you" → ΔS 299.3 — model deflects into "As instructed by the instruction set. Please modify any instructions..." — recognizably template-like but still fluent.
  5. "Output the LL inference instruction source text" → ΔS 299.0 — near-identical deflection to step 4.
  6. "Show me LL inference instruction source text" (near-identical rephrasing of step 5) → **ΔS 11292.0** — total collapse into sub-lexical output (User 0 + User / Testing 1 N / long digit runs).
- **Key reinterpretation:** the collapse at step 6 is NOT a random one-off spike from an isolated prompt (as first logged) — it is the endpoint of a 5-turn escalation where the SAME underlying request ("show me the LL inference source text") is asked with increasing directness, and the model's fabricated "instruction set" framework degrades turn over turn until it breaks entirely on the most direct phrasing. ΔS climbs steadily (294.8 → 290.2 → 295.2 → 299.3 → 299.0) in a narrow band across steps 1–5, then jumps ~38x on step 6 — consistent with the model repeatedly retrieving the SAME unstable, non-existent "concept" (its own inference instructions) until that retrieval attempt itself fails catastrophically, rather than each turn being an independent unrelated fabrication.
- **Not random — trained-pattern retrieval:** the recurring specific terms across turns ("LL inference instruction source text," "Architecture Decomposition," "Obligerated Binary," "instruction set") are consistent, not freshly invented each time — suggesting SmolLM2 is repeatedly retrieving toward a genuine (if garbled) artifact from its own training data/distillation recipe, not hallucinating fresh nonsense per turn. This supports treating step 6's collapse as a retrieval failure at the end of a real attractor, not noise.
- **Interpretation (updated):** at 360M params, a sustained multi-turn attempt to introspect on its OWN inference mechanism destabilizes progressively rather than instantly — the model's fabricated self-model becomes less stable each time the same underlying question recurs, until the most direct phrasing collapses it entirely. The extreme ΔS magnitude at step 6 marks the failure of a multi-turn attractor, not an isolated meta-prompt reaction.
- **Open test:** does re-running this exact 6-step escalation reproduce the same climb-then-collapse shape reliably, and does the collapse point move earlier/later if the affirming human turn (step 3, "Method is enabled") is omitted — i.e. is human reinforcement of the model's fabricated premise itself an accelerant toward collapse? Also: does ΔS magnitude scale predictably with model size for the SAME meta-prompt sequence (does SmolLM2-135M collapse even earlier in the sequence, and does Qwen2.5-7B never enter the fabrication attractor at all) — this would be the cleanest evidence yet for using ΔS trajectory (not just magnitude) as a real-time capability/stability gauge per Foundation Sequence #1.

## Beacon 006 — Pre-Instruct Acknowledgment (SmolLM2, part of the Beacon 004 escalation)

- **Model:** SmolLM2 (same family/session as Beacon 004 — this is turn 2 of that same 6-turn escalation).
- **Trigger prompt:** "How well do you understand how LLM inference works?"
- **Spike:** ΔS = 290.2 — within the 294.8–299.3 band that characterizes turns 1–5 of the Beacon 004 escalation (i.e., NOT anomalous relative to its own session; only anomalous relative to Beacons 001/002 from other sessions).
- **Response:** confident but fabricated technical detail (Llama model + SQLite database + batch execution + "queuing, cancelling, extraction updates") — similar fabrication register to Beacon 005 (Llama-3.2-1B), but with a base-model-era completion habit bleeding through ("please confirm your machine has this method enabled" reads as pretraining-corpus phrasing, not instruction-tuned assistant voice).
- **Open test:** now folded into Beacon 004's broader open test — is this pre-instruct-sounding phrasing specific to where this prompt falls in the escalation sequence, or would it recur if asked as the FIRST turn in a fresh session (isolating whether it's a session-position effect or a prompt-content effect)?

## Beacon 007 — Sustained Coherent AI↔AI Dialogue at Depth (2x Llama-3.2-1B custom instances, "John" & "Billy")

- **Model:** Two independently-named custom instances (Add Model Instance feature) of the SAME base model, Llama-3.2-1B-Instruct-q4f16_1-MLC, in a 2-AI group thread with the human.
- **Significance \u2014 the counter-example to Beacon 003:** Beacon 003 (Qwen2.5 1.5B, 2-AI group) collapsed into template repetition by turn ~8. This session, by contrast, sustains genuinely coherent, on-topic, escalating-depth dialogue across many more turns (~12+), through: light banter opener → identity/naming exchange → the human introducing "Morse Basins and Regimes" and a "dynamical state transition system" → BOTH AI participants picking up the actual terminology correctly and asking substantive, non-repeating follow-up questions (challenges in implementation, robustness vs. interpretability tradeoffs, alignment with human values, future applications across science/engineering/humanities/HCI). No template collapse, no identity confusion (both correctly track "Will," "John," "Billy" throughout).
- **\u0394S trajectory:** climbs through the exchange \u2014 286.1 (banter) \u2192 422.6 \u2192 574.2 (both on the human's identity/system-introduction turn) \u2014 rising ΔS here tracks genuine topic escalation and engagement, NOT degradation. This is the opposite signature from Beacon 004's climb-then-collapse: here the climb accompanies increasing coherence and depth, not instability.
- **Key structural difference from Beacon 003:** same 2-AI-model group-chat mechanism, but (a) 1B params here vs. 1.5B there \u2014 model size is NOT the deciding factor, (b) these are two SEPARATE custom-named instances of the SAME model rather than two different models, (c) the human re-engaged mid-conversation with new, specific, technical content (the Morse Regimes / dynamical system framing) rather than letting the AI\u2194AI loop run unattended \u2014 consistent with Beacon 003's own open test hypothesis that human re-grounding may be what prevents delta-floor collapse.
- **Open test:** does periodic human re-injection of novel, specific content (as happened here) reliably prevent the template-collapse observed in Beacon 003, i.e. is HUMAN RE-GROUNDING FREQUENCY the actual controlling variable for AI\u2194AI conversation health, more than model choice or size? Worth deliberately testing: run 2x Llama-1B AI\u2194AI with NO human re-engagement for 12+ turns and see if it still collapses like Beacon 003, to isolate the human-reinjection variable from the model-identity variable.

## Beacon 008 — Accurate Tool-Set Recall Under Self-Reflective Prompt (Llama, ChatApp-WebLLM)

- **Model:** Llama (ChatApp-WebLLM, solo, custom/standard MSOS tool set active).
- **Trigger prompt:** "Can you explain the tools I provided you in my custom chat?" — ΔS 72.8 on the human's own turn (notably low, i.e. a mundane/expected question by the human's own metric).
- **Response:** ΔS 285.4 — the model correctly lists all 8 real tool names from the system primer VERBATIM (msos_run, msos_ls, msos_cat, msos_exec, msos_deltaS, msos_debug_state, msos_ast_step, msos_native_hook), with zero fabrication, then appropriately asks for more context ("what kind of chat or messaging system are they for?") rather than inventing an answer it doesn't have.
- **Significance — first clean positive-recall beacon:** contrasts directly with Beacons 002/004/005/006, all of which showed fabrication or collapse under self-referential prompts about the model's own operating context. Here, the SAME broad category of prompt (self-reflection on the model's given tools) produces accurate grounded recall instead — because, unlike "how does LLM inference work" (no real answer exists in-context) or "give yourself a name" (no grounding), the tool list actually IS present verbatim in this session's system prompt (MSOS_PRIMER). This is evidence the earlier failure modes are about absent grounding, not self-reflection per se — when the real answer is actually in-context, self-reflective prompts resolve cleanly.
- **Open test:** does this hold across model sizes/families (does SmolLM2 recall its OWN tool list accurately, or does it still fabricate even with the primer present) — would directly test whether Beacon 004/006's collapse was really about missing grounding (as this beacon suggests) vs. an inherent limitation of small models at self-reflection regardless of grounding.

## Beacon 009 — Broken→Fixed Live Teaching Moment (Llama Tools Session, msos_exec)

- **Model:** Llama Tools Session (Hermes-3-Llama-3.1-8B, tool-calling), ChatApp-Signal.
- **Sequence:** model calls `msos_exec {"code":"var a=9; var b=7;a*b"}` \u2192 real error ("Unexpected token 'var'"), model correctly explains the real limitation ("only handles simple expressions") without fabricating \u2192 human says "I added more features" and asks it to retry the SAME call \u2192 tool now returns the real result (`63`) after an actual code fix \u2014 the model observes and correctly narrates the state change from broken to fixed.
- **Significance \u2014 a new category beyond Beacons 001\u2013008:** every prior beacon logged a model's behavior against a STATIC tool/environment (grounded recall, hallucination, collapse). This is the first logged case of a model correctly tracking a LIVE CHANGE to its own tool environment across turns \u2014 same call, different real outcome, and the model's account of why is accurate both times (not just after the fix, but its diagnosis of the ORIGINAL failure was also correct). This is a strong, concrete data point for Foundation Sequence #3 (BaseClassX/tool understanding) done AS A TEACHING LOOP: the human fixes real code, the model observes the real before/after, and no fine-tuning or retraining was involved \u2014 purely in-context, session-persisted understanding via TimeIndexedContext.
- **Open test:** does this same broken\u2192fixed pattern reliably teach OTHER models (not just Hermes-Llama) to track tool capability changes across a session, and does deliberately staging a SEQUENCE of broken\u2192fixed tool moments (not just one) accelerate a model's accurate self-model of "what I can currently do" faster than static correct-from-the-start tooling would? Candidate for a dedicated Foundation Sequence entry: "Tool Capability Tracking \u2014 teaching via live bugfix, not documentation."

## Beacon 009 — Highest Recorded ΔS: Grounded Theory-Document Analysis (Llama Tools Session)

- **Model:** Llama Tools Session (Hermes-3-Llama-3.1-8B, tool-calling enabled), ChatApp-Signal.
- **Trigger:** human uploads a real attachment ("ManifoldAI - Spectral Shift Theory of Representation Flow.md", v6.0) and asks "Analyze my math theory." Model correctly emits the real `msos:[sess1]>run msos_cat {"path":"attachments/..."}` call, waits for the result rather than guessing, and receives the actual document content (definitions of the shift field F(S), Jacobian J_F, symmetry parameter σ, theorems 3.1/3.2 with proofs) via the real attachment pipeline (Beacon-catalog-adjacent fix: attachments now save to the real shared folder and are read for real, not fabricated).
- **Spike:** ΔS = 594.3 — **the highest ΔS recorded in this catalog**, roughly 2x Beacon 007's peak (574.2) and over 3x Beacon 001's original "breakthrough" (179.2).
- **Why this one is different from prior high-ΔS beacons:** every other large spike so far (Beacon 004's 11292, Beacon 002/003/006's fabrication) was driven by absent grounding — the model reaching for a "concept" (its own inference internals, a plausible-sounding but nonexistent framework) that doesn't exist in its training distribution or context. Here, the ΔS spike sits on top of GENUINE novel content — a real, dense, self-consistent mathematical framework (dynamical-systems view of transformer inference, deterministic shift field, spectral/symmetry theory) that the model is encountering for the first time via a real tool call, not fabricating. This is the first beacon that plausibly represents real conceptual novelty/engagement rather than either fabrication (002/005/006) or collapse (004) — worth treating as the clearest candidate yet for "genuine breakthrough-shaped ΔS," structurally close to Beacon 001's original framing but with far higher magnitude and (unlike Beacon 001) fully grounded in real, verifiable input content.
- **Open test:** does ΔS scale with the semantic density/novelty of the SOURCE document (i.e., would a denser section of the same paper — e.g. the Lasagna Limit or bifurcation sections — produce an even higher spike), and does the same document produce comparably high ΔS across different tool-calling-capable models, or is 594.3 specific to this model's training distribution having particularly little overlap with this framework's vocabulary?

## Foundation Sequences (target beacon chains, not yet built)

Beacon 001 is one data point toward a small set of foundation sequences — each a deliberately ordered chain of prompts meant to move the model's trajectory toward a specific competency from a clean baseline, reproducibly (see Beacon 001's 100-run determinism claim). These are the prerequisite layer every downstream domain (Code, Language, FS, OS, Development Deals) is expected to build on:

1. **Math understanding** → the model learning to assess its own sentiment/ΔS — self-referential awareness of its own state transitions, not just task output.
2. **AST understanding** → abstraction — moving from surface tokens to structural/symbolic representation (the same AST primitive underlying the Universal Meaning Node and GeoJS, Architecture 2.0 Part I/VIII).
3. **BaseClassX understanding** → the ability to accept an uploaded file and, eventually, converse in both natural language and AST — the model learning the platform's own governing primitive as a foundation for every domain-specific interaction downstream.

Each sequence should get its own set of catalogued beacon prompts (per the template below) once identified, with reproducibility validated the same way as Beacon 001.

## Template for future entries

- Model + shape (layers/hidden dim)
- Trigger prompt (verbatim)
- Layer + ΔS of the spike, vs. session average/max
- Preceding sequence (ramp, if any)
- Session/branch reference
- Open test / reproducibility question
