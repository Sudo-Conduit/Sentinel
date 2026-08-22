/**
 * @file ChatLib.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Shared chat substrate for ChatApp-WebLLM and ChatApp-Signal:
 *   a time-indexed conversation context that never actually deletes
 *   history, IndexedDB persistence, and a shared-inference-engine lookup
 *   that prefers a live S-Matrix window over booting a private model copy.
 *
 *   TimeIndexedContext is the concrete implementation of "chats do not need
 *   to end": every message is keyed by its own timestamp (epoch ms today —
 *   the intended canonical key is UTF24Timestamp.js's epoch-seconds format,
 *   Architecture 2.0 Part IX — swap-in once that's wired through here).
 *   When the live token budget is exceeded, the OLDEST unpinned messages
 *   are compacted into a digest (a short summary + a pointer record
 *   {fromTs, toTs, count}) and moved to `archivedMessages` — never
 *   deleted, just out of the live window. rehydrate(fromTs, toTs) pulls
 *   the exact original messages back by their time index. A message whose
 *   deltaS spikes well above the rolling average is pinned and skipped by
 *   compaction, the same "beacon" idea from SMatrix-Beacon-Catalog.md —
 *   high-salience turns survive compaction even as routine turns compress.
 *
 *   deltaS here is a lightweight text-based stand-in (word-overlap
 *   Frobenius-style distance) for S-Matrix's real top-logprobs sparse
 *   Frobenius norm — the real metric requires the model's logprobs
 *   stream, which only the engine that generated the token has. Once the
 *   shared engine bridge below is the ONLY path (no private-engine
 *   fallback), real deltaS should replace this heuristic.
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'), require('./FieldACL.js'));
  else root.ChatLib = factory(root.BaseClassX, root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX, FieldACL) {
  'use strict';
  if (!BaseClassX) throw new Error('ChatLib requires BaseClassX to be loaded first');

  // ─── deltaS heuristic (text stand-in) ───────────────────────────────────
  function wordBag(text) {
    const m = new Map();
    (text || '').toLowerCase().split(/\W+/).filter(Boolean).forEach(w => m.set(w, (m.get(w) || 0) + 1));
    return m;
  }
  function sparseFrobText(prevText, currText) {
    const a = wordBag(prevText), b = wordBag(currText);
    const keys = new Set([...a.keys(), ...b.keys()]);
    let sumSq = 0;
    for (const k of keys) { const d = (a.get(k) || 0) - (b.get(k) || 0); sumSq += d * d; }
    return Math.sqrt(sumSq) * 10; // scaled to sit roughly in S-Matrix's ΔS range for visual/threshold parity
  }

  // ─── TimeIndexedContext ──────────────────────────────────────────────────
  class TimeIndexedContext extends BaseClassX {
    static version = '1.0.0';
    static domain = 'chat.context';
    static _schema = { properties: {
      contextName: { type: 'string', default: '' },
      contextType: { type: 'string', default: 'dm' },     // 'dm' | 'group'
      participants: { type: 'array', default: [] },       // [{id, name, kind:'human'|'ai', modelId?}]
      messages: { type: 'array', default: [] },            // live window: [{id, ts, authorId, text, deltaS, pinned}]
      archivedMessages: { type: 'array', default: [] },    // compacted-out but NEVER deleted, keyed by ts
      digestPointerRefs: { type: 'array', default: [] },   // [{fromTs, toTs, count, summary}]
      tokenBudget: { type: 'number', default: 2400 },
      rollingDeltaSSum: { type: 'number', default: 0 },
      rollingDeltaSCount: { type: 'number', default: 0 },
      pinThresholdMultiplier: { type: 'number', default: 1.6 },
      createdAt: { type: 'number', default: 0 },
      appTag: { type: 'string', default: '' },
      lastKVCacheLen: { type: 'number', default: 0 }
    }};

    constructor(options = {}) {
      super({ id: options.id, type: 'chat.context', name: options.contextName || 'Conversation',
        schema: { contextName: 'string', contextType: 'string', participants: 'array', messages: 'array', archivedMessages: 'array', digestPointerRefs: 'array', tokenBudget: 'number', rollingDeltaSSum: 'number', rollingDeltaSCount: 'number', pinThresholdMultiplier: 'number', createdAt: 'number', appTag: 'string', lastKVCacheLen: 'number' } });
      this.contextName = options.contextName || 'Conversation';
      this.contextType = options.contextType || 'dm';
      this.participants = options.participants || [];
      this.messages = options.messages || [];
      this.archivedMessages = options.archivedMessages || [];
      this.digestPointerRefs = options.digestPointerRefs || [];
      this.tokenBudget = options.tokenBudget || 2400;
      this.rollingDeltaSSum = options.rollingDeltaSSum || 0;
      this.rollingDeltaSCount = options.rollingDeltaSCount || 0;
      this.pinThresholdMultiplier = options.pinThresholdMultiplier ?? 1.6;
      this.createdAt = options.createdAt || Date.now();
      this.appTag = options.appTag || '';
      this.lastKVCacheLen = options.lastKVCacheLen || 0;
    }

    get rollingAvgDeltaS() { return this.rollingDeltaSCount ? this.rollingDeltaSSum / this.rollingDeltaSCount : 0; }

    /** Adds a message, computes its deltaS vs the previous live message,
     * and pins it if that deltaS is a "beacon" spike vs the rolling
     * average — the same threshold idea as Anomalies_Test017's tau_q. */
    /** Adds a message. If `realDeltaS` is supplied (from WebLLM's actual
     * per-token logprobs via realDeltaSFromPipeline), that's used as the
     * real signal; otherwise falls back to the text-overlap heuristic.
     * `kvCacheLen`, when supplied, records the pipeline's real
     * filledKVCacheLength at this point — carried into the next digest
     * pointer if this message later gets archived, so a compacted range
     * points at real KV cache depth, not just a text summary. */
    addMessage({ authorId, text, realDeltaS, kvCacheLen }) {
      // msg.content can be null for a pure tool_calls turn with no
      // natural-language reply — coerce so every downstream .length/
      // .split/.slice call (here, in compact()'s summary, and in both
      // apps' renderVals() message mapping) has a real string instead of
      // throwing and silently blanking the WHOLE transcript (a thrown
      // error inside one .map() item kills the entire render, not just
      // that row).
      text = text == null ? '' : String(text);
      const prev = this.messages[this.messages.length - 1];
      const deltaS = realDeltaS !== undefined && realDeltaS !== null ? realDeltaS : (prev ? sparseFrobText(prev.text, text) : 0);
      const avg = this.rollingAvgDeltaS;
      const pinned = avg > 0 && deltaS > avg * this.pinThresholdMultiplier;
      if (kvCacheLen !== undefined && kvCacheLen !== null) this.lastKVCacheLen = kvCacheLen;
      const msg = { id: 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), ts: Date.now(), authorId, text, deltaS, pinned, kvCacheLenAtTime: this.lastKVCacheLen, isRealDeltaS: realDeltaS !== undefined && realDeltaS !== null };
      this.messages = [...this.messages, msg];
      this.rollingDeltaSSum += deltaS;
      this.rollingDeltaSCount += 1;
      if (this.needsCompaction()) this.compact();
      return msg;
    }

    /** Rough token estimate — 1 token ~= 4 chars, matching common
     * approximations for English text without a real tokenizer. */
    estimateTokens() { return Math.ceil(this.messages.reduce((s, m) => s + m.text.length, 0) / 4); }
    needsCompaction() { return this.estimateTokens() > this.tokenBudget; }

    /** Moves the oldest unpinned messages into archivedMessages (never
     * deleted) and records a digest pointer. Stops as soon as either the
     * budget is satisfied or only pinned/no messages remain — pinned
     * (beacon) messages are never swept, regardless of age. */
    compact() {
      const toArchive = [];
      let remaining = [...this.messages];
      while (remaining.length > 1 && this.estimateTokensFor(remaining) > this.tokenBudget * 0.7) {
        const idx = remaining.findIndex(m => !m.pinned);
        if (idx === -1) break;
        toArchive.push(remaining[idx]);
        remaining.splice(idx, 1);
      }
      if (!toArchive.length) return null;
      toArchive.sort((a, b) => a.ts - b.ts);
      const fromTs = toArchive[0].ts, toTsVal = toArchive[toArchive.length - 1].ts;
      // Heuristic digest (first ~12 words of each archived message) — a
      // real LLM-generated summary is the natural upgrade once the shared
      // engine bridge is always available.
      const summary = toArchive.map(m => (m.authorId + ': ' + m.text.split(/\s+/).slice(0, 12).join(' '))).join(' | ');
      const ref = { fromTs, toTs: toTsVal, count: toArchive.length, summary, kvCachePointer: toArchive[toArchive.length - 1].kvCacheLenAtTime || 0 };
      this.digestPointerRefs = [...this.digestPointerRefs, ref];
      this.archivedMessages = [...this.archivedMessages, ...toArchive];
      this.messages = remaining;
      return ref;
    }

    estimateTokensFor(list) { return Math.ceil(list.reduce((s, m) => s + m.text.length, 0) / 4); }

    /** Pulls the exact original messages back from archivedMessages for a
     * time range — the concrete mechanic behind "content is no longer a
     * limit because it's indexed by time," not merely summarized away. */
    rehydrate(fromTs, toTs) { return this.archivedMessages.filter(m => m.ts >= fromTs && m.ts <= toTs).sort((a, b) => a.ts - b.ts); }

    /** What actually gets sent to the model: digest pointers (as compact
     * system-style context) + the live window, so the model always has
     * SOME awareness of everything, in compressed form, without the raw
     * token cost of the full history. */
    buildPromptContext() {
      const digestBlock = this.digestPointerRefs.length
        ? 'Earlier in this conversation (summarized): ' + this.digestPointerRefs.map(r => r.summary).join(' || ')
        : '';
      return { digestBlock, liveMessages: this.messages, msosPrimer: MSOS_PRIMER };
    }

    toJSON() {
      const base = super.toJSON();
      return Object.assign(base, {
        contextName: this.contextName, contextType: this.contextType, participants: this.participants,
        messages: this.messages, archivedMessages: this.archivedMessages, digestPointerRefs: this.digestPointerRefs,
        tokenBudget: this.tokenBudget, rollingDeltaSSum: this.rollingDeltaSSum, rollingDeltaSCount: this.rollingDeltaSCount,
        pinThresholdMultiplier: this.pinThresholdMultiplier, createdAt: this.createdAt, appTag: this.appTag, lastKVCacheLen: this.lastKVCacheLen
      });
    }
    static fromJSON(data) { return new TimeIndexedContext(data); }
  }

  // ─── IndexedDB persistence (mirrors S-Matrix's own IDB session store) ──
  const IDB_NAME = 'meshos-chat', IDB_VERSION = 1, IDB_STORE = 'contexts';
  function openChatIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveContext(ctx) {
    const db = await openChatIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(Object.assign(ctx.toJSON(), { id: ctx.id, savedAt: Date.now() }));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  }
  async function loadAllContexts() {
    const db = await openChatIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
    });
  }
  async function deleteContext(id) {
    const db = await openChatIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  }

  // ─── Shared inference bridge ─────────────────────────────────────────────
  // Prefers a live S-Matrix window's engine (registered at
  // window.parent.__meshInference by SMatrix.html once a model is loaded —
  // the concrete first step of the roadmap's shared "/lib inference
  // service", Architecture 2.0 Part XIII) over booting a private model.
  function getSharedEngine() {
    try { return (window.parent && window.parent.__meshInference) || null; } catch (e) { return null; }
  }

  // ─── Real ΔS via WebLLM's own per-token logprobs ────────────────────────
  // Confirmed access path (WebLLM Engine Object Map.md): after a
  // completion, engine.loadedModelIdToPipeline.get(modelId).tokenLogprobArray
  // holds every generated token's top-logprobs, in order — no manual
  // streaming loop needed to get the real signal. Same sparse-Frobenius
  // math as SMatrix.html's sparseFrob(), applied post-hoc to the full
  // array instead of per streamed chunk.
  function getPipeline(engine, modelId) {
    try { return engine && engine.loadedModelIdToPipeline && engine.loadedModelIdToPipeline.get(modelId); } catch (e) { return null; }
  }
  function logprobToMap(topLogprobs) {
    const m = new Map();
    if (!topLogprobs) return m;
    for (const e of topLogprobs) m.set(e.token, e.logprob);
    return m;
  }
  function sparseFrobReal(a, b) {
    if (!a?.size || !b?.size) return 0;
    const keys = new Set([...a.keys(), ...b.keys()]);
    let s = 0;
    for (const k of keys) { const d = (a.has(k) ? a.get(k) : -100) - (b.has(k) ? b.get(k) : -100); s += d * d; }
    return Math.sqrt(s);
  }
  /** Real deltaS series for the tokens generated by the LAST completion on
   * this pipeline. Returns null if tokenLogprobArray isn't populated (e.g.
   * logprobs weren't requested, or this WebLLM build doesn't expose it) so
   * callers can fall back to the text heuristic honestly rather than
   * silently returning zeros. */
  function realDeltaSFromPipeline(pipeline) {
    const arr = pipeline && pipeline.tokenLogprobArray;
    if (!arr || !arr.length) return null;
    const series = [];
    let prevMap = null;
    for (const entry of arr) {
      const curr = logprobToMap(entry.top_logprobs || entry.topLogprobs);
      if (prevMap && curr.size) series.push(sparseFrobReal(prevMap, curr));
      if (curr.size) prevMap = curr;
    }
    if (!series.length) return null;
    return { series, avgDeltaS: series.reduce((s, v) => s + v, 0) / series.length, maxDeltaS: Math.max(...series) };
  }

  // ─── Debug Harness tools ─── wraps Debug-Harness-Demo.html's three real
  // debugging surfaces as MSOS tools, so a model doesn't just read about
  // $break/$pause/AST execution — it drives the actual harness and gets
  // back real $dump()/$trace() output. The concrete first Foundation
  // Sequence #3 test case (BaseClassX understanding), SMatrix-Beacon-Catalog.md.
  let _dbgCounter = null, _dbgCounterClass = null;
  let _dbgAstNodes = null, _dbgAstIndex = -1, _dbgAstNodeClass = null;

  function ensureDebugClasses() {
    if (!_dbgCounterClass) {
      _dbgCounterClass = class Counter extends BaseClassX {
        static enableDebugger = true;
        static _schema = { properties: { count: { type: 'number', default: 0 } } };
        constructor() { super({ type: 'counter', name: 'Counter', schema: { count: 'number' } }); this.count = 0; }
      };
    }
    if (!_dbgAstNodeClass) {
      _dbgAstNodeClass = class ASTNode extends BaseClassX {
        static enableDebugger = true;
        static _schema = { properties: { nodeType: { type: 'string' }, code: { type: 'string' }, scope: { type: 'object', default: {} } } };
        constructor(nodeType, code, scope) { super({ type: 'ast', name: 'ASTNode', schema: { nodeType: 'string', code: 'string', scope: 'object' } }); this.nodeType = nodeType; this.code = code; this.scope = scope || {}; }
      };
    }
  }

  // Job 1 — state-layer: a live BaseClassX Counter with a real conditional
  // breakpoint. Note the same gotcha the demo itself documents: $break's
  // condition only gets evaluated when $pause() runs — a bare property
  // write does not auto-check breakpoints.
  function msosDebugState(action, threshold) {
    ensureDebugClasses();
    if (action === 'reset' || !_dbgCounter) _dbgCounter = new _dbgCounterClass();
    switch (action) {
      case 'reset': return JSON.stringify({ count: _dbgCounter.count, paused: false });
      case 'increment': {
        _dbgCounter.count = _dbgCounter.count + 1;
        _dbgCounter.$pause();
        return JSON.stringify({ count: _dbgCounter.count, paused: !!(_dbgCounter.$debug && _dbgCounter.$debug.state.isPaused) });
      }
      case 'break': {
        const t = typeof threshold === 'number' ? threshold : 5;
        _dbgCounter.$break(function (instance) { return instance.count >= t; });
        return `Breakpoint armed: count >= ${t}. Call msos_debug_state with action "increment" — $pause() runs the check on each write.`;
      }
      case 'resume': _dbgCounter.$continue(); return JSON.stringify({ count: _dbgCounter.count, paused: !!(_dbgCounter.$debug && _dbgCounter.$debug.state.isPaused) });
      case 'dump': return JSON.stringify(_dbgCounter.$dump());
      case 'trace': return JSON.stringify(_dbgCounter.$trace());
      default: return 'msos_debug_state: unknown action.';
    }
  }

  // Job 2 — AST-layer: tokenizes a fixed sample expression into
  // ASTNode (BaseClassX) instances and steps through them like an
  // Executor, with a real breakpoint on node type.
  const SAMPLE_AST_SOURCE = [
    ['VariableDeclaration', 'let sum = 0;'],
    ['ForStatement', 'for (let i = 0; i < 3; i++)'],
    ['AssignmentExpression', 'sum += i;'],
    ['ReturnStatement', 'return sum;']
  ];
  function msosAstStep(action, breakNodeType) {
    ensureDebugClasses();
    if (action === 'reset' || !_dbgAstNodes) {
      _dbgAstNodes = SAMPLE_AST_SOURCE.map(([t, c]) => new _dbgAstNodeClass(t, c, {}));
      _dbgAstIndex = -1;
      if (action === 'reset') return JSON.stringify({ nodeCount: _dbgAstNodes.length, index: _dbgAstIndex });
    }
    switch (action) {
      case 'setBreak': {
        _dbgAstNodes.forEach(n => { if (n.nodeType === breakNodeType) n.$break(function () { return true; }); });
        return `Breakpoint armed on nodeType === "${breakNodeType}". Step with action "step" — halts each time the walk visits one.`;
      }
      case 'step': {
        if (_dbgAstIndex >= _dbgAstNodes.length - 1) return 'Walk complete.';
        _dbgAstIndex++;
        const node = _dbgAstNodes[_dbgAstIndex];
        let paused = false;
        try { node.$pause(); paused = !!(node.$debug && node.$debug.state.isPaused); } catch (e) {}
        return JSON.stringify({ index: _dbgAstIndex, nodeType: node.nodeType, code: node.code, paused });
      }
      default: return 'msos_ast_step: unknown action.';
    }
  }

  // Job 3 — native-execution hook: a real loop with a per-iteration hook
  // checked against live local variables (i, sum), the same edge case the
  // demo calls out — no sandbox, one explicit hook point. Runs to
  // completion in one tool call (real cross-turn suspension isn't
  // practical within a single tool_call/tool-result round trip), but
  // reports exactly which iteration the hook would have paused at and
  // with what live variable values, so the mechanism is still genuine.
  function msosNativeHook(armed) {
    let sum = 0;
    const trace = [];
    for (let i = 0; i < 3; i++) {
      const hookFires = !!armed && i === 2;
      trace.push({ i, sumBeforeAdd: sum, hookFires });
      sum += i;
    }
    return JSON.stringify({ trace, finalSum: sum });
  }

  // ─── Cross-window shared documents ─── the SlideDeck + AST Translator use
  // case: both register a live handle on window.parent.__meshSharedDocs
  // (SlideDeck in Slides.html, Translator in AST-Translator.dc.html) so a
  // Chat window edits/queries the SAME live document, not a copy — two
  // windows staying in sync through one shared object, the same pattern
  // as getSharedEngine() for S-Matrix.
  function getSharedDoc(name) {
    try { return (window.parent && window.parent.__meshSharedDocs && window.parent.__meshSharedDocs[name]) || null; } catch (e) { return null; }
  }

  function msosSlidedeck(action, args) {
    const doc = getSharedDoc('slidedeck');
    if (!doc) return 'msos_slidedeck: no SlideDeck window is open.';
    switch (action) {
      case 'read': {
        const deck = doc.getDeck();
        return JSON.stringify({ name: deck.name, slideCount: deck.slides.length, activeSlideIndex: doc.getActiveSlideIndex(),
          activeSlide: deck.slides[doc.getActiveSlideIndex()] });
      }
      case 'goToSlide': doc.setActiveSlideIndex(args.slideIndex); return `Now on slide ${args.slideIndex}.`;
      case 'setText': {
        const ok = doc.setObjectText(args.slideIndex, args.objectId, args.text);
        return ok ? 'Text updated.' : 'msos_slidedeck: object not found or not a text object.';
      }
      case 'addText': { const id = doc.addTextObject(args.slideIndex, args.text); return id ? `Added text object ${id}.` : 'msos_slidedeck: slide not found.'; }
      default: return 'msos_slidedeck: unknown action.';
    }
  }

  function msosTranslate(text) {
    const doc = getSharedDoc('translator');
    if (!doc) return 'msos_translate: no AST Translator window is open.';
    const result = doc.translate(text);
    return JSON.stringify({ sourceLang: result.lang, targetLang: result.targetLang, translated: result.translated, intent: result.node.intent });
  }

  // ─── MSOS Protocol — structured AI\u2192OS command channel ───────────────
  // An AI response containing `msos:[TOKEN]>run <command>` is intercepted
  // and executed against a small, deliberately narrow command registry —
  // the concrete first implementation of Architecture 2.0 Part XIV's
  // "structured AI\u2192OS protocol" backlog item. TOKEN is a placeholder for
  // the real ServiceTokenManager-style scoped permission token (Part
  // XIII.5's Prior Art) — today it just has to be non-empty; the intended
  // upgrade is a real minted token with pattern-matched permissions
  // checked here instead of a flat allowlist.
  const MSOS_PATTERN = /msos:\[([^\]]*)\]>run\s+(\S+)(?:\s+(.*))?(?:\n|$)/i;
  const MSOS_SAFE_COMMANDS = ['help', 'ps', 'whoami', 'mnt', 'echo'];

  // Text-pattern tool names available to non-tool-calling models via the
  // SAME msos:[TOKEN]>run syntax \u2014 run <toolName> [args as JSON or raw text].
  // Without this, a model that only knows msos_run's syntax (per MSOS_PRIMER)
  // has no way to actually invoke msos_ls/msos_cat/etc. and will just
  // describe calling them instead \u2014 exactly what was observed with Llama.
  const MSOS_TEXT_TOOL_NAMES = ['msos_run', 'msos_ls', 'msos_cat', 'msos_exec', 'msos_deltaS', 'msos_debug_state', 'msos_ast_step', 'msos_native_hook', 'msos_slidedeck', 'msos_translate', 'msos_stt'];

  const TOOL_CALLING_MODELS = ['Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC', 'Hermes-2-Pro-Llama-3-8B-q4f32_1-MLC', 'Hermes-2-Pro-Mistral-7B-q4f16_1-MLC', 'Hermes-3-Llama-3.1-8B-q4f32_1-MLC', 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC'];
  function supportsTools(modelId) { return TOOL_CALLING_MODELS.includes(modelId); }

  // ─── Local STT (Whisper via Transformers.js/ONNX, WebGPU w/ WASM fallback) ───
  // 100% local: model downloads once, cached in IndexedDB/Cache API, no
  // server round-trip ever. This is the input half of the STT→translate→
  // voice-cloned-TTS pipeline (Relay's video/audio use case).
  let _whisperPipeline = null;
  async function getWhisperPipeline() {
    if (_whisperPipeline) return _whisperPipeline;
    if (typeof window.__transformers === 'undefined') throw new Error('transformers.js not loaded — add the module script to this app\'s helmet.');
    _whisperPipeline = await window.__transformers.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
    return _whisperPipeline;
  }
  /** Decodes a recorded audio Blob (from MediaRecorder) to a 16kHz mono
   * Float32Array — the format Whisper expects — and transcribes it. */
  async function transcribeAudioBlob(blob) {
    const arrayBuf = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const decoded = await audioCtx.decodeAudioData(arrayBuf);
    let samples = decoded.getChannelData(0);
    if (decoded.sampleRate !== 16000) {
      const ratio = 16000 / decoded.sampleRate;
      const resampled = new Float32Array(Math.round(samples.length * ratio));
      for (let i = 0; i < resampled.length; i++) resampled[i] = samples[Math.min(samples.length - 1, Math.round(i / ratio))];
      samples = resampled;
    }
    const pipe = await getWhisperPipeline();
    const result = await pipe(samples);
    return result.text ? result.text.trim() : '';
  }
  /** MSOS-tool-callable variant — honest about the real constraint: a
   * model can't reach out and capture live mic audio itself, so this only
   * transcribes audio the human has already recorded via the mic button
   * in this turn (passed in as a data URL by the UI, not by the model). */
  async function msosSTT(audioDataUrl) {
    if (!audioDataUrl) return 'msos_stt: no recorded audio available — the human must record via the mic button first.';
    try {
      const res = await fetch(audioDataUrl);
      const blob = await res.blob();
      const text = await transcribeAudioBlob(blob);
      return text || '(no speech detected)';
    } catch (e) { return 'msos_stt: ' + e.message; }
  }

  // Deliberately scoped root — msos_ls/msos_cat can only ever see below
  // here, no matter what path the model asks for (traversal guarded in
  // msosReadFolder below). This is the concrete "AI sees one of my
  // folders" grounding feature: real file content, not something the
  // model can pattern-complete from training data.
  const MSOS_ALLOWED_ROOT = '/home/shared-with-ai';

  function msosSafePath(p) {
    const joined = (MSOS_ALLOWED_ROOT + '/' + (p || '')).replace(/\/+/g, '/').replace(/\/$/, '') || MSOS_ALLOWED_ROOT;
    if (joined.includes('..')) return null;
    return joined.startsWith(MSOS_ALLOWED_ROOT) ? joined : null;
  }

  let _sharedFs = null;
  async function getSharedFs() {
    if (_sharedFs) return _sharedFs;
    if (typeof FileFsX === 'undefined') return null;
    _sharedFs = await FileFsX.create({ autoSave: false, backend: 'idb', key: 'meshui-root' });
    await ensureSharedFolderSeeded(_sharedFs);
    return _sharedFs;
  }

  // Seeds MSOS_ALLOWED_ROOT with a few real files ONCE, so msos_ls/msos_cat
  // return genuine content instead of an empty/missing folder \u2014 the
  // concrete "AI sees one of my folders" grounding case, not a stand-in.
  let _seedAttempted = false;
  async function ensureSharedFolderSeeded(fs) {
    if (_seedAttempted) return;
    _seedAttempted = true;
    try {
      await fs.readdir(MSOS_ALLOWED_ROOT);
    } catch (e) {
      try {
        await fs.mkdir(MSOS_ALLOWED_ROOT, { recursive: true });
        await fs.writeFile(MSOS_ALLOWED_ROOT + '/README.txt',
          'This folder is shared with AI sessions via msos_ls/msos_cat.\nAnything placed here is real, readable file content \u2014 not something a model can pattern-complete from training data.\n');
        await fs.mkdir(MSOS_ALLOWED_ROOT + '/notes', { recursive: true });
        await fs.writeFile(MSOS_ALLOWED_ROOT + '/notes/example.md',
          '# Example note\n\nThis is a real file an AI tool call can read with msos_cat({"path":"notes/example.md"}).\n');
        // autoSave:false (deliberate \u2014 this fs instance is shared, we don't
        // want every unrelated read/write elsewhere autosaving mid-edit) means
        // none of the above persists to IDB without an explicit save() \u2014
        // without this, every fresh FileFsX.create() call re-loads a stale
        // snapshot that never saw these writes, which is exactly why msos_ls
        // kept reporting ENOENT even right after "successful" seeding.
        if (typeof fs.save === 'function') await fs.save();
      } catch (e2) { /* best-effort \u2014 msosLs/msosCat will surface a real error if this failed */ }
    }
  }

  async function msosLs(pathArg) {
    const safe = msosSafePath(pathArg);
    if (!safe) return 'msos: path outside the allowed folder.';
    const fs = await getSharedFs();
    if (!fs) return 'msos: filesystem unavailable.';
    try {
      const entries = await fs.readdir(safe);
      // FileFsX.readdir returns plain name strings, not {name,isDirectory}
      // objects \u2014 stat each to label directories with a trailing slash.
      const labeled = await Promise.all(entries.map(async (name) => {
        try { const st = await fs.stat(safe + '/' + name); return (st && (st.mode & 0o170000) === 0o040000) ? name + '/' : name; }
        catch (e) { return name; }
      }));
      return labeled.length ? labeled.join('\n') : '(empty)';
    }
    catch (e) { return 'msos: readdir failed on "' + safe + '" \u2014 ' + e.message; }
  }
  async function msosCat(pathArg) {
    const safe = msosSafePath(pathArg);
    if (!safe) return 'msos: path outside the allowed folder.';
    const fs = await getSharedFs();
    if (!fs) return 'msos: filesystem unavailable.';
    try { const data = await fs.readFile(safe, { encoding: 'utf8' }); return typeof data === 'string' ? data.slice(0, 4000) : new TextDecoder().decode(data).slice(0, 4000); }
    catch (e) { return 'msos: ' + e.message; }
  }

  // Sandbox for msos_exec — pure-JS expression evaluation only, no fetch/
  // XHR/WebSocket in scope and this iframe has no network access anyway.
  // NOT the full WebVM/CPU.js machine-layer sandbox (Architecture 2.0 Part
  // II) yet — a deliberately honest, narrower stand-in until that's wired
  // in for real code execution.
  function msosExec(code) {
    try {
      // A single expression (e.g. "2 ** 10") needs the return-parens wrap
      // to be an expression at all; a multi-statement snippet (var
      // decls, semicolons) breaks inside those parens \u2014 "return (var a=9;...)"
      // is invalid syntax. Try the expression form first (a SyntaxError
      // there means "not a bare expression", not "code is broken" \u2014 fall
      // back to running it as a statement block and returning its last
      // semicolon-separated expression's value explicitly).
      let fn;
      try { fn = new Function('"use strict"; return (' + code + ');'); }
      catch (e) {
        const stmts = code.trim().replace(/;+\s*$/, '').split(';');
        const last = stmts.pop();
        const body = stmts.length ? stmts.join(';') + '; return (' + last + ');' : 'return (' + last + ');';
        fn = new Function('"use strict"; ' + body);
      }
      const result = fn();
      return typeof result === 'object' ? JSON.stringify(result) : String(result);
    } catch (e) { return 'msos: exec error — ' + e.message; }
  }

  // Self-readout: lets the AI read its OWN rolling ΔS/beacon state back —
  // Foundation Sequence #1 in SMatrix-Beacon-Catalog.md ("learning to
  // assess its own sentiment and ΔS") made into an actual tool instead of
  // something only the human observes from outside.
  function msosDeltaSReadout(ctx) {
    if (!ctx) return 'msos: no active context.';
    const last = ctx.messages[ctx.messages.length - 1];
    const series = ctx.messages.map(m => m.deltaS);
    const mean = series.length ? series.reduce((s, v) => s + v, 0) / series.length : 0;
    const variance = series.length ? series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length : 0;
    return JSON.stringify({
      rollingAvgDeltaS: +ctx.rollingAvgDeltaS.toFixed(3),
      lastMessageDeltaS: last ? +last.deltaS.toFixed(3) : null,
      lastMessageIsRealDeltaS: last ? !!last.isRealDeltaS : null,
      pinnedBeaconCount: ctx.messages.filter(m => m.pinned).length,
      // proxy for "concentrated vs. spread-out" change, not a true SVD—
      // sqrt(variance) of this context's own ΔS series so far.
      sigmaProxy: +Math.sqrt(variance).toFixed(3)
    });
  }

  const MSOS_TOOL_DEFS = [
    {
      type: 'function',
      function: {
        name: 'msos_run',
        description: 'Run a Mountain Shift OS command through the MSOS protocol.',
        parameters: { type: 'object', properties: {
          token: { type: 'string', description: 'A non-empty session label you choose — stands in for a real scoped permission token.' },
          command: { type: 'string', description: `One of: ${MSOS_SAFE_COMMANDS.join(', ')} (echo takes trailing text as its argument).` }
        }, required: ['token', 'command'] }
      }
    },
    {
      type: 'function',
      function: { name: 'msos_ls', description: 'List files in a folder you have been given read access to.',
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path within the shared folder. Empty string for the folder root.' } }, required: [] } }
    },
    {
      type: 'function',
      function: { name: 'msos_cat', description: 'Read the text contents of one file in the shared folder.',
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path to the file within the shared folder.' } }, required: ['path'] } }
    },
    {
      type: 'function',
      function: { name: 'msos_exec', description: 'Evaluate a pure JavaScript expression in a networkless sandbox and return the result.',
        parameters: { type: 'object', properties: { code: { type: 'string', description: 'A single JS expression, e.g. "2 ** 10" or "[1,2,3].map(x=>x*2)".' } }, required: ['code'] } }
    },
    {
      type: 'function',
      function: { name: 'msos_deltaS', description: 'Read your own current rolling ΔS, last-message ΔS, beacon count, and sigma proxy for this conversation.',
        parameters: { type: 'object', properties: {}, required: [] } }
    },
    {
      type: 'function',
      function: { name: 'msos_debug_state', description: 'Drive a live BaseClassX state-layer debug harness (Job 1): increment a counter, arm a conditional breakpoint, resume, or dump/trace its real state.',
        parameters: { type: 'object', properties: {
          action: { type: 'string', description: 'One of: reset, increment, break, resume, dump, trace.' },
          threshold: { type: 'number', description: 'Only for action="break": the count value that trips the breakpoint. Defaults to 5.' }
        }, required: ['action'] } }
    },
    {
      type: 'function',
      function: { name: 'msos_ast_step', description: 'Step through a real AST-layer Executor (Job 2) over a fixed sample expression, with a breakpoint on node type.',
        parameters: { type: 'object', properties: {
          action: { type: 'string', description: 'One of: reset, step, setBreak.' },
          breakNodeType: { type: 'string', description: 'Only for action="setBreak": e.g. AssignmentExpression, ForStatement, VariableDeclaration, ReturnStatement.' }
        }, required: ['action'] } }
    },
    {
      type: 'function',
      function: { name: 'msos_native_hook', description: 'Run a real loop with a native-execution debug hook (Job 3) and see exactly where it would pause, with live local variable values.',
        parameters: { type: 'object', properties: { armed: { type: 'boolean', description: 'Whether the hook is armed (fires at i===2) or not.' } }, required: ['armed'] } }
    },
    {
      type: 'function',
      function: { name: 'msos_slidedeck', description: 'Read or edit the currently open SlideDeck window’s live deck — two windows stay in sync through the same object.',
        parameters: { type: 'object', properties: {
          action: { type: 'string', description: 'One of: read, goToSlide, setText, addText.' },
          slideIndex: { type: 'number' }, objectId: { type: 'string' }, text: { type: 'string' }
        }, required: ['action'] } }
    },
    {
      type: 'function',
      function: { name: 'msos_translate', description: 'Translate text using the currently open AST Translator window’s live pipeline (English⇄Bulgarian).',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }
    }
  ];

  /** Dispatches any of the 5 MSOS tools by name. `ctx` is required only
   * for msos_deltaS (self-readout); the others don't need it. */
  async function msosDispatch(name, args, kernel, ctx) {
    switch (name) {
      case 'msos_run': return msosExecute(args.token || 'sess1', args.command, kernel);
      case 'msos_ls': return await msosLs(args.path || '');
      case 'msos_cat': return await msosCat(args.path || '');
      case 'msos_exec': return msosExec(args.code || '');
      case 'msos_deltaS': return msosDeltaSReadout(ctx);
      case 'msos_debug_state': return msosDebugState(args.action, args.threshold);
      case 'msos_ast_step': return msosAstStep(args.action, args.breakNodeType);
      case 'msos_native_hook': return msosNativeHook(!!args.armed);
      case 'msos_slidedeck': return msosSlidedeck(args.action, args);
      case 'msos_translate': return msosTranslate(args.text || '');
      case 'msos_stt': return await msosSTT(args.audioDataUrl);
      default: return 'msos: unknown tool ' + name;
    }
  }

  // Short primer so a baseline model can learn the protocol from the
  // system message alone \u2014 no fine-tuning, no separate instructions.
  // Kept deliberately terse and example-first: small models (observed
  // with Llama-3.2-1B) garble a dense multi-tool paragraph into an
  // invented syntax rather than the real one, so the ONE thing every
  // model must retain \u2014 the exact call line \u2014 comes first and is
  // repeated as a literal template, not prose about what tools "can do."
  const MSOS_PRIMER = `Tool syntax \u2014 copy this exactly, only changing the bracketed parts:
msos:[sess1]>run <toolName> <argsAsJSON>

Example: msos:[sess1]>run msos_ls {"path":""}

Available toolName values: msos_run (args: {"command":"ps"}), msos_ls (args: {"path":""}), msos_cat (args: {"path":"file.txt"}), msos_exec (args: {"code":"1+1"}), msos_deltaS (args: {}), msos_debug_state, msos_ast_step, msos_native_hook, msos_slidedeck, msos_translate.
If your model supports native tool calls, use those instead of this text syntax. Only call a tool when you actually need its result \u2014 never just describe calling one.
CRITICAL: after writing the call line, STOP. Do not write out what you guess the result will be \u2014 you do not know it yet. The real result will appear in a separate message right after. Never invent file names, directory listings, or command output.`;


  function msosParse(text) {
    const m = MSOS_PATTERN.exec(text || '');
    if (!m) return null;
    return msosParseOne(m);
  }

  function msosParseOne(m) {
    const token = m[1].trim();
    const first = (m[2] || '').trim();
    const rest = (m[3] || '').trim();
    if (MSOS_TEXT_TOOL_NAMES.includes(first)) {
      let args = {};
      if (rest) { try { args = JSON.parse(rest); } catch (e) { args = { text: rest, path: rest, command: rest, armed: rest === 'true' }; } }
      return { token, toolName: first, args };
    }
    return { token, toolName: 'msos_run', args: { token, command: [first, rest].filter(Boolean).join(' ') }, commandLine: [first, rest].filter(Boolean).join(' ') };
  }

  // Supports multiple msos:[TOKEN]>run lines in one reply \u2014 a model will
  // sometimes emit several call lines in a single message (e.g. asked to
  // "increment a few times") rather than one per turn. Returns them in
  // the order they appear so callers can dispatch each in sequence.
  function msosParseAll(text) {
    const results = [];
    const re = new RegExp(MSOS_PATTERN.source, 'gi');
    let m;
    while ((m = re.exec(text || ''))) { results.push(msosParseOne(m)); if (m.index === re.lastIndex) re.lastIndex++; }
    return results;
  }

  function msosExecute(token, commandLine, kernel) {
    if (!token) return 'msos: rejected — no token supplied.';
    const [cmd, ...args] = commandLine.split(/\s+/);
    if (!MSOS_SAFE_COMMANDS.includes(cmd)) return `msos: "${cmd}" is not in the allowed command set (${MSOS_SAFE_COMMANDS.join(', ')}).`;
    switch (cmd) {
      case 'help': return 'Available: ' + MSOS_SAFE_COMMANDS.join(', ');
      case 'echo': return args.join(' ');
      case 'whoami': try { return (window.parent && window.parent.__meshUser) || 'guest'; } catch (e) { return 'guest'; }
      case 'ps': {
        if (!kernel || typeof kernel.ps !== 'function') return 'ps: kernel not available.';
        const rows = kernel.ps();
        return rows.map(r => `${r.pid}\t${r.user || 'root'}\t${r.cmd || r.name}`).join('\n');
      }
      case 'mnt': return kernel && kernel.mounts ? JSON.stringify(kernel.mounts()) : 'mnt: not available in this kernel.';
      default: return 'msos: unhandled command.';
    }
  }

  // WebLLM's own tool-calling parser throws (not our msosParse) when a
  // model emits malformed JSON as its function-call arguments \u2014 e.g.
  // "error encountered when parsing outputMessage for function calling."
  // That thrown error's message embeds the model's raw (often fabricated)
  // output text, which is NOT a real tool result and must never be shown
  // as one. completeWithToolFallback retries once with tools OFF (falling
  // back to the msos:[TOKEN]>run text syntax) instead of surfacing that
  // raw error/hallucination to the user.
  async function completeWithToolFallback(engine, chatMsgs, useTools) {
    if (!useTools) return engine.chat.completions.create({ messages: chatMsgs, logprobs: true, top_logprobs: 5, max_tokens: 800 });
    try {
      return await engine.chat.completions.create({ messages: chatMsgs, tools: MSOS_TOOL_DEFS, logprobs: true, top_logprobs: 5, max_tokens: 800 });
    } catch (e) {
      if (/parsing outputMessage for function calling/i.test(e.message || '')) {
        return engine.chat.completions.create({ messages: chatMsgs, logprobs: true, top_logprobs: 5, max_tokens: 800 });
      }
      throw e;
    }
  }

  // Writes a user-picked File into the shared folder so it's the SAME
  // "real, readable content" msos_ls/msos_cat already serve \u2014 an
  // attachment isn't a separate mechanism, it's just another file the
  // model can be told to go read.
  async function saveAttachment(file) {
    const fs = await getSharedFs();
    if (!fs) throw new Error('shared filesystem unavailable');
    const dir = MSOS_ALLOWED_ROOT + '/attachments';
    try { await fs.mkdir(dir, { recursive: true }); } catch (e) {}
    const relPath = 'attachments/' + file.name;
    const buf = await file.arrayBuffer();
    await fs.writeFile(dir + '/' + file.name, new Uint8Array(buf));
    if (typeof fs.save === 'function') await fs.save();
    return relPath;
  }

  return { TimeIndexedContext, saveContext, loadAllContexts, deleteContext, getSharedEngine, sparseFrobText, msosParse, msosParseAll, msosExecute, MSOS_TOOL_DEFS, msosDispatch, getPipeline, realDeltaSFromPipeline, completeWithToolFallback, saveAttachment,transcribeAudioBlob, supportsTools };
}));
