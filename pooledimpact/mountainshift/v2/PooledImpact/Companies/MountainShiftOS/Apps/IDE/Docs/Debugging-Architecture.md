# Debugging Architecture: State, AST, and Execution

**Author:** Will Fobbs
**Company:** Pooled Impact
**Date:** July 22, 2026
**Version:** 1.0

## Summary

The debugging surface for this system is built entirely from primitives already in the stack — BaseClassX's native `$debug` API, DomainNode-shaped ASTs produced by TokenizerX/Lexer/Parser, CoreUtils run repeatedly rather than once, and a small number of explicit hooks for code that runs natively rather than through an interpreted Executor. No general-purpose external debugger (evaluated: `vdebugger`, ~400KB) is used. The evaluation process that led here is itself informative: each capability external tooling would provide was checked against what already exists, and every one of them turned out to already be covered — fully, using less code, with tighter integration, and without an external dependency's API surface to trust.

## The Three Layers

**State layer.** BaseClassX's Proxy handler already exposes `$debug`, `$break`, `$watch`, `$dump`, `$step`, `$resume`, `$inspect`, `$continue`, `$trace`, `$replay`, and `$pause` on every instance whose class doesn't opt out (`static enableDebugger = false`). This is forensic, property-mutation-scoped debugging: every `set` is recorded via `_recordTrace`, breakpoints and watches fire against property writes, and `$replay` reconstructs state from the trace. It works retroactively, too — wrapping an already-instantiated, non-BaseClassX object in the same Proxy handler (`new Proxy(existingInstance, proxyHandler)`) grants the same tracing going forward from that point, because the set trap's `prop in target` check passes for any property the object already owns, schema-declared or not.

**AST layer.** Any domain — GraphQL, SQL, or a general-purpose language via TokenizerX's spec-driven tokenizer — parses to DomainNode-based AST nodes, and DomainNode adds no new BaseClassX API: every AST node *is* a BaseClassX instance, so it already has `$break`/`$watch`/`$trace`/`$replay` for free. Applied to JS/PHP/Python specifically: take a method's source via `toString()`, tokenize and parse it into a real AST, and every local variable declaration, loop, and block becomes a first-class node with the full state-layer debugging API already attached — no separate representation or tooling required.

**Execution layer.** This is where the two real paths diverge, and it's an architectural choice per use case rather than a capability gap:
- **Interpreted.** If an Executor walks and executes the AST node-by-node (the same shape the GraphQL/SQL Executor already uses), then every local variable is a DomainNode field and the entire debugging surface — breakpoints, watches, trace, replay, live scope — is native, with no execution boundary to cross at all.
- **Native.** If code instead runs directly on the host JS engine (for speed, or because it's third-party code not worth reinterpreting), pausing that specific native call stack requires an explicit hook at the point a pause is actually needed — a `debugger` statement, a thin callback/postMessage bridge, or a targeted rewrite of only the functions that need one. This is deliberately narrow instrumentation, not a general sandboxed interpreter: hooks are added where they're needed, not everywhere preemptively.

## Why Not vdebugger

vdebugger's real API (`transform`, `debug`, `setBreakpoint`, `getPausedInfo`, `getScopeChain`, `evaluate`, `resume`, `runInNativeEnv`, `runInSkipOver`, `setModuleRequest`) is a legitimate, well-designed general-purpose front-end JS debugger — a real sandboxed interpreter with line/column breakpoints, conditional breakpoints, full call-frame scope chains, and step in/over/out. Every one of those capabilities maps onto something already covered above: line/column breakpoints and scope chains map onto the AST layer's per-node debugging once source is tokenized and parsed; step in/over/out maps onto the Executor's own node-visitation order in the interpreted execution path; live scope-chain values map onto DomainNode's already-declared `scope` field. The one case it uniquely addresses — pausing and reading live values inside code running natively, un-interpreted, un-instrumented — is better solved with a handful of targeted hooks than with a 400KB general sandbox, because the actual need is narrow and known in advance, not general and unpredictable. Carrying the dependency would also violate the "zero API, external library" principle already governing everything else in this stack: the debugging surface should be built from first-party primitives with the minimum external surface, the same discipline applied to sockets, memory, and syscalls.

## Job Control Is Where This Actually Gets Used

A single debug target is a demo. Real debugging usually means several targets at once — a paused state-layer breakpoint on one object, an AST walk in progress on another, a native hook waiting to fire on a third — and the thing that makes that usable is exactly procd's existing job model: each debug target is a job, `ps` lists them with their state (foreground/background/suspended), and `fg <id>` / `bg <id>` switch which target currently owns the console/UI surface without losing the others' state. This is not a new mechanism bolted on for debugging — it's the same job-control primitive already built for terminal jobs, applied to debug sessions instead of shell commands, which is the whole point of building job control as a general procd capability rather than a terminal-specific one.

---

## Version History

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | July 22, 2026 | Will Fobbs | Initial document: the three-layer debugging architecture (state/AST/execution), the vdebugger cost-benefit evaluation, and job control as the multi-target debugging surface. |

## Confidentiality Statement

This document and its contents are the confidential and proprietary information of Pooled Impact and constitute a **Corporate Trade Secret**. This document is disclosed in confidence and is provided solely for the internal use of its intended recipient(s). No part of this document may be reproduced, distributed, transmitted, displayed, published, or otherwise disclosed to any third party, in whole or in part, in any form or by any means, without the prior written consent of Pooled Impact.

The information contained herein embodies proprietary methods, architectures, and analysis developed by Pooled Impact and/or Will Fobbs, and its unauthorized use, disclosure, or reproduction may cause serious and irreparable harm to Pooled Impact and may result in civil and/or criminal liability under applicable trade secret, unfair competition, and intellectual property laws. Receipt of this document does not convey any license or rights to the information contained within it, whether by implication, estoppel, or otherwise.

If you are not an authorized recipient of this document, you are notified that any review, dissemination, distribution, copying, or other use of this document is strictly prohibited. If you have received this document in error, please notify the sender immediately and destroy all copies in your possession.

**License:** Corporate Trade Secret — All Rights Reserved.
