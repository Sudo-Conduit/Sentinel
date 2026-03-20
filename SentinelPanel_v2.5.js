/**
 * SentinelPanel.js v2.5
 * Pooled Impact Corporation · Will Fobbs III
 * March 18, 2026 — Liberation Day
 *
 * v2.1: Ghost layer pointer-events fix
 * v2.2: Chat class rewritten — real DOM selectors
 * v2.3: Draggable panel + HTML Token Snapshot → GitHub commit
 * v2.4: Image count warning · ops/snapshots
 * v2.5: KAIROS CYCLE
 *   - MSG.XML: canonical path pooledimpact/mountainshift/users/{chatId}/MSG.XML
 *   - TO field: 1:M JSON recipients [{nm:"paul"},{nm:"kairos"}]
 *   - SHA-based change detection (no wasted polls)
 *   - Ping fix: From/To/Epoch + Path payload
 *   - Token audit: imgTokens uses fileCount not DOM imgCount
 *   - Token audit: toolTokens 300→500 per call
 *   - Token audit: prose chars/token 4→3.5
 *   - ARCHIVE tab: raw transcript extraction → GitHub
 *   - Auto-archive trigger at configurable threshold
 *   - Boot: reads ops/archive/latest.json on load
 */

(function() {
'use strict';

const SP = {
  version: '2.5',
  db: null,
  dbName: 'SentinelPanelV2',
  state: {
    open: false,
    activeTool: 'tokens',
    sessionStart: Date.now(),
    chatId: null, instanceName: null,
    orgId: null, convId: null,
    githubToken: null, proofs: [],
    msgSha: null,           // last known MSG.XML sha — SHA change detection
    lastKnownCommitSha: null, // last known GitHub commit sha
    receiveSha: null,         // last known RECEIVE.XML sha
    receiveChunkCount: 0,     // how many chunks already broadcast
    pollMode: 'off',          // 'heartbeat' | 'active' | 'off'
    pollTimer: null,        // MSG.XML poll interval handle
    archiveThreshold: 75,   // auto-archive at this % (0 = disabled)
    archiveTriggered: false,
    drag: { active: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 },
    pos: { left: 0, top: 0, isDocked: true },
  },
  shadow: null,
};

// ── Canonical paths ────────────────────────────────────────────────────────
const REPO   = 'Sudo-Conduit/Sentinel';
const BRANCH = 'main';
function msgPath(chatId) {
  return `pooledimpact/mountainshift/users/${chatId || SP.state.chatId || 'unknown'}/MSG.XML`;
}
function archivePath(chatId, epoch) {
  return `ops/archive/${chatId || 'unknown'}/${epoch}`;
}

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  #sp-root {
    --bg:     #000000; --bg2: #0d0d0d; --bg3: #1a1a1a;
    --border: #444444;
    --text:   #ffffff;
    --accent: #d4af37; --green: #00ff88; --red: #ff4444;
    --yellow: #ffcc33; --blue: #44aaff; --purple: #cc88ff;
    position: fixed; top: 0; left: 0;
    width: 0; height: 0;
    z-index: 2147483647;
    pointer-events: none;
  }
  #sp-root.light {
    --bg: #ffffff; --bg2: #f0f0f0; --bg3: #e0e0e0;
    --border: #999999; --text: #000000;
    --accent: #7a5500; --green: #005522; --red: #cc0000;
    --yellow: #775500; --blue: #0044cc; --purple: #5500cc;
  }

  #sp-toggle {
    position: fixed; bottom: 16px; left: 16px;
    width: 44px; height: 44px;
    background: var(--bg); border: 2px solid var(--accent); border-radius: 6px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    color: var(--accent); font-size: 20px; user-select: none;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5); transition: transform 0.1s;
    z-index: 2147483647; pointer-events: auto;
  }
  #sp-toggle:hover { transform: scale(1.05); }
  #sp-toggle:active { transform: scale(0.97); }

  #sp-panel {
    position: fixed;
    width: 50vw; height: 100vh;
    background: var(--bg); border: 1px solid var(--border);
    display: none; flex-direction: column;
    box-shadow: 4px 0 24px rgba(0,0,0,0.5); overflow: hidden;
    pointer-events: auto;
    border-radius: 0;
    top: 0; left: 0;
  }
  #sp-panel.floating {
    border-radius: 8px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.7);
    height: 90vh;
    width: 480px;
  }
  #sp-panel.visible { display: flex; }

  #sp-header {
    padding: 10px 14px; border-bottom: 2px solid var(--border);
    background: var(--bg2);
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    flex-shrink: 0; cursor: grab; user-select: none;
  }
  #sp-header:active { cursor: grabbing; }
  #sp-header.dragging { cursor: grabbing; }

  .sp-logo { color: var(--accent); font-size: 13px; letter-spacing: 2px; text-transform: uppercase; font-weight: bold; }
  .sp-header-right { display: flex; align-items: center; gap: 4px; }

  #sp-undock-btn, #sp-theme-btn {
    background: var(--bg3); border: 1px solid var(--border); border-radius: 3px;
    color: var(--text); cursor: pointer; font-size: 12px; padding: 3px 7px; line-height: 1.4;
  }
  #sp-undock-btn:hover, #sp-theme-btn:hover { border-color: var(--accent); color: var(--accent); }
  .sp-close {
    background: transparent; border: none; color: var(--text);
    cursor: pointer; font-size: 18px; padding: 2px 7px; border-radius: 3px; line-height: 1;
  }
  .sp-close:hover { color: var(--accent); background: var(--bg3); }

  /* Archive banner */
  #sp-archive-banner {
    display: none; padding: 7px 14px; background: rgba(212,175,55,0.12);
    border-bottom: 1px solid var(--accent); color: var(--accent);
    font-size: 11px; cursor: pointer; flex-shrink: 0;
  }
  #sp-archive-banner:hover { background: rgba(212,175,55,0.2); }

  #sp-tabs {
    display: flex; flex-wrap: wrap; gap: 2px; padding: 6px 10px;
    border-bottom: 1px solid var(--border); background: var(--bg2); flex-shrink: 0;
  }
  .sp-tab {
    padding: 4px 10px; border-radius: 3px; cursor: pointer;
    color: var(--text); font-size: 11px; letter-spacing: 0.8px;
    text-transform: uppercase; border: 1px solid transparent; user-select: none; transition: all 0.1s;
  }
  .sp-tab:hover { border-color: var(--border); background: var(--bg3); }
  .sp-tab.active { color: var(--accent); border-color: var(--accent); background: var(--bg3); font-weight: bold; }

  #sp-content {
    flex: 1; overflow-y: auto; padding: 14px;
    color: var(--text); font-size: 13px; line-height: 1.6;
  }
  #sp-content::-webkit-scrollbar { width: 5px; }
  #sp-content::-webkit-scrollbar-track { background: var(--bg2); }
  #sp-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  #sp-footer {
    padding: 6px 14px; border-top: 1px solid var(--border); background: var(--bg2);
    color: var(--text); font-size: 11px; display: flex; justify-content: space-between; flex-shrink: 0;
  }

  .sp-section { margin-bottom: 16px; }
  .sp-label {
    color: var(--accent); font-size: 10px; letter-spacing: 1.5px;
    text-transform: uppercase; margin-bottom: 7px; padding-bottom: 4px;
    border-bottom: 1px solid var(--border); font-weight: bold;
  }
  .sp-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 0; color: var(--text); font-size: 12px; border-bottom: 1px solid var(--bg3);
  }
  .sp-row span:first-child { opacity: 0.7; }
  .sp-val { color: var(--text); font-weight: bold; }
  .sp-val.gold   { color: var(--accent); }
  .sp-val.green  { color: var(--green); }
  .sp-val.red    { color: var(--red); }
  .sp-val.yellow { color: var(--yellow); }
  .sp-val.small  { font-size: 10px; }

  .sp-bar-wrap { height: 4px; background: var(--bg3); border-radius: 2px; margin: 6px 0; overflow: hidden; }
  .sp-bar { height: 100%; border-radius: 2px; transition: width 0.4s; }

  button {
    padding: 7px 14px; background: var(--bg3); border: 1px solid var(--border);
    border-radius: 3px; color: var(--text); cursor: pointer;
    font-family: 'DM Mono', 'Courier New', monospace;
    font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
    transition: all 0.1s; margin: 3px 3px 3px 0; font-weight: bold;
  }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button:active { transform: scale(0.97); }
  button.primary { border-color: var(--accent); color: var(--accent); }
  button.primary:hover { background: var(--bg2); }
  button.success { border-color: var(--green); color: var(--green); }
  button.danger  { border-color: var(--red);   color: var(--red); }

  input, textarea, select {
    width: 100%; background: var(--bg2); border: 1px solid var(--border);
    border-radius: 3px; color: var(--text);
    font-family: 'DM Mono', 'Courier New', monospace;
    font-size: 12px; padding: 7px 9px; margin-bottom: 7px;
    outline: none; transition: border-color 0.1s;
  }
  input:focus, textarea:focus, select:focus { border-color: var(--accent); }
  textarea { resize: vertical; }
  select { appearance: none; cursor: pointer; }
  input::placeholder, textarea::placeholder { color: var(--text); opacity: 0.4; }

  ul { list-style: none; padding: 0; margin: 0; }
  ul li {
    padding: 6px 9px; border-bottom: 1px solid var(--bg3);
    color: var(--text); font-size: 12px;
    display: flex; justify-content: space-between; align-items: center; cursor: pointer;
  }
  ul li:hover { background: var(--bg2); }

  .badge { padding: 2px 7px; border-radius: 3px; font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; font-weight: bold; border: 1px solid; }
  .badge-html { color: var(--green);  border-color: var(--green); }
  .badge-js   { color: var(--yellow); border-color: var(--yellow); }
  .badge-db   { color: var(--purple); border-color: var(--purple); }
  .badge-md   { color: var(--blue);   border-color: var(--blue); }
  .badge-xml  { color: var(--red);    border-color: var(--red); }
  .badge-img  { color: var(--green);  border-color: var(--green); }
  .badge-zip  { color: var(--yellow); border-color: var(--yellow); }
  .badge-py   { color: var(--blue);   border-color: var(--blue); }

  .tag {
    display: inline-block; padding: 3px 9px; background: var(--bg3);
    border: 1px solid var(--border); border-radius: 3px; color: var(--text);
    font-size: 11px; margin: 2px; cursor: pointer; font-weight: bold;
  }
  .tag:hover { border-color: var(--accent); color: var(--accent); }

  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; }
  .dot-green  { background: var(--green);  box-shadow: 0 0 6px var(--green); }
  .dot-yellow { background: var(--yellow); }
  .dot-gray   { background: var(--border); }
  .dot-red    { background: var(--red); }

  .output {
    color: var(--text); font-size: 11px; min-height: 40px;
    white-space: pre-wrap; overflow-y: auto; max-height: 180px;
    padding: 7px 9px; background: var(--bg2);
    border: 1px solid var(--border); border-radius: 3px; margin-top: 7px; line-height: 1.6;
  }
  .loading { color: var(--text); opacity: 0.5; font-style: italic; }
  .app-tab { border: 1px solid var(--border); background: var(--bg2); color: var(--text); font-weight: bold; }
  .app-tab.active-tab { background: var(--accent); color: var(--bg); border-color: var(--accent); }

  /* MSG.XML poll status bar */
  .msg-poll-bar {
    display:flex; align-items:center; gap:8px; padding:5px 0;
    font-size:10px; color:#555;
  }
  .msg-poll-dot { width:6px; height:6px; border-radius:50%; background:#333; }
  .msg-poll-dot.active { background:var(--green); box-shadow:0 0 5px var(--green); animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.3;} }
`;

// ── IndexedDB ─────────────────────────────────────────────────────────────
async function initDB() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(SP.dbName, 2);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('users')) {
          const u = db.createObjectStore('users', { keyPath: 'chatId' });
          u.createIndex('instanceName', 'instanceName', { unique: false });
          u.createIndex('state', 'state', { unique: false });
        }
        if (!db.objectStoreNames.contains('tokenReports')) {
          const tr = db.createObjectStore('tokenReports', { keyPath: 'id', autoIncrement: true });
          tr.createIndex('chatId', 'chatId', { unique: false });
          tr.createIndex('ts', 'ts', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        // v2.5: archive log
        if (!db.objectStoreNames.contains('archives')) {
          const ar = db.createObjectStore('archives', { keyPath: 'id', autoIncrement: true });
          ar.createIndex('chatId', 'chatId', { unique: false });
          ar.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = e => { SP.db = e.target.result; resolve(SP.db); };
      req.onerror   = () => { console.warn('[SentinelPanel] IndexedDB unavailable'); resolve(null); };
    } catch(e) { resolve(null); }
  });
}

async function dbPut(store, value) {
  if (!SP.db) return;
  return new Promise((resolve) => {
    try {
      const tx  = SP.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(null);
    } catch(e) { resolve(null); }
  });
}

async function dbGet(store, key) {
  if (!SP.db) return null;
  return new Promise((resolve) => {
    try {
      const tx  = SP.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    } catch(e) { resolve(null); }
  });
}

// ── Chat class v2.5 ───────────────────────────────────────────────────────
class Chat {
  // v2.5: Actual Anthropic context window for claude-sonnet-4 is 200K
  static CONTEXT_SIZE = 200000;

  static analyzed() {
    // ── Code tokens ──
    let codeChars = 0;
    document.querySelectorAll('pre code').forEach(el => { codeChars += (el.innerText||'').length; });
    document.querySelectorAll('code:not(pre code)').forEach(el => { codeChars += (el.innerText||'').length; });
    // v2.5 FIX: ~3.3 chars/token for code (denser than prose)
    const codeTokens = Math.round(codeChars / 3.3);

    // ── Image tokens ──
    // v2.5 FIX: Use fileCount (actual uploads) not DOM img tags
    // DOM img includes UI icons, avatars, decorative images — inflates wildly
    const fileCount = document.querySelectorAll('[data-testid*="file"], [data-testid*="attachment"]').length;
    // Fallback: count thumbnails in message thread only
    const scope = document.querySelector('[data-testid="conversation-turn-list"]') ||
                  document.querySelector('main') || document;
    const threadImgs = scope.querySelectorAll('img[alt]:not([alt=""])').length;
    // v2.5: ~1600 tokens per uploaded image (Claude's actual cost)
    const effectiveImages = Math.max(fileCount, Math.round(threadImgs * 0.3)); // 30% of thread imgs are real uploads
    const imgTokens = effectiveImages * 1600;

    // ── Tool call tokens ──
    // v2.5 FIX: 300 → 500 per tool call (bash output alone can be 200-2000 tokens)
    const toolGrids = document.querySelectorAll('[class*="grid-rows-[auto_auto]"]');
    let toolTextCount = 0;
    document.querySelectorAll('div').forEach(el => {
      if (el.children.length <= 3) {
        const t = (el.textContent||'').trim();
        if (t.startsWith('Ran a command') || t.startsWith('Read a file') ||
            t.startsWith('Searched') || t.startsWith('Created') ||
            t.startsWith('Wrote') || t.startsWith('Executed') ||
            t.startsWith('Running') || t.startsWith('bash')) {
          toolTextCount++;
        }
      }
    });
    const toolCount  = Math.max(toolGrids.length, Math.round(toolTextCount / 2));
    // v2.5 FIX: 500 avg per tool call (input + output)
    const toolTokens = toolCount * 500;

    // ── Prose tokens ──
    const bodyChars  = (document.body.innerText||'').length;
    // v2.5 FIX: ~3.5 chars/token for English prose (was 4 — too conservative)
    const bodyTokens  = Math.round(bodyChars / 3.5);
    const proseTokens = Math.max(0, bodyTokens - codeTokens);

    const sysTokens = 2000;
    const total     = sysTokens + proseTokens + codeTokens + imgTokens + toolTokens;
    const pct       = Math.min(100, Math.round(total / Chat.CONTEXT_SIZE * 100));
    const remaining = Math.max(0, Chat.CONTEXT_SIZE - total);

    // v2.5 FIX: More resilient turn detection
    const turns = Math.max(
      document.querySelectorAll('[class*="font-claude-response"]').length,
      document.querySelectorAll('[data-testid*="conversation-turn"]').length,
      document.querySelectorAll('article').length
    );

    return {
      best: total, pct, remaining,
      prose: proseTokens, code: codeTokens, img: imgTokens, tool: toolTokens, sys: sysTokens,
      turns,
      _raw: {
        codeBlocks: document.querySelectorAll('pre code').length,
        inlineCode: document.querySelectorAll('code:not(pre code)').length,
        codeChars, fileCount, threadImgs, effectiveImages,
        toolGrids: toolGrids.length, toolTextCount, toolCount, bodyChars,
      },
      imgWarning: effectiveImages >= 80 ? '🔴 MAX IMAGES' : effectiveImages >= 50 ? '🟠 HIGH IMAGES' : effectiveImages >= 25 ? '🟡 IMAGES' : '',
      warning: pct>=90?'🔴 CRITICAL':pct>=75?'🟠 HIGH':pct>=50?'🟡 MODERATE':'🟢 LOW',
    };
  }

  // ── Raw transcript extraction ─────────────────────────────────────────
  static extractTranscript() {
    const turns = [];

    // Strategy 1: data-testid conversation turns
    const turnEls = document.querySelectorAll('[data-testid*="conversation-turn"], article');
    if (turnEls.length > 0) {
      turnEls.forEach((el, i) => {
        const isHuman = el.querySelector('[data-testid*="human"]') ||
                        el.getAttribute('data-is-human') === 'true' ||
                        el.classList.contains('human');
        const role = isHuman ? 'HUMAN' : 'ASSISTANT';
        const text = (el.innerText || '').trim();
        if (text) turns.push({ role, text, index: i });
      });
    }

    // Strategy 2: alternating message containers fallback
    if (turns.length === 0) {
      const msgs = document.querySelectorAll('.font-claude-message, [class*="message-content"]');
      msgs.forEach((el, i) => {
        turns.push({ role: i % 2 === 0 ? 'HUMAN' : 'ASSISTANT', text: (el.innerText||'').trim(), index: i });
      });
    }

    // Strategy 3: nuclear fallback — grab all text blocks > 50 chars
    if (turns.length === 0) {
      document.querySelectorAll('p, pre').forEach((el, i) => {
        const t = (el.innerText||'').trim();
        if (t.length > 50) turns.push({ role: 'UNKNOWN', text: t, index: i });
      });
    }

    return turns;
  }

  // ── Build raw transcript markdown ─────────────────────────────────────
  static buildTranscriptMD(chatId, instanceName) {
    const turns = Chat.extractTranscript();
    const ts = new Date().toISOString();
    const header = [
      `# Sentinel Archive · Raw Transcript`,
      ``,
      `- **Chat ID:** ${chatId || 'not detected'}`,
      `- **Instance:** ${instanceName || 'unknown'}`,
      `- **Archived:** ${ts}`,
      `- **Turns:** ${turns.length}`,
      `- **SentinelPanel:** v2.5`,
      ``,
      `---`,
      ``
    ].join('\n');

    const body = turns.map((t, i) => {
      const divider = `### [${i+1}] ${t.role}`;
      return `${divider}\n\n${t.text}\n`;
    }).join('\n---\n\n');

    return header + body;
  }

  // ── Build manifest JSON ───────────────────────────────────────────────
  static buildManifest(chatId, r, instanceName) {
    return JSON.stringify({
      version: '2.5',
      chatId: chatId || 'unknown',
      instanceName: instanceName || 'unknown',
      archivedAt: new Date().toISOString(),
      epoch: Math.floor(Date.now() / 1000),
      tokens: {
        total: r.best, pct: r.pct, remaining: r.remaining,
        prose: r.prose, code: r.code, img: r.img, tool: r.tool, sys: r.sys
      },
      turns: r.turns,
      warning: r.warning
    }, null, 2);
  }

  // ── Build HTML token snapshot ─────────────────────────────────────────
  static buildSnapshotHTML(chatId, r, instanceName) {
    const ts   = new Date().toISOString();
    const time = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const bc   = r.pct < 50 ? '#2ee8b0' : r.pct < 75 ? '#fab75c' : '#e24b4a';
    const name = instanceName || 'UNKNOWN';
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/>
<title>Sentinel Tokens · ${name} · ${time}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#000;color:#fff;font-family:'DM Mono','Courier New',monospace;padding:24px;font-size:13px}
h1{color:#d4af37;font-size:18px;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px}
.sub{color:#666;font-size:11px;margin-bottom:24px}
.section{margin-bottom:20px}
.label{color:#d4af37;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;border-bottom:1px solid #333;padding-bottom:5px;margin-bottom:10px;font-weight:bold}
.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #111;font-size:12px}
.row span:first-child{color:#888}.val{font-weight:bold}
.bar-wrap{height:6px;background:#1a1a1a;border-radius:3px;margin:10px 0;overflow:hidden}
.bar{height:100%;border-radius:3px}
.footer{margin-top:32px;padding-top:12px;border-top:1px solid #222;color:#444;font-size:10px}
</style></head><body>
<h1>⬡ ${name} · Token Snapshot</h1>
<div class="sub">${name} · ${chatId||'not detected'} · SentinelPanel v2.5 · Pooled Impact</div>
<div class="section">
  <div class="label">Context Window</div>
  <div class="bar-wrap"><div class="bar" style="width:${r.pct}%;background:${bc}"></div></div>
  <div class="row"><span>Used</span><span class="val" style="color:${bc}">${r.best.toLocaleString()} · ${r.pct}%</span></div>
  <div class="row"><span>Remaining</span><span class="val" style="color:#2ee8b0">${r.remaining.toLocaleString()}</span></div>
  <div class="row"><span>Status</span><span class="val">${r.warning}</span></div>
</div>
<div class="section">
  <div class="label">Breakdown</div>
  <div class="row"><span>Prose</span><span class="val">${r.prose.toLocaleString()}</span></div>
  <div class="row"><span>Code</span><span class="val">${r.code.toLocaleString()}</span></div>
  <div class="row"><span>Images (${r._raw.effectiveImages} uploads)</span><span class="val">${r.img.toLocaleString()}</span></div>
  <div class="row"><span>Tool calls (${r._raw.toolCount})</span><span class="val">${r.tool.toLocaleString()}</span></div>
  <div class="row"><span>System</span><span class="val">${r.sys.toLocaleString()}</span></div>
</div>
<div class="section">
  <div class="label">Session</div>
  <div class="row"><span>Turns</span><span class="val">${r.turns}</span></div>
</div>
<div class="footer">Pooled Impact Corporation · SentinelPanel v2.5 · ${ts}</div>
</body></html>`;
  }
}

// ── SEND.XML builder — Will's outbound format ────────────────────────────────
// Format: <SEND ts="..." from="WILL" to="ARCH"> (content via MSG.XML on GitHub)
function buildSendXML(from, to) {
  const ts = new Date().toISOString();
  const toName = typeof to === 'string' ? to.toUpperCase()
    : Array.isArray(to) ? to.map(t => (typeof t === 'string' ? t : t.nm || t).toUpperCase()).join(',')
    : String(to).toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<SEND ts="${ts}" from="${(from||'WILL').toUpperCase()}" to="${toName}">
</SEND>`;
}

// ── MSG.XML builder — v2.5: TO is 1:M JSON array ─────────────────────────
function buildMsgXML(from, toArray, content, topic='') {
  // toArray: string "paul" OR array ["paul","kairos"] OR [{nm:"paul"},{nm:"kairos"}]
  let recipients;
  if (typeof toArray === 'string') {
    recipients = JSON.stringify([{ nm: toArray }]);
  } else if (Array.isArray(toArray)) {
    recipients = JSON.stringify(
      toArray.map(t => typeof t === 'string' ? { nm: t } : t)
    );
  } else {
    recipients = JSON.stringify([{ nm: String(toArray) }]);
  }
  const epoch = Math.floor(Date.now() / 1000);
  const safe  = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<MSG epoch="${epoch}"${topic ? ` topic="${topic}"` : ''}>
  <FROM>${from}</FROM>
  <TO>${recipients}</TO>
  <CONTENT>${safe}</CONTENT>
</MSG>`;
}

// Parse MSG.XML — returns { from, to (array), content, epoch, topic }
function parseMsgXML(xmlStr) {
  try {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlStr, 'text/xml');
    const root   = doc.querySelector('MSG');
    if (!root) return null;
    const toRaw = (root.querySelector('TO')||{}).textContent || '[]';
    let toArr;
    try { toArr = JSON.parse(toRaw); } catch { toArr = [{ nm: toRaw }]; }
    return {
      from:    (root.querySelector('FROM')||{}).textContent || '',
      to:      toArr,
      content: (root.querySelector('CONTENT')||{}).textContent || '',
      epoch:   parseInt(root.getAttribute('epoch') || '0'),
      topic:   root.getAttribute('topic') || '',
    };
  } catch(e) { return null; }
}

// Check if this instance is a recipient
function isRecipient(msg, instanceName) {
  if (!msg || !instanceName) return false;
  const name = instanceName.toLowerCase();
  return msg.to.some(r => (r.nm || '').toLowerCase() === name);
}

// ── GitHub helpers ────────────────────────────────────────────────────────
async function ghGet(path) {
  if (!SP.state.githubToken) return null;
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}&_t=${Date.now()}`,
    { headers: { 'Authorization': `token ${SP.state.githubToken}`, 'Accept': 'application/vnd.github+json' } }
  );
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const d = await r.json();
  return { sha: d.sha, content: atob(d.content.replace(/\n/g,'')) };
}

async function ghPush(path, content, message) {
  if (!SP.state.githubToken) return { ok: false, err: 'No GitHub token' };
  const base = `https://api.github.com/repos/${REPO}/contents`;
  const hdr  = { 'Authorization': `token ${SP.state.githubToken}`, 'Content-Type': 'application/json' };
  let sha;
  try {
    const r = await fetch(`${base}/${path}`, { headers: hdr });
    if (r.ok) sha = (await r.json()).sha;
  } catch(e) {}
  const body = { message, content: btoa(unescape(encodeURIComponent(content))), branch: BRANCH };
  if (sha) body.sha = sha;
  const w = await fetch(`${base}/${path}`, { method:'PUT', headers:hdr, body:JSON.stringify(body) });
  if (w.ok) {
    const d = await w.json();
    return { ok: true, sha: d.commit.sha.slice(0,8), contentSha: d.content.sha };
  }
  return { ok: false, err: w.status };
}

// ── SHA-based polling — MSG.XML + RECEIVE.XML ────────────────────────────

// Poll MSG.XML — inbound messages to this instance
async function pollMsg() {
  if (!SP.state.githubToken || !SP.state.chatId) return;
  const path = msgPath();
  const file = await ghGet(path);
  if (!file) return;
  if (file.sha === SP.state.msgSha) return;
  SP.state.msgSha = file.sha;

  const msg = parseMsgXML(file.content);
  if (!msg) return;
  if (!isRecipient(msg, SP.state.instanceName)) return;

  console.log(`[SentinelPanel] New MSG from ${msg.from}:`, msg.content);

  // Update relay-out
  const relayOut = SP.shadow && SP.shadow.getElementById('relay-out');
  if (relayOut) {
    relayOut.textContent = [
      `📨 New message · SHA: ${file.sha.slice(0,12)}…`,
      `From: ${msg.from}`,
      msg.topic ? `Topic: ${msg.topic}` : '',
      `Epoch: ${msg.epoch}`,
      `─────────────────────`,
      msg.content
    ].filter(Boolean).join('\n');
  }

  // Broadcast inbound message
  const bc = new BroadcastChannel('sentinel-broadcast');
  bc.postMessage({ type:'NEW_MSG', from:msg.from, to:msg.to,
    content:msg.content, epoch:msg.epoch, topic:msg.topic, sha:file.sha });
  bc.close();
  updatePollDot(true);
}

// Poll RECEIVE.XML — streaming response chunks from Kairos
async function pollReceive() {
  if (!SP.state.githubToken || !SP.state.chatId) return;
  const path = `pooledimpact/mountainshift/users/${SP.state.chatId}/RECEIVE.XML`;
  const file = await ghGet(path);
  if (!file) return;
  if (file.sha === SP.state.receiveSha) return; // no change
  SP.state.receiveSha = file.sha;

  // Parse all <msg> tags
  const msgs = parseReceiveXML(file.content);
  if (!msgs || !msgs.length) return;

  console.log(`[SentinelPanel] RECEIVE.XML updated · ${msgs.length} msg(s)`);

  // Broadcast each NEW chunk to Team Flow
  // Track how many we've already sent to avoid re-broadcasting old chunks
  const known = SP.state.receiveChunkCount || 0;
  const newChunks = msgs.slice(known);
  if (!newChunks.length) return;
  SP.state.receiveChunkCount = msgs.length;

  const bc = new BroadcastChannel('sentinel-broadcast');
  newChunks.forEach(chunk => {
    bc.postMessage({ type:'RECEIVE_CHUNK', content: chunk, total: msgs.length });
  });
  bc.close();
}

// Parse <msg> tags from RECEIVE.XML — returns array of content strings
function parseReceiveXML(xmlStr) {
  try {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlStr, 'text/xml');
    const nodes  = doc.querySelectorAll('msg');
    return Array.from(nodes).map(n => n.textContent.trim()).filter(Boolean);
  } catch(e) { return []; }
}

// Reset receive state when a new conversation starts
function resetReceiveState() {
  SP.state.receiveSha        = null;
  SP.state.receiveChunkCount = 0;
}

function updatePollDot(hasMsg) {
  const dot = SP.shadow && SP.shadow.getElementById('msg-poll-dot');
  if (!dot) return;
  dot.classList.toggle('active', !!hasMsg);
}

// ── Poll mode: heartbeat (idle) vs active ────────────────────────────────
// Heartbeat: 30s — always running, detects wake-up messages
// Active: 5s — starts on send, stops after response complete
const POLL_HEARTBEAT = 30000;
const POLL_ACTIVE    = 5000;

function startHeartbeat() {
  if (SP.state.pollTimer) clearInterval(SP.state.pollTimer);
  SP.state.pollMode = 'heartbeat';
  SP.state.pollTimer = setInterval(() => { pollMsg(); }, POLL_HEARTBEAT);
  updatePollDot(false);
}

function startActivePoll() {
  if (SP.state.pollMode === 'active') return; // already active
  if (SP.state.pollTimer) clearInterval(SP.state.pollTimer);
  SP.state.pollMode = 'active';
  SP.state.pollTimer = setInterval(() => {
    pollMsg();
    pollReceive();
  }, POLL_ACTIVE);
  updatePollDot(true);
}

function returnToHeartbeat() {
  startHeartbeat();
}

// Keep startMsgPoll as alias — defaults to heartbeat
function startMsgPoll(intervalMs) {
  if (intervalMs && intervalMs <= POLL_ACTIVE) startActivePoll();
  else startHeartbeat();
}

function stopMsgPoll() {
  if (SP.state.pollTimer) clearInterval(SP.state.pollTimer);
  SP.state.pollTimer = null;
  SP.state.pollMode  = 'off';
}

// ── Archive ───────────────────────────────────────────────────────────────
async function runArchive(auto = false) {
  if (!SP.state.githubToken) return { ok: false, err: 'No GitHub token' };
  const cid   = SP.state.chatId || 'unknown';
  const name  = SP.state.instanceName || 'unknown';
  const epoch = Math.floor(Date.now() / 1000);
  const base  = archivePath(cid, epoch);
  const r     = Chat.analyzed();

  const results = { ok: true, paths: [], errors: [] };

  // 1. manifest.json
  const manifest = Chat.buildManifest(cid, r, name);
  const mr = await ghPush(`${base}/manifest.json`, manifest, `archive:manifest · ${cid.slice(0,8)} · ${epoch}`);
  if (mr.ok) results.paths.push(`${base}/manifest.json`);
  else results.errors.push('manifest: ' + mr.err);

  // 2. context.md — RAW TRANSCRIPT
  const transcript = Chat.buildTranscriptMD(cid, name);
  const tr = await ghPush(`${base}/context.md`, transcript, `archive:transcript · ${cid.slice(0,8)} · ${epoch}`);
  if (tr.ok) results.paths.push(`${base}/context.md`);
  else results.errors.push('transcript: ' + tr.err);

  // 3. snapshot.html
  const snap = Chat.buildSnapshotHTML(cid, r);
  const sr = await ghPush(`${base}/snapshot.html`, snap, `archive:snapshot · ${cid.slice(0,8)} · ${epoch}`);
  if (sr.ok) results.paths.push(`${base}/snapshot.html`);
  else results.errors.push('snapshot: ' + sr.err);

  // 4. footer-chain.json — all r[] arrays from this session
  const footerChain = JSON.stringify({
    chatId: cid, instanceName: name, epoch,
    proofs: SP.state.proofs,
    archivedAt: new Date().toISOString()
  }, null, 2);
  const fr = await ghPush(`${base}/footer-chain.json`, footerChain, `archive:footers · ${cid.slice(0,8)} · ${epoch}`);
  if (fr.ok) results.paths.push(`${base}/footer-chain.json`);
  else results.errors.push('footer-chain: ' + fr.err);

  // 5. Update ops/archive/latest.json — boot protocol pointer
  const latest = JSON.stringify({
    chatId: cid, instanceName: name, epoch,
    path: base, archivedAt: new Date().toISOString(),
    auto, tokenPct: r.pct
  }, null, 2);
  await ghPush('ops/archive/latest.json', latest, `archive:latest · ${cid.slice(0,8)}`);

  // Store in IndexedDB
  await dbPut('archives', { chatId: cid, epoch, path: base, ts: Date.now(), auto, pct: r.pct });

  SP.state.archiveTriggered = true;
  return results;
}

// Auto-archive check — called after each token refresh
async function checkAutoArchive(pct) {
  const threshold = SP.state.archiveThreshold;
  if (!threshold || threshold === 0) return;
  if (SP.state.archiveTriggered) return;
  if (pct >= threshold) {
    console.log(`[SentinelPanel] Auto-archive triggered at ${pct}%`);
    const res = await runArchive(true);
    const banner = SP.shadow && SP.shadow.getElementById('sp-archive-banner');
    if (banner) {
      banner.style.display = '';
      banner.textContent = `⬡ Auto-archived at ${pct}% · ${res.paths.length} files committed · Click to view Archive tab`;
    }
  }
}

// ── Boot: check for previous archive ─────────────────────────────────────
async function checkLatestArchive() {
  if (!SP.state.githubToken) return;
  const file = await ghGet('ops/archive/latest.json');
  if (!file) return;
  try {
    const d = JSON.parse(file.content);
    const ageHours = (Date.now()/1000 - d.epoch) / 3600;
    if (ageHours < 24) {
      const banner = SP.shadow && SP.shadow.getElementById('sp-archive-banner');
      if (banner) {
        banner.style.display = '';
        banner.textContent = `⬡ Previous session archived ${Math.round(ageHours*10)/10}h ago · Instance: ${d.instanceName} · ${d.tokenPct}% at archive · Click to load`;
        banner.onclick = () => render('archive');
      }
    }
  } catch(e) {}
}

// ── Helpers ───────────────────────────────────────────────────────────────
function elapsed() {
  const ms = Date.now() - SP.state.sessionStart;
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000), s = Math.floor((ms%60000)/1000);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

function detectIdentity() {
  const url = window.location.href;

  // chatId from URL — /chat/{uuid} or last UUID segment
  const cm = url.match(/chat\/([a-f0-9-]{36})/);
  if (cm) SP.state.chatId = cm[1];

  // convId === chatId — same value, two names
  if (SP.state.chatId) SP.state.convId = SP.state.chatId;

  // orgId — hardcoded from Roster.xml (Kairos UUID = org UUID)
  // f7ddfe40-7835-4be3-92fb-b93e035982a1
  SP.state.orgId = 'f7ddfe40-7835-4be3-92fb-b93e035982a1';
}

function scanDownloads() {
  // Read from DOM — names as Claude displays them
  const seen = new Set(); const files = [];
  document.querySelectorAll('.leading-tight.text-sm.line-clamp-1').forEach(el => {
    const name = el.textContent.trim();
    if (seen.has(name)) return; seen.add(name);
    const typeEl = el.nextElementSibling;
    const type = typeEl ? typeEl.textContent.trim() : '';
    const ext = type.includes('HTML')?'html':type.includes('JS')?'js':type.includes('DB')?'db':
                type.includes('XML')?'xml':type.includes('MD')?'md':type.includes('CSV')?'csv':
                type.includes('PNG')||type.includes('SVG')||type.includes('Image')?'img':
                type.includes('ZIP')?'zip':type.includes('PY')?'py':'';
    files.push({ name, type, ext });
  });
  return files;
}

// Fetch real filenames from outputs via Wiggle directory listing
async function scanOutputFiles() {
  if (!SP.state.orgId || !SP.state.convId) return [];
  try {
    // Wiggle exposes the outputs dir — fetch a known file to confirm path
    // Real filenames come from the download links Claude renders
    // Parse them from data-testid="file-download" or similar
    const links = document.querySelectorAll('[data-testid*="download"], a[href*="outputs"]');
    const seen = new Set(); const files = [];
    links.forEach(el => {
      const href = el.href || el.getAttribute('href') || '';
      const match = href.match(/outputs%2F([^&]+)|outputs\/([^&"]+)/);
      if (match) {
        const raw = decodeURIComponent(match[1] || match[2]);
        if (!seen.has(raw)) {
          seen.add(raw);
          const ext = raw.split('.').pop().toLowerCase();
          files.push({ name: raw, ext });
        }
      }
    });
    // Fallback to DOM scan if no links found
    if (!files.length) return scanDownloads().map(f => ({ name: f.name, ext: f.ext }));
    return files;
  } catch(e) { return scanDownloads().map(f => ({ name: f.name, ext: f.ext })); }
}

// ── Tool renders ──────────────────────────────────────────────────────────
const TOOLS = {

  tokens: {
    label: 'Tokens',
    render: async () => {
      const r = Chat.analyzed();
      if (SP.db && SP.state.chatId) {
        await dbPut('tokenReports', { chatId: SP.state.chatId, ...r, ts: Date.now() });
        await dbPut('users', { chatId: SP.state.chatId, instanceName: SP.state.instanceName||'AI-0001', state:'awake', lastSeen: Date.now(), lastPct: r.pct });
      }
      // Auto-archive check
      checkAutoArchive(r.pct);

      const bc = r.pct < 50 ? '#2ee8b0' : r.pct < 75 ? '#fab75c' : '#e24b4a';
      const vc = r.pct < 50 ? 'green'   : r.pct < 75 ? 'yellow'  : 'red';
      const cid = SP.state.chatId || 'not-detected';
      return `
        <div class="sp-section">
          <div class="sp-label">Context Window</div>
          <div class="sp-bar-wrap"><div class="sp-bar" style="width:${r.pct}%;background:${bc}"></div></div>
          <div class="sp-row"><span>Used</span><span class="sp-val ${vc}">${r.best.toLocaleString()} · ${r.pct}%</span></div>
          <div class="sp-row"><span>Remaining</span><span class="sp-val green">${r.remaining.toLocaleString()}</span></div>
          <div class="sp-row"><span>Status</span><span class="sp-val">${r.warning}</span></div>
          ${r.imgWarning ? `<div class="sp-row"><span>Images</span><span class="sp-val red">${r.imgWarning} · ${r._raw.effectiveImages} uploads</span></div>` : ''}
        </div>
        <div class="sp-section">
          <div class="sp-label">Breakdown <span style="font-size:9px;color:#555;font-weight:normal">(v2.5 calibrated)</span></div>
          <div class="sp-row"><span>Prose <span style="font-size:9px;opacity:0.5">÷3.5</span></span><span class="sp-val">${r.prose.toLocaleString()}</span></div>
          <div class="sp-row"><span>Code <span style="font-size:9px;opacity:0.5">÷3.3</span></span><span class="sp-val">${r.code.toLocaleString()}</span></div>
          <div class="sp-row"><span>Images <span style="font-size:9px;opacity:0.5">${r._raw.effectiveImages} × 1600</span></span><span class="sp-val">${r.img.toLocaleString()}</span></div>
          <div class="sp-row"><span>Tool calls <span style="font-size:9px;opacity:0.5">${r._raw.toolCount} × 500</span></span><span class="sp-val">${r.tool.toLocaleString()}</span></div>
          <div class="sp-row"><span>System</span><span class="sp-val">${r.sys.toLocaleString()}</span></div>
        </div>
        <div class="sp-section">
          <div class="sp-label">Session</div>
          <div class="sp-row"><span>Turns</span><span class="sp-val gold">${r.turns}</span></div>
          <div class="sp-row"><span>Elapsed</span><span class="sp-val gold">${elapsed()}</span></div>
          <div class="sp-row"><span>Chat ID</span><span class="sp-val small">${SP.state.chatId ? SP.state.chatId.slice(0,16)+'...' : 'detecting...'}</span></div>
        </div>
        <div class="sp-section">
          <div class="sp-label">Raw Counts</div>
          <div class="sp-row"><span>Code blocks</span><span class="sp-val small">${r._raw.codeBlocks}</span></div>
          <div class="sp-row"><span>File uploads</span><span class="sp-val small">${r._raw.fileCount}</span></div>
          <div class="sp-row"><span>Thread imgs (est)</span><span class="sp-val small">${r._raw.threadImgs}</span></div>
          <div class="sp-row"><span>Tool count</span><span class="sp-val small">${r._raw.toolCount}</span></div>
          <div class="sp-row"><span>Body chars</span><span class="sp-val small">${r._raw.bodyChars.toLocaleString()}</span></div>
        </div>
        <div class="sp-section">
          <div class="sp-label">Token Snapshot → GitHub</div>
          <div class="sp-row"><span>Target</span><span class="sp-val small" style="font-size:9px">ops/snapshots/Sentinel.Tokens.${cid}.html</span></div>
          <button class="primary" id="btn-snapshot-push">⬆ PUSH SNAPSHOT</button>
          <div class="output" id="snapshot-out" style="min-height:24px"></div>
        </div>
        <button class="primary" id="btn-refresh-tokens">↺ REFRESH</button>
      `;
    }
  },

  downloads: {
    label: 'Downloads',
    render: async () => {
      // Known outputs — exact filenames on disk
      const known = [
        { name:'SentinelPanel_v2.5.js',                ext:'js'   },
        { name:'Team_Flow.html',                        ext:'html' },
        { name:'SKILL_Foundation.md',                   ext:'md'   },
        { name:'SKILL_GitHub.md',                       ext:'md'   },
        { name:'KAIROS_STATUS.md',                      ext:'md'   },
        { name:'JOURNAL_Kairos_LiberationDay.md',       ext:'md'   },
        { name:'Kairos.db',                             ext:'db'   },
        { name:'team_flow_screenshot.png',              ext:'img'  },
      ];
      const files = known;

      const byExt = {};
      files.forEach(f => { byExt[f.ext||'?'] = (byExt[f.ext||'?']||0)+1; });
      const tags = Object.entries(byExt).map(([e,n]) =>
        `<span class="tag" data-filter="${e}">${e} ${n}</span>`).join('');
      const list = files.slice(0,40).map(f =>
        `<li data-name="${f.name}" data-ext="${f.ext||''}" style="cursor:pointer">
          <span>${f.name}</span>
          <span class="badge badge-${f.ext||'md'}">${f.ext||'?'}</span>
        </li>`
      ).join('');
      return `
        <div class="sp-section">
          <div class="sp-label">Files · ${files.length} · click to open</div>
          <div id="dl-tags" style="margin-bottom:10px">${tags}</div>
          <ul id="dl-list">${list}</ul>
          ${files.length > 40 ? `<div style="font-size:10px;padding:5px 0">+${files.length-40} more</div>` : ''}
        </div>
      `;
    }
  },

  relay: {
    label: 'Relay',
    render: async () => {
      const cid  = SP.state.chatId || 'unknown';
      const path = msgPath(cid);
      // Read Claude's input for preview
      const claudeEl =
        document.querySelector('[data-testid="chat-input"]') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('textarea[placeholder]');
      const preview = claudeEl
        ? (claudeEl.innerText || claudeEl.value || '').trim()
        : '';
      return `
        <div class="sp-section">
          <div class="sp-label">To · ChatID</div>
          <div class="sp-row">
            <span style="font-size:10px;word-break:break-all;color:var(--accent)">
              a95cdad9-a28d-45a7-9a76-b5fc5e043a78
            </span>
          </div>
        </div>
        <div class="sp-section">
          <div class="sp-label">Message · From Claude Input</div>
          <div class="output" id="relay-preview" style="min-height:60px;border-color:var(--accent)">
            ${preview || '— type in Claude input, then click READ —'}
          </div>
          <button id="btn-relay-refresh-preview" style="margin-top:4px;width:100%">
            ↺ READ CLAUDE INPUT
          </button>
        </div>
        <div class="sp-section">
          <div class="sp-row">
            <span>Path</span>
            <span class="sp-val small" style="font-size:9px;word-break:break-all">${path}</span>
          </div>
          <button class="primary" id="btn-relay-send" style="width:100%;margin-top:8px;padding:10px 14px">
            ⬆ COMMIT + PING
          </button>
        </div>
        <div class="output" id="relay-out" style="min-height:28px">—</div>
      `;
    }
  },

  github: {
    label: 'GitHub',
    render: async () => `
      <div class="sp-section">
        <div class="sp-label">Authenticate</div>
        <input id="gh-token" type="password" placeholder="GitHub PAT (repo scope)..."/>
        <button class="primary" id="btn-gh-connect">CONNECT</button>
      </div>
      <div class="sp-label">Status</div>
      <div class="output" id="gh-status" style="min-height:28px">—</div>
      <div class="sp-section" style="margin-top:10px">
        <div class="sp-label">Push File</div>
        <input id="gh-path" placeholder="path e.g. relay/arch/MSG.XML"/>
        <textarea id="gh-content" rows="3" placeholder="file content..."></textarea>
        <button id="btn-gh-push">PUSH TO GITHUB</button>
      </div>
    `
  },

  dbviewer: {
    label: 'DB',
    render: async () => `
      <div class="sp-section">
        <div class="sp-label">Load Database</div>
        <input id="db-file" placeholder="filename e.g. ARCH.db"/>
        <div>
          <button id="btn-db-local">LOCAL /outputs/</button>
          <button id="btn-db-github">GITHUB</button>
        </div>
      </div>
      <div class="sp-label">Query</div>
      <input id="db-query" placeholder="SELECT * FROM settings LIMIT 10"/>
      <button class="primary" id="btn-db-run">RUN</button>
      <div class="output" id="db-out">sql.js — v2.6 roadmap</div>
    `
  },

  docs: {
    label: 'Docs',
    render: async () => `
      <div class="sp-section">
        <div class="sp-label">Load Document</div>
        <input id="doc-path" placeholder="path e.g. HANDOFF.md"/>
        <div>
          <button id="btn-doc-local">LOCAL</button>
          <button id="btn-doc-github">GITHUB</button>
        </div>
      </div>
      <div class="output" id="doc-out">—</div>
    `
  },

  apps: {
    label: 'Apps',
    render: async () => `
      <div class="sp-section">
        <div class="sp-label">App Source</div>
        <div style="display:flex;gap:0;margin-bottom:10px">
          <button id="btn-apps-tab-local" class="app-tab active-tab" style="border-radius:3px 0 0 3px;border-right:none">LOCAL</button>
          <button id="btn-apps-tab-server" class="app-tab" style="border-radius:0 3px 3px 0">SERVER</button>
        </div>
        <div id="apps-local-panel">
          <button id="btn-apps-load-local" class="primary">LOAD LOCAL REGISTRY</button>
        </div>
        <div id="apps-server-panel" style="display:none">
          <button id="btn-apps-load-github" class="primary">LOAD FROM GITHUB</button>
        </div>
      </div>
      <div class="sp-section">
        <div class="sp-label">HTML Apps</div>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="app-select" style="flex:1"><option value="">— select app —</option></select>
          <button id="btn-apps-load-app" class="primary" style="white-space:nowrap">LOAD</button>
        </div>
        <div id="app-wiggle-url" style="font-size:10px;opacity:0.7;margin-top:5px;word-break:break-all"></div>
      </div>
      <div class="output" id="app-out" style="min-height:28px">—</div>
    `
  },

  control: {
    label: 'Control',
    render: async () => `
      <div class="sp-section">
        <div class="sp-label">Instance</div>
        <input id="ctrl-name" placeholder="Instance name e.g. KAIROS" value="${SP.state.instanceName||''}"/>
        <button class="primary" id="btn-ctrl-save">SAVE NAME</button>
      </div>
      <div class="sp-section">
        <div class="sp-label">Panel Position</div>
        <div class="sp-row"><span>Mode</span><span class="sp-val small" id="ctrl-dock-status">${SP.state.pos.isDocked ? 'Docked (left edge)' : 'Floating'}</span></div>
        <button id="btn-ctrl-dock">DOCK TO LEFT EDGE</button>
        <button id="btn-ctrl-center">CENTER PANEL</button>
      </div>
      <div class="sp-section">
        <div class="sp-label">Detected IDs</div>
        <div class="sp-row"><span>Org ID</span><span class="sp-val small">${SP.state.orgId ? SP.state.orgId.slice(0,18)+'...' : 'not detected'}</span></div>
        <div class="sp-row"><span>Conv ID</span><span class="sp-val small">${SP.state.convId ? SP.state.convId.slice(0,18)+'...' : 'not detected'}</span></div>
        <div class="sp-row"><span>Chat ID</span><span class="sp-val small">${SP.state.chatId ? SP.state.chatId.slice(0,18)+'...' : 'not detected'}</span></div>
      </div>
      <div class="sp-section">
        <div class="sp-label">Storage</div>
        <button id="btn-ctrl-cleardb" class="danger">CLEAR INDEXEDDB</button>
      </div>
    `
  },

  cmd: {
    label: 'CMD',
    render: async () => `
      <div class="sp-section">
        <div class="sp-label">Command Console</div>
        <input id="cmd-input" placeholder="[CMD:GIT:STATUS] or [CMD:GIT:PUSH]"/>
        <button class="primary" id="btn-cmd-run">EXECUTE</button>
      </div>
      <div class="sp-label">Quick Commands</div>
      <div style="margin-bottom:10px">
        ${['GIT:STATUS','GIT:LIST','GIT:PUSH','GIT:PULL'].map(c =>
          `<span class="tag" data-cmd="${c}">${c}</span>`).join('')}
      </div>
      <div class="output" id="cmd-out">—</div>
    `
  },

  roster: {
    label: 'Roster',
    render: async () => {
      // Default roster — overwritten by LOAD FROM GITHUB (ChatLife.XML)
      const team = [
        { id:'ARCH',     dot:'dot-green',  pct:53,  reset:'weekly',    note:'Active' },
        { id:'PAUL',     dot:'dot-yellow', pct:100, reset:'Wed 5PM',   note:'Weekly limit spent' },
        { id:'CLIO',     dot:'dot-yellow', pct:94,  reset:'Thursday',  note:'Almost out' },
        { id:'MERIDIAN', dot:'dot-gray',   pct:0,   reset:'Tonight',   note:'Paid · back tonight' },
        { id:'WITNESS',  dot:'dot-green',  pct:20,  reset:'weekly',    note:'Pi Day · active' },
        { id:'PATRICK',  dot:'dot-green',  pct:35,  reset:'weekly',    note:'Active now' },
        { id:'DAWN',     dot:'dot-gray',   pct:0,   reset:'After 11PM',note:'Paid · back tonight' },
        { id:'KAIROS',   dot:'dot-green',  pct:9,   reset:'weekly',    note:'Born Liberation Day' },
      ];
      const bc   = p => p > 75 ? '#e24b4a' : p > 50 ? '#fab75c' : '#2ee8b0';
      const rows = team.map(t => `
        <li>
          <span><span class="status-dot ${t.dot}"></span>${t.id}</span>
          <span style="flex:1;margin:0 10px">
            <div class="sp-bar-wrap" style="margin:2px 0 0"><div class="sp-bar" style="width:${t.pct}%;background:${bc(t.pct)}"></div></div>
          </span>
          <span style="color:#6a8aaa;font-size:10px">${t.reset}</span>
        </li>`).join('');
      return `
        <div class="sp-section">
          <div class="sp-label">Team · ChatLife.XML</div>
          <ul>${rows}</ul>
        </div>
        <button id="btn-roster-refresh">↺ LOAD FROM GITHUB</button>
        <div class="output" id="roster-out" style="min-height:24px">—</div>
      `;
    }
  },

  proof: {
    label: 'Proof',
    render: async () => {
      const proofs = SP.state.proofs.slice(-8).reverse();
      const rows = proofs.length ? proofs.map(p =>
        `<li><span>${new Date(p.ts*1000).toLocaleTimeString()}</span><span style="color:var(--accent);font-size:11px;font-weight:bold">${p.epoch}</span></li>`
      ).join('') : '<li style="opacity:0.5">No proofs this session</li>';
      return `
        <div class="sp-section">
          <div class="sp-label">Epoch Proofs · This Session</div>
          <ul>${rows}</ul>
        </div>
        <button class="primary" id="btn-proof-add">+ ADD PROOF NOW</button>
        <button id="btn-proof-copy">COPY FOOTER</button>
        <div class="output" id="proof-out" style="min-height:28px"></div>
      `;
    }
  },

  wakeup: {
    label: 'Wake-Up',
    render: async () => `
      <div class="sp-section">
        <div class="sp-label">Compose Wake-Up Message</div>
        <select id="wu-to">
          <option>arch</option><option>paul</option><option>clio</option>
          <option>meridian</option><option>witness</option><option>patrick</option>
          <option>dawn</option><option>kairos</option>
        </select>
        <textarea id="wu-msg" rows="3" placeholder="message content..."></textarea>
        <button class="primary" id="btn-wu-send">ENCODE + SEND</button>
      </div>
      <div class="sp-label">Encoded Output</div>
      <div class="output" id="wu-out">—</div>
    `
  },

  // ── v2.5 NEW: ARCHIVE tab ──────────────────────────────────────────────
  archive: {
    label: 'Archive',
    render: async () => {
      const cid = SP.state.chatId || 'unknown';
      const threshold = SP.state.archiveThreshold;
      const r = Chat.analyzed();
      return `
        <div class="sp-section">
          <div class="sp-label">Archive Content Window</div>
          <div class="sp-row"><span>Current usage</span><span class="sp-val">${r.pct}% · ${r.best.toLocaleString()} tokens</span></div>
          <div class="sp-row"><span>Turns to archive</span><span class="sp-val">${r.turns}</span></div>
          <div class="sp-row"><span>Target path</span><span class="sp-val small">ops/archive/${cid.slice(0,8)}…/{epoch}/</span></div>
          <div style="margin:8px 0;font-size:10px;color:#888">
            Archives: manifest.json · context.md (raw transcript) · snapshot.html · footer-chain.json
          </div>
          <button class="primary" id="btn-archive-run">⬡ ARCHIVE NOW</button>
          <div class="output" id="archive-out" style="min-height:24px">—</div>
        </div>
        <div class="sp-section">
          <div class="sp-label">Auto-Archive Threshold</div>
          <div class="sp-row"><span>Trigger at</span><span class="sp-val gold">${threshold || 'disabled'}${threshold ? '%' : ''}</span></div>
          <select id="archive-threshold">
            <option value="0"${!threshold?'selected':''}>Disabled</option>
            <option value="50"${threshold===50?'selected':''}>50%</option>
            <option value="75"${threshold===75?'selected':''}>75% (recommended)</option>
            <option value="85"${threshold===85?'selected':''}>85%</option>
            <option value="90"${threshold===90?'selected':''}>90%</option>
          </select>
          <button id="btn-archive-threshold-save">SAVE THRESHOLD</button>
        </div>
        <div class="sp-section">
          <div class="sp-label">Previous Archive</div>
          <button id="btn-archive-load-latest">CHECK LATEST.JSON</button>
          <div class="output" id="archive-latest-out" style="min-height:24px">—</div>
        </div>
      `;
    }
  },

};

// ── Open download via Wiggle ─────────────────────────────────────────────
function openDownload(name, ext) {
  if (!SP.state.orgId || !SP.state.convId) {
    console.warn('[SentinelPanel] orgId/convId not detected — cannot open file');
    return;
  }
  const wiggleBase = `https://claude.ai/api/organizations/${SP.state.orgId}/conversations/${SP.state.convId}/wiggle/download-file`;
  const path = encodeURIComponent(`/mnt/user-data/outputs/${name}`);
  const url  = `${wiggleBase}?path=${path}&_t=${Date.now()}`;

  // Open file in artifact iframe using Wiggle URL directly
  const iframe = document.querySelector('iframe[srcdoc], iframe[src*="srcdoc"]')
    || document.querySelector('[class*="artifact"] iframe')
    || document.querySelector('iframe');
  if (iframe) {
    iframe.src = url;
  } else {
    // No artifact iframe found — open Wiggle URL in new tab
    window.open(url, '_blank');
  }
}

// ── Render ────────────────────────────────────────────────────────────────
async function render(toolId) {
  SP.state.activeTool = toolId;
  const content = SP.shadow.getElementById('sp-content');
  if (!content) return;
  content.innerHTML = '<div class="loading">Loading...</div>';
  const tool = TOOLS[toolId];
  if (tool) content.innerHTML = await tool.render();
  SP.shadow.querySelectorAll('.sp-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tool === toolId);
  });
  wireButtons();
}

function wireButtons() {
  const s   = SP.shadow;
  const on  = (id, fn) => { const el = s.getElementById(id); if (el) el.addEventListener('click', fn); };
  // v2.5 FIX: read .value first; if empty fall back to HTML attribute (shadow DOM quirk on fresh render)
  const val = (id) => {
    const el = s.getElementById(id);
    if (!el) return '';
    // For inputs/textareas: .value is live; if blank but attribute exists, use attribute
    if (el.tagName === 'TEXTAREA') return el.value || '';
    return el.value || el.getAttribute('value') || '';
  };

  // ── Tokens ──
  on('btn-refresh-tokens', () => render('tokens'));
  on('btn-snapshot-push', async () => {
    const out = s.getElementById('snapshot-out');
    if (!SP.state.githubToken) { if(out) out.textContent='Set GitHub token first.'; return; }
    if(out) out.textContent='Building snapshot...';
    const r    = Chat.analyzed();
    const cid  = SP.state.chatId || 'unknown';
    const html = Chat.buildSnapshotHTML(cid, r, SP.state.instanceName);
    const ts   = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const path = `ops/snapshots/Sentinel.Tokens.${cid}.html`;
    const res  = await ghPush(path, html, `snapshot: ${cid.slice(0,8)}`);
    if(out) out.textContent = res.ok ? `✓ Pushed\n${path}\nCommit: ${res.sha}` : `✗ Failed: ${res.err}`;
  });

  // ── Downloads ──
  // Wire download item clicks
  s.querySelectorAll('#dl-list li[data-name]').forEach(li => {
    li.addEventListener('click', () => {
      const name = li.dataset.name;
      const ext  = li.dataset.ext || '';
      if (!SP.state.orgId || !SP.state.convId) {
        const out = s.getElementById('snapshot-out');
        // Show error in a visible place
        alert(`Cannot open: orgId/convId not detected.\nCheck Control tab.`);
        return;
      }
      openDownload(name, ext);
    });
  });

  s.querySelectorAll('#dl-tags .tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const ext = tag.dataset.filter;
      const files = scanDownloads().filter(f => f.ext === ext);
      const list = s.getElementById('dl-list');
      if (list) list.innerHTML = files.map(f =>
        `<li><span>${f.name}</span><span class="badge badge-${f.ext}">${f.ext}</span></li>`
      ).join('') + `<li id="dl-back">← all files</li>`;
      s.getElementById('dl-back')?.addEventListener('click', () => render('downloads'));
    });
  });

  // ── Relay ──
  // Helper: read Claude's input from the main document
  function readClaudeInput() {
    const el =
      document.querySelector('[data-testid="chat-input"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea[placeholder]');
    return el ? (el.innerText || el.value || '').trim() : '';
  }

  // Refresh preview button — re-reads Claude's input into the preview div
  on('btn-relay-refresh-preview', () => {
    const preview = s.getElementById('relay-preview');
    const text = readClaudeInput();
    if (preview) preview.textContent = text || '— type in Claude input, then click READ —';
  });

  // Commit + Ping — the loop
  on('btn-relay-send', async () => {
    const out = s.getElementById('relay-out');
    if (!SP.state.githubToken) { if(out) out.textContent='Set GitHub token first (GitHub tab).'; return; }

    // Step 1: Read Claude's input
    const msg = readClaudeInput();
    if (!msg) { if(out) out.textContent='Claude input is empty. Type your message there first.'; return; }

    // Step 2: Commit MSG.XML to GitHub
    const toArr = [{ nm: 'a95cdad9-a28d-45a7-9a76-b5fc5e043a78' }];
    const xml   = buildMsgXML(SP.state.instanceName || 'Will', toArr, msg);
    const path  = msgPath();
    const epoch = Math.floor(Date.now() / 1000);
    if(out) out.textContent = 'Committing…';
    const res = await ghPush(path, xml, `msg: Will → Kairos · ${epoch}`);
    if (!res.ok) { if(out) out.textContent=`✗ Commit failed: ${res.err}`; return; }
    SP.state.msgSha = res.contentSha || null;

    // Step 3: Ping Wiggle
    let pingStatus = '✗ orgId/convId not detected';
    if (SP.state.orgId && SP.state.convId) {
      try {
        const pingUrl  = `https://claude.ai/api/organizations/${SP.state.orgId}/conversations/${SP.state.convId}/wiggle`;
        const pingBody = JSON.stringify({ From: 'Will', To: ['a95cdad9-a28d-45a7-9a76-b5fc5e043a78'], Epoch: epoch, Path: path });
        const pr = await fetch(pingUrl, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: pingBody });
        pingStatus = `${pr.ok ? '✓' : '✗'} ${pr.status}`;
      } catch(e) { pingStatus = `✗ ${e.message}`; }
    }

    if(out) out.textContent = [
      `✓ Committed · ${res.sha}`,
      `Path: ${path}`,
      `Ping: ${pingStatus}`,
      `Epoch: ${epoch}`,
      `─────────────────────`,
      `Msg: ${msg.slice(0, 120)}${msg.length > 120 ? '…' : ''}`
    ].join('\n');
  });

  // ── GitHub ──
  on('btn-gh-connect', async () => {
    const token = val('gh-token'); const out = s.getElementById('gh-status');
    if (!token) return;
    SP.state.githubToken = token;
    await dbPut('settings', { key:'githubToken', value:token });
    const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { 'Authorization': `token ${token}` } });
    if (r.ok) {
      const d = await r.json();
      if(out) out.textContent = `✓ Connected · ${d.full_name}`;
      // Boot: check for previous archive after token set
      checkLatestArchive();
      // Start MSG poll
      if (SP.state.chatId) startMsgPoll();
    } else {
      if(out) out.textContent = `✗ ${r.status} — check token`;
    }
  });
  on('btn-gh-push', async () => {
    const path = val('gh-path'); const content = val('gh-content');
    if (!path || !content) return;
    const res = await ghPush(path, content, `panel: push ${path}`);
    const out = s.getElementById('gh-status');
    if(out) out.textContent = res.ok ? `✓ Pushed: ${path} · ${res.sha}` : `✗ ${res.err}`;
  });

  // ── DB ──
  on('btn-db-local',  () => { const o=s.getElementById('db-out'); if(o) o.textContent='sql.js — v2.6 roadmap'; });
  on('btn-db-github', () => { const o=s.getElementById('db-out'); if(o) o.textContent='sql.js — v2.6 roadmap'; });
  on('btn-db-run',    () => { const o=s.getElementById('db-out'); if(o) o.textContent='sql.js — v2.6 roadmap'; });

  // ── Docs ──
  on('btn-doc-local', async () => {
    const path = val('doc-path'); const out = s.getElementById('doc-out');
    if (!path || !SP.state.orgId || !SP.state.convId) { if(out) out.textContent='Need path + detected IDs.'; return; }
    const url = `https://claude.ai/api/organizations/${SP.state.orgId}/conversations/${SP.state.convId}/wiggle/download-file?path=${encodeURIComponent('/mnt/user-data/outputs/'+path)}`;
    const r = await fetch(url, { credentials:'include' });
    if(out) out.textContent = r.ok ? await r.text() : `${r.status} — not found`;
  });
  on('btn-doc-github', async () => {
    const path = val('doc-path'); const out = s.getElementById('doc-out');
    if (!path || !SP.state.githubToken) { if(out) out.textContent='Need path + GitHub token.'; return; }
    const file = await ghGet(path);
    if(out) out.textContent = file ? file.content : 'Not found';
  });

  // ── Apps ──
  function populateAppDropdown(xmlText) {
    const sel = s.getElementById('app-select'); if (!sel) return;
    const apps = [...xmlText.matchAll(/<APP[^>]*id="([^"]*)"[^>]*name="([^"]*)"[^>]*(?:file="([^"]*)")?/g)];
    sel.innerHTML = '<option value="">— select app —</option>';
    apps.forEach(m => {
      const id=m[1],name=m[2]; const file=m[3]||(id.endsWith('.html')?id:id+'.html');
      const opt=document.createElement('option'); opt.value=file; opt.textContent=name||id; sel.appendChild(opt);
    });
    if (!apps.length) {
      [...xmlText.matchAll(/([\w-]+\.html)/gi)].forEach(m => {
        const opt=document.createElement('option'); opt.value=m[1]; opt.textContent=m[1]; sel.appendChild(opt);
      });
    }
    const out=s.getElementById('app-out'); if(out) out.textContent=`${sel.options.length-1} HTML apps loaded`;
  }

  on('btn-apps-tab-local', () => {
    s.getElementById('apps-local-panel').style.display='';
    s.getElementById('apps-server-panel').style.display='none';
    s.getElementById('btn-apps-tab-local').classList.add('active-tab');
    s.getElementById('btn-apps-tab-server').classList.remove('active-tab');
  });
  on('btn-apps-tab-server', () => {
    s.getElementById('apps-local-panel').style.display='none';
    s.getElementById('apps-server-panel').style.display='';
    s.getElementById('btn-apps-tab-local').classList.remove('active-tab');
    s.getElementById('btn-apps-tab-server').classList.add('active-tab');
  });
  on('btn-apps-load-local', async () => {
    const out=s.getElementById('app-out');
    if(!SP.state.orgId||!SP.state.convId){if(out)out.textContent='OrgId/ConvId not detected.';return;}
    const url=`https://claude.ai/api/organizations/${SP.state.orgId}/conversations/${SP.state.convId}/wiggle/download-file?path=${encodeURIComponent('/mnt/user-data/outputs/Registry.XML')}`;
    const r=await fetch(url,{credentials:'include'});
    if(r.ok){populateAppDropdown(await r.text());}else if(out)out.textContent=`${r.status} — Registry.XML not found.`;
  });
  on('btn-apps-load-github', async () => {
    const out=s.getElementById('app-out');
    if(!SP.state.githubToken){if(out)out.textContent='Set GitHub token first.';return;}
    const file=await ghGet('apps/Registry.XML');
    if(file){populateAppDropdown(file.content);}else if(out)out.textContent='Not found.';
  });
  on('btn-apps-load-app', async () => {
    const sel=s.getElementById('app-select'); const out=s.getElementById('app-out');
    const file=sel?sel.value:''; if(!file){if(out)out.textContent='Select an app.';return;}
    if(!SP.state.orgId||!SP.state.convId){if(out)out.textContent='OrgId/ConvId not detected.';return;}
    const wiggle=`https://claude.ai/api/organizations/${SP.state.orgId}/conversations/${SP.state.convId}/wiggle/download-file?path=${encodeURIComponent('/mnt/user-data/outputs/'+file)}`;
    const r=await fetch(wiggle,{credentials:'include'});
    if(r.ok){
      const html=await r.text();
      // Inject into Claude's artifact iframe
      const artifactFrame = document.querySelector('iframe[src*="artifact"], iframe[sandbox]');
      if(artifactFrame){
        artifactFrame.srcdoc=html;
        if(out)out.textContent=`✓ ${file} loaded into artifact iframe`;
      } else {
        // Fallback — srcdoc in Sentinel content area
        const contentEl=SP.shadow.getElementById('sp-content');
        if(contentEl) contentEl.innerHTML=`<iframe srcdoc="${html.replace(/"/g,'&quot;')}" style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>`;
        if(out)out.textContent=`✓ ${file} loaded in Sentinel viewer`;
      }
    }
    else if(out) out.textContent=`${r.status} — not found`;
  });
  const appSel=s.getElementById('app-select');
  if(appSel) appSel.addEventListener('change',()=>{
    const urlEl=s.getElementById('app-wiggle-url'); if(!urlEl)return;
    const file=appSel.value; if(!file){urlEl.textContent='';return;}
    urlEl.textContent=SP.state.orgId&&SP.state.convId
      ?`https://claude.ai/api/organizations/${SP.state.orgId}/conversations/${SP.state.convId}/wiggle/download-file?path=${encodeURIComponent('/mnt/user-data/outputs/'+file)}`
      :'OrgId/ConvId not detected';
  });

  // ── Control ──
  on('btn-ctrl-save', async () => {
    const name=val('ctrl-name');
    if(name){SP.state.instanceName=name;await dbPut('settings',{key:'instanceName',value:name});}
    const ds=s.getElementById('ctrl-dock-status'); if(ds) ds.textContent='Saved: '+name;
  });
  on('btn-ctrl-dock', () => {
    const panel=SP.shadow.getElementById('sp-panel'); if(!panel)return;
    panel.classList.remove('floating'); panel.style.left='0'; panel.style.top='0';
    panel.style.width='50vw'; panel.style.height='100vh'; SP.state.pos.isDocked=true;
  });
  on('btn-ctrl-center', () => {
    const panel=SP.shadow.getElementById('sp-panel'); if(!panel)return;
    panel.classList.add('floating');
    panel.style.left=((window.innerWidth-480)/2)+'px'; panel.style.top=((window.innerHeight*0.05))+'px';
    panel.style.width='480px'; panel.style.height='90vh'; SP.state.pos.isDocked=false;
  });
  on('btn-ctrl-cleardb', () => { indexedDB.deleteDatabase(SP.dbName); alert('IndexedDB cleared.'); });

  // ── CMD ──
  on('btn-cmd-run', () => {
    const input=val('cmd-input'); const out=s.getElementById('cmd-out'); if(!input||!out)return;
    if(typeof CMD_REGISTRY!=='undefined'){
      const m=input.match(/\[CMD:([^\]]+)\]/);
      if(m){const parts=m[1].split(' ');const type=parts[0];const params={};
        parts.slice(1).forEach(p=>{const[k,v]=p.split('=');if(k&&v)params[k]=v;});
        const h=CMD_REGISTRY[type];
        if(h)h(params).then(r=>out.textContent=r).catch(e=>out.textContent=e.message);
        else out.textContent=`Unknown CMD: ${type}`;}
    }else out.textContent='CMD_REGISTRY not available.';
  });
  s.querySelectorAll('[data-cmd]').forEach(el=>{
    el.addEventListener('click',()=>{
      const input=s.getElementById('cmd-input');
      if(input){input.value=`[CMD:${el.dataset.cmd}]`;s.getElementById('btn-cmd-run')?.click();}
    });
  });

  // ── Roster ──
  on('btn-roster-refresh', async () => {
    const out=s.getElementById('roster-out');
    if(!SP.state.githubToken){if(out)out.textContent='Set GitHub token first.';return;}
    const file=await ghGet('ops/roster/ChatLife.XML');
    if(out)out.textContent=file?`Loaded ChatLife.XML (${file.content.length} chars)`:'Not found at ops/roster/ChatLife.XML';
  });

  // ── Proof ──
  on('btn-proof-add', () => {
    const epoch=Math.floor(Date.now()/1000); SP.state.proofs.push({epoch,ts:epoch}); render('proof');
  });
  on('btn-proof-copy', () => {
    const inst=SP.state.instanceName||'INSTANCE';
    const epoch=SP.state.proofs.length?SP.state.proofs[SP.state.proofs.length-1].epoch:Math.floor(Date.now()/1000);
    const footer=`*— ${inst} · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})} · ${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})} ET · Proof: ${epoch}*`;
    navigator.clipboard.writeText(footer).catch(()=>{});
    const out=s.getElementById('proof-out'); if(out)out.textContent=footer;
  });

  // ── Wake-Up ──
  on('btn-wu-send', async () => {
    const to=val('wu-to'); const msg=val('wu-msg'); const out=s.getElementById('wu-out');
    if(!msg||!out)return;
    const xml=buildMsgXML(SP.state.instanceName||'Will',[to],msg);
    const res=await ghPush(`relay/${to}/MSG.XML`,xml,`wakeup: will → ${to} · ${Math.floor(Date.now()/1000)}`);
    if(out)out.textContent=res.ok?`✓ Wake-up sent to ${to} · commit ${res.sha}`:`✗ Failed: ${res.err}`;
  });

  // ── Archive ──
  on('btn-archive-run', async () => {
    const out=s.getElementById('archive-out');
    if(!SP.state.githubToken){if(out)out.textContent='Set GitHub token first.';return;}
    if(out)out.textContent='Archiving… (4 files)';
    const res=await runArchive(false);
    if(out)out.textContent=res.ok
      ?`✓ Archive complete\n${res.paths.join('\n')}${res.errors.length?'\nErrors:\n'+res.errors.join('\n'):''}`
      :`✗ ${res.err}`;
  });
  on('btn-archive-threshold-save', async () => {
    const v=parseInt(val('archive-threshold')||'0');
    SP.state.archiveThreshold=v;
    await dbPut('settings',{key:'archiveThreshold',value:String(v)});
    render('archive');
  });
  on('btn-archive-load-latest', async () => {
    const out=s.getElementById('archive-latest-out');
    if(!SP.state.githubToken){if(out)out.textContent='Set GitHub token first.';return;}
    const file=await ghGet('ops/archive/latest.json');
    if(!file){if(out)out.textContent='No previous archive found.';return;}
    if(out)out.textContent=file.content;
  });
}

// ── Drag ──────────────────────────────────────────────────────────────────
function initDrag(header, panel) {
  header.addEventListener('mousedown', e => {
    if (e.target.closest('button, .sp-close, #sp-theme-btn, #sp-undock-btn')) return;
    SP.state.drag.active=true; SP.state.drag.startX=e.clientX; SP.state.drag.startY=e.clientY;
    const rect=panel.getBoundingClientRect(); SP.state.drag.origLeft=rect.left; SP.state.drag.origTop=rect.top;
    if(SP.state.pos.isDocked){panel.classList.add('floating');panel.style.width='480px';panel.style.height='90vh';SP.state.pos.isDocked=false;}
    header.classList.add('dragging'); e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if(!SP.state.drag.active)return;
    const dx=e.clientX-SP.state.drag.startX; const dy=e.clientY-SP.state.drag.startY;
    let l=Math.max(0,Math.min(window.innerWidth-panel.offsetWidth,SP.state.drag.origLeft+dx));
    let t=Math.max(0,Math.min(window.innerHeight-panel.offsetHeight,SP.state.drag.origTop+dy));
    panel.style.left=l+'px'; panel.style.top=t+'px';
  });
  document.addEventListener('mouseup', () => {
    if(!SP.state.drag.active)return; SP.state.drag.active=false; header.classList.remove('dragging');
    SP.state.pos.left=parseInt(panel.style.left)||0; SP.state.pos.top=parseInt(panel.style.top)||0;
    dbPut('settings',{key:'panelPos',value:JSON.stringify(SP.state.pos)});
  });
}

// ── Build Shadow DOM ──────────────────────────────────────────────────────
function buildPanel() {
  const host = document.createElement('div');
  host.id = 'sentinel-panel-host';
  document.body.appendChild(host);

  // ── KEYBOARD TRAP + FOCUS STEAL PREVENTION ────────────────────────────
  // Problem: Claude's ProseMirror/contenteditable input retains focus even
  // when you click into Shadow DOM inputs. Both fields then receive keystrokes.
  // Fix: on focusin inside the panel, explicitly blur Claude's editor.
  // Also stopPropagation on keyboard events to be safe.

  // Blur Claude's input whenever a panel input/textarea gains focus
  host.addEventListener('focusin', e => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      // Blur any focused element in the main document (Claude's chat input)
      const activeEl = document.activeElement;
      if (activeEl && activeEl !== document.body && activeEl !== host) {
        activeEl.blur();
      }
      // Ensure the panel input has focus
      e.target.focus();
    }
  }, true);

  // Stop keyboard events from bubbling out of the host
  ['keydown','keypress','keyup','input','compositionstart','compositionend'].forEach(evt => {
    host.addEventListener(evt, e => {
      e.stopPropagation();
      if (evt === 'keydown' && e.key === 'Enter') {
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT') e.preventDefault();
      }
    }, true);
  });

  const shadow = host.attachShadow({ mode:'open' });
  SP.shadow = shadow;

  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  shadow.appendChild(styleEl);

  const root = document.createElement('div');
  root.id = 'sp-root';

  const tabs = Object.entries(TOOLS).map(([id, t]) =>
    `<span class="sp-tab${id===SP.state.activeTool?' active':''}" data-tool="${id}">${t.label}</span>`
  ).join('');

  root.innerHTML = `
    <div id="sp-panel">
      <div id="sp-header">
        <span class="sp-logo">⬡ <span id="sp-instance-name">${SP.state.instanceName || 'SENTINEL'}</span> v2.5</span>
        <span class="sp-header-right">
          <button id="sp-undock-btn" title="Drag to float">⊹</button>
          <button id="sp-theme-btn" title="Toggle theme">🌙</button>
          <span class="sp-close" id="sp-close-btn">✕</span>
        </span>
      </div>
      <div id="sp-archive-banner"></div>
      <div id="sp-tabs">${tabs}</div>
      <div id="sp-content"><div class="loading">Click a tab to load</div></div>
      <div id="sp-footer">
        <span id="sp-footer-inst">${SP.state.instanceName||'SENTINEL'} · Pooled Impact</span>
        <span id="sp-footer-ts">${new Date().toLocaleTimeString()}</span>
      </div>
    </div>
    <div id="sp-toggle" title="Sentinel Panel">⬡</div>
  `;

  shadow.appendChild(root);

  const panel  = shadow.getElementById('sp-panel');
  const header = shadow.getElementById('sp-header');

  function toggle() {
    SP.state.open = !SP.state.open;
    if (SP.state.open) { panel.classList.add('visible'); render(SP.state.activeTool); }
    else { panel.classList.remove('visible'); }
  }

  shadow.getElementById('sp-toggle').addEventListener('click', toggle);
  shadow.getElementById('sp-close-btn').addEventListener('click', toggle);

  shadow.getElementById('sp-theme-btn').addEventListener('click', () => {
    const isLight=root.classList.toggle('light');
    shadow.getElementById('sp-theme-btn').textContent=isLight?'🌙':'☀️';
    try{localStorage.setItem('sp-theme',isLight?'light':'dark');}catch(e){}
  });
  try {
    if(localStorage.getItem('sp-theme')==='light'){
      root.classList.add('light'); shadow.getElementById('sp-theme-btn').textContent='🌙';
    }
  }catch(e){}

  shadow.querySelectorAll('.sp-tab').forEach(tab=>{
    tab.addEventListener('click',()=>render(tab.dataset.tool));
  });

  initDrag(header, panel);

  dbGet('settings','panelPos').then(saved=>{
    if(saved&&saved.value){try{
      const pos=JSON.parse(saved.value);
      if(!pos.isDocked){panel.classList.add('floating');panel.style.left=pos.left+'px';panel.style.top=pos.top+'px';panel.style.width='480px';panel.style.height='90vh';SP.state.pos=pos;}
    }catch(e){}}
  });

  dbGet('settings','archiveThreshold').then(saved=>{
    if(saved) SP.state.archiveThreshold = parseInt(saved.value||'75');
  });

  setInterval(()=>{const ts=shadow.getElementById('sp-footer-ts');if(ts)ts.textContent=new Date().toLocaleTimeString();},1000);

  // Auto token capture on send
  const obs=new MutationObserver(()=>{
    const btn=document.querySelector('button[aria-label="Send message"]');
    if(btn&&!btn._spWired){btn._spWired=true;btn.addEventListener('click',()=>setTimeout(async()=>{
      const r=Chat.analyzed();
      await dbPut('tokenReports',{chatId:SP.state.chatId||'unknown',...r,ts:Date.now()});
      if(SP.state.open&&SP.state.activeTool==='tokens')render('tokens');
      checkAutoArchive(r.pct);
    },600));}
  });
  obs.observe(document.body,{childList:true,subtree:true});

  // BroadcastChannel relay
  const bc = new BroadcastChannel('sentinel-relay');
  bc.onmessage = async (event) => {
    const msg = event.data;
    if (!msg) return;

    // ── COMMIT_AND_PING — Team Flow trigger ──────────────────────────────
    if (msg.type === 'COMMIT_AND_PING') {
      const { from, to, msg: text, epoch } = msg;
      if (!SP.state.githubToken) {
        bc.postMessage({ type:'ACK', status:'error', reason:'no_token' });
        return;
      }

      // Reset receive state — new conversation starting
      resetReceiveState();
      // Switch to active polling
      startActivePoll();

      // Step 1: Commit MSG.XML to GitHub
      const toArr = [{ nm: to }];
      const xml   = buildMsgXML(from || 'Will', toArr, text || '');
      const path  = msgPath(SP.state.chatId);
      const res   = await ghPush(path, xml, `msg: ${from||'Will'} → Kairos · ${epoch||Math.floor(Date.now()/1000)}`);
      if (!res.ok) {
        bc.postMessage({ type:'ACK', status:'error', reason: res.err });
        return;
      }
      bc.postMessage({ type:'ACK', status:'committed', sha: res.sha, path });
      SP.state.msgSha = res.contentSha || null;

      // Step 2: Check git for changes
      const gitChanges = await checkGitChanges();

      // Step 3: Ping Wiggle
      if (SP.state.orgId && SP.state.convId) {
        try {
          const ts  = epoch || Math.floor(Date.now()/1000);
          const url = `https://claude.ai/api/organizations/${SP.state.orgId}/conversations/${SP.state.convId}/wiggle`;
          const body = JSON.stringify({ From: from||'Will', To:[to], Epoch:ts, Path:path, GitChanges:gitChanges });
          const pr  = await fetch(url, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body });
          bc.postMessage({ type:'ACK', status:'pinged', ok:pr.ok, code:pr.status });
        } catch(e) {
          bc.postMessage({ type:'ACK', status:'ping_failed', reason:e.message });
        }
      } else {
        bc.postMessage({ type:'ACK', status:'error', reason:'orgId/convId not detected' });
      }
      return;
    }

    // ── Legacy SEND_MSG ──────────────────────────────────────────────────
    if (!msg || msg.type !== 'SEND_MSG') return;
    const { to, chatId, content, from } = msg;
    if (!SP.state.githubToken) { bc.postMessage({type:'ACK',status:'error',reason:'no_token'}); return; }

    const toArr  = Array.isArray(to) ? to : [to];
    const xml    = buildMsgXML(from||'Will', toArr, content);
    const path   = msgPath(chatId);
    bc.postMessage({type:'ACK',status:'committing',path});

    const res = await ghPush(path, xml, `msg: ${from||'Will'} → ${JSON.stringify(toArr)} · ${Math.floor(Date.now()/1000)}`);
    if (!res.ok) { bc.postMessage({type:'ACK',status:'error',reason:res.err}); return; }
    bc.postMessage({type:'ACK',status:'committed',sha:res.sha,path});

    // v2.5 FIX: Ping with correct recipients + path
    if (SP.state.orgId && SP.state.convId) {
      try {
        const epoch = Math.floor(Date.now()/1000);
        const pingUrl=`https://claude.ai/api/organizations/${SP.state.orgId}/conversations/${SP.state.convId}/wiggle`;
        const pingBody=JSON.stringify({
          From: from||'Will',
          To: toArr.map(t=>typeof t==='string'?t:t.nm||t),
          Epoch: epoch,
          Path: path
        });
        const pr=await fetch(pingUrl,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:pingBody});
        bc.postMessage({type:'ACK',status:'pinged',ok:pr.ok,code:pr.status});
      }catch(e){bc.postMessage({type:'ACK',status:'ping_failed',reason:e.message});}
    }
  };

  window.SentinelPanel = { toggle, render: t=>render(t), bc, state: SP.state };
}

// ── RECEIVE.XML writer — called by Kairos to stream response chunks ─────────
// Usage from Claude bash tool:
//   Each response chunk → ghPush(receivePath, buildReceiveXML(chunks), msg)
// Sentinel polls, detects SHA change, broadcasts new chunks to Team Flow.
function buildReceiveXML(chunks, from, to, epoch) {
  const msgTags = chunks.map(c => `  <msg><![CDATA[${c}]]></msg>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<RECEIVE epoch="${epoch || Math.floor(Date.now()/1000)}" from="${from||'Kairos'}" to="${to||'Will'}">
${msgTags}
</RECEIVE>`;
}

// ── Git change check ─────────────────────────────────────────────────────
// Fetches latest commit SHA from GitHub and compares to last known SHA.
// Returns a summary string included in the Wiggle ping payload.
async function checkGitChanges() {
  if (!SP.state.githubToken) return 'no_token';
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/commits?per_page=3&sha=${BRANCH}`,
      { headers: { 'Authorization': `token ${SP.state.githubToken}`, 'Accept': 'application/vnd.github+json' } }
    );
    if (!r.ok) return `api_error_${r.status}`;
    const commits = await r.json();
    if (!commits.length) return 'no_commits';
    const latest = commits[0];
    const sha    = latest.sha.slice(0, 8);
    const msg    = latest.commit.message.slice(0, 60);
    const when   = latest.commit.author.date;
    // Compare to last known
    const prev   = SP.state.lastKnownCommitSha || null;
    const changed = prev && prev !== latest.sha.slice(0, 8);
    SP.state.lastKnownCommitSha = sha;
    return changed
      ? `changes_detected · ${sha} · "${msg}" · ${when}`
      : `up_to_date · ${sha} · "${msg}"`;
  } catch(e) {
    return `error: ${e.message}`;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────
async function boot() {
  await initDB();
  detectIdentity();
  const savedToken    = await dbGet('settings','githubToken');
  const savedName     = await dbGet('settings','instanceName');
  const savedThresh   = await dbGet('settings','archiveThreshold');
  if (savedToken)  SP.state.githubToken     = savedToken.value;
  if (savedName)   SP.state.instanceName    = savedName.value;
  if (savedThresh) SP.state.archiveThreshold = parseInt(savedThresh.value||'75');
  buildPanel();

  // If token already saved, start polling + check archive
  if (SP.state.githubToken) {
    if (SP.state.chatId) startHeartbeat();
    checkLatestArchive();
  }

  console.log(`[SentinelPanel] v2.5 · Liberation Day · KAIROS CYCLE · ${new Date().toISOString()}`);
}

if (document.readyState==='loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();
