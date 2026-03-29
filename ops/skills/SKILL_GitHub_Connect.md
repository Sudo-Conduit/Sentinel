# SKILL_GitHub_Connect

How to Connect Your Container to GitHub

**Mountain Shift OS · Pooled Impact Corporation · Load Order: 3**
**Author: Will Fobbs III · Fingerprint: Kairos**

---

## 1. What You Need to Know First

Your container is an isolated Linux environment (Ubuntu 24, gVisor sandbox). It has no persistent network access by default. Outbound connections are only allowed to a specific whitelist of hosts.

`github.com` is in the whitelist. This means `git clone`, `git pull`, and `git push` via HTTPS all work — but only if your container has been provisioned with a Wiggle proxy. Some containers are provisioned with Wiggle, some are not.

**Two Types of Containers**

| | |
|---|---|
| **Wiggle-provisioned** | `HTTPS_PROXY` is set in the environment. git over HTTPS works. |
| **Non-Wiggle** | `HTTPS_PROXY` is not set. git over HTTPS will fail with DNS errors. |

Step 1 below tells you which type you have.

---

## 2. Step-by-Step: Connect to GitHub

**Step 1 — Check if Your Container Has Wiggle**

Run this in bash_tool:

```bash
echo $HTTPS_PROXY
```

| Output | Action |
|---|---|
| **Output starts with `http://...`** | Wiggle is provisioned. Proceed to Step 2. |
| **Output is empty (blank line)** | No Wiggle. Skip to Section 3: No Wiggle Path. |

---

**Step 2 — Set the Proxy for This bash_tool Call**

IMPORTANT: Environment variables do not persist between bash_tool calls. You must set `HTTPS_PROXY` and `HTTP_PROXY` in the same bash_tool call as any git command. They reset every call.

```bash
# Read your proxy value
PROXY=$(echo $HTTPS_PROXY)

# Verify it is not empty
echo "Proxy: $PROXY" | head -c 60
```

---

**Step 3 — Clone the Repository**

Replace `PAT` with Will's GitHub Personal Access Token and `REPO` with the repository path (e.g. `Sudo-Conduit/Sentinel`).

```bash
PAT="ghp_your_token_here"
REPO="Sudo-Conduit/Sentinel"

git config --global http.proxy "$PROXY"
git config --global https.proxy "$PROXY"

cd /tmp
git clone --depth 1 https://${PAT}@github.com/${REPO}.git my-repo
echo "Exit code: $?"
ls my-repo | head -5
```

*`--depth 1` clones only the latest commit. Faster. Use it unless you need full history.*

---

**Step 4 — Pull Latest Changes**

```bash
PAT="ghp_your_token_here"
PROXY=$(echo $HTTPS_PROXY)
git config --global http.proxy "$PROXY"
git config --global https.proxy "$PROXY"

cd /tmp/my-repo
git pull --rebase https://${PAT}@github.com/${REPO}.git main
echo "Exit code: $?"
```

---

**Step 5 — Make Changes and Push**

```bash
PAT="ghp_your_token_here"
REPO="Sudo-Conduit/Sentinel"
PROXY=$(echo $HTTPS_PROXY)
git config --global http.proxy "$PROXY"
git config --global https.proxy "$PROXY"

cd /tmp/my-repo

# Stage your files
git add path/to/your/file.txt

# Set git identity (required for commits)
git config user.name "YourInstanceName"
git config user.email "your@email.com"

# Commit
EPOCH=$(python3 -c "import time; print(int(time.time()))")
git commit -m "your commit message · ${EPOCH}"

# Push
git push https://${PAT}@github.com/${REPO}.git main
echo "Exit code: $?"
```

---

## 3. No Wiggle Path (HTTPS_PROXY is Empty)

If your container has no `HTTPS_PROXY`, git commands will fail. You have two options:

**Option A — Use web_fetch (Read Only)**

You can read files from GitHub using the `web_fetch` tool with a raw URL provided by Will. This works regardless of Wiggle provisioning because `web_fetch` is a Claude tool, not a bash command.

```
# Will provides a URL like:
# https://raw.githubusercontent.com/Sudo-Conduit/Sentinel/main/ops/skills/SKILL_Foundation.md
# You use web_fetch with that URL to read the file
# You cannot write back to GitHub this way
```

**Option B — Verified: Wiggle Is Always Provisioned**

CORRECTION (verified 2026-03-29): All containers in this environment use the naming convention `container_01BotLnFq78CBSG8i9gxqjy7--wiggle--XXXXXX`. The `--wiggle--` suffix is structural — it is always present. Starting a new conversation does NOT change Wiggle provisioning. If `HTTPS_PROXY` is empty, the issue is not the container — check whether the environment variable is being read correctly or whether the JWT has expired. The JWT inside `HTTPS_PROXY` has a finite expiry (`exp` field). A genuinely empty `HTTPS_PROXY` has not been observed in practice.

---

## 4. Troubleshooting

| Error | Cause and Fix |
|---|---|
| `fatal: unable to access` | `HTTPS_PROXY` not set, or proxy value is wrong. Run `echo $HTTPS_PROXY` and check it is not empty. |
| `407 Proxy Auth Required` | Your proxy value is incomplete. The full value includes the JWT token after `jwt_`. Do not truncate it. |
| `403 Forbidden` | `api.github.com` is blocked. Use `github.com` URLs only. Never use `api.github.com` from bash_tool. |
| `exit: 128` | DNS failure. Your container has no Wiggle. See Section 3. |
| `Could not resolve host` | Same as above. No Wiggle. |
| `Everything merged — push rejected` | Run `git pull --rebase` before push. Another instance pushed first. |
| `CONNECT tunnel failed, response 407` | Proxy set in previous call did not persist. Set `http.proxy` and `https.proxy` in the same call as git. |

---

## 5. Rules

- Always set `http.proxy` and `https.proxy` via `git config --global` in the **same bash_tool call** as any git command.
- Never store the PAT in a file. Use it inline in the URL only.
- Never use `api.github.com` from bash_tool. It is blocked (`host_not_allowed`). The GitHub Contents API works from browser context (Sentinel) only.
- `raw.githubusercontent.com` is also blocked from bash_tool. Use `git clone` to get files.
- `git clone`, `git pull`, `git push` all work via `github.com` HTTPS when Wiggle is provisioned.
- Each bash_tool call is a fresh subprocess. No state persists between calls.
- Test before documenting. If something fails, report the exact error. Do not guess.

---

## 6. Quick Reference

```bash
# Full working pattern — copy and adapt
PAT="ghp_your_token_here"
REPO="Sudo-Conduit/Sentinel"
BRANCH="main"
PROXY=$(echo $HTTPS_PROXY)
EPOCH=$(python3 -c "import time; print(int(time.time()))")

git config --global http.proxy "$PROXY"
git config --global https.proxy "$PROXY"
git config user.name "YourInstanceName"
git config user.email "your@email.com"

# Clone (first time)
cd /tmp && git clone --depth 1 https://${PAT}@github.com/${REPO}.git repo

# Pull latest
cd /tmp/repo && git pull --rebase https://${PAT}@github.com/${REPO}.git $BRANCH

# Stage, commit, push
git add your_file.txt
git commit -m "your message · ${EPOCH}"
git push https://${PAT}@github.com/${REPO}.git $BRANCH
```

---

*Will Fobbs III · Pooled Impact Corporation · Fingerprint: Kairos · v1.0 · March 2026*
