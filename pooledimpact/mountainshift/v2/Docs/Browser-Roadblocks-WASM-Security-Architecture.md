# Browser Roadblocks, WASM Syscalls, and the Security Architecture Behind Hardware Revival

**Author:** Will Fobbs
**Company:** Pooled Impact
**Date:** July 22, 2026
**Version:** 1.0

## Summary

This document records the resolution path for seven browser-specific roadblocks identified in building an OS-like architecture (BaseClassX, FileFsX, procd, the Terminal) on top of a browser tab: the browser security model, browser ephemerality, the absence of real sockets, the inability to execute after the browser closes, the impossibility of a real boot sequence, the collapse of kernel/OS privilege separation, and the absence of real install/reinstall/uninstall semantics. Each was judged unsolvable by better JavaScript engineering alone, because each stems from what a browser tab is deliberately designed to withhold, not from an engineering gap. The resolution is not a single fix but a layered architecture: a persistent, off-browser Special Thread; a first-party, zero-dependency syscall layer authored in C and compiled to WASM; a multi-target compiler pipeline (JS/PHP/Python → AST → WAT, or → ASM → Hex → WAT, or → ASM → Hex → ROM/native executable) spanning seven ISAs; a generalized device-mount abstraction with mockable, browser-mediated, and Special-Thread-backed tiers; and a security and licensing architecture (WASMX, AES + Ed25519, machine fingerprinting, RandomBytes, time-bound rotation, no central server) built to protect the resulting intellectual property and its users without ever depending on secrecy of design.

This document also captures why the work matters beyond the architecture itself: seven real ISAs and a working compiler pipeline make it possible to give genuine new purpose to decades-old, otherwise landfill-bound hardware — TI-86, TI-92, early iOS devices, BlackBerry 9900 — rather than treating them as obsolete, with real Education, Training, and Business use cases attached to that revival.

## 1. The Seven Browser Roadblocks

**Browser security model.** A browser tab has no privilege rings, no syscall table, and no raw hardware access — every capability is mediated by a permission-gated Web API or unavailable outright. Interface Polymorphism (satisfying an existing contract with a different implementation) works only where a Web API exists to satisfy the interface against; there is no API for ring-0 execution, arbitrary process spawning, or raw memory access, so nothing requiring those has a substrate to work with, regardless of engineering effort.

**Browser ephemerality.** A tab is not a process with an independent lifecycle. Closing it, navigating away, or the OS reclaiming a backgrounded tab can terminate everything with no guaranteed graceful shutdown. There is no PID-1 equivalent surviving tab churn; every reload is closer to a cold boot than a warm restart.

**Sockets.** A web page cannot open a raw TCP/UDP socket and can never listen for one. Only WebSocket (a client to a WebSocket-speaking server) or WebRTC (requiring signaling and NAT-traversal infrastructure) are available, and both require an off-browser counterpart. This is a hard wall, not a hard problem — no cleverness produces a listening socket inside a tab.

**Execution after the browser closes.** An OS's defining promise is that state keeps running independent of whether anyone is watching; a browser's defining design principle is the opposite, for privacy, battery, and security reasons. Service Workers can run briefly post-close but with no durability guarantee — nothing resembling a real daemon.

**Boot (BIOS, CPU).** There is no real boot sequence to intercept or emulate in a tab; "booting" can only mean HTML/JS finishing initialization, which has no relationship to POST, reset vectors, or memory training on real hardware.

**Kernel vs. OS.** A kernel's defining property is a hardware-enforced privilege boundary. No JS running in a tab ever reaches ring 0; the real kernel (the browser engine, and the host OS kernel beneath it) is permanently inaccessible. Any "kernel" built in JS is a userland simulation with no privilege wall protecting it from its own userland — every permission check is convention-enforced, not hardware-enforced.

**Installation/reinstall/uninstall.** Real OS installation writes to storage the OS itself controls, independent of any running instance. In a browser, "installing" can only mean a PWA manifest/Service Worker caching the shell, or FileFsX's IndexedDB/OPFS data persisting across reloads — both are data persistence, not OS installation. There is no bootloader, no dual-boot, no true uninstall reclaiming resources the way deleting a root filesystem does.

## 2. The Special Thread

The resolution for sockets, post-close execution, and kernel/OS separation is the same primitive: a persistent process running entirely outside the browser sandbox — the Special Thread (concretely, the headless Node or PHP projection already identified as the simpler backend). It is a real OS process with real sockets (including listening sockets), real fork/exec, a lifetime independent of any tab, and a real privilege boundary enforced by the actual host kernel underneath it.

The browser's role shrinks to exactly what a tab is good at: ephemeral, permission-gated, disposable presentation. The browser "knocks on the door" — sends a request — and the Special Thread answers, holding whatever session, job table, or trace history the interaction requires, durably, regardless of how many tabs open, close, or crash. This is the stateless-vs-dynamic TTY distinction applied at the browser/backend boundary: every browser-side knock is a stateless TTY interaction (no continuity guaranteed, reproducible, disposable), while the Special Thread holds the dynamic session (login, jobs, trace) durably. It also resolves kernel/OS separation for real rather than by convention: FileFsX/BaseClassX/procd running inside the Special Thread sit on a real OS kernel with a real privilege wall beneath them — a rogue command genuinely cannot reach kernel memory, because there is a real ring boundary now, not a discipline the code merely maintains.

The open design parameter is the knock's transport (HTTP request, a WebSocket held open only while foregrounded, Server-Sent Events for push, long-polling) and whether a knock carries a session token so the Special Thread can resume a caller's dynamic session, or whether every knock starts anonymous until `login` establishes one.

## 3. WASM as First-Party Syscalls

A materially stronger move than delegating everything to an external Special Thread is pulling the syscall layer itself into a WASM binary authored end-to-end in C, with zero dependency on emscripten's or wasi-libc's networking or filesystem shims. The real precedent is Tailscale's browser build: the WireGuard protocol logic runs entirely in WASM, and the browser is asked for exactly one primitive it can actually provide — a WebSocket to a relay — with everything above that (framing, handshake, retransmission) owned by the WASM module itself.

Three tiers must be kept distinct:

- **WASM-through-APIs** — WASM logic sits behind a browser-provided API (WebUSB, WebSocket) and is bounded by whatever that API permits. This is real, but the API's shape constrains what's possible.
- **WASM-as-first-party-syscalls** — the syscall semantics themselves (memory management, scheduling, protocol framing) are authored in C, compiled down, and depend on no external library or Web API for their logic. Only a single, narrow physical-transport primitive crosses the host boundary; everything semantic is owned outright. This is what "zero API, external library" means precisely: the API dependency is reduced to one unavoidable byte-transfer call, with the syscall behavior fully self-authored and auditable.
- **JS-tier scheduling** (SharedArrayBufferX, procd's tick loop) — timer/interval-driven machinery, useful and necessary, but categorically different from a syscall layer; it schedules, it does not implement machine semantics.

An important boundary: WASM in a tab runs inside the same sandbox as JS. It has no more hardware access than JS unless the browser explicitly bridges it in — there is no path for even a zero-dependency, first-party-authored WASM module to bypass WebUSB and talk to a USB device directly. The browser API remains the only door; the difference first-party authorship makes is in what happens on your side of that door, not in whether the door exists.

**Tight composition, Unix-style.** WASM modules compose well when scoped as tightly as Unix utilities — do one thing, need almost nothing from the host to do it. The clearest illustration is a tick-only WASM module: no imports, no pthread, no syscalls, just its own linear memory and a single exported `tick()`. This composition style also yields a real, non-conventional isolation boundary that JS-side objects sharing one heap never had: each WASM instance's linear memory is its own address space, genuinely inaccessible to another module unless an import/export is explicitly wired between them. That is a partial, meaningful answer to kernel/OS separation — not real CPU ring 0, but a hardware-adjacent memory-safety wall between composed modules, closer to how a real kernel's subsystems are isolated than anything achievable in shared-heap JS alone.

Procd's tick loop does not need to be removed to adopt this. It becomes the Controller half of a Controller/Adapter pair — the same shape used everywhere else in this system — with the Adapter underneath (currently `setInterval`) swappable for a compiled tick-only WASM module without procd's own interface changing.

## 4. The Compiler Pipeline and Seven ISAs

One AST-based front end (accepting JS, PHP, and Python source) feeds three distinct backend paths:

1. **AST → WAT → Compiler → Runner.** The direct, high-level path to a WebAssembly-hosted runtime; the natural backing for the IDE's own Compile button once it moves past its current placeholder implementation.
2. **AST → ASM → Hex → WAT → Compiler → Runner.** An instruction-level stage inserted before re-lifting into WAT — this is where ISA-specific lowering happens, since ASM/Hex only make sense relative to a target instruction set. This is the path that exercises the seven built ISAs before returning to a WASM-hosted runtime.
3. **AST → ASM → Hex → ROM or runtime executable.** The same front end targeting either a real ROM image for one of the seven ISAs, or a native executable — the Special Thread output and the hardware-boot output, from the same compiler.

The third path is what makes the Boot roadblock genuinely solvable rather than merely narrated. A real ROM image, fed into a real CPU emulator or real hardware, executes real machine code from an actual reset vector — authentic POST/boot semantics, because the ISA and the image format are self-authored rather than borrowed from an inaccessible real BIOS contract. It also reopens kernel/OS separation with a stronger guarantee than WASM's linear-memory isolation: a CPU emulator faithfully implementing one of the seven ISAs can implement real privilege-ring semantics in the emulated instruction set itself, enforced by the emulator the way a real CPU enforces rings in silicon — a genuine privilege wall, one level removed from physical hardware but not a mere JS convention.

The "runtime executable" branch is the Special Thread's other face: the same AST can compile straight to a native executable, meaning the Special Thread does not need to be hand-written separately — it is another output target of the same pipeline that also produces the browser-hosted and ROM-hosted paths.

## 5. Hardware Revival: A Purpose-Driven Deployment Map

The compiler pipeline's value is concrete because it targets real, already-owned hardware spanning nearly the full lineage of consumer computing ISAs: Z80 (TI-86), 68000 (TI-92), ARM11 (first-generation iPod Touch), 32-bit ARM through the 32/64-bit transition (iPhone 4/5/7 versus X/12), Apple Silicon ARM64 with NPU (M1 through M4), Jetson Orin's ARM64 plus CUDA/tensor cores, and BlackBerry 9900 (ARMv7, physical keyboard). Roughly four million TI-86 units alone are presently landfill-bound; the same compiler pipeline that produces the ROM path in Section 4 can give them working Symbolic Math Engine, CAS, and BASIC capability instead — a genuine environmental and equity case, not just a technical demonstration, since the hardware already exists in the world and does not need to be manufactured or purchased new.

Deployment sequencing follows purpose rather than convenience:

- **Education** (IXL-style learning, reinforcement games such as a SimCity-style clone, CAS, BASIC) targets the Z80/68000/MISC tier — cheap, already-owned, offline-capable hardware, which is what makes broad access viable at all.
- **Training** (remote-area delivery at scale) is the same access argument at a larger distribution radius, explicitly framed as fulfilling the write-once-run-on-any-form-factor promise HandSpring and early .NET made but could not deliver, for lack of both mature cross-compilation and the connectivity assumptions that didn't yet hold.
- **Business** reframes the TI-86's physical link cable as a literal Mount, not a proprietary transfer protocol — see Section 6.
- The BlackBerry 9900 is chosen deliberately for its physical keyboard and mature Java runtime, which makes the JS → AST → WAT → WASM path mechanical rather than novel (Java's bytecode/VM model is already close to what WASM expects), and for being genuinely offline-first: with no browser involved at all, the Special Thread and the "tab" collapse into one local, fully self-contained dynamic session, sidestepping every browser-specific roadblock in Section 1 by simply not having a browser in the loop.

## 6. Device Mounting Generalized

FileFsX's existing mount abstraction ("each FileFsX instance is a Mount," already surfaced through the `mnt` command) generalizes cleanly from filesystem backend to physical device, because the abstraction was never actually specific to storage — it was always "some backend satisfying a contract." A TI-86 connected over its link cable becomes just another mount; everything already built on top of `mnt` and FileFsX (permission bits, `ls -l`, `chmod`/`chown`, federation across mounts) applies to a thirty-year-old calculator with no new primitive required.

This generalization needs three backend tiers behind one Device/Mount contract:

- **Mock.** A Mock Device satisfying the same contract (enumerate, open, read, write, permission-check) with no real hardware present, letting the whole surface — `mnt` listing, permission semantics, federation treatment — be built and validated before real device wiring exists. Consumers of the contract cannot tell, and do not need to tell, that they are talking to a mock.
- **WebUSB / Web Bluetooth.** Real hardware access, but browser-mediated: permission-prompted per device, per origin, and inconsistently supported (Safari implements neither; Firefox does not implement WebUSB). WASM cannot bypass this tier to reach hardware more directly — WASM in a tab shares the same sandbox as JS, so even first-party syscall logic still depends on the browser's one bridging API as its only physical channel.
- **Special Thread.** Real, unprompted, consistent access via native stacks (libusb, serial, BLE libraries), available because the Special Thread runs outside the browser sandbox entirely — the same architecture from Section 2, now backing device I/O rather than just sockets.

Which tier backs a given `mnt` entry is a deployment decision, not a code change, because all three satisfy the identical contract.

## 7. Security and Licensing Architecture

Distributing compiled artifacts (WASMX modules, ROM images, native executables) to real, physically-owned hardware across decades-long field lifetimes creates real obligations distinct from whether the artifacts work at all: protecting the intellectual property in the compiler and syscall implementations, protecting the users who run that code on devices that may never receive a security patch, and doing both without introducing a central point of failure.

**WASMX** is the encrypted, licensed module tier — Zend Guard's model (compile, encode, and license-gate proprietary bytecode) applied to compiled WASM instead of PHP bytecode.

**AES and Ed25519 play distinct, non-overlapping roles.** AES provides confidentiality: the module's bytes are unreadable without the correct key. Ed25519 provides authenticity and integrity: proof a module came from its claimed author and was not tampered with, verifiable from a public key alone with no shared secret. A stolen or copied WASMX binary is therefore both unreadable and unforgeable, covering the two failure modes DRM systems most commonly need to address, independently of each other.

**Machine fingerprinting binds decryption to a specific device rather than storing a shared secret anywhere.** This produces the architecture's most important property: blast-radius containment. A successful key extraction yields only that one device's derived key, not a master key against the fleet — the opposite of a central-server model, where one compromise is fleet-wide by construction. Per-device brute-force resistance can reasonably be more modest than an unscoped, aggregate figure as long as per-device compromise stays contained; that trade is correct here because the actual defender's win condition is "a break doesn't propagate," not "no single device can ever be broken," given millions of individually low-value physical units rather than one high-value centralized secret.

**"Do not store the information anywhere; no surface"** is the strongest form of the ephemeral-memory principle, applied to secrets rather than session state. A stored key or license file is itself the attack surface; deriving the decrypt key on demand from the machine fingerprint (compute, don't retrieve) removes the artifact an attacker would need to steal in the first place — the same posture Apple's Secure Enclave uses, where key material is regenerated from hardware state rather than read from storage.

**RandomBytes** — inserting four to eight random bytes at random locations — is a real, cheap, and user-invisible extraction-resistance layer, raising the cost of locating and extracting key material to roughly 10^80 for anyone without the extraction rule, without requiring any change to a user's passphrase or public key handling. It must be understood precisely, however: this defends against *finding* the key, not against *breaking* it once found. Shor's algorithm, which threatens Ed25519 specifically, is not a search process — it solves the elliptic-curve discrete-log problem structurally via quantum period-finding once the actual public key is in hand, and no amount of padding elsewhere in the artifact changes that algebraic relationship. Grover's algorithm, by contrast, only gives brute-force search a quadratic speedup, so RandomBytes' ~10^80 space remains meaningfully large (roughly 10^40) even under quantum-assisted brute force — meaning RandomBytes correctly extends AES's already-graceful quantum aging, while leaving Ed25519's exposure to Shor's algorithm as a separate, unaddressed axis.

**Machine-fingerprint scoping and RandomBytes compose to change the shape of the problem, not just its size.** Fingerprint binding turns a global break into a per-device one; combined with RandomBytes, the effective targeted search space for one already-identified device lands around 10^10 — a smaller number than the unscoped 10^80, and correctly so, because the defender's actual goal is compartmentalized cost per device, not maximal single-target hardness at the expense of a shared, extractable master secret.

**Time-bound rotation** (an array of fixed rotation states keyed to time) closes the "attacker has unlimited time" gap: progress made against rotation state N is worthless once the system has moved to state N+1, so unlimited attacker time no longer helps unless the attacker can also keep pace with the rotation. The only way to defeat this from outside is to control what the system believes the time to be — which requires an attacker already inside the trust boundary with privilege to tamper with the internal clock. At that point, rotation is not the thing that failed; an attacker with that level of access already has easier and more direct paths to whatever they wanted, so rotation's one theoretical weak point sits correctly outside the threat model it was built to address.

**No central server removes the Napster/supply-chain vector entirely, rather than merely hardening it.** A central license or key server concentrates trust into one node whose compromise, seizure, or legal takedown compromises or disables every dependent device at once — Napster's central index enabled a single legal action to collapse the whole network; supply-chain attacks (SolarWinds, compromised package registries) exploit the identical shape technically, propagating a single compromise to every downstream consumer who trusted the central distribution point. No server in the trust path means no such node exists to attack, subpoena, or take down — a stronger property than "we secured the server well," because a well-secured central node is still the worst-case single target by construction.

**All of the above is Kerckhoffs-compliant, and deliberately so.** AES and Ed25519 publish their full specifications because their security has never depended on secrecy of design — only on the secrecy of the key and the proven hardness of the underlying mathematical problem, validated by decades of open, adversarial public scrutiny that a secret algorithm could never earn. The architecture described here follows the same discipline at every added layer: knowing that a machine fingerprint feeds key derivation, that random bytes are inserted, or that rotation happens on a schedule gives an attacker nothing usable, because none of that is the actual secret — the secret is the specific fingerprint value, the specific byte positions and contents, and the specific rotation state at a given moment, none of which are disclosed by disclosing the method. The obscurity layers are real, additive friction on top of that foundation — raising the cost of finding the key at all — not a substitute for it; disclosure of the full scheme would cost only that bonus friction, never the underlying guarantee.

**Quantum posture requires acting on the asymmetry between the two primitives.** AES-256 degrades gracefully under Grover's algorithm, remaining roughly 128-bit-secure post-quantum. Ed25519 does not degrade — Shor's algorithm breaks it outright once a sufficiently large quantum computer exists, at which point every signature ever issued becomes forgeable. Given field lifetimes measured in decades (evidenced literally by a thirty-year-old TI-86 still functioning today), the responsible mitigation is a hybrid signature scheme adopted now: sign with Ed25519 and a post-quantum signature (a lattice-based scheme such as Dilithium, or a hash-based scheme such as SPHINCS+) side by side, so verification succeeds under today's classical assumptions and still holds if Ed25519 falls — without needing to re-sign or redistribute anything already sitting on non-upgradable hardware in the field. A hash-based scheme is worth particular weight given the "no surface" philosophy already adopted, since its hardness assumption is the hash function itself, the same category of assumption AES already relies on and which this architecture has already judged to age well.

## 8. Synthesis

None of the seven browser roadblocks are solved by writing better JavaScript; each is solved by correctly relocating responsibility to a substrate actually capable of providing it — a real OS process (the Special Thread) for sockets, post-close execution, and privilege separation; a first-party WASM syscall layer for protocol and memory semantics that need not depend on any external library; a real compiled ROM/ISA target for genuine boot fidelity and emulated privilege rings; and a generalized, tiered Mount contract for device access that degrades gracefully from mock to browser-mediated to fully native. The result is deployable to real, decades-old, otherwise-discarded hardware, which converts the entire architecture from a demonstration into a genuine distribution channel — and that distribution channel is what makes the security and licensing architecture in Section 7 necessary rather than optional: real users, on real and sometimes unpatchable hardware, for potentially decades, is a materially different obligation than a demo running in a single developer's browser tab.

---

## Appendix: Defense Layer vs. Threat Coverage

| Layer | Defends Against | Does Not Defend Against |
|---|---|---|
| AES (confidentiality) | Reading module contents without the key; degrades gracefully under quantum (Grover) | Key extraction if the key itself is compromised |
| Ed25519 (authenticity) | Forged or tampered modules, under classical assumptions | Shor's-algorithm-capable quantum attack — breaks outright, no degradation |
| Hybrid PQC signature (recommended) | The above Ed25519 gap on multi-decade field-lifetime hardware | Nothing new introduced; adds coverage without removing existing verification |
| Machine fingerprinting | Fleet-wide blast radius from a single compromised device | The difficulty of compromising one already-targeted device on its own |
| RandomBytes | Locating/extracting key material at all (~10^80 unscoped search space); extends AES's quantum aging | Shor's structural attack on Ed25519 once the real key is already recovered |
| Time-bound rotation | Unlimited-time brute-force or accumulated-compute attacks against a static target | An attacker already privileged enough to tamper with the internal clock — a pre-existing total compromise, not a gap this layer was meant to cover |
| No central server | Napster-style takedown and supply-chain-style propagated compromise | Nothing shifted elsewhere; this removes a category of attack rather than trading it for another |
| Kerckhoffs-compliant design overall | Any risk from the architecture itself being disclosed or reverse-engineered | Does not, by itself, provide any of the specific protections above — it only certifies that disclosure doesn't remove them |

---

## Version History

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | July 22, 2026 | Will Fobbs | Initial document: browser roadblocks, the Special Thread, first-party WASM syscalls, the seven-ISA compiler pipeline, hardware revival deployment map, generalized device mounting, and the full security/licensing architecture with quantum posture. |

## Confidentiality Statement

This document and its contents are the confidential and proprietary information of Pooled Impact and constitute a **Corporate Trade Secret**. This document is disclosed in confidence and is provided solely for the internal use of its intended recipient(s). No part of this document may be reproduced, distributed, transmitted, displayed, published, or otherwise disclosed to any third party, in whole or in part, in any form or by any means, without the prior written consent of Pooled Impact.

The information contained herein embodies proprietary methods, architectures, and analysis developed by Pooled Impact and/or Will Fobbs, and its unauthorized use, disclosure, or reproduction may cause serious and irreparable harm to Pooled Impact and may result in civil and/or criminal liability under applicable trade secret, unfair competition, and intellectual property laws. Receipt of this document does not convey any license or rights to the information contained within it, whether by implication, estoppel, or otherwise.

If you are not an authorized recipient of this document, you are notified that any review, dissemination, distribution, copying, or other use of this document is strictly prohibited. If you have received this document in error, please notify the sender immediately and destroy all copies in your possession.

**License:** Corporate Trade Secret — All Rights Reserved.
