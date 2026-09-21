# test_output/

Saved, verbatim test-run records for `research/periodic-data-table/test/run-all.js`.

Each file is a real run's raw output, not a summary or a hand-typed claim:
`node test/run-all.js --save` (or `SAVE_TEST_OUTPUT=1 node test/run-all.js`)
writes the exact console output here, dated and commit-hashed, as
`<ISO-timestamp>_<short-commit-hash>.txt`.

This is a durable, checkable record - a claim like "146/146 checks passing"
can be verified against the actual file it came from, and a file's commit
hash stops matching `git log` the moment the code moves on, so a stale
record is obviously stale rather than silently trusted. Same convention as
this project's other `*-test-output.txt` artifacts (e.g. `NTX-test-output.txt`):
paste real run output, not a description of one.

Nothing here is regenerated automatically - run with `--save` when a run is
worth keeping (a milestone, a roadmap update, before/after a real fix), not
on every local test invocation.
