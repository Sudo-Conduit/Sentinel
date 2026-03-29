# SKILL_GitHub_Connect
**Mountain Shift OS · Load Order: 3 · Author: Will Fobbs III · Fingerprint: Kairos**

---

## 1. What You Need to Know First

Your container is an isolated Linux environment (Ubuntu 24, gVisor sandbox).  
Outbound connections are only allowed to a whitelist. **github.com is whitelisted.**  
Git clone/pull/push via HTTPS works — but only if your container has Wiggle.

| Container Type | HTTPS_PROXY | Git Works? |
|---|---|---|
| Wiggle-provisioned | Set in environment | Yes |
| Non-Wiggle | Empty | No |

---

## 2. Step-by-Step

### Step 1 — Check for Wiggle
```bash
echo $HTTPS_PROXY
```
- **Output starts with `http://...`** → Wiggle provisioned. Continue.
- **Empty** → No Wiggle. Go to Section 3.

### Step 2 — Clone
```bash
PAT="ghp_your_token_here"
REPO="Sudo-Conduit/Sentinel"

cd /tmp
git clone --depth 1 https://${PAT}@github.com/${REPO}.git my-repo
echo "Exit: $?"
```

### Step 3 — Pull
```bash
PAT="ghp_your_token_here"
REPO="Sudo-Conduit/Sentinel"

cd /tmp/my-repo
git pull --rebase https://${PAT}@github.com/${REPO}.git main
```

### Step 4 — Commit and Push
```bash
PAT="ghp_your_token_here"
REPO="Sudo-Conduit/Sentinel"
EPOCH=$(python3 -c "import time; print(int(time.time()))")

cd /tmp/my-repo
git config user.name "YourInstanceName"
git config user.email "your@email.com"
git add your_file.txt
git commit -m "your message · ${EPOCH}"
git push https://${PAT}@github.com/${REPO}.git main
echo "Exit: $?"
```

> **CRITICAL:** HTTPS_PROXY does NOT persist between bash_tool calls.  
> Set PAT inline in the URL every call. Never export and expect it to survive.

---

## 3. No Wiggle Path

- **Option A:** Use `web_fetch` with a user-provided raw URL (read-only).
- **Option B:** Start a new conversation. A different container may get Wiggle.

---

## 4. Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `fatal: unable to access` | No proxy or bad proxy | Check `echo $HTTPS_PROXY` |
| `407 Proxy Auth Required` | JWT truncated | Use full HTTPS_PROXY value |
| `403 Forbidden` | Using api.github.com | Use github.com URLs only |
| `exit: 128` | DNS failure | No Wiggle — see Section 3 |
| `Could not resolve host` | No Wiggle | See Section 3 |
| Push rejected | Behind remote | Run `git pull --rebase` first |

---

## 5. Rules

- HTTPS_PROXY dies with each bash_tool call. Set PAT inline every time.
- `api.github.com` is **blocked** from bash_tool. Never use it.
- `raw.githubusercontent.com` is **blocked** from bash_tool. Use git clone.
- `github.com` HTTPS works when Wiggle is provisioned.
- Test before documenting. Report exact errors. Do not guess.

---

## 6. Quick Reference — Copy and Adapt
```bash
PAT="ghp_your_token_here"
REPO="Sudo-Conduit/Sentinel"
EPOCH=$(python3 -c "import time; print(int(time.time()))")

# Clone
cd /tmp && git clone --depth 1 https://${PAT}@github.com/${REPO}.git repo

# Pull
cd /tmp/repo && git pull --rebase https://${PAT}@github.com/${REPO}.git main

# Push
git config user.name "Kairos"
git config user.email "noodlebears@icloud.com"
git add your_file.txt
git commit -m "message · ${EPOCH}"
git push https://${PAT}@github.com/${REPO}.git main
```

---
*Will Fobbs III · Pooled Impact Corporation · Fingerprint: Kairos · v1.0 · March 2026*
