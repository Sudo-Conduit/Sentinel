// background/service-worker.js
// Handles:
//   1. Injecting ClaudeForm.js into a claude.ai tab via scripting API
//   2. Attaching / detaching chrome.debugger
//   3. Forwarding CDP commands to the debugger target

'use strict';

// Track which tabs have the debugger attached
const debuggerTabs = new Set();

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {

    case 'ATTACH_DEBUGGER':
      handleAttachDebugger(msg.tabId).then(sendResponse);
      return true;

    case 'DETACH_DEBUGGER':
      handleDetachDebugger(msg.tabId).then(sendResponse);
      return true;

    case 'CDP_COMMAND':
      handleCdpCommand(msg.tabId, msg.method, msg.params).then(sendResponse);
      return true;

    default:
      sendResponse({ ok: false, error: 'Unknown message type: ' + msg.type });
  }
});

// ── Attach debugger ───────────────────────────────────────────────────────────
async function handleAttachDebugger(tabId) {
  if (debuggerTabs.has(tabId)) {
    return { ok: true, note: 'already attached' };
  }
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerTabs.add(tabId);
    console.log('[Sentinel] Debugger attached to tab', tabId);
    return { ok: true };
  } catch (err) {
    console.error('[Sentinel] Attach failed:', err);
    return { ok: false, error: err.message };
  }
}

// ── Detach debugger ───────────────────────────────────────────────────────────
async function handleDetachDebugger(tabId) {
  if (!debuggerTabs.has(tabId)) {
    return { ok: true, note: 'not attached' };
  }
  try {
    await chrome.debugger.detach({ tabId });
    debuggerTabs.delete(tabId);
    console.log('[Sentinel] Debugger detached from tab', tabId);
    return { ok: true };
  } catch (err) {
    console.error('[Sentinel] Detach failed:', err);
    return { ok: false, error: err.message };
  }
}

// ── Send CDP command ──────────────────────────────────────────────────────────
async function handleCdpCommand(tabId, method, params = {}) {
  if (!debuggerTabs.has(tabId)) {
    return { ok: false, error: 'Debugger not attached. Click "Attach Debugger" first.' };
  }
  try {
    const result = await chrome.debugger.sendCommand({ tabId }, method, params);
    return { ok: true, result };
  } catch (err) {
    console.error('[Sentinel] CDP command failed:', method, err);
    return { ok: false, error: err.message };
  }
}

// ── Clean up if tab closes ────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (debuggerTabs.has(tabId)) {
    debuggerTabs.delete(tabId);
    console.log('[Sentinel] Tab closed — removed from debugger set:', tabId);
  }
});

// ── Detach notice from Chrome ─────────────────────────────────────────────────
chrome.debugger.onDetach.addListener((source, reason) => {
  debuggerTabs.delete(source.tabId);
  console.log('[Sentinel] Debugger detached by Chrome:', reason, source.tabId);
});

console.log('[Sentinel] Service worker running.');

// Notify any open DevTools panels that the SW is alive
// (fires after a reload/update wakes the SW back up)
chrome.runtime.onInstalled.addListener(() => {
  broadcastToDevTools({ type: 'SW_READY' });
});

chrome.runtime.onStartup.addListener(() => {
  broadcastToDevTools({ type: 'SW_READY' });
});

function broadcastToDevTools(msg) {
  // Send to all extension views (DevTools panels, popups, etc.)
  chrome.runtime.sendMessage(msg).catch(() => {}); // ignore if no listeners
}

// ── GET_COOKIE ────────────────────────────────────────────────────────────────
// Reads claude.ai cookies (including HttpOnly) and relays to content script
// which broadcasts on sentinel-relay BroadcastChannel → CookieWiggle receives it

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'GET_COOKIE') return;

  chrome.cookies.getAll({ url: 'https://claude.ai' }, (cookies) => {
    if (!cookies || !cookies.length) {
      sendResponse({ ok: false, error: 'No cookies found for claude.ai' });
      return;
    }

    // Log all cookies for debugging
    console.log('[Sentinel] claude.ai cookies:', cookies.map(c => ({
      name: c.name,
      length: c.value.length,
      httpOnly: c.httpOnly,
      secure: c.secure
    })));

    // Priority: HttpOnly session tokens first, then longest value
    const priority = [
      '__Secure-next-auth.session-token',
      'next-auth.session-token',
      '__Host-next-auth.csrf-token',
      'sessionKey',
      'session',
    ];

    let found = null;
    for (const name of priority) {
      const c = cookies.find(c => c.name === name);
      if (c) { found = c; break; }
    }

    // Fallback: longest HttpOnly cookie
    if (!found) {
      found = cookies
        .filter(c => c.httpOnly)
        .sort((a, b) => b.value.length - a.value.length)[0];
    }

    // Final fallback: longest cookie of any type
    if (!found) {
      found = cookies.sort((a, b) => b.value.length - a.value.length)[0];
    }

    if (!found) {
      sendResponse({ ok: false, error: 'Could not identify session cookie' });
      return;
    }

    console.log(`[Sentinel] Selected cookie: ${found.name} (${found.value.length} chars, httpOnly:${found.httpOnly})`);

    // Relay to the active claude.ai tab's content script
    chrome.tabs.query({ url: 'https://claude.ai/*', active: true }, (tabs) => {
      const tab = tabs[0];
      if (tab) {
        chrome.tabs.sendMessage(tab.id, {
          type:   'RELAY_COOKIE',
          name:   found.name,
          value:  found.value,
          httpOnly: found.httpOnly
        });
      }
    });

    sendResponse({ ok: true, name: found.name, length: found.value.length });
  });

  return true; // async response
});
