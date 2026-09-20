# CORE Reference Library

A library of 31 self-contained HTML/canvas reference implementations
(`9x8_Matrix.html` plus `9x8_Torus_001.html`–`9x8_Torus_030.html`), each
documented here with a screenshot and a helper Markdown file explaining
what it demonstrates and how its UI works. See [`Intro.md`](./Intro.md) for
the conceptual throughline connecting the releases, [`Changelog.md`](./Changelog.md)
for a release-by-release summary, and [`Roadmap.md`](./Roadmap.md) for
what's covered so far and what isn't.

## What's here

- **`9x8_Matrix.html` / `9x8_Torus_001.html`–`030.html`** — the reference
  implementations themselves. Plain HTML/canvas 2D, no build system, no
  external libraries (a few releases reference LaTeX/MathJax-style markup
  in their labels without loading a renderer — see the per-release docs
  for where this shows up as a display bug). Each is a standalone file you
  can open directly in a browser.
- **`9x8_Matrix.md` / `9x8_Torus_001.md`–`030.md`** — one helper doc per
  release, following a consistent template:
  - **What it demonstrates** — the concept(s) the release visualizes.
  - **How the UI works** — the controls and what drives the render loop.
  - **What's in the screenshot** — what state the screenshot was captured
    in, and how to read it.
  - A closing note cross-referencing related releases.
- **`img/<release-name>/`** — one subfolder per release holding its
  screenshot(s), captured with headless Playwright at the file's default
  load state (`img/<release-name>/<release-name>.png`; a few releases with
  toggle states also have an `_engaged.png` variant).

## How to read the library

Start with [`9x8_Matrix.md`](./9x8_Matrix.md) — it establishes the
foundational `9×8 = 72` grid and `72 ≡ 0 (mod 72)` toroidal numbering that
the rest of the series builds on. From there, releases 001–019 develop the
core shell-lattice rendering engine and its recurring motifs (see
[`Intro.md`](./Intro.md)); releases 020–029 apply that same engine as a
skin over different applied domains (photovoltaics, chemistry, compilers,
acoustic translation, NLP, finance); release 030 closes the series with a
static "manuscript library" tying the visual themes back to four named
theoretical claims.

Each release doc links forward/backward to the releases it most directly
builds on or reuses code from, so following those links is usually a
faster way to trace a specific idea (e.g. the CSS-custom-property canvas
quirk, or the Sentinel Operator toggle) across the series than reading
straight through.

## Known issues across the series

A few recurring bugs are documented individually in their releases but are
worth knowing about up front if you're using these files as working
references rather than just reading the docs:

- **CSS custom-property canvas quirk** (releases 004–015, reappears in 021
  and 029): assigning a CSS variable string directly to `ctx.fillStyle`/
  `ctx.strokeStyle` doesn't resolve the way it would in DOM/CSS — canvas
  silently ignores the assignment and keeps the previous color.
- **Unrendered inline LaTeX** (releases 028–029): several telemetry titles
  use `\(...\)` LaTeX delimiters with no MathJax/KaTeX script loaded, so the
  raw LaTeX source displays as literal text.
- **Dropdown wiring bugs**: release 025's profile dropdown reads the wrong
  element id and is inert; release 026 is the explicit fix for that same
  bug.
- **Blank 3D viewport** (release 029): a missing `points` field on the
  profile data objects means the 3D lattice's node-generation loop never
  runs, so Window 3 renders empty.

See each release's own `.md` for the specifics of where these show up.
