# CORE Roadmap

## Done

- All 31 reference implementations (`9x8_Matrix.html` +
  `9x8_Torus_001.html`–`030.html`) have a helper `.md` doc with a
  Playwright screenshot, following a consistent template (what it
  demonstrates, how the UI works, what's in the screenshot).
- Four project-level docs: this file, [`ReadMe.md`](./ReadMe.md) (entry
  point/index), [`Intro.md`](./Intro.md) (conceptual throughline across
  the series), [`Changelog.md`](./Changelog.md) (release-by-release log).
- Screenshots organized as `img/<release-name>/<release-name>.png`, one
  subfolder per release (a few toggle-based releases also have an
  `_engaged.png` variant capturing the "on" state).
- Real bugs found and documented in place (not fixed, since this was a
  documentation pass, not a code-repair pass):
  - Release 025's Anchor Profile dropdown is inert (wrong element id).
  - Release 029's 3D viewport (Window 3) renders completely blank (missing
    `points` field on profile data).
  - Releases 028–029 have unrendered inline LaTeX in telemetry labels (no
    MathJax/KaTeX loaded).
  - The recurring CSS-custom-property canvas quirk (004–015, 021, 029).

## Not yet done / open items

- **Code fixes**: none of the bugs above have been fixed in the `.html`
  files themselves — only documented. If Will wants these releases to
  actually work correctly (e.g. release 025's dropdown, release 029's 3D
  view), that's separate follow-up work, not covered by this
  documentation pass.
- **The `/js`, `/tests`, `/scratch` subfolders** Will mentioned creating on
  his machine haven't synced to this session as of the last check
  (2026-09-20) — only `/img` (created by this session) and the 31 source
  `.html` files plus their new `.md` docs are visible here. Worth
  re-checking once Will's next local sync lands, in case those folders add
  material relevant to this library (e.g. existing tests or scratch
  experiments for the same releases).
- **RegX.js/RulesEngine.js cross-reference**: release 026's doc notes a
  real conceptual link between its C/PHP "frontend pipeline" framing and
  this project's actual `RegX.js` compiler frontends
  (`frontend_c.js`, `frontend_php.js`, etc., per project memory). That
  connection is only noted, not explored — a deeper writeup tracing which
  CORE releases correspond to which real RegX.js components could be a
  useful follow-up if Will wants the conceptual library tied more tightly
  to the actual codebase.
- **Fobbs Valence Table (FVT) cross-reference**: release 011 is named
  after FVT but FVT itself (`research/periodic-data-table/
  FobbsValenceTable.html`) isn't part of this library and hasn't been
  documented the same way — out of scope for CORE specifically, but noted
  in [`Intro.md`](./Intro.md) as a related standalone app.
- **No index of bugs vs. intentional quirks**: the per-release docs each
  flag their own known issues, and [`ReadMe.md`](./ReadMe.md) has a
  short cross-release summary, but there's no single triage table (e.g.
  "blocking" vs. "cosmetic" vs. "narrative flavor, not a bug"). Could be
  useful if this library moves toward being an actual maintained codebase
  rather than a reference archive.

## Suggested next steps (not started, pending Will's direction)

1. Decide whether the documented bugs (025, 029 especially) are worth
   fixing, or are intentionally left as "as-found" reference snapshots.
2. If Will's local `/js`, `/tests`, `/scratch` folders sync in, review
   them for material this library should incorporate or cross-link.
3. Consider a short top-level index table (release → one-line theme → doc
   link) in `ReadMe.md` if the 31-entry list there ever needs to be
   scanned faster than the current prose-plus-table format allows.
