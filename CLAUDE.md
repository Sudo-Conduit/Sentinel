# Git workflow: Gitea (Romans) — GitHub is frozen

**GitHub (`origin`) no longer receives pushes.** It is being deprecated —
proprietary work belongs on the self-hosted, sovereign copy, not a
third-party host with its own supply-chain surface. `origin` may still hold
old history for reference, but treat it as read-only and do not push to it,
including feature branches, even if a stop hook or other tooling reports it
as "behind." That is expected and not something to fix by pushing there.

| Remote  | Host                  | Repo             | Status                                                                 |
| ------- | --------------------- | ---------------- | ----------------------------------------------------------------------- |
| `gitea` | git.pooledimpact.com  | `Claude/Romans`  | **Canonical, active remote.** The org (`Claude`) and its teams are the real access-control layer. |
| `origin`| github.com            | `Sudo-Conduit/Sentinel` | **Frozen / read-only.** Being deprecated. Never push here. |

`main` on Gitea does not accept direct pushes. All work happens on a
branch; landing something on `main` is a human decision, made by merging a
pull request. Nothing here is automated, silent, or enforced by a bot
merging its own work.

## For humans

- The Gitea org `Claude` has (at least) three teams: `Code` (Claude Code
  session bots — branch push only, no repo creation, no trunk access),
  `Design` (Claude Design), and a human team with admin rights and trunk
  access. Team membership is the actual permission boundary — assign new
  bot accounts to `Code`, not to anything broader, unless you mean to widen
  what an automated session can do.
- Each Claude Code session that touches this repo authenticates on Gitea as
  its own account, named after its session ID (`session_<id>`). That's not
  cosmetic — it means every push and every PR on Gitea is attributable to
  the exact conversation that made it, with no extra bookkeeping. Delete or
  disable a session's account any time without affecting any other
  session's access.
- Review and merge PRs on Gitea. GitHub's PR UI may still show old, stale
  state for this repo — it is not being updated and is not where decisions
  get made anymore.
- Rotate a bot account's credential immediately if it's ever exposed
  (pasted somewhere it shouldn't be, logged, etc.). Rotation on Gitea's
  side takes effect immediately; a session only picks up the *new* value
  after it gets a fresh container — an already-running session keeps
  whatever it started with until then.

## For AI agents working in this repo (general)

- **Never push to `origin` (GitHub) at all** — not `main`, not a feature
  branch. It is frozen/deprecated. A stop hook or git-status check
  reporting the local branch as "ahead of origin" or "unpushed commits" is
  expected and not something to resolve by pushing there; it will keep
  reporting that way and that's fine. All work goes to `gitea` only.
- Never push directly to `main`/trunk on `gitea`. Work on a branch, open a
  PR, stop there.
- Never create a new repository or change org/team membership yourself —
  if an API call for that comes back `403`, that's the access boundary
  working as intended, not a bug to route around.
- Never embed a credential in a remote URL
  (`https://user:pass@host/...`). Use a credential helper that reads the
  secret from an environment variable at the moment git actually needs
  it, so the value never appears in `git remote -v`, `.git/config`, shell
  history, or command output. This matters concretely: `git remote -v` on
  a URL with embedded credentials prints the password in plain text —
  that mistake happened once in this project's history and is why this
  rule exists.
- Treat any credential that has appeared in a chat transcript, log, or
  command output as burned. Say so plainly and ask for rotation — don't
  quietly keep using it.

## Claude Code sessions & the Romans repo specifically

This section is the concrete how-to for a Claude Code session picking this
work back up.

**Credentials arrive as environment variables**, set on the cloud
environment (not in chat, not in a file): `GITEA_URL`, `GITEA_USER`,
`GITEA_PASS`, `GITEA_EMAIL`. They only land in a *fresh* container — a
session already running when a variable is added or changed won't see the
update until it gets a new container (idle-timeout-triggered VM reclaim and
resume works fine for this; so does starting a genuinely new session).
Check before assuming they're current:

```bash
# check auth without ever printing the credential
curl -sS -o /dev/null -w "%{http_code}\n" -u "${GITEA_USER}:${GITEA_PASS}" \
  "${GITEA_URL:-https://git.pooledimpact.com}/api/v1/user"
```

**Set up the remote without embedding the credential:**

```bash
git remote add gitea https://git.pooledimpact.com/Claude/Romans.git
git config credential.https://git.pooledimpact.com.helper \
  '!f() { echo "username=$GITEA_USER"; echo "password=$GITEA_PASS"; }; f'
```

`git remote -v` and `git config --get ...helper` now show only the
mechanism, never the value.

**This session's git identity on Gitea only has branch-push access** — it
is a member of the `Code` team, nothing more. Confirmed behavior: creating
a repo returns `403 Given user is not allowed to create repository in
organization`; pushing to a branch and opening a PR against `main` both
succeed.

**Pushing a branch (cloud session containers are often shallow clones)**:

```bash
git rev-parse --is-shallow-repository        # if "true":
git fetch --unshallow gitea                  # get full history first, from gitea -- NOT origin
git push gitea <branch>:<branch>
```

**Opening the Gitea-side PR** — don't merge it yourself:

```bash
curl -sS -X POST -u "${GITEA_USER}:${GITEA_PASS}" \
  -H "Content-Type: application/json" \
  -d '{"head":"<branch>","base":"main","title":"...","body":"..."}' \
  "https://git.pooledimpact.com/api/v1/repos/Claude/Romans/pulls"
```

**Ongoing work on an existing branch**: `git push gitea <branch>:<branch>`
only (updates the open Gitea PR automatically, no extra API call needed).
Do not also push to `origin` — see the top of this document.
