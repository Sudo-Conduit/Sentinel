// panel/panel.js
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  injected:   false,
  debuggerOn: false,
  tabId:      chrome.devtools.inspectedWindow.tabId,
  watchStop:  null,   // function to stop active file watcher
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  connBadge:       $('conn-badge'),
  tabInfo:         $('tab-info'),
  btnAttachDbg:    $('btn-attach-debugger'),
  log:             $('log'),
  chkAutoscroll:   $('chk-autoscroll'),
  btnClearLog:     $('btn-clear-log'),
  responseArea:    $('response-area'),
  responseText:    $('response-text'),
  responseMs:      $('response-ms'),
  btnCopyResponse: $('btn-copy-response'),
  panelOverlay:      $('panel-overlay'),
  overlayMessage:    $('overlay-message'),
  overlayStream:     $('overlay-stream'),
  btnOverlayDismiss: $('btn-overlay-dismiss'),
  // Send
  sendText:   $('send-text'),
  chkCapture: $('chk-capture'),
  btnSend:    $('btn-send'),
  // Attach
  attachName:    $('attach-name'),
  attachMime:    $('attach-mime'),
  attachContent: $('attach-content'),
  attachMsg:     $('attach-msg'),
  btnAttachOnly:     $('btn-attach-only'),
  btnAttachSend:     $('btn-attach-send'),
  chkAttachCapture:  $('chk-attach-capture'),
  // Packet
  pktFrom:         $('pkt-from'),
  pktTo:           $('pkt-to'),
  pktChat:         $('pkt-chat'),
  pktCommand:      $('pkt-command'),
  pktQuery:        $('pkt-query'),
  pktPing:         $('pkt-ping'),
  pktMemory:       $('pkt-memory'),
  pktMemoryTopic:  $('pkt-memory-topic'),
  pktBuild:        $('pkt-build'),
  pktBuildArtifact:$('pkt-build-artifact'),
  btnSendPacket:   $('btn-send-packet'),
  btnGuardedSend:  $('btn-guarded-send'),
  btnPreviewXml:   $('btn-preview-xml'),
  xmlPreview:      $('xml-preview'),
  // Capture
  capPoll:          $('cap-poll'),
  capSettle:        $('cap-settle'),
  capTimeout:       $('cap-timeout'),
  btnWaitResponse:  $('btn-wait-response'),
  capXml:           $('cap-xml'),
  btnSendCapture:   $('btn-send-capture'),
  btnPacketCapture: $('btn-packet-capture'),
  // Watcher
  watchFilename:   $('watch-filename'),
  watchInterval:   $('watch-interval'),
  watchTimeout:    $('watch-timeout'),
  watchRetryAfter: $('watch-retry-after'),
  watchMaxRetries: $('watch-max-retries'),
  btnWatchStart:   $('btn-watch-start'),
  btnWatchStop:    $('btn-watch-stop'),
  watchStatus:     $('watch-status'),
  sawFilename:     $('saw-filename'),
  btnSendAndWait:  $('btn-send-and-wait'),
  btnGetMisses:    $('btn-get-misses'),
  btnClearMisses:  $('btn-clear-misses'),
  missesTable:     $('misses-table'),
  // Mesh
  meshIdentity:    $('mesh-identity'),
  meshChannel:     $('mesh-channel'),
  btnJoinMesh:     $('btn-join-mesh'),
  btnLeaveMesh:    $('btn-leave-mesh'),
  btnPingMesh:     $('btn-ping-mesh'),
  meshChatTo:      $('mesh-chat-to'),
  meshChatText:    $('mesh-chat-text'),
  btnMeshChat:     $('btn-mesh-chat'),
  meshMeridianTxt: $('mesh-meridian-text'),
  btnToMeridian:   $('btn-to-meridian'),
  meshXmlBroadcast:$('mesh-xml-broadcast'),
  btnXmlBroadcast: $('btn-xml-broadcast'),
  // Debugger
  dbgMethod:  $('dbg-method'),
  dbgParams:  $('dbg-params'),
  btnDbgSend: $('btn-dbg-send'),
};

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const ts = new Date().toTimeString().slice(0, 8);
  entry.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg ${type}">${escHtml(String(msg))}</span>`;
  els.log.appendChild(entry);
  if (els.chkAutoscroll.checked) els.log.scrollTop = els.log.scrollHeight;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── pageEval ──────────────────────────────────────────────────────────────────
function pageEval(expr) {
  return new Promise((resolve, reject) => {
    const wrapped = `(function(){
      var __r=(function(){ return (${expr}); })();
      if(__r&&typeof __r.then==='function'){
        return __r.then(function(v){ return typeof v==='string'?v:JSON.stringify(v); });
      }
      return typeof __r==='string'?__r:JSON.stringify(__r);
    })()`;
    chrome.devtools.inspectedWindow.eval(wrapped, { useContentScriptContext: false }, (result, ex) => {
      if (ex) reject(new Error(ex.value || ex.description || JSON.stringify(ex)));
      else resolve(result);
    });
  });
}

// ── Resilient background messaging ───────────────────────────────────────────
async function sendToBackground(msg, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await chrome.runtime.sendMessage(msg);
      if (resp === undefined) throw new Error('No response from background');
      return resp;
    } catch (err) {
      const dead = err.message?.includes('invalidated') || err.message?.includes('connection') || err.message?.includes('No response');
      if (dead && i < retries - 1) {
        log('⚠ Reconnecting…', 'warn');
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      throw err;
    }
  }
}

// ── Panel Overlay ─────────────────────────────────────────────────────────────
const overlay = {
  _t: null,
  show(msg = 'Processing…') {
    els.panelOverlay.className = 'panel-overlay';
    els.overlayMessage.textContent = msg;
    els.overlayStream.textContent = '';
    els.overlayStream.classList.remove('active');
  },
  update(msg) { els.overlayMessage.textContent = msg; },
  stream(text) {
    const p = text.length > 200 ? '…' + text.slice(-200) : text;
    els.overlayStream.textContent = p;
    els.overlayStream.classList.add('active');
    els.overlayStream.scrollTop = els.overlayStream.scrollHeight;
  },
  done(msg = '✓ Done') {
    els.panelOverlay.classList.add('done');
    els.overlayMessage.textContent = msg;
    els.overlayStream.classList.remove('active');
    this._t = setTimeout(() => this.hide(), 1200);
  },
  error(msg) {
    els.panelOverlay.classList.add('error');
    els.overlayMessage.textContent = msg;
    this._t = setTimeout(() => this.hide(), 3000);
  },
  hide() {
    clearTimeout(this._t);
    els.panelOverlay.classList.add('closing');
    setTimeout(() => { els.panelOverlay.className = 'panel-overlay hidden'; }, 200);
  },
};
els.btnOverlayDismiss.addEventListener('click', () => overlay.hide());

// ── Response capture via MutationObserver ────────────────────────────────────
// Installs a MutationObserver in the page that watches for the last assistant
// message to change, then resolves when text settles.
// Far more reliable than polling — reacts immediately to DOM mutations.

async function captureBaseline() {
  try { return await pageEval(`window.cf._getLastAssistantText()`); }
  catch { return ''; }
}

async function pollForResponse(opts = {}) {
  const settleTime = opts.settleTime ?? 2000;
  const timeout    = opts.timeout    ?? 120000;

  // Install observer in page, store result on window.__sentinelCapture
  await pageEval(`(function(){
    if (window.__sentinelObserver) {
      window.__sentinelObserver.disconnect();
      window.__sentinelObserver = null;
    }
    window.__sentinelCapture = null;

    var settleTime = ${settleTime};
    var timeout    = ${timeout};
    var t0         = Date.now();
    var settleTimer = null;
    var lastText   = '';
    var started    = false;

    function getText() {
      var el = window.cf._getLastAssistantMessage();
      return el ? (el.innerText || '').trim() : '';
    }

    // Snapshot the current last message node count so we know when a NEW one appears
    var selectors = [
      '[data-testid="assistant-message"]',
      '.font-claude-message',
      '[class*="AssistantMessage"]',
      '[class*="assistant"]'
    ];
    function getMessageNodes() {
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        if (els.length) return els;
      }
      return [];
    }
    var baselineCount = getMessageNodes().length;

    function onMutation() {
      var nodes = getMessageNodes();
      // Wait for a NEW message node to appear beyond baseline
      if (!started && nodes.length > baselineCount) {
        started = true;
      }
      if (!started) return;

      var current = getText();
      if (current === lastText) return;
      lastText = current;

      // Reset settle timer on each change
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function() {
        if (window.__sentinelObserver) {
          window.__sentinelObserver.disconnect();
          window.__sentinelObserver = null;
        }
        window.__sentinelCapture = { text: lastText, ms: Date.now() - t0, done: true };
      }, settleTime);
    }

    // Timeout fallback
    setTimeout(function() {
      if (window.__sentinelCapture && window.__sentinelCapture.done) return;
      if (window.__sentinelObserver) {
        window.__sentinelObserver.disconnect();
        window.__sentinelObserver = null;
      }
      window.__sentinelCapture = {
        text: lastText,
        ms: Date.now() - t0,
        done: true,
        timedOut: !started
      };
    }, timeout);

    window.__sentinelObserver = new MutationObserver(onMutation);
    window.__sentinelObserver.observe(document.body, {
      childList: true, subtree: true, characterData: true
    });
  })()`);

  log('Observer installed — waiting for response…', 'dim');

  // Poll __sentinelCapture from panel side (cheap — just reading a flag)
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    let lastLen = 0;
    const timer = setInterval(async () => {
      try {
        const raw = await pageEval(
          `window.__sentinelCapture ? JSON.stringify(window.__sentinelCapture) : null`
        );

        // Stream preview while waiting
        if (!raw || raw === 'null') {
          const preview = await pageEval(`window.cf._getLastAssistantText()`);
          if (preview && preview.length !== lastLen) {
            lastLen = preview.length;
            log(`[capture] streaming… ${preview.length} chars`, 'dim');
            if (opts.onChunk) opts.onChunk(preview);
            if (opts.onStart && lastLen > 0) opts.onStart();
          }
          return;
        }

        clearInterval(timer);
        const result = JSON.parse(raw);
        await pageEval(`window.__sentinelCapture = null`).catch(() => {});

        if (result.timedOut) {
          log('[capture] timeout — no response detected', 'error');
          reject(new Error('No response within timeout'));
        } else {
          log(`[capture] settled — ${result.text.length} chars in ${result.ms}ms`, 'ok');
          if (opts.onChunk) opts.onChunk(result.text);
          resolve({ text: result.text, ms: result.ms });
        }
      } catch { /* page navigating, keep waiting */ }
    }, 400);
  });
}

// ── Tab navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Badge / status ────────────────────────────────────────────────────────────
function updateBadge() {
  const { injected, debuggerOn } = state;
  if (injected && debuggerOn)    { els.connBadge.textContent = '● Ready';        els.connBadge.className = 'badge connected'; }
  else if (injected || debuggerOn){ els.connBadge.textContent = '● Partial';     els.connBadge.className = 'badge partial'; }
  else                            { els.connBadge.textContent = '● Disconnected'; els.connBadge.className = 'badge disconnected'; }
}

chrome.tabs && chrome.tabs.get(state.tabId, tab => {
  if (!tab) return;
  try { const u = new URL(tab.url); els.tabInfo.textContent = u.hostname + u.pathname.slice(0,30); }
  catch { els.tabInfo.textContent = tab.url?.slice(0,50); }
});

// ── Auto-detect ClaudeForm ────────────────────────────────────────────────────
async function checkCfReady() {
  try {
    const r = await pageEval(`window.cf ? 'ready' : 'not ready'`);
    state.injected = (r === 'ready');
    updateBadge();
    if (state.injected) log('✓ ClaudeForm ready (auto-injected)', 'ok');
    else log('⚠ window.cf not found — reload the claude.ai tab', 'warn');
  } catch (err) {
    state.injected = false; updateBadge();
    log('⚠ ' + err.message, 'warn');
  }
}

// ── Debugger attach/detach ────────────────────────────────────────────────────
els.btnAttachDbg.addEventListener('click', async () => {
  if (!state.debuggerOn) {
    try {
      const r = await sendToBackground({ type: 'ATTACH_DEBUGGER', tabId: state.tabId });
      if (r?.ok) { state.debuggerOn = true; updateBadge(); els.btnAttachDbg.textContent = 'Detach Debugger'; log('✓ Debugger attached', 'ok'); }
      else log('✗ ' + (r?.error ?? 'unknown'), 'error');
    } catch (err) { log('✗ ' + err.message, 'error'); }
  } else {
    try {
      const r = await sendToBackground({ type: 'DETACH_DEBUGGER', tabId: state.tabId });
      if (r?.ok) { state.debuggerOn = false; updateBadge(); els.btnAttachDbg.textContent = 'Attach Debugger'; log('Debugger detached', 'dim'); }
    } catch (err) { log('✗ ' + err.message, 'error'); }
  }
});

// ── SEND tab ──────────────────────────────────────────────────────────────────
els.btnSend.addEventListener('click', async () => {
  const text = els.sendText.value.trim();
  if (!text) { log('⚠ Enter a message first', 'warn'); return; }
  const capture = els.chkCapture.checked;
  log(`Sending message${capture ? ' + capturing' : ''}…`, 'dim');
  try {
    // Snapshot baseline BEFORE sending to avoid race condition
    const baseline = capture ? await captureBaseline() : null;
    await pageEval(`window.cf.send(${JSON.stringify(text)})`);
    log('✓ Sent', 'ok');
    if (capture) {
      showResponse(null);
      overlay.show('Waiting for response…');
      const { text: resp, ms } = await pollForResponse({
          onStart: () => overlay.update('Receiving…'),
        onChunk: t => overlay.stream(t),
      });
      overlay.done();
      showResponse(resp, ms);
    }
  } catch (err) { overlay.error('✗ ' + err.message); log('✗ ' + err.message, 'error'); }
});

// ── ATTACH tab ────────────────────────────────────────────────────────────────
els.btnAttachOnly.addEventListener('click', async () => {
  const name = els.attachName.value || 'SEND.XML';
  const mime = els.attachMime.value || 'application/xml';
  const content = els.attachContent.value;
  log(`Attaching ${name}…`, 'dim');
  try {
    await pageEval(`window.cf.attach(${JSON.stringify(name)},${JSON.stringify(content)},${JSON.stringify(mime)})`);
    log(`✓ Attached: ${name}`, 'ok');
  } catch (err) { log('✗ ' + err.message, 'error'); }
});

els.btnAttachSend.addEventListener('click', async () => {
  const name    = els.attachName.value    || 'SEND.XML';
  const mime    = els.attachMime.value    || 'application/xml';
  const content = els.attachContent.value;
  const msg     = els.attachMsg.value;
  const capture = els.chkAttachCapture.checked;
  log(`Attaching + sending ${name}${capture ? ' + capturing' : ''}…`, 'dim');
  try {
    const baseline = capture ? await captureBaseline() : null;
    await pageEval(`window.cf.attachAndSend(${JSON.stringify(name)},${JSON.stringify(content)},${JSON.stringify(mime)},${JSON.stringify(msg)})`);
    log(`✓ Attached + sent: ${name}`, 'ok');
    if (capture) {
      showResponse(null);
      overlay.show('Waiting for response…');
      const { text, ms } = await pollForResponse({
          onStart: () => overlay.update('Receiving…'),
        onChunk: t  => overlay.stream(t),
      });
      overlay.done();
      showResponse(text, ms);
    }
  } catch (err) { overlay.error('✗ ' + err.message); log('✗ ' + err.message, 'error'); }
});

// ── PACKET tab ────────────────────────────────────────────────────────────────
function buildPacketObj() {
  const p = {};
  if (els.pktFrom.value)         p.from          = els.pktFrom.value;
  if (els.pktTo.value)           p.to            = els.pktTo.value;
  if (els.pktChat.value.trim())  p.chat          = els.pktChat.value.trim();
  if (els.pktCommand.value)      p.command       = els.pktCommand.value;
  if (els.pktQuery.value)        p.query         = els.pktQuery.value;
  if (els.pktPing.value)         p.ping          = els.pktPing.value;
  if (els.pktMemory.value)     { p.memory        = els.pktMemory.value; p.memoryTopic = els.pktMemoryTopic.value || 'general'; }
  if (els.pktBuild.value)      { p.build         = els.pktBuild.value;  p.buildArtifact = els.pktBuildArtifact.value || ''; }
  return p;
}

function buildXml(p) {
  const ts = new Date().toISOString();
  const from = p.from || 'WILL', to = p.to || 'ARCH';
  let n = '';
  if (p.ping)    n += `\n  <PING>${p.ping}</PING>`;
  if (p.chat)    n += `\n  <CHAT><![CDATA[${p.chat}]]></CHAT>`;
  if (p.command) n += `\n  <COMMAND><![CDATA[${p.command}]]></COMMAND>`;
  if (p.query)   n += `\n  <QUERY><![CDATA[${p.query}]]></QUERY>`;
  if (p.memory)  n += `\n  <MEMORY topic="${p.memoryTopic||'general'}">${p.memory}</MEMORY>`;
  if (p.build)   n += `\n  <BUILD artifact="${p.buildArtifact||''}">${p.build}</BUILD>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<SEND ts="${ts}" from="${from}" to="${to}">${n}\n</SEND>`;
}

els.btnPreviewXml.addEventListener('click', () => {
  els.xmlPreview.textContent = buildXml(buildPacketObj());
  els.xmlPreview.classList.toggle('hidden');
});

els.btnSendPacket.addEventListener('click', async () => {
  const packet = buildPacketObj();
  log('Sending packet…', 'dim');
  try {
    await pageEval(`window.cf.sendPacket(${JSON.stringify(packet)})`);
    log('✓ Packet sent', 'ok');
  } catch (err) { log('✗ ' + err.message, 'error'); }
});

els.btnGuardedSend.addEventListener('click', async () => {
  const packet = buildPacketObj();
  log('Guarded send…', 'dim');
  showResponse(null);
  overlay.show('Sending to ARCH…');
  try {
    await pageEval(`window.cf.sendPacket(${JSON.stringify(packet)})`);
    overlay.update('Waiting for Claude…');
    const { text, ms } = await pollForResponse({
      onStart: () => overlay.update('Receiving…'),
      onChunk: t => overlay.stream(t),
    });
    await pageEval(`window.cf.hideOverlay()`).catch(() => {});
    overlay.done('✓ Done');
    log(`✓ Guarded send complete (${ms}ms)`, 'ok');
    showResponse(text, ms);
  } catch (err) { overlay.error('✗ ' + err.message); log('✗ ' + err.message, 'error'); }
});

// ── CAPTURE tab ───────────────────────────────────────────────────────────────
els.btnWaitResponse.addEventListener('click', async () => {
  const opts = {
    pollInterval: parseInt(els.capPoll.value)    || 800,
    settleTime:   parseInt(els.capSettle.value)  || 2000,
    timeout:      parseInt(els.capTimeout.value) || 120000,
  };
  log('Waiting for response…', 'dim');
  showResponse(null);
  overlay.show('Waiting for response…');
  try {
    const { text, ms } = await pollForResponse({
      ...opts,
      onStart: () => overlay.update('Receiving…'),
      onChunk: t  => overlay.stream(t),
    });
    overlay.done('✓ Done');
    showResponse(text, ms);
    log(`✓ Captured (${ms}ms, ${text.length} chars)`, 'ok');
  } catch (err) { overlay.error('✗ ' + err.message); log('✗ ' + err.message, 'error'); }
});

els.btnSendCapture.addEventListener('click', async () => {
  const xml = els.capXml.value.trim();
  if (!xml) { log('⚠ Enter an XML string first', 'warn'); return; }
  log('sendAndCapture…', 'dim');
  showResponse(null);
  overlay.show('Sending XML…');
  try {
    await pageEval(`window.cf.sendXML(${JSON.stringify(xml)})`);
    overlay.update('Waiting for response…');
    const { text, ms } = await pollForResponse({
      onStart: () => overlay.update('Receiving…'),
      onChunk: t  => overlay.stream(t),
    });
    overlay.done('✓ Done');
    showResponse(text, ms);
    log(`✓ sendAndCapture done (${ms}ms)`, 'ok');
  } catch (err) { overlay.error('✗ ' + err.message); log('✗ ' + err.message, 'error'); }
});

els.btnPacketCapture.addEventListener('click', async () => {
  const packet = buildPacketObj();
  log('packetAndCapture…', 'dim');
  showResponse(null);
  overlay.show('Building + sending packet…');
  try {
    await pageEval(`window.cf.sendPacket(${JSON.stringify(packet)})`);
    overlay.update('Waiting for response…');
    const { text, ms } = await pollForResponse({
      onStart: () => overlay.update('Receiving…'),
      onChunk: t  => overlay.stream(t),
    });
    overlay.done('✓ Done');
    showResponse(text, ms);
    log(`✓ packetAndCapture done (${ms}ms)`, 'ok');
  } catch (err) { overlay.error('✗ ' + err.message); log('✗ ' + err.message, 'error'); }
});

// ── WATCHER tab ───────────────────────────────────────────────────────────────
function setWatchStatus(msg, type = 'active') {
  els.watchStatus.className = `watch-status ${type}`;
  els.watchStatus.innerHTML = `<span class="watch-pulse"></span>${escHtml(msg)}`;
}

els.btnWatchStart.addEventListener('click', async () => {
  const filename   = els.watchFilename.value   || 'RECEIVE.XML';
  const interval   = parseInt(els.watchInterval.value)   || 3000;
  const timeout    = parseInt(els.watchTimeout.value)    || 120000;
  const retryAfter = parseInt(els.watchRetryAfter.value) || 120000;
  const maxRetries = parseInt(els.watchMaxRetries.value) || 5;

  // Start watch in the page via ClaudeForm
  log(`👁 Watching for "${filename}"…`, 'dim');
  setWatchStatus(`Watching for ${filename}…`);
  els.btnWatchStart.disabled = true;
  els.btnWatchStop.disabled  = false;

  try {
    const expr = `window.cf.watchOutputFile(${JSON.stringify(filename)}, {
      interval: ${interval},
      timeout: ${timeout},
      retryAfterMs: ${retryAfter},
      maxRetries: ${maxRetries},
      onFound: function(f){ window.__watchResult = {found:true,  filename:f}; },
      onMiss:  function(r){ window.__watchResult = {found:false, miss:r};     }
    }).then(function(handle){ window.__watchHandle = handle; return 'started'; })`;

    await pageEval(expr);
    log(`Watcher started in page`, 'ok');

    // Poll for result from the panel side
    const pollTimer = setInterval(async () => {
      try {
        const result = await pageEval(`window.__watchResult ? JSON.stringify(window.__watchResult) : null`);
        if (result && result !== 'null') {
          clearInterval(pollTimer);
          state.watchStop = null;
          els.btnWatchStart.disabled = false;
          els.btnWatchStop.disabled  = true;
          const parsed = JSON.parse(result);
          await pageEval(`window.__watchResult = null`).catch(() => {});
          if (parsed.found) {
            setWatchStatus(`✓ Found: ${parsed.filename}`, 'found');
            log(`✓ "${parsed.filename}" found in output panel`, 'ok');
          } else {
            setWatchStatus(`✗ Miss #${parsed.miss?.retries} — page reloading`, 'missed');
            log(`✗ File not found. Miss #${parsed.miss?.retries} recorded. Page will reload.`, 'warn');
          }
        }
      } catch { /* page may have navigated */ }
    }, 1500);

    state.watchStop = () => {
      clearInterval(pollTimer);
      pageEval(`window.__watchHandle && window.__watchHandle.stop()`).catch(() => {});
    };

  } catch (err) {
    els.btnWatchStart.disabled = false;
    els.btnWatchStop.disabled  = true;
    setWatchStatus('Error: ' + err.message, 'missed');
    log('✗ ' + err.message, 'error');
  }
});

els.btnWatchStop.addEventListener('click', () => {
  if (state.watchStop) { state.watchStop(); state.watchStop = null; }
  els.btnWatchStart.disabled = false;
  els.btnWatchStop.disabled  = true;
  setWatchStatus('Stopped', '');
  log('Watcher stopped', 'dim');
});

els.btnSendAndWait.addEventListener('click', async () => {
  const packet   = buildPacketObj();
  const filename = els.sawFilename.value || 'RECEIVE.XML';
  log(`sendAndWait → watching for "${filename}"…`, 'dim');
  overlay.show(`Sending packet…`);
  try {
    await pageEval(`window.cf.sendPacket(${JSON.stringify(packet)})`);
    overlay.update(`Watching for ${filename}…`);

    // Poll for file in output panel
    const timeout    = parseInt(els.watchTimeout.value) || 120000;
    const interval   = parseInt(els.watchInterval.value) || 3000;
    const t0 = Date.now();

    const found = await new Promise((resolve) => {
      const timer = setInterval(async () => {
        try {
          const has = await pageEval(`window.cf._outputPanelHasFile(${JSON.stringify(filename)})`);
          if (has === true || has === 'true') {
            clearInterval(timer);
            resolve(true);
          } else if (Date.now() - t0 >= timeout) {
            clearInterval(timer);
            resolve(false);
          }
        } catch { /* keep polling */ }
      }, interval);
    });

    if (found) {
      overlay.done(`✓ ${filename} found!`);
      log(`✓ "${filename}" found in output panel`, 'ok');
    } else {
      overlay.error(`✗ "${filename}" not found within timeout`);
      log(`✗ "${filename}" not found — timeout`, 'warn');
    }
  } catch (err) { overlay.error('✗ ' + err.message); log('✗ ' + err.message, 'error'); }
});

els.btnGetMisses.addEventListener('click', async () => {
  log('Reading miss records…', 'dim');
  try {
    const result = await pageEval(`window.cf.getMisses().then(r => JSON.stringify(r))`);
    const records = JSON.parse(result);
    renderMissesTable(records);
    log(`Loaded ${records.length} miss record(s)`, records.length ? 'ok' : 'dim');
  } catch (err) { log('✗ ' + err.message, 'error'); }
});

els.btnClearMisses.addEventListener('click', async () => {
  log('Clearing miss records…', 'dim');
  try {
    await pageEval(`window.cf.clearMisses()`);
    els.missesTable.classList.add('hidden');
    log('✓ Miss records cleared', 'ok');
  } catch (err) { log('✗ ' + err.message, 'error'); }
});

function renderMissesTable(records) {
  if (!records.length) {
    els.missesTable.innerHTML = '<p style="color:var(--text-dim);font-size:11px;padding:6px">No miss records.</p>';
    els.missesTable.classList.remove('hidden');
    return;
  }
  const cols = ['filename', 'status', 'retries', 'lastSeen'];
  const thead = cols.map(c => `<th>${c}</th>`).join('');
  const rows = records.map(r => `<tr>${cols.map(c => `<td class="${c==='status'?'status-'+r[c]:''}">${escHtml(String(r[c]??''))}</td>`).join('')}</tr>`).join('');
  els.missesTable.innerHTML = `<table><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table>`;
  els.missesTable.classList.remove('hidden');
}

// ── MESH tab ──────────────────────────────────────────────────────────────────
els.btnJoinMesh.addEventListener('click', async () => {
  const identity = els.meshIdentity.value || 'WILL';
  const channel  = els.meshChannel.value  || 'sentinel-broadcast';
  log(`Joining mesh as "${identity}"…`, 'dim');
  try {
    await pageEval(`window.cf.joinMesh(${JSON.stringify(identity)},${JSON.stringify(channel)})`);
    log(`✓ Joined mesh as ${identity}`, 'ok');
  } catch (err) { log('✗ ' + err.message, 'error'); }
});

els.btnLeaveMesh.addEventListener('click', async () => {
  try { await pageEval(`window.cf.leaveMesh()`); log('Left mesh', 'dim'); }
  catch (err) { log('✗ ' + err.message, 'error'); }
});

els.btnPingMesh.addEventListener('click', async () => {
  try { await pageEval(`window.cf.ping()`); log('Pinged', 'ok'); }
  catch (err) { log('✗ ' + err.message, 'error'); }
});

els.btnMeshChat.addEventListener('click', async () => {
  const to = els.meshChatTo.value || 'broadcast';
  const text = els.meshChatText.value;
  if (!text) return;
  try {
    await pageEval(`window.cf.broadcastChat(${JSON.stringify(text)},${JSON.stringify(to)})`);
    log(`✓ Chat → ${to}`, 'ok');
  } catch (err) { log('✗ ' + err.message, 'error'); }
});

els.btnToMeridian.addEventListener('click', async () => {
  const text = els.meshMeridianTxt.value;
  if (!text) return;
  try {
    await pageEval(`window.cf.toMeridian(${JSON.stringify(text)})`);
    log('✓ Routed to MERIDIAN', 'ok');
  } catch (err) { log('✗ ' + err.message, 'error'); }
});

els.btnXmlBroadcast.addEventListener('click', async () => {
  const xml = els.meshXmlBroadcast.value.trim();
  if (!xml) { log('⚠ Enter XML first', 'warn'); return; }
  try {
    await pageEval(`window.cf.sendXMLAndBroadcast(${JSON.stringify(xml)})`);
    log('✓ XML sent + broadcast', 'ok');
  } catch (err) { log('✗ ' + err.message, 'error'); }
});

// ── DEBUGGER tab ──────────────────────────────────────────────────────────────
els.btnDbgSend.addEventListener('click', async () => {
  const method = els.dbgMethod.value.trim();
  let params = {};
  try { if (els.dbgParams.value.trim()) params = JSON.parse(els.dbgParams.value); }
  catch { log('⚠ Invalid JSON params', 'warn'); return; }
  log(`CDP → ${method}`, 'accent');
  try {
    const r = await sendToBackground({ type: 'CDP_COMMAND', tabId: state.tabId, method, params });
    if (r?.ok) log('← ' + JSON.stringify(r.result).slice(0, 300), 'ok');
    else log('✗ ' + (r?.error ?? 'unknown'), 'error');
  } catch (err) { log('✗ ' + err.message, 'error'); }
});

document.querySelectorAll('.quick-eval').forEach(btn => {
  btn.addEventListener('click', async () => {
    const expr = btn.dataset.expr;
    log(`eval → ${expr}`, 'dim');
    try { log('← ' + JSON.stringify(await pageEval(expr)), 'ok'); }
    catch (err) { log('✗ ' + err.message, 'error'); }
  });
});

// ── Response display ──────────────────────────────────────────────────────────
function showResponse(text, ms) {
  els.responseArea.classList.remove('hidden');
  if (text === null) {
    els.responseText.textContent = '⏳ Waiting for response…';
    els.responseMs.textContent   = '';
    return;
  }
  els.responseText.textContent = text;
  els.responseMs.textContent   = ms ? `(${ms}ms)` : '';
  log(`Response received (${text.length} chars${ms ? ', ' + ms + 'ms' : ''})`, 'accent');
}

els.btnCopyResponse.addEventListener('click', () => {
  navigator.clipboard.writeText(els.responseText.textContent)
    .then(() => log('Copied to clipboard', 'ok'));
});

els.btnClearLog.addEventListener('click', () => { els.log.innerHTML = ''; });

// ── Context recovery ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'SW_READY') log('✓ Background reconnected', 'ok');
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message ?? String(e.reason);
  if (msg.includes('Extension context invalidated')) {
    e.preventDefault();
    state.injected = false; state.debuggerOn = false;
    updateBadge();
    if (!$('ctx-banner')) {
      const b = document.createElement('div');
      b.id = 'ctx-banner';
      b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#2a1500;border-top:1px solid #f59e0b;color:#fbbf24;font-size:12px;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;';
      b.innerHTML = '<span>⚠ Extension reloaded — reload the claude.ai tab to restore window.cf</span><button onclick="this.parentElement.remove()" style="background:none;border:1px solid #f59e0b;color:#fbbf24;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Dismiss</button>';
      document.body.appendChild(b);
    }
    log('⚠ Extension context invalidated — reload the claude.ai tab', 'warn');
    setTimeout(checkCfReady, 1000);
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
log('Sentinel DevTools ready.', 'accent');
log(`Tab ${state.tabId}`, 'dim');
updateBadge();
setTimeout(checkCfReady, 800);
