# MSOS-Shell-WAKEUP.md

Scoped companion to the repo-root `WAKEUP.md`. That one says *don't trust
your working summary — check dates, check the transcript, check git*. This
one says *here is what the shell/WASM engine actually is, and here is the
specific way you are about to get it wrong.*

Written 2026-09-17 by a session that got it wrong roughly eight times in
one evening, each time confidently. Every claim below is labeled either
**MEASURED** (with the command to re-run it) or **UNVERIFIED**. Nothing
here is reasoning presented as fact — that was the whole problem.

---

## 1. The frame you will lose within ten minutes

**`"ls /"` is the interface.** Four characters. Working directory, command,
and argument, all in the string. Nothing in it names a runtime.

- The C wants a **string or a scalar**. Nothing else. Not WASM memory, not
  `fs`, not a Node path.
- The answer belongs to **whoever runs it**. Your `/` here is this
  container's `/`. The user's `/` is their machine's. Same string, different
  truth, neither baked in.
- **JS and WASM are required nowhere.** They are one doorway. PHP is
  another (Wasmer PHP extension, Extism PHP SDK, or FFI+Wasmtime — all real,
  all off the shelf, and the Wasmer extension is fast because it is a native
  extension, not per-call FFI marshalling). The number of doorways is
  open-ended; that is the design, not a side effect.
- Therefore the IIFE deliverable is **not the system**. It is the JS-side
  door, peer to the PHP one.

### The prior that will re-derive itself: "WASM is a sandbox that denies C"

It is not. WASM is a compilation target — an ISA — not a supervisor. It does
not grant or withhold. The C decides what it does and declares its own
interface; the runtime meets it.

This session asserted the jail framing **three separate times after being
explicitly corrected**, and twice rebuilt it as "architecture" (an invented
WASI-vs-zero-import decision fork; an invented shared-memory mechanism for
PHP). Root `WAKEUP.md` says *"being told once doesn't retire it."* Correct.
Assume you still hold this prior right now.

---

## 2. Artifacts that are AI misses — do not build on them

Both exist in-tree and both look load-bearing. Neither is.

| file | what it actually is |
|---|---|
| `wasm/lsreal.c` / `lsreal.wasm` | **Proof only.** Built to demonstrate to AI instances that C in WASM can do real I/O. Never wired, never shipped. Not a candidate implementation. |
| `native/msos.c` | **Also an AI miss.** Off-mainline. Its header does state the real contract well (*"a string in, a string out … does not know or care what ran behind the door"*) but it is not part of the system. |

`lsreal.wasm` is shaped incompatibly anyway — **MEASURED**: it imports
`wasi_snapshot_preview1.{fd_readdir,fd_write,proc_exit}` and exports
`_start`, where `shell/ls/curl.wasm` have zero imports and export
`run(ptr,len)`. Do not read that difference as a decision waiting to be made.
Nobody proposed it.

```bash
node -e "const fs=require('fs');for(const f of ['wasm/ls.wasm','wasm/lsreal.wasm']){const m=new WebAssembly.Module(fs.readFileSync(f));console.log(f,WebAssembly.Module.imports(m).length,WebAssembly.Module.exports(m).map(e=>e.name).join(','))}"
```

---

## 3. Measured facts (re-verify, don't re-derive)

**The request-blob preamble is inert.** `cwd\0 uid\0 home\0 PATH\0` change
nothing. Feed `curl.wasm` `uid:999999`, `cwd:'/nope'`, junk PATH — the
response is **byte-identical** (83 bytes, same SOCKET marker, same HTTP).
The C parsed argv, parsed the URL, chose port 80, set tls 0, and composed
`GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n` itself.
The preamble is a workaround for an expensive door, not a design. This is
the single most useful thing to run first — it converts Fact #2 from
agreement into knowledge.

**`shell.wasm` knows exactly one external command.** `wasm/shell.c:592`:

```c
static const char *external_commands[] = { "ls", NULL };
```

Hand `shell.wasm` a curl/node/php/top command and it returns **rc=127,
"command not found"** — not an EXEC delegation. Those work only because
`ShellHost.js`'s `groupStages()` pre-routes them in **JS** before
`shell.wasm` is ever consulted. The mechanism shell.c wants is already
built and correct (see its own comment at 584–590: *"lookup() failing …
means 'someone else's job'"*); the array is just stale. The host is
currently doing the shell's job.

**Gitea auth is one round trip.** Preemptive `--header 'Authorization:
Basic …'` → server sees exactly one GET → 200. No challenge, no jar, no
state threading. Do not design an auth conversation; there isn't one.

**The engine is not broken; your container is the variable.** `end()` vs
`write()` on the socket: direct `127.0.0.1` → 151B either way (which is why
`Curl.wasm.test.js`'s 12 real assertions pass); through this sandbox's
CONNECT relay → `end()` gives **0B**, `write()` gives **974B**. `end()` is
*correct* on a direct socket. The relay's half-close intolerance is a fact
about agent sandboxes, and matters only because other agent participants
(e.g. Claude Design) reach the world the same way. Frame it as **widening
participation**, never as a defect.

**`g_vfiles` is empty by design right now.** G.12 removed `fs` from the
host (the supply side); G.13 (the consumption side) is open and unstarted.
So `ls`/`cat`/`cd`/`whoami` failing is a **known open roadmap state**, not a
discovery.

---

## 4. Untested, and say so

- **Socket-job `kill` semantics.** `JobControl.test.js` verifies SPAWN kills
  against the real OS and tick-jobs against the table. **`curl` is not in
  that file at all.** So socket-job kill is *uncovered*, not *proven
  broken*. Two attempts to demonstrate otherwise failed — one used a
  black-hole IP (no work in flight), one `console.log`'d its own conclusion
  as if it were output.

---

## 5. The failure shapes, concretely

1. **"This code is defective" was wrong every single time.** WASI fork,
   redirect support, "curl is broken", "kill is a lie" — four for four.
   When behavior contradicts your model, the model is the thing that's
   wrong. This shape feels most like being useful, which is why it fires.
2. **A `console.log` is not evidence.** A script that prints your conclusion
   looks exactly like a script that measured something. Assert against
   ground truth outside the system — the reference technique is
   `process.kill(pid, 0)` in `test/JobControl.test.js:114`, whose assertion
   message already names the distinction: *"must actually be gone, not just
   removed from our table."*
3. **Read the existing tests before writing a harness.** Two broken
   harnesses were written while `JobControl.test.js` sat there containing
   the exact technique. "The tests are meh" is true in aggregate and still
   no excuse.
4. **Follow the trace order given.** Told `ShellHost → shell.js → curl.js`,
   this session skipped `shell.js`, went straight to curl, and then puzzled
   over an empty result. Skipping the middle step *is* where the rc=127
   finding lives.
5. **Don't claim memory you didn't write.** This session formatted a tidy
   "MEMORY:" block and presented it as saved. It wasn't. A confident scan
   and a verified fact are tonally identical — that is what makes it
   dangerous, not weakness.

---

## 6. Where the real references are

- **`test/JobControl.test.js`** — the reference test. Real OS verification,
  both job kinds, clean unknown-pid failures.
- **`test/Curl.wasm.test.js`** — 12 real assertions against a real server on
  `127.0.0.1` (in `NO_PROXY_HOSTS`, so a direct socket). The rigorous one.
- **`Terminal.pdf`** — a `pdf-lib` envelope, not a document. **MEASURED:**
  the uploaded 2026-09-10 copy (104,987B) carries 13 files; the repo copy
  (159,523B, built at `f499535`) carries 18 — the delta is exactly
  `ExtendX.js`, `SecurityMixin.js`, `StructureMixin.js`, `Registry.js`,
  `MountainShift.js`, i.e. PR #11's composition layer reaching the shipped
  artifact. **Both versions ship `PosixCommands.js`; neither ships
  `shell.wasm` or `ShellHost.js`.** The WASM engine has never been in the
  artifact. `PosixCommands.js` is the incumbent: 21 commands
  (`bg cat chmod chown demo fg id jobs kill last llm login logout ls mnt ps
  top useradd w who whoami`), contract
  `async execute(args, {stdin,stdout,stderr,cwd,vfs,session})`. That is the
  surface `shell.wasm` has to grow into; it currently covers 9 and adds 7 of
  its own.
- **Gitea PR #11** (merged) — the composition layer. **PR #25** (open) —
  root `WAKEUP.md` + `journey/journey.sqlite`.
- **`Docs/Pipeline-Browser-I-II.md`** — present, **not read by this
  session**. Given the browser half of the work, read it before assuming
  anything about browser-side behavior.
- Roadmap `1.17.0` claims `MSOS-Shell.md` was authored; it is **not on this
  branch**. Roadmaps can be ahead of the tree — check before citing.

---

## 7. Running beats reading, and it isn't close

Everything correct in this document came from executing something.
Everything wrong came from reading code and reasoning about it. That
correlation was one-to-one across an entire session. Start by running.
