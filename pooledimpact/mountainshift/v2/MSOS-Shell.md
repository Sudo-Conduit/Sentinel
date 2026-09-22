# MSOS Shell

The Shell/WASM Command Engine: a real POSIX-shaped shell whose commands
are small, single-purpose, zero-import WASM modules, orchestrated by a
thin JS host that never interprets what any command does — only
whether to let it touch the network, spawn a real process, or run in
the background. This is the reference implementation for `bootDeviceOrder`'s
eventual local shell layer described in `Kernel-Machine-Architecture.md`;
it deliberately has zero dependency on that document's Kernel/BIOS/CPU
machine model (see "Relationship to the Kernel/Machine stack" below).

Source: `pooledimpact/mountainshift/v2` — `wasm/` (C sources +
compiled `.wasm`), `commands/` (base64-embedded JS wrappers),
`ShellHost.js`/`JobTable.js`/`ProcessTable.js`/`WasmBlobProtocol.js`
(the engine), `Shell.js`/`PreflightMixin.js`/`KernelVisibilityMixin.js`
(the `ExtendX`-composable facade), `test/` (every claim below is
proven live, not asserted — see the file list at the bottom).

## The one invariant everything else follows from

**A WASM module can only ever ASK the host for something; the host
always decides.** Every module in `wasm/` has zero imports —
`WebAssembly.Module.imports()` on any of them returns `[]`. There is
no live call a module can make mid-execution: not to open a socket,
not to spawn a process, not to read a real file. The entire host
contract is two operations, always: write a request blob into the
module's own linear memory, call `run(ptr, len)`, read a response blob
back out. This is the same shape this project's own `memorymap.wasm`
already established — a shared flat buffer at fixed byte offsets,
gated by exported entry points, never a back-and-forth of
imported/exported calls.

This one property is what makes every other design decision below
non-negotiable rather than stylistic: a command module cannot have
ambient authority over anything, because it has no mechanism to reach
anything on its own.

## The wire protocol (`WasmBlobProtocol.js`)

Every module speaks the same request/response shape:

```
Request:  cwd\0 uid\0 home\0 PATH\0 cmdline\0 stdinlen\0 <stdinlen raw bytes>
          nfiles\0 (path\0 length\0 <length raw bytes>){nfiles}
Response: new_cwd\0 rc\0 <remaining bytes are stdout>
```

Length-prefixed, not NUL-terminated, for file/stdin content — a real
byte can legitimately be `\0`, and an in-band terminator would corrupt
that content on the first collision (the exact reasoning
`MemoryMapArena.js`'s own header documents for its own byte payloads).

Real content (file bytes, a directory's raw listing, `/etc/passwd`,
stdin from an earlier pipeline stage) never arrives via a call a
module makes mid-execution — there is no import to make it through.
Whoever calls `ShellHost.createShell()` gathers that content itself,
entirely outside any WASM interaction, and hands it in via
`options.files`.

## Delegation markers: the only way a module asks for help

A module that needs something only the host can provide doesn't get
an import for it — it returns a specially-shaped response instead of
an answer, and the host recognizes the shape:

| Marker | Emitted by | What it asks for | Host's entire response |
|---|---|---|---|
| `EXEC\0cmdline\0` | `shell.wasm` | "I don't implement this command myself" | Resolve `cmdline`'s head against the command-module registry and run that module instead (a fallback path — see below, the JS-side splitter usually resolves this before shell.wasm is even asked) |
| `SOCKET\0host\0port\0tls\0len\0<bytes>` | `curl.wasm` | "Open this exact raw connection and write these exact bytes" | A real TCP/TLS connect, write, and collect-until-close — zero HTTP interpretation, ever |
| `SPAWN\0program\0argc\0(arg\0){argc}stdinlen\0<bytes>` | `node.wasm`/`php.wasm` | "Run this exact whitelisted program with this exact argv/stdin" | `child_process.spawn()`, checked against a host-owned allowlist the module has no way to bypass, since it can only ever name the ONE program it's hardcoded to ask for |

Each marker follows the identical two-phase idiom: phase 1 (no answer
file present yet) computes what's needed and asks; phase 2 (the
answer handed back as a file, e.g. `/dev/socket_response` or
`/dev/exec_response` — same mechanism `whoami` already uses for
`/etc/passwd`) parses the real result and produces the final response.
`curl.wasm`/`node.wasm`/`php.wasm` are stateless across these two
calls — a fresh `WebAssembly.Instance` for phase 2 is fine, since
nothing needs to survive except what's already re-sent in `cmdline`.

**What never crosses these markers:** any interpretation of what the
real result means. `ShellHost.js` never parses HTTP (that's
`curl.c`'s job, including the chunked-transfer-encoding decoder) and
never decides whether a spawned program's output looks right (that's
`node.c`/`php.c`'s job, or the caller's). The host moves bytes and
enforces policy; the module makes sense of them.

## Pipeline routing lives in JS, not in `shell.wasm`

`shell.wasm` is Native-only — it owns builtins (`cd`, `cat`, `grep`,
`whoami`, `which`, `exit`) and runs the pipeline stages it recognizes
as one real multi-stage call. Deciding whether a given command is
Native, a separate command module (`ls`, `curl`, `node`, `php`), or
eventually a VFS-backed or machine-to-machine target is never
`shell.c`'s job — `ShellHost.js` parses the pipeline itself (a cheap
top-level split on `|`) *before* calling `shell.wasm` at all, so
routing is decided up front instead of discovered mid-pipeline. This
mirrors the one rule real Unix never breaks: `ssh host 'ls | grep x'`
runs entirely on the remote shell because the whole quoted pipeline
was handed to ONE shell — a pipeline never splits execution mid-stage
across two schedulers by accident. A stage resolving to a command
module runs as its own atomic unit (module.wasm has no internal
pipeline support); everything else joins the largest contiguous run
`shell.wasm` executes as one real pipeline, with each group's stdout
threaded into the next group's `stdinlen`/`stdin` field.

## `top.wasm`: the one stateful module

Every other module gets a fresh `WebAssembly.Instance` per call — no
state needs to survive. `top.wasm` is different on purpose: it has to
report a running tick count across many separate calls, which only
works if its own linear memory survives between them, which only
happens if `JobTable.js` keeps the SAME instance alive for a job's
whole lifetime and calls `run()` on it again and again (`"top"` to
start, `"top --tick"` to advance, `"top --stop"` for a final frame).
`top.c` never resets its own tick counter — the only piece of state
this whole engine has that outlives a single call. It renders whatever
`/proc/jobs` snapshot text it's handed (JS's own real job-table
content, gathered outside any WASM call, same idiom `whoami` uses for
`/etc/passwd`) — `top.c` itself has no notion that "job control"
exists as a concept.

## Job control lives entirely in JS (`JobTable.js`/`ProcessTable.js`)

Same split as a real kernel and shell: the kernel only ever answers
`kill(pid, sig)`; it has no idea what `bg`/`fg`/`jobs` mean, because
those words only exist in the shell process's own bookkeeping. Here,
`ProcessTable.js` is that bookkeeping layer, unifying two genuinely
different kinds of long-running thing under one pid space:

- A **stateful WASM tick-job** (`top &`) only advances when polled —
  `ProcessTable.js` auto-ticks it on a real interval until killed.
- A **real spawned process** (`node ... &`/`php ... &`) runs on its
  own the instant `child_process.spawn()` starts it, whether or not
  anything is still awaiting its completion.

`ps`/`jobs`/`fg`/`bg`/`kill` are pure JS builtins, intercepted by
`ShellHost.js` before any pipeline splitting or WASM call at all —
`shell.wasm` never learns a "job" concept exists. `kill(pid)` doesn't
care which kind of job it's aimed at: a tick-job gets its interval
stopped and one final `--stop` call; a spawned process gets a real
`SIGTERM` to its real OS pid (verified live via
`process.kill(pid, 0)` throwing `ESRCH` after — this engine's own
running theme is proving real effects, not trusting internal
bookkeeping).

## The `ExtendX`-composable facade (`Shell.js`)

`Shell.js` wraps the engine the way `MountainShift.js` wraps the
BIOS/Kernel/CPU boot chain: a plain, `ExtendX`-composable `class Shell`
(not a `BaseClassX` subclass — matching `CPU.js`'s own precedent, a
runtime engine, not schema-tracked domain state) instantiated inside
an opaque factory closure. `ShellFactory(options).boot()` resolves to
a frozen capability object — `{ok, exec, run, ps, jobs, fg, bg, kill}`
— and no command logic is reimplemented; every method is a thin call
into the same `ShellHost.js` engine the tests already exercise
directly.

Deliberately omitted, unlike `MountainShift.js`: the additional
full-trap Proxy layer. That's defense-in-depth against one specific,
named threat (a DevTools Local Overrides payload running in a real
page's global scope, offline, zero user interaction) that doesn't
apply to Shell running server-side in Node. If Shell is ever also
loaded into a browser/DevTools-injectable context, revisit this
decision rather than assuming it still holds.

### `PreflightMixin.js` / `KernelVisibilityMixin.js`

`PreflightMixin.js` generalizes the shape `SecurityMixin.js` already
used once (a same-named wrapper per `BaseClass.prototype` method,
running a check before calling `this.super[name]()`) into a reusable
`createPreflightMixin(BaseClass, {before, after})` factory — nothing
new added to `ExtendX`, since the `this.super()`/`next()` chain
already IS preflight/postflight composition. This is the intended home
for concerns like an egress-policy mixin over `curl` calls or a
max-ticks budget over `node`/`php` spawns — composed onto `Shell`
without touching `Shell.js`'s own class body, via its
`composeMixins(Shell)` construction hook (needed since `Shell.js`
never exports the `Shell` class directly).

`KernelVisibilityMixin.js` is the first real example: it mirrors a
Shell background-job start into a real Kernel's `fork()`, so a unified
Terminal `ps` can show Shell's jobs alongside Kernel's simulated ones.
It deliberately does NOT unify pid spaces or forward `kill()` — see
`Docs/MSOS-Cleanup-Roadmap.md`'s Category G.9 for why that's a real,
tracked gap rather than something silently half-done.

## Relationship to the Kernel/Machine stack

`Kernel.js`'s `tick()` is a simulated x86 register-level scheduler —
each call advances a shared `CPU.js` instance's registers one
fetch/decode/execute quantum for a "process." Shell's jobs (a
backgrounded `top` tick-job, a real spawned `node`/`php` process) are
not simulated CPU-bound programs; nothing about them could
meaningfully run under that round-robin register-level scheduler.
Wiring Shell's execution INTO Kernel's `tick()` would be a category
error, not an integration. And an ISO, in this codebase (see
`ISO.js`), is a boot install-image manifest — a data payload
`BIOS.boot()` installs FROM, not a place runtime logic lives. Shell's
code is a peer runtime engine, the same category as `MountainShift.js`
itself, never install-manifest data or Kernel-scheduled work. The one
integration point that DOES make sense — unified `ps` visibility — is
exactly what `KernelVisibilityMixin.js` provides, as a bolt-on, not a
structural dependency.

## Tests

`test/Shell.wasm.test.js`, `test/Curl.wasm.test.js`,
`test/Spawn.wasm.test.js`, `test/Top.wasm.test.js`,
`test/JobControl.test.js`, `test/PreflightMixin.test.js`,
`test/Shell.opaque.test.js`, `test/KernelVisibilityMixin.test.js` — all
wired into `test/run-all.js`. See `Docs/MSOS-Cleanup-Roadmap.md`'s
Category G for the scored backlog entry and current pass counts.
