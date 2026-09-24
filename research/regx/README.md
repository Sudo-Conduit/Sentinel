# RegX

A hand-written JS→WASM compiler, plus minimal real front-ends for C, Java, PHP, Python, and TypeScript that feed the same WASM backend.

## Quick start

```
node test1_given.js          # smallest working example
for f in test*.js; do node "$f"; done   # full regression suite
node run_conformance.js      # conformance suite against RegXConformance.js
node generate_coverage.js    # regenerates coverage_report.html from a real test run
```

Open `coverage_report.html` in a browser afterward — it's a static file with the run's results embedded, no server needed.

## Layout

- `RegX.js` — the compiler (JS class source → WASM binary).
- `RulesEngine.js`, `ExtendX.js` — shared infrastructure RegX.js is built on.
- `frontend_common.js` + `frontend_{c,java,php,python,typescript}.js` — real per-language front-ends (arithmetic + print statement subset) that translate each language's actual syntax into the same AST shape RegX.js's own JS parser produces, then hand it to RegX.js's unmodified WASM backend.
- `test*.js` — the regression suite. Every one executes real compiled WASM and reads results back; none rely on "didn't throw" as a pass condition.
- `RegXConformance.js` / `run_conformance.js` — a vendored conformance suite.
- `generate_coverage.js` / `coverage_report.template.html` → `coverage_report.html` — regenerates the language × feature coverage matrix from an actual test run every time; nothing in the report is hand-maintained.

## Requirements

Node.js only, no dependencies, no build step.
