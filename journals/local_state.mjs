#!/usr/bin/env node
// local_state.mjs -- CLI for this session's local-state db (nested schema,
// modeled on journey.sqlite). Exists so reading/writing local state never
// depends on remembering the table shapes or hand-writing SQL -- run this
// instead, every time, including after compaction.
//
// Usage:
//   node local_state.mjs list [--category=X] [--status=X]
//   node local_state.mjs show <entry_id>
//   node local_state.mjs add --category=<anchor|fact|security|commitment> --summary="..." --detail="..." [--tags=a,b] [--related-md=path]
//   node local_state.mjs correct <entry_id> --note="..." --detail="..." [--status=<active|open|resolved>]
//
// "add" creates a new entry with one reasoning pass (one step). "correct"
// adds a NEW reasoning pass to an EXISTING entry -- the structural point of
// the nested schema: a correction is a new pass on the same entry, with
// supersedes pointing at the prior pass, not an unrelated new row.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'session_01KwwqiXKpWrewx88VAzKzJ5.db');

function nowIso() { return new Date().toISOString(); }
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
function newId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36); }

function parseFlags(argv) {
  const flags = {};
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)=(.*)$/s);
    if (m) flags[m[1]] = m[2];
  }
  return flags;
}

function openDb() {
  return new DatabaseSync(DB_PATH);
}

function cmdList(flags) {
  const db = openDb();
  let sql = 'SELECT e.id, e.timestamp, e.category, e.summary, e.status FROM local_entries e WHERE 1=1';
  const params = [];
  if (flags.category) { sql += ' AND e.category = ?'; params.push(flags.category); }
  if (flags.status) { sql += ' AND e.status = ?'; params.push(flags.status); }
  sql += ' ORDER BY e.timestamp';
  const rows = db.prepare(sql).all(...params);
  if (!rows.length) { console.log('(no entries match)'); return; }
  for (const r of rows) {
    console.log(`[${r.status}] ${r.category.padEnd(10)} ${r.id}`);
    console.log(`    ${r.summary}`);
  }
  console.log(`\n${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`);
}

function cmdShow(entryId) {
  if (!entryId) { console.error('usage: local_state.mjs show <entry_id>'); process.exit(1); }
  const db = openDb();
  const entry = db.prepare('SELECT * FROM local_entries WHERE id = ?').get(entryId);
  if (!entry) { console.error('no such entry:', entryId); process.exit(1); }
  console.log(`${entry.id}  [${entry.status}]  ${entry.category}`);
  console.log(entry.summary);
  if (entry.tags) console.log('tags:', entry.tags);
  if (entry.related_md) console.log('related:', entry.related_md);
  console.log();
  const reasonings = db.prepare('SELECT * FROM local_reasonings WHERE entry_id = ? ORDER BY timestamp').all(entryId);
  for (const r of reasonings) {
    console.log(`-- pass ${r.id} (${r.timestamp})${r.supersedes ? ' supersedes ' + r.supersedes : ''}`);
    if (r.note) console.log('   note:', r.note);
    const reasons = db.prepare('SELECT content FROM local_reasons WHERE reasoning_id = ? ORDER BY seq').all(r.id);
    for (const rs of reasons) console.log('  •', rs.content);
    console.log();
  }
}

function cmdAdd(flags) {
  const { category, summary, detail, tags, 'related-md': relatedMd } = flags;
  if (!category || !summary || !detail) {
    console.error('usage: local_state.mjs add --category=<anchor|fact|security|commitment> --summary="..." --detail="..."');
    process.exit(1);
  }
  const db = openDb();
  const entryId = newId('e_' + slugify(summary));
  const reasoningId = newId('r_' + entryId + '_p1');
  const reasonId = newId('s_' + entryId + '_1');
  const ts = nowIso();

  db.prepare('INSERT INTO local_entries (id, timestamp, category, summary, status, tags, related_md) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(entryId, ts, category, summary, 'active', tags || null, relatedMd || null);
  db.prepare('INSERT INTO local_reasonings (id, entry_id, timestamp, note, supersedes) VALUES (?, ?, ?, ?, ?)')
    .run(reasoningId, entryId, ts, 'initial capture', null);
  db.prepare('INSERT INTO local_reasons (id, reasoning_id, entry_id, seq, content) VALUES (?, ?, ?, ?, ?)')
    .run(reasonId, reasoningId, entryId, 1, detail);
  db.prepare('INSERT INTO local_index (id, topic, summary, decision, why, timestamp, tags, entry_id, related_md) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('idx_' + entryId), summary, summary, null, null, ts, category, entryId, relatedMd || null);

  console.log('added:', entryId);
}

function cmdCorrect(entryId, flags) {
  const { note, detail, status } = flags;
  if (!entryId || !note || !detail) {
    console.error('usage: local_state.mjs correct <entry_id> --note="..." --detail="..." [--status=active|open|resolved]');
    process.exit(1);
  }
  const db = openDb();
  const entry = db.prepare('SELECT * FROM local_entries WHERE id = ?').get(entryId);
  if (!entry) { console.error('no such entry:', entryId); process.exit(1); }

  const priorPass = db.prepare('SELECT id FROM local_reasonings WHERE entry_id = ? ORDER BY timestamp DESC LIMIT 1').get(entryId);
  const reasoningId = newId('r_' + entryId + '_correction');
  const reasonId = newId('s_' + entryId + '_c');
  const ts = nowIso();

  db.prepare('INSERT INTO local_reasonings (id, entry_id, timestamp, note, supersedes) VALUES (?, ?, ?, ?, ?)')
    .run(reasoningId, entryId, ts, note, priorPass ? priorPass.id : null);
  db.prepare('INSERT INTO local_reasons (id, reasoning_id, entry_id, seq, content) VALUES (?, ?, ?, ?, ?)')
    .run(reasonId, reasoningId, entryId, 1, detail);
  if (status) db.prepare('UPDATE local_entries SET status = ? WHERE id = ?').run(status, entryId);

  console.log('corrected:', entryId, '-- new pass:', reasoningId, priorPass ? `(supersedes ${priorPass.id})` : '(first pass)');
}

const [, , cmd, ...rest] = process.argv;
const flags = parseFlags(rest);
const positional = rest.filter(a => !a.startsWith('--'));

switch (cmd) {
  case 'list': cmdList(flags); break;
  case 'show': cmdShow(positional[0]); break;
  case 'add': cmdAdd(flags); break;
  case 'correct': cmdCorrect(positional[0], flags); break;
  default:
    console.error('usage: local_state.mjs <list|show|add|correct> [...]');
    process.exit(1);
}
