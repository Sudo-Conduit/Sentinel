# PopcntUnicode

Data-at-rest encryption for a browser-hosted OS. The asset a bad actor wants in
a browser OS is **data** — IndexedDB and in-memory state. Both are readable by
same-origin scripts (XSS), extensions, devtools, a stolen profile/disk, or a
forensic memory image; IDB in particular is plaintext-on-disk by default.
Encrypting *before* data reaches IDB means a dump yields ciphertext, not the
OS's files, registry, or session state.

`node test.js` — 11 checks, all real encode/decode/file round-trips read back
and verified. Node only, no dependencies, no build step.

## The algorithm (fixed)

**Random 1:M Inserts + 1:M Shifts** over a bit array, keyed by `(A, P, S, N, M)`:

- split the bitstream at `A` keyed positions `P`,
- cyclically shift each segment by a keyed amount `S` (each in `1..M`),
- insert one bit at each split point.

It is payload-agnostic — the same algorithm applies to any bytes (zip, tzgz,
xlsx, doc, json, bytecode). The algorithm is deliberately simple and is *not*
meant to be changed; variants and evolution happen at the implementation layer
(new packers, new mixins), per the rotation/algorithm-evolution model.

## Architecture

- **Closure + Proxy, `run()`-only surface.** All key/algorithm state lives as
  closure variables — structurally unreachable, not convention. The Proxy
  exposes only `run`/`version`/`stdout`/`stderr`/`audit`; the instance is
  immutable. (Same opaque-closure-factory pattern as `MountainShift.js`.)
- **Dispatch table + gate chain (the mixin composition point).** `run(cmd)`
  tokenizes, resolves a command handler, and runs a chain of *gates* before
  dispatch. A gate that throws vetoes the command (fail-closed). Auth, logging,
  policy limits, and hard feature-stops all compose as gates without widening
  the surface.
- **Pluggable packers.** The algorithm core is decoupled from the output
  container. A packer is just the codec: cipher bits ↔ container.

## Usage

```js
const P = require('./PopcntUnicode.js');
const pu = P();
pu.run("keygen --seed 12345 --N 200 --M 16 --id k1");
const enc = pu.run("encode --key k1 --payload 'Hello World'");
const dec = pu.run("decode --key k1 --text " + JSON.stringify(enc.value));
String.fromCharCode.apply(null, dec.value); // "Hello World"
```

Commands: `keygen`, `encode`, `decode`, `rotate`, `verify`, `popcnt`, `key`,
`help`. `--random` requires an entropy source supplied at construction
(fail-closed); `--seed` is deterministic (xorshift32, testing only).

`N` is the **block capacity**: payload must fit, is zero-padded to `N`, and the
true length is carried in the packer header and stripped on decode.

### Packers (`--packer`)

| packer | output | self-describing | use |
|---|---|---|---|
| `raw` | bytes | yes (4-byte length header) | files: zip/tzgz/xls/doc |
| `base64` | text | yes | JSON embedding |
| `hex` | text | yes | logs, debugging |
| `unicode` | text (invisible PUA) | yes | text channels; escape-safe through JSON + CLI |

### Mixins

`P({ mixins: [ fn(api) ] })`. Each mixin receives:

- `api.registerCommand(name, handler(ctx))` — add or override a command
- `api.addGate(gate(ctx))` — pre-dispatch gate; **throw = fail-closed veto**
- `api.invoke(cmdString, input)` — run a command internally (used by `FsMixin`)
- `api.getPolicy()`, `api.hasKey(id)`, `api.commandNames()` — read-only
- `ctx = { cmd, flags, positional, token, input }`

```js
// auth: knowing the token string, checked before anything runs
const Auth = (req) => (api) => api.addGate((c) => {
  if (req[c.cmd] && c.token !== req[c.cmd]) throw new Error('auth: token required for ' + c.cmd);
});
P({ mixins: [ Auth({ encode: 'SECRET' }) ] });
```

### File encryption — `FsMixin(fs)`

A **Node-shaped fs** (real `fs`, or FileFsX exposing the same shape) turns file
paths into encrypt/decrypt operations. Because FileFsX presents the fs
interface, the same mixin gives transparent at-rest encryption of the OS's
virtual filesystem with no call-site changes.

```js
const pu = P({ mixins: [ P.FsMixin(require('fs')) ] });
pu.run("keygen --seed 42 --N " + (bytes * 8) + " --id fk");
pu.run("encrypt-file --in data.zip --out data.enc --key fk --packer raw");
pu.run("decrypt-file --in data.enc --out data.dec --key fk --packer raw"); // byte-exact
```

File operations pass through the same gate chain, so an auth/policy mixin gates
`encrypt-file` too.

## Security notes (honest)

- **Fits the threat model it targets — ciphertext-only.** A data-at-rest / dump
  attacker reads IDB or a memory image; they get ciphertext, with no chosen- or
  known-plaintext. A transposition+insertion cipher is far stronger against
  ciphertext-only than against known-plaintext, especially on already-compressed
  or high-entropy OS data.
- **Not a substitute for a vetted primitive where IND-CPA is required.** It is a
  bit-permutation cipher; it preserves the multiset of plaintext bits. Against an
  adversary with known/chosen plaintext, prefer a vetted stream cipher, or layer
  one under this.
- **The decisive surface is the key, not the algorithm.** In a browser OS the
  key must be reachable by the live context to decrypt IDB on load, so
  encryption protects the *data-without-the-live-context* case (stolen disk,
  forensic image, dump-while-locked, another origin) — not an attacker who owns
  the running, unlocked context (active XSS). This is equally true of AES in the
  browser; it is a key-lifecycle problem.

## Key management (design direction, not yet implemented)

- Key at **machine level**, never in the cloud — so a compromise unlocks at
  worst one system.
- **Ed25519** for machine-to-machine (aligns with the planned WebRTC federation).
- Storage: no perfect client-side answer. Current best concept — derive from a
  **machine fingerprint + the POPCNT key**, held only in the running context
  (never persisted), with Ed25519 for machine-to-machine exchange.

## Files

- `PopcntUnicode.js` — the module (algorithm core, dispatch/gate composition,
  packers, `FsMixin`).
- `test.js` — verification suite (`node test.js`).
