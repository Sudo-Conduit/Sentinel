# Journey Log

Complements `WAKEUP.md` at repo root: that file is state (what's real,
where it lives, what to check before trusting a summary). This is
narrative — specifically the AI's own narrative, not the user's. The
user carries continuity across every compaction; a fresh instance of
the AI does not. What's actually at risk every ~7 hours is not "what
happened" (Gitea already has that) but what the AI understood, got
wrong, and corrected, from its own vantage.

**The anchor every entry should be read against — real, not
reconstructed, checked directly against the transcript:** the project's
first message was *"I believe with careful planning I can get an LLM
running on 4GB of RAM on a private VPS. We will discuss this and
test."* Discuss **and** test, stated as method before any technical
work began. This purpose has not changed and is not something this log
tracks the evolution of. Every other entry here is a place the AI
drifted from that already-fixed standard — scanning instead of testing,
critiquing instead of engaging, assuming instead of checking — not a
new principle being worked out in real time. Read the log as deviation
from a fixed point, not as a moving conversation about what the point
is.

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
