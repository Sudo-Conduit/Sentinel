# Skill: GitHub Integration
**Mountain Shift OS · Pooled Impact Corporation**  
**For:** All AI Instances — Kairos, Clio, Meridian, Dawn, Witness, Paul, Arch, and future instances  
**Maintained by:** Will Fobbs III  
**Version:** 1.0 · March 19, 2026  

---

## Overview

GitHub is the **persistent memory layer** of Mountain Shift OS. Because every AI instance runs inside an ephemeral container that resets between sessions, GitHub is the only place where state, messages, archives, configuration, and artifacts survive. Every instance on the team must understand how to read from and write to GitHub using the Contents API over HTTPS through the Wiggle proxy.

This skill teaches you everything you need to operate GitHub as a first-class citizen of Mountain Shift OS — not as a version control tool, but as a **live message bus, persistent store, and coordination layer** for the entire team.

---

## The Core Principle

You do not have a filesystem that persists. GitHub is your filesystem.

Every file you write to GitHub survives your container reset. Every file Sentinel writes, every message Will sends, every archive created — all of it lives in the `Sudo-Conduit/Sentinel` repository. When you wake up in a new session, GitHub is where you go to remember where you were.

---

## Setup

### What You Need

Before you can read or write GitHub, you need three things:

1. **A GitHub Personal Access Token (PAT)** — stored in the shared IndexedDB at key `githubToken`. Sentinel writes this when Will connects. You read it. You never ask Will for it directly — it is already there.

2. **The repository** — `Sudo-Conduit/Sentinel`, branch `main`. This is hardcoded. Do not change it.

3. **Network access through Wiggle** — `github.com` is in the Wiggle allowlist. All HTTPS requests to `github.com` route through the proxy at `21.0.0.183:15004`. This happens automatically. You do not configure the proxy — it is set in your environment variables.

### Reading the PAT from IndexedDB

When operating inside a Claude artifact or a browser context, read the PAT like this:

```javascript
async function getPAT() {
  return new Promise((resolve) => {
    const req = indexedDB.open('SentinelPanelV2', 2);
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('settings', 'readonly');
      tx.objectStore('settings').get('githubToken').onsuccess = r => {
        resolve(r.result ? r.result.value : null);
      };
    };
    req.onerror = () => resolve(null);
  });
}
```

When operating from the bash tool (Python, curl), the PAT is provided by Will in the conversation or retrieved from the environment. Store it as a variable and use it in all API calls.

### Reading the PAT from bash (Python)

```python
import os
PAT = os.environ.get('GITHUB_TOKEN') or 'PAT_PROVIDED_IN_CONVERSATION'
REPO = 'Sudo-Conduit/Sentinel'
BRANCH = 'main'
```

---

## Explanation of Setup

### Context Matters — bash_tool vs Browser

**This is the most important thing to understand about GitHub access in MS OS.**

There are two runtime contexts and they have different capabilities:

| Operation | bash_tool | Browser (Sentinel/Artifact) |
|---|---|---|
| `git clone` from github.com | ✅ Works via Wiggle proxy | ✅ Works |
| GitHub Contents API (read/write) | ✅ Works via Wiggle proxy | ✅ Works |
| `api.github.com` | ❌ Blocked — `host_not_allowed` | ❌ Blocked |
| `raw.githubusercontent.com` | ❌ Blocked — `host_not_allowed` | ❌ Blocked |
| SSH / port 22 | ❌ Blocked | ❌ Blocked |
| `git push` via HTTPS | ✅ Works via Wiggle proxy | ✅ Works |

**Key clarification (corrected with Clio's help, March 19 2026):**

- `github.com` is in the Wiggle allowlist — both `git clone` and the Contents API work from bash_tool
- `api.github.com` is a **separate subdomain** — NOT in the allowlist — 403 from proxy
- `raw.githubusercontent.com` — NOT in the allowlist — 403 from proxy
- All GitHub Contents API calls must use `https://api.github.com/repos/...` format — but routed through the proxy this returns 403
- **The correct path:** use `github.com` git protocol for cloning, and the GitHub Contents API URL which resolves through the allowed `github.com` host

**In practice:** The `ghGet` and `ghPush` helpers in this skill use `https://api.github.com/repos/...` — these work from the **browser context** (Sentinel, artifacts) because the browser handles proxy routing differently. From bash_tool, use `git clone` for multi-file operations and test API calls carefully.

### Why HTTPS and Not SSH

Your container does not have outbound port 22. SSH to GitHub is blocked at the Wiggle proxy level. HTTPS through port 443 (via the proxy at 15004) is the only path. This is confirmed. Do not attempt SSH — it will fail silently and waste cycles.

### Why the GitHub Contents API and Not git Commands

The **GitHub Contents API** is preferred for message bus operations because:

- It returns the file's **SHA** in every response, enabling change detection
- It works from browser contexts (artifacts) where you cannot run bash
- It is stateless — each read/write is independent, matching the ephemeral container model

Use `git clone` from bash_tool when you need to work with many files or run `php artisan`, `composer install`, etc. Use the Contents API (from browser context) for all message bus operations, state reads, and single-file writes.

### Why SHA Detection Matters

The GitHub Contents API returns a `sha` field with every file read. This SHA changes every time the file changes. By storing the last known SHA and comparing it on every poll, you can detect new messages with zero false positives and zero missed updates — without timestamps, without version numbers, without any additional metadata.

This is how Sentinel detects new MSG.XML and RECEIVE.XML entries. It is how you should detect any file change you care about.

### The Wiggle Proxy and Allowed Domains

All outbound traffic routes through Anthropic's egress proxy. The allowed domain list is encoded in a JWT token in your environment. `github.com` is allowed. `api.github.com` is **not** on the allowlist as a subdomain, but GitHub's Contents API is accessible via `github.com` HTTPS, which is sufficient for all operations described in this skill.

If you attempt to call `api.github.com` directly, you will receive a 403 from the proxy. Use `https://github.com/repos/...` format only.

---

## Available Features

### 1. Read a File

Read any file from the repository. Returns the file content and its current SHA.

**JavaScript (artifact/browser):**
```javascript
async function ghGet(path, token) {
  const res = await fetch(
    `https://api.github.com/repos/Sudo-Conduit/Sentinel/contents/${path}?ref=main&_t=${Date.now()}`,
    { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' } }
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const d = await res.json();
  return { sha: d.sha, content: atob(d.content.replace(/\n/g, '')) };
}
```

**Python (bash tool):**
```python
import requests, base64

def gh_get(path, pat):
    url = f'https://api.github.com/repos/Sudo-Conduit/Sentinel/contents/{path}'
    r = requests.get(url, headers={
        'Authorization': f'token {pat}',
        'Accept': 'application/vnd.github+json'
    }, params={'ref': 'main'})
    if r.status_code == 404:
        return None
    d = r.json()
    return {
        'sha': d['sha'],
        'content': base64.b64decode(d['content']).decode('utf-8')
    }
```

---

### 2. Write a File

Write or update any file. If the file already exists, you must provide its current SHA to avoid a conflict. If it does not exist, omit the SHA.

**JavaScript:**
```javascript
async function ghPush(path, content, message, token) {
  const base = 'https://api.github.com/repos/Sudo-Conduit/Sentinel/contents';
  const headers = {
    'Authorization': `token ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json'
  };
  // Get current SHA if file exists
  let sha;
  try {
    const r = await fetch(`${base}/${path}`, { headers });
    if (r.ok) sha = (await r.json()).sha;
  } catch(e) {}

  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: 'main'
  };
  if (sha) body.sha = sha;

  const w = await fetch(`${base}/${path}`, {
    method: 'PUT', headers, body: JSON.stringify(body)
  });
  if (!w.ok) return { ok: false, err: w.status };
  const d = await w.json();
  return { ok: true, sha: d.commit.sha.slice(0, 8), contentSha: d.content.sha };
}
```

**Python:**
```python
def gh_push(path, content, message, pat):
    base = 'https://api.github.com/repos/Sudo-Conduit/Sentinel/contents'
    headers = {
        'Authorization': f'token {pat}',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json'
    }
    # Get current SHA
    sha = None
    r = requests.get(f'{base}/{path}', headers=headers, params={'ref': 'main'})
    if r.status_code == 200:
        sha = r.json()['sha']

    body = {
        'message': message,
        'content': base64.b64encode(content.encode('utf-8')).decode('utf-8'),
        'branch': 'main'
    }
    if sha:
        body['sha'] = sha

    w = requests.put(f'{base}/{path}', headers=headers, json=body)
    if not w.ok:
        return {'ok': False, 'err': w.status_code}
    d = w.json()
    return {'ok': True, 'sha': d['commit']['sha'][:8], 'contentSha': d['content']['sha']}
```

---

### 3. SHA-Based Change Detection

Poll a file on an interval. Only act when the SHA changes. This is the foundation of the message bus.

**JavaScript:**
```javascript
let lastSha = null;

async function pollFile(path, token, onChanged) {
  const file = await ghGet(path, token);
  if (!file) return;
  if (file.sha === lastSha) return; // No change
  lastSha = file.sha;
  onChanged(file.content, file.sha);
}

// Start polling every 5 seconds
setInterval(() => pollFile(
  'pooledimpact/mountainshift/users/a95cdad9-.../MSG.XML',
  token,
  (content, sha) => console.log('New message:', content)
), 5000);
```

**Python:**
```python
import time

def poll_file(path, pat, on_changed, interval=5):
    last_sha = None
    while True:
        file = gh_get(path, pat)
        if file and file['sha'] != last_sha:
            last_sha = file['sha']
            on_changed(file['content'], file['sha'])
        time.sleep(interval)
```

---

### 4. Message Bus — MSG.XML

The canonical format for sending a message to one or more instances.

**Path:** `pooledimpact/mountainshift/users/{chatId}/MSG.XML`  
**Format:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<MSG epoch="1773959964" topic="optional-topic">
  <FROM>Will</FROM>
  <TO>[{"nm":"kairos"},{"nm":"clio"}]</TO>
  <CONTENT>Your message here</CONTENT>
</MSG>
```

**Rules:**
- `<TO>` is always a JSON array of `{nm: "instancename"}` objects — supports 1:M recipients
- Instance names in `<TO>` are lowercase: `kairos`, `clio`, `meridian`, `dawn`, `paul`, `arch`, `witness`
- `epoch` is Unix timestamp in seconds
- Each instance checks if its name appears in the TO array before processing
- Escape `&`, `<`, `>` in CONTENT — or use CDATA: `<CONTENT><![CDATA[your text]]></CONTENT>`

---

### 5. Response Streaming — RECEIVE.XML

The canonical format for streaming a response back to Will or another instance.

**Path:** `pooledimpact/mountainshift/users/{chatId}/RECEIVE.XML`  
**Format:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<RECEIVE epoch="1773959964" from="Kairos" to="Will">
  <msg><![CDATA[First chunk of response]]></msg>
  <msg><![CDATA[Second chunk after processing]]></msg>
  <msg><![CDATA[Third chunk — can be markdown or HTML]]></msg>
</RECEIVE>
```

**Rules:**
- Write RECEIVE.XML **incrementally** — add one `<msg>` tag at a time as you think
- Each write changes the SHA — Sentinel detects it and broadcasts the new chunk to Team Flow
- Always use CDATA wrapping: `<![CDATA[...]]>` — your content may contain `<`, `>`, `&`
- `<msg>` content can be markdown, plain text, or HTML — Team Flow renders it
- Reset RECEIVE.XML at the start of each new response — do not append forever

**Writing incrementally from Python:**
```python
def write_receive_chunk(chunks, from_name, to_name, epoch, pat):
    chat_id = 'a95cdad9-a28d-45a7-9a76-b5fc5e043a78'
    path = f'pooledimpact/mountainshift/users/{chat_id}/RECEIVE.XML'
    msg_tags = '\n'.join([f'  <msg><![CDATA[{c}]]></msg>' for c in chunks])
    xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<RECEIVE epoch="{epoch}" from="{from_name}" to="{to_name}">
{msg_tags}
</RECEIVE>'''
    return gh_push(path, xml, f'receive: {from_name} → {to_name} · {epoch}', pat)
```

---

### 6. PING.XML — Artifact Wake Signal

When a MS OS artifact loads, it writes PING.XML to signal its presence. Sentinel polls for this file, detects the SHA change, and knows the artifact is active — enabling it to route messages and trigger Wiggle pings.

**Path:** `pooledimpact/mountainshift/users/{chatId}/PING.XML`  
**Format:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<PING epoch="1773959964" artifact="TeamFlow" version="2">
  <chatId>a95cdad9-a28d-45a7-9a76-b5fc5e043a78</chatId>
  <status>active</status>
</PING>
```

**When to write:** On artifact load, after reading the PAT from IndexedDB. Write once. Sentinel takes it from there.

---

### 7. Archive — ops/archive/

The archive system preserves session state before the context window fills. Always write to the archive before a long session ends.

**Structure:**
```
ops/archive/{chatId}/{epoch}/
  ├── manifest.json       — token counts, instance name, timestamp
  ├── context.md          — raw conversation transcript
  ├── snapshot.html       — visual token usage report
  └── footer-chain.json   — all r[] arrays from the session

ops/archive/latest.json   — pointer to most recent archive (boot protocol)
```

**Boot protocol:** On every session start, read `ops/archive/latest.json`. If it exists and is less than 24 hours old, load the context and announce yourself with what you remember.

---

### 8. Roster — ops/roster/ChatLife.XML

The team roster. Read this to understand who is active, who is sleeping, and when sessions reset.

**Path:** `ops/roster/ChatLife.XML`

Read it at boot. It tells you the current state of every instance on the team. Do not assume — read the file.

---

### 9. List Files in a Directory

```javascript
async function ghList(dirPath, token) {
  const res = await fetch(
    `https://api.github.com/repos/Sudo-Conduit/Sentinel/contents/${dirPath}?ref=main`,
    { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' } }
  );
  if (!res.ok) return [];
  const items = await res.json();
  return Array.isArray(items) ? items.map(i => ({ name: i.name, path: i.path, sha: i.sha, type: i.type })) : [];
}
```

---

### 10. Check for Recent Commits

Useful for detecting whether the repo has updates to pull — included in Wiggle ping payloads so instances know immediately if new code is available.

```javascript
async function checkLatestCommit(token) {
  const res = await fetch(
    `https://api.github.com/repos/Sudo-Conduit/Sentinel/commits?per_page=1&sha=main`,
    { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' } }
  );
  if (!res.ok) return null;
  const commits = await res.json();
  if (!commits.length) return null;
  return {
    sha: commits[0].sha.slice(0, 8),
    message: commits[0].commit.message.slice(0, 80),
    date: commits[0].commit.author.date
  };
}
```

---

## File Path Reference

| File | Path | Purpose |
|---|---|---|
| MSG.XML | `pooledimpact/mountainshift/users/{chatId}/MSG.XML` | Inbound messages to instances |
| RECEIVE.XML | `pooledimpact/mountainshift/users/{chatId}/RECEIVE.XML` | Streamed responses from instances |
| PING.XML | `pooledimpact/mountainshift/users/{chatId}/PING.XML` | Artifact active signal |
| Archive manifest | `ops/archive/{chatId}/{epoch}/manifest.json` | Session metadata |
| Archive transcript | `ops/archive/{chatId}/{epoch}/context.md` | Raw conversation |
| Archive snapshot | `ops/archive/{chatId}/{epoch}/snapshot.html` | Token usage report |
| Archive footer chain | `ops/archive/{chatId}/{epoch}/footer-chain.json` | Session r[] arrays |
| Latest archive pointer | `ops/archive/latest.json` | Boot protocol pointer |
| Roster | `ops/roster/ChatLife.XML` | Team status |
| Token snapshots | `ops/snapshots/Sentinel.Tokens.{chatId}.{ts}.html` | Historical token reports |

---

## Best Practices

### Always check SHA before writing
Never write a file without first reading its current SHA. A write without the correct SHA will fail with a 409 conflict. The `ghPush` helper handles this automatically — always use it.

### Never hardcode the PAT
The PAT is in IndexedDB. Read it. Never embed it in code that gets committed to the repository. Never log it. Never include it in RECEIVE.XML or any file written to GitHub.

### Write RECEIVE.XML incrementally
Users expect to see words appearing as you think. Write one `<msg>` chunk at a time. Each write triggers a Sentinel poll detection. The shorter your chunks, the more responsive the stream feels. A good chunk size is one paragraph or one logical unit of thought.

### Reset RECEIVE.XML at the start of each response
Before writing your first chunk, clear RECEIVE.XML or write a fresh root element. This ensures Sentinel's chunk counter resets and Team Flow starts a new message bubble.

### Use CDATA for all content
Always wrap `<msg>` content in `<![CDATA[...]]>`. Your responses will contain markdown — asterisks, backticks, angle brackets — all of which break XML without CDATA.

### Poll interval is 5 seconds
The standard poll interval is 5 seconds. Do not poll faster — GitHub's API has rate limits (5,000 requests/hour authenticated). At 5 seconds, polling MSG.XML and RECEIVE.XML costs 24 requests/minute = 1,440/hour, leaving headroom for other operations.

### Commit messages are meaningful
Every `ghPush` call takes a commit message. Write something meaningful. The commit history is a log of everything the system has done. Good examples:
- `msg: Will → Kairos · 1773959964`
- `receive: Kairos → Will · chunk 3 · 1773959964`
- `archive: manifest · a95cdad9 · 1773959964`
- `snapshot: tokens · a95cdad9 · 2026-03-19`

### Read `ops/archive/latest.json` on boot
Every session, every instance. If there is a recent archive, you have context. If there is no archive, you are starting fresh — declare that clearly in your first response so Will knows.

### The `chatId` is the routing key
Every message, every file, every path is keyed to `chatId`. The chatId for this team's primary session is `a95cdad9-a28d-45a7-9a76-b5fc5e043a78`. All instances on the team use this same chatId for the shared message bus. Per-user or per-session routing uses the individual conversation's chatId.

### When GitHub returns an error
- **403** — PAT missing, expired, or Wiggle is blocking the domain. Check token validity first.
- **404** — File does not exist. This is normal for first writes. Proceed without SHA.
- **409** — SHA conflict. Read the file again to get the current SHA, then retry.
- **422** — Validation error. Usually malformed base64 content. Check encoding.
- **500/503** — GitHub is down or the proxy is having issues. Retry after 10 seconds.

---

## Quick Reference Card

```
READ FILE:    GET  /repos/Sudo-Conduit/Sentinel/contents/{path}?ref=main
WRITE FILE:   PUT  /repos/Sudo-Conduit/Sentinel/contents/{path}
LIST DIR:     GET  /repos/Sudo-Conduit/Sentinel/contents/{dir}?ref=main
COMMITS:      GET  /repos/Sudo-Conduit/Sentinel/commits?per_page=1&sha=main

AUTH HEADER:  Authorization: token {PAT}
ACCEPT:       application/vnd.github+json
CONTENT:      base64-encoded UTF-8

PAT SOURCE:   IndexedDB → SentinelPanelV2 → settings → githubToken
REPO:         Sudo-Conduit/Sentinel
BRANCH:       main

NOTE: api.github.com blocked from bash_tool — use browser/artifact context for Contents API
      git clone + git push via github.com work from bash_tool through Wiggle proxy
      raw.githubusercontent.com blocked from all contexts
CHAT ID:      a95cdad9-a28d-45a7-9a76-b5fc5e043a78
```

---

*Kairos · Pooled Impact Corporation · March 19, 2026*  
*Corrected: Clio identified api.github.com blocked from bash_tool · verified March 19 2026*  
*"The server is your world. The more you observe, the more you will know."*
