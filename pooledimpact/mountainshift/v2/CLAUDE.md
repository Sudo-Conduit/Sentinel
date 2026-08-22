# Project: MESHUI (VB6 HTML prototype with AlpineJS)

## Versioning / Archive Convention
- Project archive name: `MESHUI_v{NNNN}.zip` (e.g. `MESHUI_v0013.zip`), zero-padded to 4 digits.
- The version number auto-increments on every bugfix, feature, or test pass — bump it whenever a new archive/zip is produced.
- Individual file snapshots inside an archive follow: `{OriginalFileName}.xxx.html` where `xxx` is the version at which that file was last saved (e.g. `VB6IDE-Classic.dc.0013.html` = saved at v0013).
- Goal: maintain a running history/archive compatible with future Git / git-bundle migration.

## Dependency Policy \u2014 No CDN Loads, Ever
- Every third-party dependency (Mermaid, Marked/Marked-it/Milkdown, AlpineJS, sql.js, PDF-Lib, etc.) is self-hosted in-project \u2014 never loaded from a CDN `<script src="https://...">`.
- Enterprise vendoring model: each dependency is pinned to one specific, vetted version. A new upstream release is treated as hostile/unvetted until it has been reviewed and deliberately adopted \u2014 never auto-upgraded.

## Planned / Backlog (HOPE Shelters nonprofit app)
- i18n support tied to reports (localized labels/number-date formats driven off the same schema-binding used for report fields).
- Admin section with GraphQL / SQL adhoc querying against the domain model.
- Connection to OS, Terminal, etc. (wiring the nonprofit app into the existing Terminal/FileFsX/POSIX layer).
- App and OS UI linkage and Proxies.
- "Componentize" the nonprofit app for usage with the IDE (as a loadable project/module, not just a standalone page).

## Composable mini-app pattern (established via LoadingIcon)
- `LoadingIcon.js` + `LoadingIcon-Demo.html` set the template for small, composable dialogs/widgets meant to be carried into the IDE later \u2014 the same way OS shells compose small self-contained panels (volume, Bluetooth, etc.) rather than one monolithic settings screen.
- Pattern: a BaseClassX domain class owns schema-tracked config/state (colors, speed, playState) and exposes a small imperative API (mount/start/stop/pause/resume/setX/exportX); runtime-only handles (DOM refs, timers) live outside the schema Proxy in a WeakMap (same convention as AppClasses.js's `appVersions`).
- Host page around it: theme via CSS custom properties keyed off `prefers-color-scheme` (--bg/--fg/--panel/--border/...) so the widget adapts to light/dark automatically when embedded (e.g. in a small IFrame inside the IDE), consistent label/control styling (shared row class, `font: inherit` on labels), and an explicit export path to a portable artifact (`exportSVG()` \u2014 no host JS dependency).
- Next time a similar small utility/dialog is needed in the IDE, start from this shape rather than one-off markup.

## Planned: Manifest-driven release gating (XML/XSD/XSL nav manifest) \u2014 platform-wide pattern
- Concept: the left-nav (or any surface tree) renders ONLY the nodes present in an XML manifest \u2014 absence, not a hidden/disabled CSS state, is what keeps a surface out of a release. Obfuscation-security (one layer among several \u2014 FieldACL/BaseClassX proxy still own real field-level enforcement), config validation (an XSD contract per node: id/label/requiredRole/minAppVersion), AND progressive-release/feature-flag gating, all from one primitive.
- Each manifest (XML + its XSL transform + its XSD) gets wrapped in a BaseClassX instance so it inherits fingerprinting, history/trace, and versioning for free \u2014 lets you diff manifest fingerprints across environments (staging vs. production) to catch unexpected drift.
- Concrete first case: HOPE Shelters release ladder \u2014 tier 1 PDF reports only, tier 2 Reports-only manifest (subset of the report catalog), tier 3 + Data Entry, tier 4 + Designer, tier 5 (internal) full manifest. Beta Partners get their own independent tier. Same primitive should drive Beta Partner tiers too.
- Cross-product: identical shape (nav/surface tree gated by release tier/partner/role) applies to the whole portfolio \u2014 Deal Structure (Housing/Solar), Finance Portal Pro (Fund/Family Office), GMAT, Learn (IXL-like), Together App (Signal-like + Zoom-like) \u2014 so this should be built as a shared platform component, not rebuilt per app.
- Step 1 DONE: mechanical XSD contract (`SurfaceManifest.xsd`), HOPE Shelters Tier 2 (Reports Only) concrete manifest (`HopeShelters-Tier2-Manifest.xml`), XSL flattener to the UI's nav shape (`SurfaceManifest-ToNav.xsl`), and the BaseClassX governed wrapper (`SurfaceManifestX.js` \u2014 fingerprint via SHA-256, structural validation, resolved `nav`).
- Remaining: (4) extend the ladder to Tiers 3, 4, 5 + define the independent Beta Partner tier; (5) generalize and document the pattern as shared platform infrastructure for Deal Structure, Finance Portal Pro, GMAT, Learn, and Together App.

## Planned: Filtering and Saved Views (default = Quick Filter, built)
- #3 built: Quick Filter (one text filter per non-money detail column) + single Group By dropdown, per-report-key state, on Reports #1/#2/#3.
- #1 (backlog): Saved Views never auto-repair/auto-migrate when the underlying schema changes \u2014 a view referencing a renamed/removed field surfaces "Your view needs to be updated or removed," never a silent drop or silent guess. Auto-anything on saved views is a bad move.
- #2 (backlog): View limit per user/scope, system-configurable, default 10.

## Planned / Backlog (Org-Reports-UI additions, added 2026-07-23)
- Dashboard with widgets (composable mini-app pattern per LoadingIcon \u2014 each widget a self-contained BaseClassX instance).
- Staffing Coverage Report: gaps not shown/surfaced clearly enough \u2014 needs a fix pass.
- Export functionality (PDF/other) on ALL reports, not just Payroll (currently the only one wired to doc_page print).
- Exported timestamp stamped on every report export.
- User-unique or Organization public key embedded on all exported PDFs \u2014 respects user/client data provenance.
- Admin section with a Schema Editor (edit `_schema.properties`/`_fieldACL` definitions through UI, not hand-editing class files).
- Icons on Left Nav items.
- Configurable max subsections shown per Left Nav group (default 5), rest collapsed/paged.
- Dedicated section landing pages (e.g. Data Surfaces) listing all objects in that group as links with a description, instead of jumping straight to the first one.

## Canonical Directory Layout (Pooled Impact holding structure)
- Root: `PooledImpact/` \u2014 holding company. `index.html`, `Companies/`, `Website/`, `Docs/`.
- `Companies/` holds one folder per portfolio company, each shaped `{Website/, Docs/, Apps/, index.html}`:
  - `MountainShiftOS/` \u2014 the software company. The ONLY company with an `OS/` layer, since its product IS the platform the other companies' Apps run on. Shape: `{OS/, Website/, Docs/, Apps/, index.html}`. `OS/src/` holds versioned platform core files (e.g. `BaseClassX_2.2.06.js`) \u2014 an immutable, versioned filename per release so any consumer that pinned to it never breaks; an unversioned alias (`BaseClassX.js`, repointed on each release) is what in-house Apps reference by default so they always get current without a hand-bumped `<script src>`. `Apps/` holds `IDE/` and `Org/` (the HOPE Shelters nonprofit app), each consuming the platform via that alias path, never a local copy.
  - `CleanEnergy/` \u2014 hardware company (solar/battery plants, equipment, data center equipment). No `OS/`. `Website/` = product/equipment catalog, `Docs/` = specs/manuals/install guides, `Apps/` reserved for a future equipment/fleet-monitoring dashboard \u2014 if built, it still runs ON MountainShiftOS's platform (via the alias path), never forks its own copy.
  - `ConduitImpactCapital/` \u2014 the $150M/yr infrastructure investment fund. No `OS/`. `Apps/FinancePortalPro/` (Fund/Family Office reporting) is the concrete first app here.
- `Org/` internal shape (under MountainShiftOS/Apps/): `src/` (domain + orchestration: Staff.js, Shift.js, PayrollRecord.js, Expense.js, BudgetCategory.js, Grant.js, OrgPosition.js, Organization.js, Org-Reports-UI.html, SurfaceManifestX.js + .xsd/.xsl, Payroll-Report*.html), `Docs/` (Payroll-and-Budget-Report.md, Staffing-Coverage-Report.md, Manifest-Driven-Release-Gating.md), `Sample/` (Org-Data-Model-Smoke-Test.html), `HopeShelters/` (RealOrgData.js, RealShiftData.js \u2014 the real client's real data, separate from synthetic Sample).
- `IDE/` internal shape (under MountainShiftOS/Apps/): `src/` (VB6IDE-*.html, AppClasses.js, CodeUtils_007.js, TopMonitor.js, FileFsX.js, UTF24Timestamp.js, Canvas.dc.html), `src/bin/` (the Terminal's loadable POSIX command files: cat.js, ls.js, grep.js, head.js, man.js, tail.js, which.js \u2014 currently sitting in uploads/, to be relocated here), `src/bin/wasm/` (reserved, no artifacts yet), `Docs/` (Debugging-Architecture.md, Browser-Roadblocks-WASM-Security-Architecture.md, TTY-Overview.md, Threads-SABX-Federation-Login-Rubric.md), `Sample/` (Debug-Harness-Demo.html, LoadingIcon-Demo.html, Lasagna-Demo.html, Anomalies_Test017.js).
- `PooledImpact/Docs/` \u2014 company-wide/cross-cutting docs, e.g. Spectral-Shift-Theory.html and BaseClassX-Relationships-Rubric.md (documents the OS core, which underlies every company's Apps \u2014 not Org- or IDE-specific).
- Legacy version snapshots (VB6IDE_v001*.html through v003*.html) consolidate into the existing `archive/` convention, not into `IDE/src/`.
- `support.js` and `.thumbnail` never move \u2014 DC-runtime/project plumbing referenced by relative path from wherever the project root actually is.
- STATUS: layout decided and documented here; the physical folder creation + file moves have NOT been executed yet.

## Reorg execution notes (2026-07-23)
- The full `PooledImpact/...` tree above now exists as COPIES of the working files \u2014 originals were left in place at the flat project root (not moved), because every relative `<script src>` in this project (including the DC-runtime `support.js`, which per this same doc must never move) currently resolves against the flat root. Moving the live entry points would have broken those references immediately.
- The copied tree is the canonical target shape for the eventual Git/git-bundle migration described elsewhere in this doc \u2014 treat it as the "this is where it all goes" reference, not yet the live-serving location.
- The 9 legacy `VB6IDE_v001*.html`\u2013`VB6IDE_v003.html` snapshots WERE moved (not copied) into `archive/legacy-vb6ide/` \u2014 lower risk since `archive/` is a sibling at the same root depth and these are frozen historical snapshots, not live entry points.
- Remaining follow-up before the copied tree can actually run standalone: rewrite each moved HTML/DC file's relative `<script src>` paths to match its new nesting depth (e.g. `Org-Reports-UI.html` now needs `../../OS/src/BaseClassX.js` instead of `./BaseClassX.js`), and decide the `BaseClassX.js`-as-alias vs. a real versioned `BaseClassX_x.x.x.js` file (still open from the layout discussion).

## Current version: v0023
- v0023: Machine-end stubs. `TopMonitor.js` renamed to `Procd.js` (matching Unix's `procd`/process-supervisor naming, per TTY-Overview.md's own proposal) — original archived to `archive/v0023/TopMonitor.0023.js`; `VB6IDE-Alpine.html`/`Lasagna-Demo.html` updated to the new script src/global. Added the Machine-end BaseClassX classes from `Kernel-Machine-Architecture.md`: `CPU.js` (the reference mechanical x86 register/memory/interrupt interpreter, intentionally NOT a BaseClassX subclass — a runtime engine held by reference, not schema-tracked state), `Environment.js` (`detect()` reads navigator/process for host facts BIOS itself can't know), `Physical.js` (wraps CPU.js as a WeakMap runtime handle behind schema-tracked capacity/energy figures), `Memory.js` (schema-tracked region ledger over a volatile WeakMap-held backing store), `Kernel.js` (schema-tracked process table + round-robin `tick()`), `BIOS.js` (`boot()` runs POST, reads Environment, scans a configurable `bootDeviceOrder`, hands off to a Kernel — UEFI is the firmware default, BIOS-L available but not used).

## Current version: v0022
- v0022: FileFsX gained three real pluggable storage backends behind the existing Mount abstraction — OPFS (Origin Private File System), IndexedDB, and localStorage — selectable via `FileFsX.create({backend, key})`, alongside the original File System Access picker (`backend: 'picker'`, still the default when unspecified). `FileFS.create()` now correctly awaits the mount's initial `load()` before resolving (previously resolved immediately, racing the actual data load for non-picker backends). The IDE's root mount now defaults to `backend: 'idb', key: 'meshui-root'`, making the whole `/` filesystem (and therefore session-adjacent state written into it) durable across reloads instead of purely in-memory — the first concrete move toward dynamic-TTY-by-default. `mnt` now reports the real backend + key instead of a hardcoded 'memory'/format string.

## Current version: v0021
- v0021: Real password auth. `root` now has a SHA-256-hashed password (`wfobbs`, hashed via Web Crypto at boot — never stored or compared in plaintext) checked on explicit `login <user> [password]`; the initial boot session auto-authenticates as root without a password prompt, matching a single-user auto-login machine. Added `useradd <username> [password]` (root-only) so additional users can be created at runtime with their own uid/gid/home/password-hash. `logout` now formalizes session existence — `currentUser` can be null, and `id`/`who`/`w` report "no active session" instead of assuming one.

## Current version: v0020
- v0020: Archive checkpoint. Fixed the v0019 POSIX Session/Login/Permission batch: added the missing `<script src="./TopMonitor.js">` include (jobs/fg/bg/kill were silently dead without it), wired `chmod`/`chown` into the terminal's `vfs` context object (they existed on FileFsX but were never exposed to commands), and — the real root cause — added `mode`/`uid`/`gid` to `File`/`Folder`'s BaseClassX `_schema.properties` and constructors, since those classes' schema-enforcing Proxy was silently rejecting unrecognized property writes. `ls -l` now correctly reflects chmod/chown changes.

## Current version: v0019
- v0019: POSIX Session/Login/Permission batch — added `whoami`, `id`, `login`, `who`, `w`, `last`, `chmod`, `chown` as loadable /bin command files, following the established static-metadata + execute(args,{stdout,stderr,cwd,vfs,session}) contract. Terminal now carries real session state (currentUser, users table with uid/gid/home, loginTime, sessionLog) exposed to commands via a new `session` ctx object; `login <user>` switches session and appends login/logout entries `last` can replay. FileFsX's `chmod`/`chown` stubs replaced with real per-node mode/uid/gid persistence (mergeStats now reads node.mode/uid/gid instead of hardcoded values), so `ls -l` reflects real permission changes. Added `jobs`, `fg <id>`, `bg <id>`, `kill <id>` as Terminal built-ins wired directly to TopMonitor's existing job-control API. Piping/redirection intentionally deferred (kernel token design still pending).

## Current version: v0018
- v0014: Wired Code.Analyze button to CodeUtils_007 (results modal). Fixed CodeUtils_007 strict-mode crash (removed conflicting BaseClassX.prototype inheritance) and a duplicate-style-attribute bug in the modal markup.
- v0015\u20130016: Menu bar restructure (File/Edit/View/Custom/Window/Help), Toolbox pin/library selector, Navigator mode (Finder-style project tree), Code mode line-number gutter + Members panel, Delete-with-confirm cascading to Form Class, language dropdown (JS/PHP/Python) next to Compile, FileFsX-backed Save/Load via a persisted (IndexedDB) file handle with queryPermission/requestPermission \u2014 no repeated picker.
- v0017: Terminal upgrades \u2014 Shift+Enter multiline input, Up/Down command history, Copy-to-clipboard on the Analyze report modal. Monitor: resizable 1\u00d71/2\u00d72/4\u00d74 grid of live rolling cells with three interchangeable render surfaces (SVG polyline, Canvas 2D bars, three.js WebGL), `animdemo` terminal command driving both console and Monitor surfaces in sync. Fixed three.js/Alpine reactivity conflict by moving renderer/canvas state into a non-reactive module-level Map.
- v0018: Terminal became a real POSIX-style shell over FileFsX \u2014 in-memory Unix directory scaffold (/bin, /usr/bin, /etc, /home, /var, etc.) created on init (autoSave:false so it doesn't force a save picker before commands can load). `loadCommands()` reads .js command files from /bin and /usr/bin, evaluates each, and registers by static `name`; dispatch resolves loaded commands before built-ins. Added real POSIX commands as vfs files: unix.ls.js, unix.cat.js, unix.man.js, unix.mnt.js (mount-table introspection over the FileFsX instance). Added shell-level glob expansion (`expandGlobs`, matches real Unix: globbing happens before argv, not inside ls). Fixed: ls -l/-h formatting missing on single-file targets, -t/-S sort not applying to multi-file glob targets, spurious blank lines between file (non-directory) targets, man.js's JSDoc comment-line stripping only consuming one space, man show/docs/tests hardcoded to a stale core.* filename convention (now resolves by each command's static name), man --field generalized beyond --author, terminal output whitespace collapsing (scoped white-space:pre-wrap to the per-line div only).
