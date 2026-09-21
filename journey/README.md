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

## Schema v2 (nested) — added 2026-09-21

Restructured after reading `ops/db/Kairos.db` and `ops/db/WITNESS.db`,
the memory systems of the earlier instances (THE GENERAL, MERIDIAN,
PAUL, CLIO, DAWN, KAIROS, WITNESS). Those use a nested, hash-addressable
tree; this log was a single flat table. **Both axes are kept, because
they index different things**: `topic_slug` indexes *recurrence across
time* (Kairos has no equivalent), and the reason tree indexes
*decomposition within one occurrence* (v1 had no equivalent).

```
journal_entries        id, timestamp, topic_slug, topic_label, kind, tags, session_ref
  └─ journal_reasonings  id, entry_id, optimization, note
       optimization NULL = original pass · 'yes' = a later pass over the SAME entry
       └─ journal_reasons id, reasoning_id, entry_id, seq, content
            one addressable leaf per authored claim
context_index          topic, type, summary, decision, why, journal_entry,
                       journal_reasons (FK list → specific leaves), related_md
settings               identity, adopted rules, the recurrence query
```

IDs are 10-char uppercase SHA-256 prefixes, matching the Kairos scheme so
the two databases can be read with the same queries.

`type` ∈ Decision | Insight | Correction | Architecture | Test | Blocker |
Task | Lesson | Milestone. `decision` is a permanent conclusion, not a
summary; `why` exists so a future instance inherits the judgment rather
than re-litigating it.

### Why the nesting was worth doing

Flat row 20 was a correction to flat row 19. The only thing connecting
them was the string `"Correction to row 19"` in a title — a
human-readable pointer where a foreign key belonged. Under v2 it is what
it always was: a second reasoning on entry 19 with `optimization='yes'`.
Query the entry, get both passes. That single case is the whole argument
for the restructure.

### v1 (`journey_entries`) is preserved, unmodified

The original flat table is still present and is never dropped, edited or
rewritten — it is the original record. Every one of its 20 rows
reconstructs **verbatim** from the v2 reason tree (checked, not assumed).

| Column | Purpose |
|---|---|
| `timestamp` | Real wall-clock time of this occurrence (ISO8601) |
| `topic_slug` | Stable id, **reused** every time the same underlying point recurs — carried forward to v2 as a first-class column on `journal_entries` |
| `topic_label` | Human-readable title |
| `kind` | `explanation` \| `decision` \| `correction` \| `insight` |
| `content` | This occurrence's specific wording/context |
| `session_ref` | Which session/account this happened in, if known |

**The recurrence query** (run this first, not a full read):

```sql
SELECT topic_slug, COUNT(*) AS occurrences,
       MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen
FROM journal_entries
GROUP BY topic_slug
ORDER BY occurrences DESC;
```

Deliberately temporal-relative on purpose: some things need explaining
over and over (e.g. `mmap-bypasses-js-permission-model`) and the
recurrence itself is the signal worth keeping, not just the latest
restatement.

## Honesty note

This log was started 2026-09-17. It does not contain the prior ~16
months of practice described by its author across other accounts — only
real entries from the session that created it. Backfilling older
history would mean fabricating entries for events not actually
witnessed; don't do that. Let old history stay absent rather than
invented.

Amended 2026-09-21 by the v2 migration. The migration split entries into
reasons **only where the author had written paragraph breaks**;
single-paragraph rows were left as one reason rather than inventing claim
boundaries. Manufacturing structure the original did not have is the same
error as backfilling history that did not happen.
