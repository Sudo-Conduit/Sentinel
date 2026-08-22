# Pipeline Browser I & II

Voice/translation pipeline apps in MeshOS, self-sufficient (no other app needs to be open — each boots its own private WebLLM engine if S-Matrix's shared one isn't already loaded).

## Pipeline Browser (I)

**Flow:** Voice/Text → Translate → Voice

1. **Stage 1 — Voice → Text.** Mic capture via Web Speech `SpeechRecognition` (continuous, interim results). Transcript box is directly editable — type instead of/in addition to speaking. Source language selectable (en-US/en-GB/es-ES/fr-FR).
2. **Stage 2 — Translate.** Target language selectable (English, Spanish, French, German, Bulgarian, Romanian, Chinese). Runs through `getChatFn()`: tries `ChatLib.getSharedEngine()` (S-Matrix's already-loaded model) first, falls back to booting a private `MLCEngine` (Llama-3.2-1B) if none exists.
3. **Stage 3 — Text → Voice.** Web Speech `SpeechSynthesis`. Voice picker (Auto or a named system voice). Speed control. Lang-only routing by default (`utter.lang`, no explicit `utter.voice`) to avoid a known Chrome bug where certain named voices silently fall back to the browser-locale default — an explicit voice pick overrides this.

**Auto-translate toggle:** when on, translation fires automatically the moment recording stops or Enter is pressed in the transcript box (no separate button click needed).

**Mic/TTS turn-taking:** while TTS is speaking, the mic recognizer is aborted; it restarts the instant playback ends. Prevents the mic from ever picking up the system's own voice output — mirrors how a real interpreter or Zoom-style two-channel call behaves (mic muted while the other channel is speaking).

## Pipeline Browser II

**Flow:** Voice/Text → Translate → **AI Reply (in target language) → Back-translate to English** → Voice

Stages 1–2 identical to Pipeline Browser I. Stage 3 is new:

- **Ask AI** sends the translated (foreign-language) text to a second AI turn with a system prompt instructing it to reply naturally in that language only (no English, no meta-commentary).
- The AI's foreign-language reply is then translated back to English via a second LLM call (translate-only system prompt, same discipline as the forward direction).
- Stage 4 (Text → Voice) always speaks the back-translated English once available, closing the loop: **you speak → they hear their language → they (simulated) reply in their language → you hear it in English.**

This simulates a full round-trip conversation — useful for testing whether a translation pipeline holds up in an actual back-and-forth, not just one-directional output.

## Known limitations / open items

- Voice quality is bounded by the browser's local Web Speech synthesis engine (robotic compared to neural TTS) — a real neural TTS model (e.g. Kokoro) was attempted earlier and hit CDN/ESM loading issues in this environment; revisit if higher voice quality is needed.
- No echo-cancellation/pitch-based speaker separation yet — current mute/unmute gate is a full turn-taking lock, not simultaneous dual-channel distinction. Fine for the "two separate audio channels" (e.g. Zoom-like client) use case discussed; would need more work for same-room, both-speaking-at-once scenarios.
- Continuous/streaming translation (sentence-boundary chunking, live back-and-forth without discrete button presses) is conceptually discussed but not yet implemented.
