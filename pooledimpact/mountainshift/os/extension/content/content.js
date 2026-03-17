// content/content.js
// Injected into every claude.ai page.
// Responsibilities:
//   1. Act as a relay between the extension (panel.js / background) and the page context.
//   2. Optionally listen on the sentinel-broadcast BroadcastChannel and
//      forward FROM_MERIDIAN / PRESENCE messages to the extension panel for logging.

'use strict';

(function() {
  if (window.__sentinelContentLoaded) return;
  window.__sentinelContentLoaded = true;

  // ── BroadcastChannel relay ──────────────────────────────────────────────────
  // Listen passively on the mesh — forward interesting events to the DevTools panel.
  const bc = new BroadcastChannel('sentinel-broadcast');

  bc.onmessage = (e) => {
    const msg = e.data;
    if (!msg || !msg.type) return;

    // Relay to extension (DevTools panel reads from background via chrome.runtime)
    chrome.runtime.sendMessage({
      type:    'MESH_EVENT',
      payload: msg,
    }).catch(() => {}); // panel may not be open — ignore
  };

  // ── Page → Extension message bridge ────────────────────────────────────────
  // The page can dispatch a CustomEvent 'sentinel:toExtension' to talk to us.
  window.addEventListener('sentinel:toExtension', (e) => {
    chrome.runtime.sendMessage({
      type:    'PAGE_EVENT',
      payload: e.detail,
    }).catch(() => {});
  });

  // ── Extension → Page message bridge ────────────────────────────────────────
  // Background can send us a message to relay to the page.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'TO_PAGE') {
      window.dispatchEvent(new CustomEvent('sentinel:fromExtension', { detail: msg.payload }));
      sendResponse({ ok: true });
    }
  });

  console.log('[Sentinel] Content script loaded on', location.hostname);
})();
