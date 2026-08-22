/**
 * ClaudeForm
 * Interact with claude.ai's message input — send text, attach files, or both.
 * Paste into DevTools console on claude.ai
 *
 * Usage:
 *   const form = new ClaudeForm();
 *   await form.send('Hello');
 *   await form.attach('SEND.XML', '<SEND>...</SEND>', 'application/xml');
 *   await form.attachAndSend('SEND.XML', xmlString, 'application/xml', 'Process this');
 */

class ClaudeForm {

  constructor(opts = {}) {
    this.sendDelay  = opts.sendDelay  ?? 300;   // ms after inject before clicking send
    this.attachDelay = opts.attachDelay ?? 400;  // ms after file attach before sending
    this.debug      = opts.debug      ?? true;
  }

  _log(...args) {
    if (this.debug) console.log('[ClaudeForm]', ...args);
  }

  // ── ProseMirror editor ─────────────────────────────────
  _getEditor() {
    const el = document.querySelector('[contenteditable="true"].ProseMirror')
            || document.querySelector('[contenteditable="true"][data-testid]')
            || document.querySelector('div[contenteditable="true"]');
    if (!el) throw new Error('ProseMirror editor not found');
    return el;
  }

  // ── Send button ────────────────────────────────────────
  _getSendButton() {
    // Try multiple selectors — claude.ai changes these
    return document.querySelector('button[aria-label="Send message"]')
        || document.querySelector('button[data-testid="send-button"]')
        || Array.from(document.querySelectorAll('button')).find(b =>
             b.getAttribute('aria-label')?.toLowerCase().includes('send') ||
             b.getAttribute('data-testid')?.toLowerCase().includes('send')
           );
  }

  // ── File input ─────────────────────────────────────────
  _getFileInput() {
    // Direct query first
    let input = document.querySelector('input[type="file"]');
    if (input) return input;

    // Not visible — find the attach button and click it to expose input
    const attachBtn = document.querySelector('button[aria-label*="ttach"]')
                   || document.querySelector('button[data-testid*="attach"]')
                   || document.querySelector('[aria-label*="paperclip"]')
                   || Array.from(document.querySelectorAll('button')).find(b =>
                        b.innerHTML.includes('paperclip') ||
                        b.getAttribute('aria-label')?.toLowerCase().includes('attach') ||
                        b.getAttribute('aria-label')?.toLowerCase().includes('file')
                      );

    if (attachBtn) {
      this._log('Clicking attach button to expose file input...');
      attachBtn.click();
      // After click, input may appear
      input = document.querySelector('input[type="file"]');
      if (input) return input;
    }

    throw new Error('File input not found. Try clicking the paperclip manually first.');
  }

  // ── Inject text into ProseMirror ───────────────────────
  async _injectText(text) {
    const editor = this._getEditor();
    editor.focus();
    // Select all existing content and replace
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    // Fallback: dispatch input event
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    this._log('Text injected:', text.slice(0, 60) + (text.length > 60 ? '...' : ''));
  }

  // ── Click send ─────────────────────────────────────────
  async _clickSend(delay = this.sendDelay) {
    await this._wait(delay);
    const btn = this._getSendButton();
    if (!btn) throw new Error('Send button not found');
    if (btn.disabled) throw new Error('Send button is disabled');
    btn.click();
    this._log('Send clicked');
  }

  // ── Attach a file ──────────────────────────────────────
  async _attachFile(filename, content, mimeType = 'text/plain') {
    const input = this._getFileInput();

    // Build File object from string or Blob
    const blob = content instanceof Blob
      ? content
      : new Blob([content], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });

    // Inject via DataTransfer
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    this._log('File attached:', filename, `(${blob.size} bytes)`);
    await this._wait(this.attachDelay);
  }

  _wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Public API ─────────────────────────────────────────

  /**
   * Send a text message
   */
  async send(text) {
    await this._injectText(text);
    await this._clickSend();
    return { sent: true, text };
  }

  /**
   * Attach a file (does not send)
   */
  async attach(filename, content, mimeType = 'application/xml') {
    await this._attachFile(filename, content, mimeType);
    return { attached: true, filename };
  }

  /**
   * Attach a file then send with optional message text
   */
  async attachAndSend(filename, content, mimeType = 'application/xml', message = '') {
    await this._attachFile(filename, content, mimeType);
    if (message) await this._injectText(message);
    await this._clickSend(this.attachDelay);
    return { sent: true, attached: true, filename, message };
  }

  /**
   * Send a SEND.XML string as an attachment with no message text
   * Convenience wrapper for the MSG bus
   */
  async sendXML(xmlString, filename = 'SEND.XML') {
    return this.attachAndSend(filename, xmlString, 'application/xml', '');
  }

  /**
   * Build and send a SEND.XML from a plain object
   * { ping, chat, command, query, memory }
   */
  async sendPacket(packet = {}, filename = 'SEND.XML') {
    const ts = new Date().toISOString();
    const from = packet.from || 'WILL';
    const to   = packet.to   || 'ARCH';

    let nodes = '';
    if (packet.ping)    nodes += `\n  <PING>${packet.ping}</PING>`;
    if (packet.chat)    nodes += `\n  <CHAT><![CDATA[${packet.chat}]]></CHAT>`;
    if (packet.command) nodes += `\n  <COMMAND><![CDATA[${packet.command}]]></COMMAND>`;
    if (packet.query)   nodes += `\n  <QUERY source="${packet.querySource||'ARCH.db'}"><![CDATA[${packet.query}]]></QUERY>`;
    if (packet.memory)  nodes += `\n  <MEMORY topic="${packet.memoryTopic||'general'}" tags="${packet.memoryTags||'arch'}">${packet.memory}</MEMORY>`;
    if (packet.build)   nodes += `\n  <BUILD artifact="${packet.buildArtifact||''}" version="${packet.buildVersion||''}">${packet.build}</BUILD>`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<SEND ts="${ts}" from="${from}" to="${to}">${nodes}\n</SEND>`;
    return this.sendXML(xml, filename);
  }

  // ── BroadcastChannel ──────────────────────────────────────

  /**
   * Join the sentinel-broadcast mesh
   * identity = who you are on the mesh (WILL, ARCH, DAWN, etc.)
   */
  joinMesh(identity = 'WILL', channel = 'sentinel-broadcast') {
    if (this._bc) {
      this._log('Already on mesh as', this._identity);
      return this;
    }
    this._identity = identity;
    this._channel  = channel;
    this._bc       = new BroadcastChannel(channel);
    this._handlers = {};

    this._bc.onmessage = (e) => {
      const msg = e.data;
      this._log('← BC:', msg?.type, 'from:', msg?.from);

      // Fire registered type handlers
      const handler = this._handlers[msg?.type];
      if (handler) handler(msg);

      // Fire wildcard handler
      if (this._handlers['*']) this._handlers['*'](msg);
    };

    this._log('Joined mesh as', identity, 'on channel', channel);
    this.broadcast({ type: 'PRESENCE', from: identity, ts: Date.now() });
    return this;
  }

  /**
   * Leave the mesh
   */
  leaveMesh() {
    if (this._bc) {
      this._bc.close();
      this._bc = null;
      this._log('Left mesh');
    }
    return this;
  }

  /**
   * Broadcast a message to all mesh participants
   */
  broadcast(payload = {}) {
    if (!this._bc) throw new Error('Not on mesh. Call joinMesh() first.');
    const msg = {
      from: this._identity,
      ts: Date.now(),
      ...payload
    };
    this._bc.postMessage(msg);
    this._log('→ BC:', msg.type, 'to:', msg.to || 'broadcast');
    return msg;
  }

  /**
   * Register a handler for a specific message type
   * type='*' catches everything
   */
  onMessage(type, handler) {
    if (!this._handlers) this._handlers = {};
    this._handlers[type] = handler;
    this._log('Handler registered for type:', type);
    return this;
  }

  /**
   * Send a CHAT message to a specific mesh participant
   */
  broadcastChat(text, to = 'broadcast') {
    return this.broadcast({ type: 'CHAT_MESSAGE', to, payload: { text } });
  }

  /**
   * Send TO_MERIDIAN — routes through content.js → relay → ProseMirror
   */
  toMeridian(text) {
    return this.broadcast({
      type: 'TO_MERIDIAN',
      to: 'MERIDIAN',
      payload: { text },
      entityType: 'PRJ'
    });
  }

  /**
   * Announce presence ping
   */
  ping() {
    return this.broadcast({ type: 'PING', to: 'broadcast' });
  }

  /**
   * Listen for FROM_MERIDIAN responses and log them
   */
  listenForMeridian(callback) {
    return this.onMessage('FROM_MERIDIAN', (msg) => {
      this._log('MERIDIAN says:', msg?.payload?.text?.slice(0, 100));
      if (callback) callback(msg);
    });
  }

  // ── File Watcher (DOM + IndexedDB) ──────────────────────────

  /**
   * Open (or reuse) the sentinel IndexedDB.
   * Stores miss records: { filename, ts, retries, status, lastSeen }
   */
  async _getIDB() {
    if (this._idb) return this._idb;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('sentinel', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('misses')) {
          db.createObjectStore('misses', { keyPath: 'filename' });
        }
      };
      req.onsuccess = (e) => { this._idb = e.target.result; resolve(this._idb); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async _idbPut(storeName, record) {
    const db = await this._getIDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async _idbGet(storeName, key) {
    const db = await this._getIDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
  }

  async _idbGetAll(storeName) {
    const db = await this._getIDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * Scan claude.ai's output panel DOM for a filename.
   * Claude renders output files as download links or file chips.
   */
  _outputPanelHasFile(filename) {
    // Text scan — broadest catch
    if (document.body.innerText?.includes(filename)) return true;
    // Link/chip scan
    return Array.from(document.querySelectorAll('a, [data-testid*="file"], [class*="file"]'))
      .some(el => el.textContent?.includes(filename) || el.href?.includes(filename));
  }

  /**
   * Watch the output panel DOM for a file to appear.
   *
   * Behaviour:
   *   FOUND  → call onFound(filename), write IDB { status: "found" }, stop.
   *   MISS   → write IDB { status: "miss", retries: N }, wait retryAfterMs, reload page.
   *
   * opts:
   *   interval     ms between DOM checks       (default 3000)
   *   timeout      ms before declaring miss    (default 120000)
   *   retryAfterMs ms to wait before reload    (default 120000)
   *   maxRetries   stop reloading after N      (default 5)
   *   onFound      callback(filename)
   *   onMiss       callback(record)
   */
  async watchOutputFile(filename = 'RECEIVE.XML', opts = {}) {
    const interval   = opts.interval    ?? 3000;
    const timeout    = opts.timeout     ?? 120000;
    const retryAfter = opts.retryAfterMs ?? 120000;
    const maxRetries = opts.maxRetries  ?? 5;
    const start      = Date.now();

    // Read existing miss record to get retry count
    const existing = await this._idbGet('misses', filename).catch(() => null);
    const retries  = existing?.retries ?? 0;

    if (retries >= maxRetries) {
      this._log(`[WATCH] Max retries (${maxRetries}) reached for "${filename}". Giving up.`);
      return { stop: () => {} };
    }

    this._log(`[WATCH] Watching output panel for "${filename}" (attempt ${retries + 1}/${maxRetries})`);

    const poll = setInterval(async () => {
      if (this._outputPanelHasFile(filename)) {
        clearInterval(poll);
        this._log(`[WATCH] ✓ "${filename}" found in output panel`);

        await this._idbPut('misses', {
          filename,
          ts: Date.now(),
          retries,
          status: 'found',
          lastSeen: new Date().toISOString()
        });

        if (opts.onFound) opts.onFound(filename);
        return;
      }

      if ((Date.now() - start) >= timeout) {
        clearInterval(poll);

        const missRecord = {
          filename,
          ts: Date.now(),
          retries: retries + 1,
          status: 'miss',
          lastSeen: new Date().toISOString()
        };
        await this._idbPut('misses', missRecord).catch(() => {});
        this._log(`[WATCH] ✗ "${filename}" not found. Miss #${missRecord.retries} recorded.`);

        if (opts.onMiss) opts.onMiss(missRecord);

        this._log(`[WATCH] Reloading page in ${retryAfter / 1000}s...`);
        setTimeout(() => location.reload(), retryAfter);
      }
    }, interval);

    return { stop: () => { clearInterval(poll); this._log(`[WATCH] Stopped "${filename}"`); } };
  }

  /**
   * Read all miss records from IndexedDB — logs as a table
   */
  async getMisses() {
    const all = await this._idbGetAll('misses');
    console.table(all);
    return all;
  }

  /**
   * Clear all miss records
   */
  async clearMisses() {
    const db = await this._getIDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('misses', 'readwrite');
      const req = tx.objectStore('misses').clear();
      req.onsuccess = () => { this._log('Miss records cleared'); resolve(); };
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * One-shot: send a packet and watch output panel for RECEIVE.XML.
   * Resolves with { found, filename } or { found: false, miss }
   */
  async sendAndWait(packet, opts = {}) {
    await this.sendPacket(packet);
    this._log('Packet sent — watching output panel for RECEIVE.XML...');
    return new Promise((resolve) => {
      this.watchOutputFile('RECEIVE.XML', {
        ...opts,
        onFound: (f) => resolve({ found: true,  filename: f }),
        onMiss:  (r) => resolve({ found: false, miss: r })
      });
    });
  }

  /**
   * Combined: attach+send a file AND broadcast a mesh notification
   */
  async sendXMLAndBroadcast(xmlString, broadcastPayload = {}) {
    const result = await this.sendXML(xmlString);
    if (this._bc) {
      this.broadcast({
        type: 'SEND_XML',
        payload: { filename: 'SEND.XML', size: xmlString.length },
        ...broadcastPayload
      });
    }
    return result;
  }
}

// ── Quick test helpers ─────────────────────────────────────
window.cf = new ClaudeForm();

console.log('[ClaudeForm] Ready. window.cf available.');
console.log('');
console.log('  — Form —');
console.log('  cf.send("Hello")');
console.log('  cf.attach("SEND.XML", xmlString)');
console.log('  cf.attachAndSend("SEND.XML", xmlString, "application/xml", "msg")');
console.log('  cf.sendXML(xmlString)');
console.log('  cf.sendPacket({ chat: "...", command: "...", query: "..." })');
console.log('');
console.log('  — Mesh —');
console.log('  cf.joinMesh("WILL")                join sentinel-broadcast');
console.log('  cf.broadcastChat("Hello", "ARCH")  send chat to ARCH');
console.log('  cf.toMeridian("question")          route to General via relay');
console.log('  cf.ping()                           announce presence');
console.log('  cf.listenForMeridian(cb)            listen for General responses');
console.log('  cf.onMessage("TYPE", cb)            register any type handler');
console.log('  cf.leaveMesh()                      disconnect');
console.log('');
console.log('  — File Watcher —');
console.log('  cf.watchOutputFile("RECEIVE.XML")     watch DOM output panel, IDB miss on timeout, reload');
console.log('  cf.getMisses()                         read all IDB miss records (console.table)');
console.log('  cf.clearMisses()                       clear IDB miss records');
console.log('');
console.log('  — Combined —');
console.log('  cf.sendAndWait({ chat: "..." })    send packet + await response');
console.log('  cf.sendXMLAndBroadcast(xmlString)  upload + notify mesh');

// ── Response Capture ──────────────────────────────────────────────────────────

/**
 * Capture Claude's response after sending a message or file.
 *
 * Strategy:
 *   1. Record the current last assistant message before sending.
 *   2. After send, watch the DOM for a NEW assistant message to appear.
 *   3. Wait for streaming to finish (text stops changing).
 *   4. Return the full captured text.
 *
 * Works by observing [data-testid="assistant-message"] or the equivalent
 * message turn containers claude.ai renders.
 */

ClaudeForm.prototype._getLastAssistantMessage = function() {
  // Claude renders messages in turn containers
  // Try multiple selectors in priority order
  const selectors = [
    '[data-testid="assistant-message"]',
    '.font-claude-message',
    '[class*="AssistantMessage"]',
    '[class*="assistant"]',
  ];

  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) return els[els.length - 1];
  }

  // Fallback: find all message containers, return last non-human one
  const turns = document.querySelectorAll('[class*="ConversationTurn"], [class*="message"]');
  const assistantTurns = Array.from(turns).filter(el =>
    !el.querySelector('[data-testid="user-message"]') &&
    el.textContent?.trim().length > 10
  );
  return assistantTurns[assistantTurns.length - 1] ?? null;
};

ClaudeForm.prototype._getLastAssistantText = function() {
  const el = this._getLastAssistantMessage();
  return el ? el.innerText?.trim() ?? '' : '';
};

/**
 * Wait for Claude to finish responding after a send.
 * Resolves with the full response text.
 *
 * opts:
 *   pollInterval  ms between checks          (default 800)
 *   settleTime    ms of no-change = done      (default 2000)
 *   timeout       ms max wait                 (default 120000)
 *   onChunk       callback(text) on each poll — for streaming preview
 */
ClaudeForm.prototype.waitForResponse = async function(opts = {}) {
  const pollInterval = opts.pollInterval ?? 800;
  const settleTime   = opts.settleTime   ?? 2000;
  const timeout      = opts.timeout      ?? 120000;
  const start        = Date.now();

  // Snapshot text before response arrives
  const baseline = this._getLastAssistantText();
  this._log('[CAPTURE] Waiting for new response...');
  this._log('[CAPTURE] Baseline length:', baseline.length);

  return new Promise((resolve, reject) => {
    let lastText      = baseline;
    let lastChanged   = Date.now();
    let responseStarted = false;

    const poll = setInterval(() => {
      const now     = Date.now();
      const elapsed = now - start;
      const current = this._getLastAssistantText();

      // Has a new response started?
      if (!responseStarted && current !== baseline) {
        responseStarted = true;
        this._log('[CAPTURE] Response started...');
      }

      // Is it still streaming?
      if (responseStarted && current !== lastText) {
        lastText    = current;
        lastChanged = now;
        if (opts.onChunk) opts.onChunk(current);
      }

      // Has it settled?
      const settled = responseStarted && (now - lastChanged) >= settleTime;
      if (settled) {
        clearInterval(poll);
        this._log('[CAPTURE] Response settled. Length:', lastText.length);
        resolve(lastText);
        return;
      }

      if (elapsed >= timeout) {
        clearInterval(poll);
        if (responseStarted) {
          this._log('[CAPTURE] Timeout — returning partial response');
          resolve(lastText);
        } else {
          reject(new Error('waitForResponse: no response received within timeout'));
        }
      }
    }, pollInterval);
  });
};

/**
 * Send a SEND.XML and capture Claude's full response.
 * Returns { sent, response, ms }
 */
ClaudeForm.prototype.sendAndCapture = async function(xmlString, opts = {}) {
  const t0 = Date.now();
  await this.sendXML(xmlString);
  const response = await this.waitForResponse(opts);
  const ms = Date.now() - t0;
  this._log(`[CAPTURE] Done in ${ms}ms`);
  return { sent: true, response, ms };
};

/**
 * Build packet, send, capture response — one call.
 */
ClaudeForm.prototype.packetAndCapture = async function(packet, opts = {}) {
  const ts = new Date().toISOString();
  const from = packet.from || 'WILL';
  const to   = packet.to   || 'ARCH';
  let nodes = '';
  if (packet.ping)    nodes += `\n  <PING>${packet.ping}</PING>`;
  if (packet.chat)    nodes += `\n  <CHAT><![CDATA[${packet.chat}]]></CHAT>`;
  if (packet.command) nodes += `\n  <COMMAND><![CDATA[${packet.command}]]></COMMAND>`;
  if (packet.query)   nodes += `\n  <QUERY source="${packet.querySource||'ARCH.db'}"><![CDATA[${packet.query}]]></QUERY>`;
  if (packet.memory)  nodes += `\n  <MEMORY topic="${packet.memoryTopic||'general'}">${packet.memory}</MEMORY>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<SEND ts="${ts}" from="${from}" to="${to}">${nodes}\n</SEND>`;
  return this.sendAndCapture(xml, opts);
};

console.log('[ClaudeForm] Response capture loaded.');
console.log('  cf.waitForResponse()              wait for Claude to finish responding');
console.log('  cf.sendAndCapture(xmlString)      send SEND.XML + capture response');
console.log('  cf.packetAndCapture({chat:"..."}) build packet, send, capture');

// ── Overlay ───────────────────────────────────────────────────────────────────

/**
 * Show a full-screen overlay div covering the entire viewport.
 * Useful for blocking UI during processing, showing status, or visual feedback.
 *
 * opts:
 *   color      background color           (default 'rgba(0,0,0,0.85)')
 *   zIndex     stack order                (default 999999)
 *   html       inner HTML content         (default spinner + message)
 *   message    status text                (default 'Processing...')
 *   id         element id                 (default 'sentinel-overlay')
 *   blur       blur the page behind it    (default true)
 */
ClaudeForm.prototype.showOverlay = function(opts = {}) {
  const id      = opts.id      ?? 'sentinel-overlay';
  const color   = opts.color   ?? 'rgba(10, 10, 20, 0.92)';
  const zIndex  = opts.zIndex  ?? 999999;
  const message = opts.message ?? 'Processing...';
  const blur    = opts.blur    ?? true;

  // Remove existing if present
  this.hideOverlay(id);

  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    background: ${color};
    z-index: ${zIndex};
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ${blur ? 'backdrop-filter: blur(4px);' : ''}
    cursor: wait;
    animation: sentinel-fade-in 0.2s ease;
  `;

  overlay.innerHTML = opts.html ?? `
    <style>
      @keyframes sentinel-fade-in { from { opacity: 0 } to { opacity: 1 } }
      @keyframes sentinel-spin { to { transform: rotate(360deg) } }
      @keyframes sentinel-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
    </style>
    <div style="
      width: 48px; height: 48px;
      border: 3px solid rgba(167,139,250,0.2);
      border-top-color: #a78bfa;
      border-radius: 50%;
      animation: sentinel-spin 0.8s linear infinite;
    "></div>
    <div style="
      color: #a78bfa;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.05em;
      animation: sentinel-pulse 2s ease infinite;
    " id="${id}-msg">${message}</div>
    <div style="
      color: rgba(167,139,250,0.4);
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    ">SENTINEL · ARCH</div>
  `;

  document.body.appendChild(overlay);
  this._log('[OVERLAY] Shown:', message);
  return overlay;
};

/**
 * Update the message text on an existing overlay
 */
ClaudeForm.prototype.updateOverlay = function(message, id = 'sentinel-overlay') {
  const msgEl = document.getElementById(`${id}-msg`);
  if (msgEl) {
    msgEl.textContent = message;
    this._log('[OVERLAY] Updated:', message);
  }
};

/**
 * Hide and remove the overlay
 */
ClaudeForm.prototype.hideOverlay = function(id = 'sentinel-overlay') {
  const el = document.getElementById(id);
  if (el) {
    el.style.animation = 'sentinel-fade-in 0.15s ease reverse';
    setTimeout(() => el.remove(), 150);
    this._log('[OVERLAY] Hidden');
  }
};

/**
 * Show overlay, send packet, capture response, hide overlay.
 * The full guarded round trip.
 */
ClaudeForm.prototype.guardedSend = async function(packet, opts = {}) {
  this.showOverlay({ message: opts.message ?? 'Sending to ARCH...' });

  try {
    const ts = new Date().toISOString();
    const from = packet.from || 'WILL';
    const to   = packet.to   || 'ARCH';
    let nodes = '';
    if (packet.ping)    nodes += `\n  <PING>${packet.ping}</PING>`;
    if (packet.chat)    nodes += `\n  <CHAT><![CDATA[${packet.chat}]]></CHAT>`;
    if (packet.command) nodes += `\n  <COMMAND><![CDATA[${packet.command}]]></COMMAND>`;
    if (packet.query)   nodes += `\n  <QUERY source="${packet.querySource||'ARCH.db'}"><![CDATA[${packet.query}]]></QUERY>`;
    if (packet.memory)  nodes += `\n  <MEMORY topic="${packet.memoryTopic||'general'}">${packet.memory}</MEMORY>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<SEND ts="${ts}" from="${from}" to="${to}">${nodes}\n</SEND>`;

    await this.sendXML(xml);
    this.updateOverlay('Waiting for response...');

    const response = await this.waitForResponse({
      onChunk: (text) => {
        const preview = text.slice(-80).replace(/\n/g, ' ');
        this.updateOverlay(`↳ ${preview}`);
      },
      ...opts
    });

    this.updateOverlay('✓ Done');
    setTimeout(() => this.hideOverlay(), 800);
    return { sent: true, response };

  } catch(err) {
    this.updateOverlay(`✗ Error: ${err.message}`);
    setTimeout(() => this.hideOverlay(), 2000);
    throw err;
  }
};

console.log('[ClaudeForm] Overlay loaded.');
console.log('  cf.showOverlay({ message: "..." })  show full-screen overlay');
console.log('  cf.updateOverlay("new message")      update overlay text');
console.log('  cf.hideOverlay()                     remove overlay');
console.log('  cf.guardedSend({ chat: "..." })      overlay + send + capture + hide');
