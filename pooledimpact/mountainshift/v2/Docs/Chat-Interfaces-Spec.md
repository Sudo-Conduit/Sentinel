# Chat Interfaces — Technical Spec (Draft v1)

Three distinct chat surfaces, one shared substrate (`ChatLib.js`: `TimeIndexedContext`, MSOS tools, shared-document registry). Each interface earns its existence by a different job, not a different skin.

## 1. Relay (ChatApp-Signal.dc.html) — Video/Audio Conferencing

**Repositioned scope:** currently a Signal-style text/group messenger with human+AI participants. Pivoting its primary purpose to real-time video/audio conferencing, with text messaging as the secondary channel (as in real Signal/FaceTime-style apps) — not the other way around.

**Net-new technical requirements:**
- Real-time media transport: WebRTC peer connections for audio/video between human participants. No signaling server exists yet — needs one (could ride the existing Kernel/Terminal's cross-tab or a lightweight relay).
- AI participants in a call: an AI "session" in a video call has no camera/mic — needs a defined presence (avatar tile + live transcript/TTS output, or audio-only synthesized voice via a TTS pipeline, per the STT→AST→TTS roadmap item).
- Call state as a real Kernel process (`relay:call:<id>`), matching the OS's process-everywhere convention — call start/end are fork/kill, same as chat generation today.
- Existing `TimeIndexedContext`/MSOS tools remain the text-channel backbone during a call (chat-while-on-call), and the digest/ΔS/beacon machinery still applies to the text side.
- Group video calls reuse the existing group-thread/participant model (humans + AI sessions) already built.

**Open questions:** signaling architecture (peer-to-peer via a shared doc registry entry vs. a dedicated signaling process); whether AI participants ever get a synthesized video presence or stay audio/text-only.

## 2. WebLLM Chat (ChatApp-WebLLM.dc.html) — General Everyday Assistant

**Scope (already matches current build closely):** a general-purpose conversational assistant for everyday tasks — app help, command help, system assessment. This is the "ask the OS anything" surface.

**Confirmed/expected capability set (mostly built):**
- Full MSOS tool surface: `msos_run` (help/ps/whoami/mnt/echo), `msos_ls`/`msos_cat` (scoped folder read), `msos_exec` (sandboxed JS), `msos_deltaS` (self-readout), debug-harness tools, `msos_slidedeck`/`msos_translate` (cross-window).
- System assessment framing: this is the natural home for "what's running," "why is X slow," "what changed" — i.e., `ps`/`top`-style introspection surfaced conversationally rather than requiring Terminal syntax.
- App help: should be able to answer "how do I do X in [App]" — implies eventually indexing each app's own help/man content as retrievable context (not yet built).
- Session menu (Rename/Restart/Delete/Analyze) already built — Analyze is the admin-only ΔS/beacon inspector.

**Gaps to close:** app-help content indexing; a clearer "system assessment" quick-action set (e.g. a one-click "what's running right now" prompt) distinct from ad-hoc `msos_run ps` calls.

## 3. IDE Chat (net-new — lives inside VB6IDE, not the Dock)

**Scope:** 100% coding/design/testing assistance — not a general assistant, not conferencing. Embedded in the IDE (VB6IDE-Alpine.html or its Chat panel), scoped to the current project/file context.

**Required capabilities (net-new, not yet built):**
- Code-context grounding: the IDE chat must see the currently open file(s)/project tree (via FileFsX, same shared-root pattern as `msos_ls`/`msos_cat` but scoped to the active project, not a fixed folder) — this is the single most important difference from WebLLM Chat's generic folder access.
- Design assistance: read/comment on DC template structure, suggest layout/markup changes.
- Test assistance: run/interpret CodeUtils_007's Analyze output, and ideally drive the IDE's own test/debug tooling as tool calls (an `msos_ide_*` family, mirroring the `msos_debug_state`/`msos_ast_step` pattern already built against the standalone Debug Harness — the real integration point is wiring those same three tools against the ACTUAL file/project being edited, not the fixed demo sample).
- Should NOT have `msos_exec`'s generic sandbox as its primary tool — should have IDE-specific tools (read file, propose diff, run analyzer, run test) so its action space matches "coding assistant," not "general OS shell."

**Open questions:** whether IDE Chat is its own DC window or a panel inside VB6IDE-Alpine.html; whether it shares `TimeIndexedContext`/IndexedDB sessions with the other two chats or gets its own per-project store (per-project seems more correct, given content is project-scoped).

## Shared substrate (all three)

`ChatLib.js` already provides, usable by all three interfaces: `TimeIndexedContext` (time-indexed messages, ΔS-gated beacon pinning, digest+KV-cache-pointer compaction, `rehydrate()`), the MSOS tool-calling protocol (`MSOS_TOOL_DEFS`/`msosDispatch`), real ΔS via `pipeline.tokenLogprobArray`, and the shared-document registry (`window.parent.__meshSharedDocs`) already wired for SlideDeck and AST Translator. IDE Chat's project-scoped file tools are the same shape as `msos_ls`/`msos_cat`, just re-scoped — no new primitive needed, only a new allowed-root per project.

## Immediate next steps (proposed order)
1. Scope IDE Chat's home (new DC vs. IDE panel) — smallest ambiguity, blocks nothing else.
2. Re-scope Relay's UI toward call-first layout (video tile grid + collapsible text panel) — pure UI work, no new backend yet.
3. Design the call signaling architecture before writing any WebRTC code — this is the one genuinely hard technical unknown in the whole spec.
