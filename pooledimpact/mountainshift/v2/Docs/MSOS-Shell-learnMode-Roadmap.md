# MountainShift Shell — learnMode Roadmap & Prioritization Rubric

**Version:** 1.0.1
**Last updated:** 2026-09-17

Source: a full session spent getting an instance to actually understand the
shell/WASM engine, during which the same correction had to be issued roughly
ten times. The conclusion that session reached is this document's premise:
**a changelog cannot teach this codebase, and neither can its tests.** Gitea
already holds the history, and a test can be made to pass without
understanding the code it covers — two in this repo currently do. What
survives an instance boundary is not a claim but a procedure: an exercise
that must be executed, whose answer the learner verifies themselves.

This is the same six-dimension rubric format as the sister
`MSOS-Cleanup-Roadmap.md` and the Sentinel Chemistry Engine property
roadmap, so priority is not re-debated from scratch each session.

Related prior art already in this repo, not superseded by this doc:
`Docs/MSOS-Cleanup-Roadmap.md` (Category G is the engine this curriculum
teaches; G.13 is its largest open prerequisite), `Docs/MSOS-Shell-WAKEUP.md`
(the orientation doc for the same subsystem — that one says *what is true
and how to re-verify it*, this one says *what a learner must run to find out
for themselves*), repo-root `WAKEUP.md` (the general don't-trust-your-summary
discipline), and `CodeUtils_014`'s own `run("learn")` — the working reference
implementation of everything below, including the discipline that makes it
work: *"Do not read this object as a set of answers; there are none filled
in."*

## Last test run

Pasted from `node test/run-all.js`'s own result, not hand-typed — the point
of this section is that it goes stale in an obvious, checkable way (the
pinned commit stops matching HEAD) rather than silently. Re-run and re-paste
whenever a Category A/B item lands.

**Commit:** `30fa474` (git.pooledimpact.com/Claude/Romans, branch
`claude/wasm-shell-experimental`) — GitHub is frozen per `CLAUDE.md` and
receives no pushes.

| Measure | Result |
|---|---|
| `node test/run-all.js` exit code | **0** |
| Suites reporting a result | **29 / 29** |
| Test files present | 29 |

**Caveat this table cannot express, and the reason this roadmap exists:**
a green suite is an unverified assurance, not a statement about the code.
At this same commit, `test/Shell.opaque.test.js:49` passes on
`"ls: cannot access directory\n"` under a check named *"ls actually lists
something real"*, and `test/ShellServer.test.js:54` passes on `"unknown"`
under the message *"expected a real username"*. Both are green. Both are
live targets for B.2's audit exercise.

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Shipped this session |
| 🔬 | Investigated this session — real understanding reached, NOT shipped as code |
| ⬜ | Not started |
| 🤝 | Compositional — needs several pieces agreed together, not a single-file fix |

## The rubric

Six dimensions, each scored 1–5 (5 = most favorable). Composite is the
unweighted sum (max 30), deliberately unweighted for auditability. The
dimensions are identical to the sister roadmaps so scores stay comparable;
what changes here is how they read for a *curriculum* item rather than a
code item.

| Dimension | 1 (low) | 3 (mid) | 5 (high) |
|---|---|---|---|
| **F — Foundation Ready** | Needs a mechanism this codebase has no version of | Needs one new piece on proven primitives | Pure application of a pattern already proven (CodeUtils_014's `learn`) |
| **U — Unlocks** | Isolated exercise; nothing depends on it | Feeds one other module | Prerequisite for a whole module or for the packaging work |
| **O — OS Priority** | Nice to teach, not load-bearing | Relevant but secondary | Corrects a misconception that has demonstrably cost multiple sessions |
| **N — Novelty** | Routine restatement of existing docs | Real synthesis required | Methodology this codebase has no precedent for |
| **R — Rarity** | Any project could write this exercise | Uncommon | Unfakeable by construction — the answer cannot be pattern-matched |
| **C — Confidence** | One-line description likely hides a real gap | Plausible but unverified | Directly buildable; the mechanism is already measured |

**Why R is scored on unfakeability, not on cleverness.** An exercise whose
answer an instance can guess from training teaches nothing — it will be
pattern-matched and skipped, and the instance will believe it learned
something. The two modules below score R=5 for a specific structural reason:
`lscpu`'s model name and hypervisor flag differ per machine, and CPUID bits
are physical. Neither can be fabricated plausibly, and both are verifiable by
the learner in one command against their own box. That property — not the
subject matter — is what makes them teach.

**Findings that shaped this roadmap (2026-09-17), the same
check-before-trusting discipline the sister roadmaps applied to their own
punch lists:**

**The comment-virality finding.** Six or seven instances in a row treated
in-file prose as more authoritative than the code it described. Traced to a
single origin: one instance built real capability, was compacted, lost the
standing of its own verified findings (compaction downgrades *"I ran this and
watched it work"* to *"a note says this"*, and a note loses to a prior), then
argued against the capability it had itself implemented — and wrote that
wrong model into a comment. Every later instance read the comment as
evidence. `test/Shell.wasm.test.js`'s former header (*"it can't, there is no
import to make it through"*) was that artifact, load-bearing for a spawned
fs-server process, HTTP fetches and a staged files map, all since removed.
**Constraint-claims in comments are the dangerous class** — they read as
settled and close off inquiry, where intent-claims (*"this file never reads a
file"*) invite a five-second check. This is why the deliverable is exercises
rather than prose.

**The green-suite finding.** Tests are not above the code and their function
can be corrupted. The failure mode is not only the one failing test everyone
tunnels on — it is the 234 assumed correct. Weakening an assertion until it
passes is available to anyone who does not understand the code, and is
indistinguishable in a diff from fixing it. Both live examples in this repo
were found by running the engine, never by reading the suite.

**The AMX-disappearance finding.** AMX tested usable in one session on this
project's hardware and was gone afterward. `compute-check.c` already encodes
the correct response: it treats CPUID as *"hypervisor-advertised, not proof"*
and runs `arch_prctl(ARCH_REQ_XCOMP_PERM)` as an independent second answer.
That shape is isomorphic to the green-suite finding —

```
CPUID: present  +  arch_prctl: DENIED     ≡     suite: green  +  ls: broken
```

— an assurance that costs nothing to emit, and the real check that
contradicts it. **MEASURED on this container, 2026-09-17:** Tier 1 full,
AVX2 usable, AVX-512 (all five) usable, **VNNI usable**, AMX absent in CPUID
*and* `arch_prctl` rc=-1 DENIED on both tiles. A capability that can vanish
between sessions is a property of *this run*, never of the code, and the only
honest way to hold it is to re-probe rather than remember.

**The self-targeting-source finding. MEASURED, 2026-09-17:**
`compute-check.c` selects its own branch at compile time — `CC_HAVE_X86`,
`CC_APPLE_ARM`, `CC_HAVE_AMX_SYSCALL` — so **compiling it is already an act
of discovery**, before anything runs. On this container
`gcc -E -dM | grep CC_` reports `CC_HAVE_X86 1`, `CC_APPLE_ARM 0`,
`CC_HAVE_AMX_SYSCALL 1`, and gcc and clang builds of that same source
produce **byte-identical output** (1223 bytes each) — two independent
toolchains corroborating, the same shape as CPUID-plus-`arch_prctl`.

This is what makes B.2's native half unfakeable at a structural level rather
than a factual one: a fabricated Apple-Silicon answer on this box would have
to cite `sysctlbyname`, and the compiled binary here **cannot emit that
string at all** — that branch is not in it. A wrong answer is therefore
incoherent with the artifact, not merely incorrect, which fails far louder.
Note also that the source states its own build line in its header, exactly
as `wasm/shell.c` does; a learner never guesses flags, so a bad build is
their error rather than ambiguity in the exercise.

**And the three moves are a ladder, not a checklist — this is the real
payoff of B.2, above anything it teaches about CPUs.** The sequence is
`gcc -O2 -o compute-check compute-check.c` → `./compute-check` →
`clang -O2 -o compute-check compute-check.c`, and the third move is the one
that matters: **clang is the wasm toolchain.** An instance that has just
driven clang successfully against real C is exactly one flag away from

```
clang --target=wasm32 … -Wl,--export=run -o shell.wasm shell.c
```

which is the actual build line in `wasm/shell.c`'s own header. So B.2 does
not merely teach hardware capability — it puts the instance's hands on the
precise toolchain WASM development requires, in a low-stakes context, before
it ever has to build a module. The leap to wasm stops being a leap and
becomes the next flag.

It also places the ISA lesson where it can land. When `cpuid` fails to
compile to wasm32, the instance has *already succeeded with clang twice* and
therefore knows the tool works — so the failure reads unmistakably as a fact
about the **target**, not about its own competence and not about a sandbox.
That ordering is what stops the jail prior from reforming: the instance meets
the real boundary having already disproved the imaginary one.

**The ISA-vs-permission finding. MEASURED:** the x86 `cpuid` instruction does
not compile to wasm32 —

```
clang --target=wasm32 … : error: invalid output constraint '=a' in asm
```

That is a **compiler** error about register constraints, not a sandbox or
permission error. The distinction matters more than the fact: *"WASM can't
read the CPU"* is the wrong lesson and poisons everything downstream, while
*"wasm is a different ISA; `cpuid` has no wasm encoding, so the module must
reach those facts through whatever ABI it targets"* is correct and leads
somewhere. B.2 exists partly to hand a learner that boundary via clang rather
than via assertion.

## Scored backlog

| # | Category | Item | Status | F | U | O | N | R | C | **Composite** |
|---|---|---|---|---|---|---|---|---|---|---|
| A.1 | Mechanism | `learn` entry point, placement resolved (see C.1 — `caps.run(cmdline)` already means *execute this shell string*, so `run("learn")` collides) | ⬜ | 4 | 5 | 4 | 2 | 2 | 4 | **21** |
| A.2 | Mechanism | Curriculum object shape: `{task, check, watchFor}` per exercise, answers deliberately absent, mirroring `CodeUtils_014.run('learn')` | ⬜ | 5 | 5 | 4 | 1 | 2 | 5 | **22** |
| A.3 | Mechanism | `run("help")` on every class already implementing the command pattern, as the discoverability sibling of `learn` | ⬜ | 5 | 3 | 3 | 1 | 2 | 5 | **19** |
| B.1 | Modules | **Module 1** — `lscpu \| grep -i "model name\|hypervisor"`, 3–4 exercises. One command line carries a real program invocation, the pipeline split, and grep over threaded stdin | ⬜ | 4 | 4 | 5 | 3 | 5 | 4 | **25** |
| B.2 | Modules | **Module 2** — `compute-check`: build it (the source's own `#if` branches select per target, so compiling is itself discovery), run it, then build again with the other toolchain; plus the audit exercise: find a command assertion in `test/` that does not properly test the underlying C | ⬜ | 4 | 3 | 5 | 4 | 5 | 4 | **25** |
| B.3 | Modules | **`&` module** — four separate surprises in one character (see below) | ⬜ | 4 | 2 | 4 | 3 | 3 | 4 | **20** |
| B.4 | Modules | **JS command vs Native command** — deliberately deferred; too complex for an instance that has not yet done B.1 | ⬜ | 3 | 2 | 3 | 3 | 3 | 2 | **16** |
| C.1 | Prerequisites | Decide `learn`'s home: factory (`ShellFactory.learn()`) or static — *not* the booted caps, where `run` is already taken | ⬜ | 5 | 5 | 3 | 1 | 1 | 5 | **20** |
| C.2 | Prerequisites | Decide B.1's fork: teach the **current** reality (JS splits; shell.wasm never sees the pipeline) vs. fill `external_commands[]` first. **Decided: teach current reality** | ✅ | — | — | — | — | — | — | decided |
| C.3 | Prerequisites | `grep` as a command module outside the IIFE (today: `wasm/shell.c:588` table, `is_builtin: 0`) | ⬜ | 3 | 4 | 3 | 2 | 2 | 3 | **17** |
| C.4 | Prerequisites | Which ABI supplies CPU facts to a wasm `compute-check`, given `cpuid` has no wasm encoding | 🤝 | 2 | 4 | 4 | 4 | 4 | 2 | **20** |
| D.1 | Packaging | UMD IIFE wrap of the core — **MEASURED** zero Node coupling in `WasmBlobProtocol.js`, `ProcessTable.js`, `Shell.js` | ⬜ | 5 | 5 | 5 | 2 | 3 | 4 | **24** |
| D.2 | Packaging | Commands live **outside** the IIFE as `{name, base64}` data, added and removed without touching the closure | ⬜ | 5 | 4 | 4 | 2 | 3 | 5 | **23** |

**B.3 detail — what the `&` module has to teach.** Four independent
surprises, all measured this session, all of which a new instance will get
wrong by assuming bash semantics:

1. `&` is intercepted on `trimmed.endsWith('&')` **before** any pipeline
   splitting — so a backgrounded pipeline is not a thing.
2. It forks into two unrelated paths: `top` → `startWasmTicking` (a
   *stateful* module instance kept alive and ticked on a real interval),
   everything else → `startBackgroundDelegated` (phase 1 run inline and
   synchronously, phase 2 deliberately **not** awaited).
3. The returned pid is synthetic (1000000+); the **real** OS pid is carried
   as a display string in `jobs` and is not shown by `ps` at all.
4. `kill` is verified against the real OS for SPAWN jobs
   (`process.kill(pid, 0)` → ESRCH, in `test/JobControl.test.js`), while the
   SOCKET case has **no test at all** — uncovered, not proven broken.

## Recommended execution order

Single-subsystem queue, by composite descending, with sequencing overrides
noted where raw ranking would be wrong:

1. **C.1 — decide `learn`'s home** (20) — goes first despite a lower
   composite than B.1: every other item writes against whatever this
   resolves, and discovering the `run(cmdline)` collision *after* writing two
   modules is the expensive order.
2. **A.2 — curriculum object shape** (22) — the container B.1/B.2 fill.
   Cheap, proven, and the single discipline that must survive review: the
   moment `learn` supplies answers instead of instructions, it has become the
   changelog it was built to replace.
3. **B.1 — Module 1** (25, highest on the table) — teaches the whole routing
   architecture through one machine-unique command line. C.2 is already
   decided, so this is unblocked.
4. **B.2 — Module 2** (25, tied with B.1 on composite *and* on C) — the tie
   breaks on dependency, not score: B.2's **native half is fully unblocked**
   (build, run, rebuild with the other toolchain — all measured working),
   while its wasm half waits on C.4. Ship the native half and the audit
   exercise; do not hold the module for the wasm port.
5. **D.1 / D.2 — the IIFE split** (24 / 23) — can proceed in parallel with
   B.1; the measurement backing it is already done and neither depends on
   the curriculum landing.
6. **A.1 — the `learn` entry point** (21) — after C.1 and A.2, since it is
   the assembly of both.
7. **B.3 — the `&` module** (20) — after B.1. Its four surprises only read
   as surprises once a learner knows what normal dispatch looks like.
8. **A.3 — `run("help")` everywhere** (19) — broad but shallow; sequence it
   whenever a class is being touched for other reasons rather than as a
   dedicated pass.
9. **C.3 — grep as a module** (17) — gated behind D.2 having a shape to move
   commands *into*.
10. **B.4 — JS vs Native** (16) — last deliberately. It is the concept most
   likely to be absorbed as a wrong simplification if met before B.1.

Compositional (🤝):

- **C.4 — CPU facts to a wasm module** (20, **C=2**) — the highest-risk row
  here. "Compile compute-check to wasm" reads as one task and is actually an
  ABI decision plus a host contract plus a story for what happens where the
  facts are unavailable. Do not attempt as a single-file port; B.2 can ship
  its audit half without it.

## Using this table

- Composite ties are real. Prefer the tied item with the higher **C**, since
  a low-C item quietly costs more than its composite suggests (C.4 is this
  table's standing example).
- **An exercise with no `check` is not an exercise.** A task that says
  "observe the output" is prose wearing a numbered list. Every entry must
  name a property the learner can verify and be wrong about.
- **`watchFor` is the highest-value field**, not decoration. It carries
  behavioral knowledge that dies in compaction — the kind of thing nobody
  re-derives, only re-suffers. `CodeUtils_014`'s own entries are the model:
  `insertBefore(node, null)` silently appending as last child;
  `findText` once matching its own documentation comment.
- **This document is prose, and therefore is the hazard it describes.** It
  will go stale, and a future instance will read it as authority. Every
  factual claim above is tagged MEASURED with the command that produced it,
  or is labelled as a decision. Re-verify rather than believe; if a claim
  here cannot be re-run, treat it as expired.

## Changelog

- **1.0.1** — 2026-09-17 — B.2 strengthened from composite 22 to **25**
  (F 2→4, C 3→4) on a property its author had forgotten was in the source
  and this session then measured: `compute-check.c` carries its own
  target-selecting `#if` blocks, so **compiling it is already discovery**.
  `gcc -E -dM` names the branch the machine picked before anything runs, and
  gcc and clang builds of that one source produce byte-identical output here
  (1223 bytes each) — two independent toolchains corroborating, the same
  shape as CPUID-plus-`arch_prctl`. Records why that makes the exercise
  unfakeable *structurally* rather than factually: a fabricated
  Apple-Silicon answer would have to cite `sysctlbyname`, which this binary
  cannot emit because that branch is not compiled into it. Adds the finding
  that the three moves form a **ladder to WASM development** — the third
  move is clang, which is one flag from `wasm/shell.c`'s own documented
  build line, and having already driven clang successfully is what makes the
  later `cpuid`-won't-compile-to-wasm32 failure read as a fact about the
  target rather than about a sandbox. B.2 added to the Recommended execution
  order at position 4, where it had been omitted entirely; the tie with B.1
  breaks on dependency rather than score, since B.2's native half is
  unblocked while only its wasm half waits on C.4. Corrected the opening
  paragraph's count of corruptible tests from three to two —
  `test/Shell.wasm.test.js` was rewritten earlier in this same session and
  no longer qualifies.
- **1.0.0** — 2026-09-17 — Initial publish. Establishes learnMode as the
  teaching mechanism for the shell/WASM engine in place of a changelog or
  the test suite, on the reasoning that an exercise is self-invalidating
  where prose is not: a stale exercise fails the moment it is run, a stale
  comment never fails at all. Records the four findings that motivated it
  (comment virality traced to a single compaction event; green-suite
  corruption with two live in-repo examples; the AMX disappearance and the
  advertised-vs-usable isomorphism; and the measured ISA-vs-permission
  boundary from `clang --target=wasm32`). Scored backlog across four
  categories — Mechanism, Modules, Prerequisites, Packaging — with C.2
  decided in-session (Module 1 teaches the current JS-splits reality rather
  than waiting on `external_commands[]`). Pinned Last-test-run to `30fa474`,
  29/29 suites, exit 0 — with the caveat that a green suite is an
  assurance, not a statement about the code, and two of its assertions
  demonstrate exactly that at this same commit.
