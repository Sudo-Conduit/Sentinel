/**
 * @file llmd.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description LLM daemon client surface. One shared MLCEngine (hosted in
 *   sw-llmd.js, a service worker — survives any app window closing) with
 *   model weights. Each caller (Terminal's llm.chat, S-Matrix's UI) gets its
 *   OWN context: its own `messages` array, tracked by a caller-supplied
 *   contextId. The engine is shared; the conversation is not.
 *
 *   Extends BaseClassX like every other node in the tree — status is
 *   schema-tracked (queryable/traceable/diffable via BaseClassX's own APIs);
 *   the actual engine/kernel handle/listener callbacks/session contexts are
 *   non-serializable runtime state and live in a WeakMap, same convention as
 *   Kernel.js's _host and AppClasses.js's appVersions.
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./BaseClassX.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./BaseClassX.js'));
  else root.Llmd = factory(root.BaseClassX);
}(typeof self !== 'undefined' ? self : this, function(BaseClassX) {
  'use strict';
  if (!BaseClassX) throw new Error('Llmd requires BaseClassX to be loaded first');

  const _runtime = new WeakMap(); // instance -> { engine, kernel, downloadProcPid, contexts, listeners }
  const DB_NAME = 'meshui-llmd', STORE = 'sessions';

  function idbOpen() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  async function idbTx(mode, fn) {
    var db = await idbOpen();
    return new Promise(function (res, rej) {
      var tx = db.transaction(STORE, mode);
      var store = tx.objectStore(STORE);
      var result = fn(store);
      tx.oncomplete = function () { res(result && result.__req ? result.__req.result : result); };
      tx.onerror = function () { rej(tx.error); };
    });
  }

  class Llmd extends BaseClassX {
    static version = '1.0.0';
    static domain = 'machine.llmd';
    static _schema = { properties: {
      state: { type: 'string', default: 'idle' }, // idle | loading | ready | error
      modelId: { type: 'string', default: null },
      progressText: { type: 'string', default: '' },
      progressPct: { type: 'number', default: null },
      tokPerSec: { type: 'number', default: null },
      activeContexts: { type: 'number', default: 0 }
    }};

    constructor(options = {}) {
      super({ type: 'machine.llmd', name: 'Llmd' });
      this.state = 'idle';
      this.modelId = null;
      this.progressText = '';
      this.progressPct = null;
      this.tokPerSec = null;
      this.activeContexts = 0;
      _runtime.set(this, { engine: null, kernel: null, downloadProcPid: null, contexts: {}, listeners: [] });
    }

    _rt() { return _runtime.get(this); }
    _emit() {
      var status = this.getStatus();
      this._rt().listeners.forEach(function (fn) { try { fn(status); } catch (e) {} });
    }

    onStatus(fn) {
      var rt = this._rt();
      rt.listeners.push(fn);
      return function () { rt.listeners = rt.listeners.filter(function (f) { return f !== fn; }); };
    }
    getStatus() {
      return { state: this.state, modelId: this.modelId, progressText: this.progressText, progressPct: this.progressPct, tokPerSec: this.tokPerSec, activeContexts: this.activeContexts };
    }

    attachKernel(k) { this._rt().kernel = k; this._recordTrace('attachKernel', { hasKernel: !!k }); }

    isReady() { return this.state === 'ready'; }

    async loadModel(id, appConfig) {
      var rt = this._rt();
      if (this.state === 'ready' && this.modelId === id) return;
      this.state = 'loading'; this.modelId = id; this.progressText = 'starting'; this._emit();
      if (rt.kernel) { var p = rt.kernel.fork('llmd:download:' + id, 0); rt.downloadProcPid = p.pid; }
      var self = this;
      try {
        if (!window.webllm) {
          var mod = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm');
          window.webllm = mod;
        }
        var cfg = appConfig || window.webllm.prebuiltAppConfig;
        var onProgress = function (rep) {
          self.progressText = rep.text || '';
          self.progressPct = typeof rep.progress === 'number' ? rep.progress : null;
          self._emit();
        };
        var swReady = 'serviceWorker' in navigator;
        if (swReady) {
          try {
            await navigator.serviceWorker.register('./sw-llmd.js');
            rt.engine = await window.webllm.CreateServiceWorkerMLCEngine(id, { appConfig: cfg, initProgressCallback: onProgress });
          } catch (e) {
            // Service worker path unavailable (unsupported browser, sw script blocked) —
            // fall back to an in-page engine so the daemon still works, just tied to this tab.
            rt.engine = await window.webllm.CreateMLCEngine(id, { appConfig: cfg, initProgressCallback: onProgress });
          }
        } else {
          rt.engine = await window.webllm.CreateMLCEngine(id, { appConfig: cfg, initProgressCallback: onProgress });
        }
        this.modelId = id;
        this.state = 'ready'; this.progressText = 'ready'; this.progressPct = 1; this._emit();
        this._recordTrace('loadModel', { modelId: id });
      } catch (e) {
        this.state = 'error'; this.progressText = e.message; this._emit();
        throw e;
      } finally {
        if (rt.kernel && rt.downloadProcPid != null) { rt.kernel.kill(rt.downloadProcPid); rt.downloadProcPid = null; }
      }
    }

    async unload() {
      var rt = this._rt();
      if (rt.engine) { try { await rt.engine.unload(); } catch (e) {} }
      rt.engine = null; this.modelId = null; rt.contexts = {};
      this.state = 'idle'; this.progressText = ''; this.progressPct = null; this.tokPerSec = null; this.activeContexts = 0;
      this._emit();
      this._recordTrace('unload', {});
    }

    // contextId: any stable string a caller picks (e.g. 'terminal:3', 'smatrix:main').
    // Each contextId owns its own messages array — its own "context window" — against
    // the one shared engine, per the "own context window" design decision.
    context(contextId) {
      var rt = this._rt();
      if (!rt.contexts[contextId]) { rt.contexts[contextId] = { messages: [], busy: false }; this.activeContexts = Object.keys(rt.contexts).length; }
      return rt.contexts[contextId];
    }
    resetContext(contextId) {
      var rt = this._rt();
      delete rt.contexts[contextId];
      this.activeContexts = Object.keys(rt.contexts).length;
      this._emit();
    }

    async chat(contextId, userText, onToken) {
      var rt = this._rt();
      if (this.state !== 'ready') throw new Error('llmd: no model loaded');
      var ctx = this.context(contextId);
      if (ctx.busy) throw new Error('llmd: context busy');
      ctx.busy = true;
      ctx.messages.push({ role: 'user', content: userText });
      var kProc = rt.kernel ? rt.kernel.fork('llmd:infer:' + contextId, 0) : null;
      var t0 = performance.now(); var tokens = 0; var full = '';
      var self = this;
      try {
        var gen = await rt.engine.chat.completions.create({ messages: ctx.messages, stream: true });
        for await (var chunk of gen) {
          var delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
          if (delta) { full += delta; tokens++; if (onToken) onToken(delta); self.tokPerSec = parseFloat((tokens / ((performance.now() - t0) / 1000)).toFixed(1)); self._emit(); }
        }
        ctx.messages.push({ role: 'assistant', content: full });
        this._recordTrace('chat', { contextId: contextId, tokens: tokens });
        return full;
      } finally {
        ctx.busy = false;
        if (rt.kernel && kProc) rt.kernel.kill(kProc.pid);
      }
    }

    // ─── Sessions (persistent conversation branches) ──────────────────────
    // A session is a saved contextId's message history + which baseModelId it
    // started from — the "branch" concept: resume attuned to prior ∆S instead
    // of always starting from pristine baseline.
    async saveSession(contextId, label) {
      var ctx = this.context(contextId);
      var id = contextId + ':' + Date.now();
      var rec = { id: id, contextId: contextId, baseModelId: this.modelId, label: label || contextId, messages: ctx.messages.slice(), savedAt: Date.now() };
      await idbTx('readwrite', function (store) { store.put(rec); });
      this._recordTrace('saveSession', { id: id });
      return id;
    }
    async listSessions() {
      return idbTx('readonly', function (store) { return { __req: store.getAll() }; });
    }
    async deleteSession(id) {
      await idbTx('readwrite', function (store) { store.delete(id); });
      this._recordTrace('deleteSession', { id: id });
    }
    async selectSession(id, contextId) {
      var rec = await idbTx('readonly', function (store) { return { __req: store.get(id) }; });
      if (!rec) throw new Error('session not found: ' + id);
      var ctx = this.context(contextId);
      ctx.messages = rec.messages.slice();
      this._recordTrace('selectSession', { id: id, contextId: contextId });
      return rec;
    }
    async exportSession(id) {
      var rec = await idbTx('readonly', function (store) { return { __req: store.get(id) }; });
      if (!rec) throw new Error('session not found: ' + id);
      return JSON.stringify(rec, null, 2);
    }
    async importSession(json) {
      var rec = JSON.parse(json);
      if (!rec.id) rec.id = 'imported:' + Date.now();
      await idbTx('readwrite', function (store) { store.put(rec); });
      this._recordTrace('importSession', { id: rec.id });
      return rec.id;
    }
    // Replay: re-emit a saved session's turns as a stream (token-paced when
    // --stream is requested), WITHOUT calling the model — a transcript replay,
    // not new inference.
    async replaySession(id, onToken, streamed) {
      var rec = await idbTx('readonly', function (store) { return { __req: store.get(id) }; });
      if (!rec) throw new Error('session not found: ' + id);
      for (var i = 0; i < rec.messages.length; i++) {
        var m = rec.messages[i];
        var line = '[' + m.role + '] ';
        if (streamed) {
          onToken(line);
          var words = m.content.split(' ');
          for (var w = 0; w < words.length; w++) { onToken(words[w] + (w < words.length - 1 ? ' ' : '')); await new Promise(function (r) { setTimeout(r, 20); }); }
          onToken('\n');
        } else {
          onToken(line + m.content + '\n');
        }
      }
      return rec;
    }
  }

  return Llmd;
}));

// Singleton instance, same call-site shape as before (window.Llmd.chat(...), etc.)
// — but now a real BaseClassX node: queryable/traceable/diffable via its own APIs.
if (typeof window !== 'undefined') {
  window.Llmd = new (window.Llmd)();
}
