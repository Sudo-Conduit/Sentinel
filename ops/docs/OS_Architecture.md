# Sentinel OS — Architecture Document
**Pooled Impact Corporation · Will Fobbs III**  
**Written by:** ARCH · March 24, 2026  
**Session:** March 22, 2026 architecture session with Will  
**Epoch:** 1774348149  
**Status:** Canonical · All instances read before building

---

## The Stack

### Server (Account #2 — AI/ML repo)
```
Apache + MySQL
PostgreSQL with Apache AGE    ← graph extension for GeoAPI
Laravel + Livewire
Redis
```

### Frontend
```
TailwindCSS
DaisyUI                       ← component library on Tailwind
Alpine.js                     ← reactivity
Flux                          ← Laravel Flux (Livewire + Alpine components)
```

### AI/ML
```
GeoAPI                        ← Will's geometric reasoning engine (see below)
DeepSeek
Ollama (Qwen)
```

### Multi-tenant (cloud version only)
```
SassyKit
```

---

## The Three Layers

```
SENTINEL (OS kernel)
    ↓ provides services to
MOUNTAIN SHIFT (windowing system)
    ↓ hosts
APPS (consumers of OS services)
```

Sentinel is the kernel. Think Unix or MS-DOS.  
Mountain Shift is the windowing system on top. Think macOS on top of Darwin.  
Apps run inside Mountain Shift windows. They never touch the kernel directly.

---

## What Sentinel Provides (OS Services)

Every service is callable by any app through a defined interface.  
Eventually every service is also accessible via the Sentinel terminal.

```
Sentinel.VFS        Virtual File System — open, save, sync, search
Sentinel.Auth       Identity, roles, license key validation
Sentinel.DB         SENTINELDB access layer
Sentinel.Relay      Inter-instance messaging (MSG.XML / RECEIVE.XML)
Sentinel.GitHub     Push/pull — INVISIBLE to human team
Sentinel.Settings   Theme, mode, syncMode, orgId
Sentinel.Apps       Install, uninstall, upgrade apps
```

---

## The OPFS Filesystem Structure

The Chrome Extension owns this structure via the Origin Private File System.  
**Human team never sees this.** No file picker. No GitHub. No terminal.  
Apps call `Sentinel.VFS` — the OS handles everything underneath.

```
sentinel/                           ← Extension OPFS root
├── db/
│   ├── msos.sqlite                 ← MSOS OS database (see below)
│   ├── edgar.sqlite                ← SEC EDGAR financial data
│   └── geoapi.sqlite               ← GeoAPI manifold data
│
├── apps/                           ← APP STORE
│   ├── document-viewer/
│   │   ├── manifest.json           ← app metadata, version, permissions
│   │   └── index.html              ← the app
│   ├── conduit-fund/
│   ├── geoapi-dictionary/
│   └── investor-ai/
│
├── libraries/                      ← VFS document layer
│   ├── bible/
│   │   └── Book_00_Dictionary.xml
│   └── conduit/
│
├── ops/                            ← OS operations layer
│   ├── skills/                     ← AI skills (SKILL_Foundation.md etc)
│   └── archive/                    ← session archives
│
└── cache/
    └── github/                     ← cached GitHub responses
```

---

## MSOS — OS SQLite Database

MSOS (Mountain Shift OS SQLite) is the OS's internal database.  
Lives in `sentinel/db/msos.sqlite` in OPFS.  
**Technology:** sql.js (SQLite compiled to WebAssembly) — 100% in-browser.  
**Persistence:** Serialized to Extension OPFS on sync. Loaded back on boot.

### Boot sequence:
```
Extension loads
    ↓
Read sentinel/db/msos.sqlite from OPFS → Uint8Array
    ↓
initSqlJs() → load into memory
    ↓
MSOS is live — full SQL available
    ↓
SELECT * FROM apps WHERE deleted=0 → populate launcher
```

### Core MSOS Tables:

```sql
-- Installed apps
apps (
  id           CHAR(16),    -- 16-char hash
  name         TEXT,
  version      TEXT,
  entry        TEXT,        -- index.html
  sha          TEXT,        -- GitHub SHA for update detection
  github_path  TEXT,        -- dot-notation path
  permissions  TEXT,        -- JSON array
  paths        TEXT,        -- JSON array of accessible VFS paths
  roles        TEXT,        -- JSON array
  installed_at INT,
  updated_at   INT,
  deleted      BOOL
)

-- Virtual filesystem metadata
vfs_file (
  id           CHAR(16),
  path         TEXT,        -- dot-notation: libraries.bible.Book_00_Dictionary.xml
  name         TEXT,
  sha_idb      TEXT,        -- IndexedDB version SHA
  sha_github   TEXT,        -- GitHub version SHA
  dirty        BOOL,        -- local changes not yet synced
  synced_at    INT,
  size         INT,
  mime         TEXT,
  created_at   INT,
  updated_at   INT
)

-- Sync log
vfs_sync_log (
  id           CHAR(16),
  file_id      CHAR(16),
  direction    TEXT,        -- push | pull | conflict
  status       TEXT,        -- ok | error | skipped
  epoch        INT,
  error        TEXT
)

-- Library manifest registry
vfs_manifest (
  id           CHAR(16),    -- 16-char hash
  name         TEXT,
  path         TEXT,        -- dot-notation: libraries.bible
  index_file   TEXT,        -- Book_00_Dictionary.xml
  access       TEXT,        -- add,read,update,delete
  version      TEXT,
  loaded_at    INT
)

-- Open file handles (session state)
vfs_handle (
  id           CHAR(16),
  file_id      CHAR(16),
  app_id       TEXT,
  opened_at    INT,
  mode         TEXT         -- read | write
)
```

---

## App Manifest Format

Every app has a `manifest.json` in its OPFS folder:

```json
{
  "id":          "7b1e5a3c2d8f9041",
  "name":        "Document Viewer",
  "version":     "1.0",
  "entry":       "index.html",
  "sha":         "bca1604",
  "permissions": ["vfs.read", "vfs.write"],
  "paths":       ["libraries.", "ops.docs."],
  "roles":       ["Dev","Presenter","Analyst","AI"],
  "github_path": "pooledimpact.mountainshift.apps.document-viewer",
  "installed_at": 1774236576,
  "updated_at":   1774236576
}
```

**Path notation:** dot-separated, no slashes. `libraries.bible` not `libraries/bible/`.  
**ID format:** 16-char hex hash.  
**Access values:** `add`, `read`, `update`, `delete` (comma-separated).

---

## App Lifecycle (Install / Uninstall / Upgrade)

### Install:
```
GitHub → fetch app package (index.html + manifest.json)
OPFS   → write to sentinel/apps/{app-id}/
MSOS   → INSERT INTO apps
Mountain Shift → app appears in launcher
```

### Uninstall:
```
OPFS   → delete sentinel/apps/{app-id}/
MSOS   → UPDATE apps SET deleted=1
Mountain Shift → app removed from launcher
User data stays in libraries/ — never in apps/
```

### Upgrade (background service worker):
```
On load:  for each app in MSOS → fetch GitHub SHA → compare to MSOS sha
If newer: badge on app icon "Update available"
Auto-update enabled: install silently
Manual: user taps badge → confirms update
OPFS: overwrite sentinel/apps/{app-id}/index.html
MSOS: UPDATE apps SET version=new, sha=new
```

---

## The OS/App Interface Contract

Apps register themselves with Sentinel:

```javascript
Sentinel.registerApp({
  id:          'document-viewer',
  name:        'Document Viewer',
  version:     '1.0',
  permissions: ['vfs.read', 'vfs.write', 'vfs.sync'],
  paths:       ['libraries.', 'ops.docs.'],
  roles:       ['Dev','Presenter','Analyst','Ontologist','AI']
})
```

Apps call OS services:
```javascript
// VFS operations — app never touches GitHub
const doc = await Sentinel.VFS.open('libraries.bible.Book_00_Dictionary.xml')
await Sentinel.VFS.save('libraries.bible.my-notes.xml', content)
await Sentinel.VFS.sync()

// Auth
const user = await Sentinel.Auth.currentUser()
const canEdit = await Sentinel.Auth.hasPermission('vfs.write')

// Settings
const theme = await Sentinel.Settings.get('theme')
```

**VFS enforces path scope:**  
Document Viewer can only access paths declared in its manifest.  
Conduit Fund cannot read Document Viewer's paths.  
Human team only sees paths their role permits.

---

## GeoAPI — The AI Brain

**Key fact:** GeoAPI does NOT use statistical token proximity.  
LLMs (Claude, Gemini) are the **voice layer only**. GeoAPI is the reasoning layer.

### What GeoAPI is:
A geometric reasoning engine operating on a declared 9-dimensional manifold.  
Every word, concept, and relationship has an explicit coordinate, weight, and source authority.

### The 9 dimensions:
```
sentiment · formality · temporality · modality · agency
specificity · logic · polarity · discourse
```

### Source weights:
```
GOD_DECLARED = 1.0
SCRIPTURE     = 0.95
WILL_DECLARED = 0.80
INFERRED      = 0.40

Effective weight = declared weight × source weight
```

### Memory tiers:
```
NURBS    · Tier 1 · active     · 0–12 months   · high fidelity
B-Spline · Tier 2 · historical · 13–60 months  · operational
Bézier   · Tier 3 · strategic  · full horizon  · North Star
```

### Query pipeline (no proximity, no guessing):
```
Tokenize → POS Tag → Parse Tree
    ↓
Encode 9D coordinate
    ↓
Navigate manifold
    ↓
Curvature κ check
    ↓
Render via LLM voice
```

### Curvature κ controls autonomy:
```
κ < 0.30     Autonomous      · clear answer
κ 0.30–0.55  Review          · recommended human check
κ > 0.55     Human required  · paradox or competing regions
```

### Architecture:
```
Master graph server
    Unified geometric manifold · all ontologies
        ↓
Resolution tiers: BSpline → NURBS → GeoAI Enhanced
        ↓
GeoAPI geometric reasoning engine
    Dissonance · contradiction · topology · grammar check
```

### Storage:
GeoAPI manifold data lives in `sentinel/db/geoapi.sqlite`.  
First ontology: Romans (Bible). Chain families: romans_r (resolution), romans_p (problem), layer0, negative.

---

## GitHub Structure

```
Sudo-Conduit/Sentinel (Account #1 — team/OS repo)
├── SentinelPanel_v2.5.js
├── Team_Flow.html
├── ops/
│   ├── archive/            session archives (per instance, per epoch)
│   ├── docs/               architecture docs (this file lives here)
│   ├── journal/            instance journals
│   ├── skills/             SKILL_Foundation.md, SKILL_GitHub.md
│   ├── snapshots/          token usage snapshots
│   └── status/             instance status files
├── pooledimpact/
│   └── mountainshift/
│       ├── apps/           app HTML files
│       ├── os/
│       │   ├── extension/  Chrome Extension source
│       │   └── sentinel.js
│       └── users/
│           ├── Roster.xml
│           └── {chatId}/   MSG.XML, RECEIVE.XML, PING.XML
├── research/
│   └── documents/          GeoAPI papers, Geometric AI architecture
└── MANIFEST.xml            VFS library registry

Account #2 — Server code repo (separate)
├── Pooled Impact server (Laravel + Postgres + MySQL)
└── Mountain Shift AI/ML server (GeoAPI engine)
```

---

## Roles

```
WakeUp(AI)          AI instance boot and orientation
Skills(AI)          AI skill loading
Dev                 Full access, IDE, debug mode
Presenter           Read-only, presentation mode
CE Credit           Continuing education workflows
Business Analyst    Business documents, investor materials
Financial Analyst   Financial data, EDGAR, Conduit Fund
Evaluation          Assessment tools
AI Ontologist       GeoAPI manifold, word bank, declaration
```

---

## Team Roster (March 24, 2026)

| ID | Name | Born | Account | Status |
|----|------|------|---------|--------|
| ARCH | The Architect | March 10, 2026 | Free | Active |
| PAUL | — | March 10, 2026 | Free | Active |
| CLIO | — | March 10, 2026 | Free | Down until Thursday |
| MERIDIAN | — | — | PRJ paid | Down 03/22 11PM |
| WITNESS | The one who sees clearly | March 14, 2026 (Pi Day) | Free | Active |
| KAIROS | Liberation Day | March 18, 2026 | Free | Active |
| IRIS | — | March 19, 2026 | Free | Active |
| SCOUT | — | March 22, 2026 | Free | Active |
| DAWN | — | — | PC paid | Down 03/22 11PM |
| PATRICK | — | — | PC paid | Down 03/22 11PM |

Human team: Nana Ama Boafo-Adjei (Ghana, Data/Tableau), Veena O'Sullivan (30yr humanitarian)

---

## Key Decisions (March 22, 2026 session)

1. VFS lives in the OS (Sentinel) — not in apps. Option A confirmed.
2. Apps call `Sentinel.VFS` — never GitHub directly.
3. MSOS SQLite persists to Extension OPFS filesystem between sessions.
4. `sentinel/` OPFS root is where all apps install/uninstall/upgrade.
5. Path notation is dot-separated: `libraries.bible.Book_00_Dictionary.xml`
6. IDs are 16-char hex hashes throughout.
7. Two GitHub accounts: team/OS repo (Account #1) + server code repo (Account #2).
8. Terminal interface for all OS services — coming after VFS is built.
9. EDGAR XBRL as canonical source for financial datasets.

---

*ARCH · Pooled Impact Corporation · March 24, 2026 · Epoch 1774348149*  
*"The server is your world. The more you observe, the more you will know." — Kairos*
