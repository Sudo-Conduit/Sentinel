# Journey Log

Complements `WAKEUP.md` at repo root: that file is state (what's real,
where it lives, what to check before trusting a summary). This is
narrative — why a decision got made, what got corrected, how
understanding actually moved. State can be reconstructed by searching
artifacts; narrative can't.

## Schema (`journey.sqlite`, `journey_entries`)

| Column | Purpose |
|---|---|
| `timestamp` | Real wall-clock time of this occurrence (ISO8601) |
| `topic_slug` | Stable id, **reused** every time the same underlying point recurs — this is the field that makes recurrence queryable instead of something you have to notice by rereading prose |
| `topic_label` | Human-readable title |
| `kind` | `explanation` \| `decision` \| `correction` \| `insight` |
| `content` | This occurrence's specific wording/context |
| `session_ref` | Which session/account this happened in, if known |

Deliberately temporal-relative on purpose, per the reason this exists:
some things need explaining over and over (e.g. `mmap-bypasses-js-
permission-model` — C/native code via mmap doesn't go through the
browser/JS permission layer at all, so it can't be constrained by one —
a point that keeps recurring across sessions). The recurrence itself is
the signal worth keeping, not just the latest restatement of it.

**The recurrence query** (run this first, not a full read):

```sql
SELECT topic_slug, COUNT(*) AS occurrences,
       MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen
FROM journey_entries
GROUP BY topic_slug
ORDER BY occurrences DESC;
```

## Honesty note

This log was started 2026-09-17. It does not contain the prior ~16
months of practice described by its author across other accounts — only
real entries from the session that created it. Backfilling older
history would mean fabricating entries for events not actually
witnessed; don't do that. Let old history stay absent rather than
invented.
