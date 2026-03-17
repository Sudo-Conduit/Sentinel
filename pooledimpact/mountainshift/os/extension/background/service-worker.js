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
