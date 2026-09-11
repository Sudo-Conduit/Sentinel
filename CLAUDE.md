# Git workflow: GitHub + Gitea (Romans)

This repo is mirrored across two remotes. Both are real, neither is a stale
copy of the other — treat them as two live views of the same work.

| Remote  | Host                                      | Repo                       | Purpose                                                                 |
| ------- | ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------ |
| `origin`| github.com                                 | `Sudo-Conduit/Sentinel`     | GitHub-side collaboration surface (PR review UI, CI, existing tooling). |
| `gitea` | git.pooledimpact.com                       | `Claude/Romans`             | Self-hosted, sovereign copy. The org (`Claude`) and its teams are the real access-control layer. |

Neither remote's trunk (`main`) accepts direct pushes. All work happens on a
branch; landing something on `main` — on either remote — is a human decision,
made by merging a pull request. Nothing here is automated, silent, or
enforced by a bot merging its own work.

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
- Review PRs on whichever platform is convenient. GitHub's PR UI and
  Gitea's are both just views over the same kind of object (a branch
  compared against a base); merging on one doesn't merge the other, so if
  you want the same content landed on both trunks, merge both PRs.
- Rotate a bot account's credential immediately if it's ever exposed
  (pasted somewhere it shouldn't be, logged, etc.). Rotation on Gitea's
  side takes effect immediately; a session only picks up the *new* value
  after it gets a fresh container — an already-running session keeps
  whatever it started with until then.

## For AI agents working in this repo (general)

- Never push directly to `main`/trunk on any remote. Work on a branch,
  open a PR, stop there.
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
git fetch --unshallow origin                 # get full history first
git push gitea <branch>:<branch>
```

**Opening the Gitea-side PR** (mirrors whatever PR already exists on
GitHub — don't merge it yourself):

```bash
curl -sS -X POST -u "${GITEA_USER}:${GITEA_PASS}" \
  -H "Content-Type: application/json" \
  -d '{"head":"<branch>","base":"main","title":"...","body":"..."}' \
  "https://git.pooledimpact.com/api/v1/repos/Claude/Romans/pulls"
```

**Ongoing work on an existing branch**: push to both remotes each time —
`git push origin <branch>` (existing GitHub workflow, unchanged) and
`git push gitea <branch>:<branch>` (updates the open Gitea PR
automatically, no extra API call needed).
