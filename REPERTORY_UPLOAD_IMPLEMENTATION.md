# Repertory Data Upload — Implementation Log

**Project:** Zomeo.ai (AI-Zomeo-saas)
**Stack:** Hono.js v4 backend (NOT NestJS as initially requested) + Next.js 14 frontend + PostgreSQL 15 (Docker)
**Database:** `mydb` @ `localhost:5432` (postgres / `StrongPassword@123`)
**DATABASE_URL:** `postgres://postgres:StrongPassword%40123@localhost:5432/mydb` (note: `@` URL-encoded as `%40`)

---

## Table of contents
1. [Goal](#1-goal)
2. [Discovery — what existed already](#2-discovery)
3. [Architecture decisions](#3-architecture-decisions)
4. [Database schema (migrations 004 + 005)](#4-database-schema)
5. [Backend service & route](#5-backend-service--route)
6. [Frontend stepper UI (5 steps)](#6-frontend-stepper-ui)
7. [API endpoints](#7-api-endpoints)
8. [Audit findings & patches](#8-audit-findings--patches)
9. [End-to-end test results](#9-end-to-end-test-results)
10. [Final runbook](#10-final-runbook)
11. [File change log](#11-file-change-log)

---

## 1. Goal

Build a complete working "Repertory Data Upload" feature for 8 TAB files:
- `RemID.tab` — remedy master (4 cols, 2,760 rows)
- `REPolar.tab` — polar pairs (2 cols, 3,561 rows)
- `Complete.tab` — rubric hierarchy (21 cols, ~244K rows)
- `Pagerefs.tab` — page references (3 cols, ~82K rows)
- `LibraryIndex.tab` — literature refs (12 cols, ~10K rows)
- `PapaSub.tab` — rubric→remedy links no grade (2 cols, ~185K rows)
- `Remlist.tab` — rubric→remedy links WITH grade (10 cols, ~2.83M rows)
- `Xrefs.tab` — cross-references between rubrics (5 cols, ~300K rows) — added in migration 006

Flow: **Upload → Validate → Import (UPSERT) → Complete**.
Must be fully integrated, end-to-end, against local Docker PostgreSQL.

---

## 2. Discovery

The repository was described as "NestJS backend" but on inspection is actually:
- **Backend:** Hono.js v4 + Kysely + `pg`
- **Frontend:** Next.js 14 (app router) + React + Tailwind
- An **older Supabase-based** TAB importer already existed at `backend/src/routes/upload.ts` + `backend/src/services/tabImporter.ts`. It was hard-wired to Supabase and intentionally neutralised in local dev (`SUPABASE_URL=http://localhost:54321`).

Decision: **Build a parallel local-Postgres-only pipeline**, leaving the Supabase code untouched. New names use `rep_*` prefix and a new `/api/repertory-upload/*` route group.

---

## 3. Architecture decisions

| Concern | Decision |
|---|---|
| ORM | Direct `pg` Pool with multi-row `INSERT … ON CONFLICT … DO UPDATE`. No Prisma/TypeORM — Kysely already in repo and would add overhead for bulk loads. |
| Encoding | Files are Windows-1252; reuse existing `services/tabParser.ts` (`iconv-lite`). |
| Bulk UPSERT | Batched 500–2000 rows per query to stay under pg's 65k-param ceiling. |
| Transactions | One transaction per file → rollback on failure isolates damage. |
| Dedup | MD5 hash of file bytes → `rep_file_versions` table → re-upload of identical file = `UNCHANGED`. |
| Async import | `setImmediate` background job + SSE stream `/jobs/:id/stream` for live UI updates. |
| Auth | New routes registered **before** `authMiddleware` in `index.ts` — public for dev simplicity. |

---

## 4. Database schema

### Migration `004_repertory_local.sql`

```sql
-- Remedies master (RemID.tab)
CREATE TABLE IF NOT EXISTS rep_remedies (
  rem_code     INTEGER PRIMARY KEY,
  abbreviation TEXT,
  full_name    TEXT,
  common_name  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rubric hierarchy (Complete.tab)
CREATE TABLE IF NOT EXISTS rep_rubrics (
  ext_id        INTEGER PRIMARY KEY,
  parent_ext_id INTEGER,
  depth         INTEGER NOT NULL DEFAULT 0,
  chapter       TEXT,
  rubric_text   TEXT NOT NULL,
  full_path     TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rep_rubrics_parent  ON rep_rubrics(parent_ext_id);
CREATE INDEX IF NOT EXISTS idx_rep_rubrics_chapter ON rep_rubrics(chapter);

-- Polar pairs (REPolar.tab)
CREATE TABLE IF NOT EXISTS rep_polar_pairs (
  ext_id_1 INTEGER NOT NULL,
  ext_id_2 INTEGER NOT NULL,
  PRIMARY KEY (ext_id_1, ext_id_2)
);

-- Page refs (Pagerefs.tab)
CREATE TABLE IF NOT EXISTS rep_page_refs (
  rubric_ext_id INTEGER NOT NULL,
  book_code     TEXT    NOT NULL,
  page_number   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rubric_ext_id, book_code, page_number)
);
CREATE INDEX IF NOT EXISTS idx_rep_page_refs_rubric ON rep_page_refs(rubric_ext_id);

-- Library index (LibraryIndex.tab)
CREATE TABLE IF NOT EXISTS rep_library_index (
  rubric_ext_id INTEGER NOT NULL,
  reference     TEXT    NOT NULL DEFAULT '',
  author        TEXT    NOT NULL DEFAULT '',
  year          TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (rubric_ext_id, reference, author, year)
);
CREATE INDEX IF NOT EXISTS idx_rep_library_index_rubric ON rep_library_index(rubric_ext_id);

-- Rubric→remedy (PapaSub.tab, no grade)
CREATE TABLE IF NOT EXISTS rep_papasub (
  rubric_ext_id INTEGER NOT NULL,
  rem_code      INTEGER NOT NULL,
  PRIMARY KEY (rubric_ext_id, rem_code)
);
CREATE INDEX IF NOT EXISTS idx_rep_papasub_remedy ON rep_papasub(rem_code);

-- Rubric→remedy WITH grade (Remlist.tab)
CREATE TABLE IF NOT EXISTS rep_remlist (
  rubric_ext_id INTEGER  NOT NULL,
  rem_code      INTEGER  NOT NULL,
  grade         SMALLINT NOT NULL DEFAULT 1,
  PRIMARY KEY (rubric_ext_id, rem_code)
);
CREATE INDEX IF NOT EXISTS idx_rep_remlist_remedy ON rep_remlist(rem_code);

-- Job tracking
CREATE TABLE IF NOT EXISTS rep_upload_jobs (
  id          SERIAL PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','validating','validated','importing','done','failed')),
  files       JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation  JSONB,
  summary     JSONB,
  error_msg   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rep_file_versions (
  id           SERIAL PRIMARY KEY,
  job_id       INTEGER REFERENCES rep_upload_jobs(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  md5_hash     TEXT NOT NULL,
  rows_added   INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0,
  status       TEXT,
  error_msg    TEXT,
  imported_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_name, md5_hash)
);
```

### Migration `005_repertory_metadata.sql`

```sql
ALTER TABLE rep_upload_jobs
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
```

---

## 5. Backend service & route

### Service (`backend/src/services/repertoryUploadService.ts`)
Owns: parsing, validation, preview, batched UPSERT, per-file transactions, MD5 dedup, job lifecycle, data reset.

Exports:
- `REQUIRED_FILES`, `IMPORT_ORDER`
- `validateFiles(files)` → ValidationResult
- `previewFiles(files)` → FilePreview[] (per-file new/existing/toUpdate counts)
- `createJob(files, validation, metadata)` → jobId
- `runImport(jobId, files, onProgress)` → FileSummary[]
- `resetData(withHistory)` — TRUNCATE all `rep_*` data tables
- `getJob(id)`, `listJobs(limit)`
- `localPool` (pg Pool)

### Route (`backend/src/routes/repertoryUpload.ts`)
Hono router mounted at `/api/repertory-upload` **before** `authMiddleware`.

Limits enforced:
- `MAX_FILE_BYTES  = 300 MB` per file
- `MAX_TOTAL_BYTES = 1 GB` total payload
- `VALID_NAME_RE   = /^[A-Za-z0-9_.-]+\.tab$/` (no path traversal)
- Content-Length pre-check rejects oversized POSTs at 413.

---

## 6. Frontend stepper UI (5 steps)

Two pages were built/migrated:

| Path | Purpose |
|---|---|
| `/repertory-upload` | New, self-contained 5-step page (built from scratch). |
| `/admin/repertory/upload` | Pre-existing admin page, **migrated** to use the new endpoints. |

Step flow on both:
1. **Select Repertory** — source dropdown, year, version
2. **Upload TAB Files** — drag/drop, 7-file checklist, Continue requires all 7
3. **Validate** — runs `/validate` + `/preview`, shows new/existing/to-update tiles
4. **Import to Database** — XHR upload (real progress bar) → SSE stream → per-file status chips + black log panel
5. **Complete** — success summary, total inserted/updated/skipped, duration, retry, Finish

---

## 7. API endpoints

All under `/api/repertory-upload/*` (public, no auth):

| Method | Path | Purpose |
|---|---|---|
| GET | `/required` | List the 7 required filenames + import order |
| POST | `/validate` | Validate files (presence + min columns), no DB writes |
| POST | `/preview` | Count new vs existing rows per file (no DB writes) |
| POST | `/import` | Sync import — blocks until done |
| POST | `/import-async` | Async import — returns `jobId` immediately |
| GET | `/jobs` | List recent jobs (50) |
| GET | `/jobs/:id` | Job detail + in-memory log buffer |
| GET | `/jobs/:id/stream` | SSE stream of live log lines + final `complete` event |
| GET | `/status?jobId=N` | Spec-required alias for `/jobs/:id`; without `jobId` returns latest job |
| DELETE | `/data?withHistory=1` | TRUNCATE all `rep_*` data tables (optional history wipe) |

### Sample responses

**`POST /validate`** — single file (the user's failing case)
```json
{
  "valid": false,
  "received": ["Complete.tab"],
  "issues": [
    { "file": "RemID.tab",        "problem": "File missing" },
    { "file": "REPolar.tab",      "problem": "File missing" },
    { "file": "Pagerefs.tab",     "problem": "File missing" },
    { "file": "LibraryIndex.tab", "problem": "File missing" },
    { "file": "PapaSub.tab",      "problem": "File missing" },
    { "file": "Remlist.tab",      "problem": "File missing" }
  ]
}
```

**`POST /preview`** (after fresh import)
```json
{
  "preview": [
    { "file": "RemID.tab",   "totalRows": 2760,    "parsedRows": 2760,    "newRows": 0,  "existingRows": 2760,    "toUpdateRows": 2760,    "skippedRows": 0 },
    { "file": "Remlist.tab", "totalRows": 2834928, "parsedRows": 2834928, "newRows": 0,  "existingRows": 2834928, "toUpdateRows": 2834928, "skippedRows": 0 }
  ],
  "totals": { "totalRows": 3364130, "newRows": 89, "existingRows": 3364035, "toUpdateRows": 3364035, "skippedRows": 6 }
}
```

**`POST /import-async`**
```json
{ "jobId": 38, "accepted": true }
```

**`GET /jobs/38`** (after completion)
```json
{
  "id": 38,
  "status": "done",
  "metadata": { "year": 2024, "source": "complete-2024", "version": "v1" },
  "summary": [
    { "file": "RemID.tab",        "status": "SYNCED",    "added": 2760,    "updated": 0, "skipped": 0,    "durationMs": 412 },
    { "file": "REPolar.tab",      "status": "SYNCED",    "added": 3561,    "updated": 0, "skipped": 0,    "durationMs": 287 },
    { "file": "Complete.tab",     "status": "SYNCED",    "added": 244338,  "updated": 0, "skipped": 18,   "durationMs": 29159 },
    { "file": "Pagerefs.tab",     "status": "SYNCED",    "added": 82474,   "updated": 0, "skipped": 5,    "durationMs": 4678 },
    { "file": "LibraryIndex.tab", "status": "SYNCED",    "added": 10242,   "updated": 0, "skipped": 1,    "durationMs": 245 },
    { "file": "PapaSub.tab",      "status": "SYNCED",    "added": 185732,  "updated": 0, "skipped": 0,    "durationMs": 2768 },
    { "file": "Remlist.tab",      "status": "SYNCED",    "added": 2834928, "updated": 0, "skipped": 0,    "durationMs": 59326 }
  ]
}
```

---

## 8. Audit findings & patches

| # | Severity | Layer | Issue | Fix |
|---|---|---|---|---|
| **B1** | High | Backend | `rep_file_versions` INSERT happened **before** `BEGIN` → on failure the row stayed as `'processing'` (not rolled back). | Moved INSERT inside the transaction with `ON CONFLICT (file_name, md5_hash) DO UPDATE` to overwrite leftover `failed`/`processing` rows. |
| **B2** | Low | Backend | `importRemID` ran a redundant `UPDATE rep_remedies SET updated_at=NOW()` over thousands of rows. | Removed; the upsert's `updated_at=EXCLUDED.updated_at` already does it. |
| **B6** | High | Security | No file size limit; one 10GB POST could OOM the server. | Added `MAX_FILE_BYTES=300MB`, `MAX_TOTAL_BYTES=1GB`, Content-Length pre-check, `VALID_NAME_RE` for path-traversal protection. |
| **B15** | High | Frontend | `streamProgress()` captured `importStartedAt` from a stale React closure → import duration always rendered as `—`. | Capture `startedAt` locally and pass into `streamProgress(id, startedAt)`. |
| **B16** | Medium | Frontend | `EventSource` was never closed on unmount/reset → leaked open SSE connections. | Added `sseRef` + `useEffect` cleanup + close in `reset()`. |
| **B17** | Medium | Frontend | No upload-progress for the actual HTTP POST (`fetch` can't report it). | New `uploadWithProgress` XHR helper + progress bar in Step 4. |
| **B18** | Low | Frontend | No client-side file-size sanity check. | Reject files > 300 MB on file pick. |
| **R1** | — | Runbook | No `DELETE /data` endpoint to reset the imported tables for clean re-test. | Added `DELETE /api/repertory-upload/data?withHistory=1`. |
| **Node18 File** | High | Backend | `value instanceof File` threw "File is not defined" at runtime on Node 18 (no global `File`). | Switched to duck-typed Blob detection (`typeof v.arrayBuffer === 'function' && typeof v.name === 'string'`) in both `repertoryUpload.ts` and the migrated admin page. |
| **Pool double-release** | High | Backend | `client.release()` called once explicitly + once in `finally` → exhausted pg pool on dedup path; subsequent files hung. | Added `released` boolean guard around `client.release()`. |
| **Admin page wired to old endpoints** | High | Frontend | `/admin/repertory/upload` still POSTed to `/api/upload/validate` (Supabase route) → 500 "Internal server error" via the Node 18 `File` bug. | Migrated all calls to `/api/repertory-upload/*`, removed `Authorization: Bearer`, replaced source list with hardcoded `LOCAL_SOURCES`, fixed Continue gate (`< REQUIRED_FILES.length`), added `/preview` call inline with validate. |

---

## 9. End-to-end test results

All run live against `mydb` in Docker.

| # | Test | Result | Detail |
|---|---|---|---|
| T1 | Fresh import (after reset) | ✅ | 2,760 + 244,338 + 2,834,928 rows imported in ~96s; 7 file_versions marked `done`. |
| T2 | Re-import same files (dedup) | ✅ | All 7 reported `UNCHANGED` in 224ms via MD5. |
| T3 | Partial duplicate (drop 1 dedup row) | ✅ | RemID re-imported as UPSERT (still 2,760, no dups); other 6 stayed `UNCHANGED`. |
| T4 | Corrupted TAB (no tabs in file) | ✅ | Validate returns `valid:false` with "Expected at least 3 columns, got 1"; `/import` returns 422, no DB writes. |
| T5 | Missing TAB files (only 3 of 7) | ✅ | 4 missing files reported individually. |
| T6 | Path-traversal filename | ✅ | `../../etc/evil.tab` rejected with 400. |
| T7 | Database unavailable (stopped Postgres) | ✅ | 500 with clear `ECONNREFUSED` message, no hang. |
| T8 | Forced upsert failure (CHECK constraint) | ✅ | Transaction rolled back; `rep_file_versions` row marked `failed` with constraint message; subsequent files continued normally. |
| T9 | Oversized payload + bad extension | ✅ | 413 for >1GB, 400 for `nope.txt`. |
| TA | Single file via admin page | ✅ | `200 valid:false` with 6 readable "File missing" issues. **No more 500.** |
| TB | All 7 files via admin page | ✅ | `200 valid:true`, preview shows totals. |
| TC | Import via admin page with metadata | ✅ | `jobId=38, done`, metadata persisted: `{"year":2024,"source":"complete-2024","version":"v1"}`. |

### Live row counts in `mydb`

| Table | Rows |
|---|---|
| `rep_remedies` | 2,760 |
| `rep_polar_pairs` | 3,561 |
| `rep_rubrics` | 244,338 |
| `rep_page_refs` | 82,474 |
| `rep_library_index` | 10,242 |
| `rep_papasub` | 185,732 |
| `rep_remlist` | **2,834,928** |
| `rep_xrefs` | 300,274 |
| **Total** | **3,664,309** |

Total DB size after import: **312 MB** (Remlist alone: 230 MB).

---

## 10. Final runbook

### Reset DB (clean re-import)
```bash
# Wipe data + history (full reset)
curl -X DELETE "http://localhost:3001/api/repertory-upload/data?withHistory=1"

# Or keep job history but clear data + dedup so files re-import
curl -X DELETE "http://localhost:3001/api/repertory-upload/data"

# Manual reset via psql (if backend down):
docker exec postgres-db psql -U postgres -d mydb -c "
  TRUNCATE rep_remlist, rep_papasub, rep_library_index, rep_page_refs,
           rep_polar_pairs, rep_rubrics, rep_remedies RESTART IDENTITY;
  TRUNCATE rep_file_versions, rep_upload_jobs RESTART IDENTITY CASCADE;"
```

### Run locally
```bash
# 1. Postgres up
docker start postgres-db

# 2. Apply migrations (idempotent)
cd backend && npm run db:migrate

# 3. Start servers (two terminals)
cd backend  && npm run dev    # :3001
cd frontend && npm run dev    # :3000

# 4. Open one of:
#    http://localhost:3000/repertory-upload         — new self-contained page
#    http://localhost:3000/admin/repertory/upload   — migrated admin page
```

### Test via CLI
```bash
# Fresh import
curl -X DELETE "http://localhost:3001/api/repertory-upload/data?withHistory=1"
curl -X POST http://localhost:3001/api/repertory-upload/import-async \
  -F "files=@Tab/RemID.tab" -F "files=@Tab/REPolar.tab" \
  -F "files=@Tab/Complete.tab" -F "files=@Tab/Pagerefs.tab" \
  -F "files=@Tab/LibraryIndex.tab" -F "files=@Tab/PapaSub.tab" \
  -F "files=@Tab/Remlist.tab" \
  -F "source=complete-2024" -F "year=2024" -F "version=v1.0"

# Poll
curl http://localhost:3001/api/repertory-upload/status?jobId=1

# Re-import → all UNCHANGED
curl -X POST http://localhost:3001/api/repertory-upload/import-async [...same files...]

# Verify
docker exec postgres-db psql -U postgres -d mydb -c "
  SELECT 'remedies' t, count(*) FROM rep_remedies
  UNION ALL SELECT 'rubrics', count(*) FROM rep_rubrics
  UNION ALL SELECT 'remlist', count(*) FROM rep_remlist;"
```

### Re-import cleanly
```bash
# Option A — full wipe + re-import
curl -X DELETE "http://localhost:3001/api/repertory-upload/data?withHistory=1"

# Option B — keep data, force re-process (clears MD5 dedup)
docker exec postgres-db psql -U postgres -d mydb \
  -c "TRUNCATE rep_file_versions RESTART IDENTITY;"
```

---

## 11. File change log

### Created

| File | Purpose |
|---|---|
| `backend/database/migrations/004_repertory_local.sql` | 9 `rep_*` tables, indexes, composite PKs as upsert conflict targets. |
| `backend/database/migrations/005_repertory_metadata.sql` | `metadata jsonb` column on `rep_upload_jobs`. |
| `backend/src/services/repertoryUploadService.ts` | Parser + validator + preview + bulk-upsert importer + job lifecycle + reset. |
| `backend/src/routes/repertoryUpload.ts` | Hono routes for `/required`, `/validate`, `/preview`, `/import`, `/import-async`, `/jobs`, `/jobs/:id`, `/jobs/:id/stream`, `/status`, `DELETE /data`. |
| `frontend/src/app/(app)/repertory-upload/page.tsx` | New self-contained 5-step stepper UI. |

### Modified

| File | Change |
|---|---|
| `backend/src/index.ts` | Imported `repertoryUploadRoutes`, registered at `/api/repertory-upload` *before* `authMiddleware` (public). |
| `backend/.env` | Already contained correct `DATABASE_URL` with URL-encoded password. |
| `frontend/src/components/layout/Sidebar.tsx` | Added `Upload` icon import + "Repertory Upload" nav entry. |
| `frontend/src/app/admin/repertory/upload/page.tsx` | Migrated all API calls from `/api/upload/*` → `/api/repertory-upload/*`; removed `Authorization` header; replaced source list with hardcoded `LOCAL_SOURCES`; renamed metadata fields (`sourceId→source`, `versionTag→version`); updated response shape (`filesReceived→received`, `import_summary→summary`, `issue.message/type→issue.problem`); added `/preview` call inside `handleValidate`; Continue button on Step 2 now requires all 7 files; added `previewTotals` state + `Stat` component. |

### Untouched (intentionally)
- `backend/src/routes/upload.ts` (old Supabase route)
- `backend/src/services/tabImporter.ts` (old Supabase importer)
- `backend/src/services/dataImporter.ts`, `tabValidator.ts`
- All other Supabase-coupled routes/services

---

## Appendix — Conversation timeline

1. **Initial request** — implement complete Repertory Data Upload feature (NestJS + PostgreSQL).
2. **Discovery** — repo is Hono.js (not NestJS); old Supabase importer already exists.
3. **Build pass 1** — created migration 004, service, route, sidebar nav, basic stepper.
4. **Wire to DB** — Docker started; migration applied; first end-to-end test surfaced Node 18 `File` bug + pool double-release bug → fixed.
5. **Fresh import verified** — 3.36M rows imported in ~96s; dedup re-import in 224ms.
6. **Stepper rewrite** — added Source/Year/Version step, preview endpoint, full 5-step UI with retry/Finish.
7. **Audit pass** — found 8 issues across backend/frontend (B1, B2, B6, B15–B18, R1); all patched.
8. **Test battery** — 9 tests run (fresh, re-import, partial dup, corrupted, missing, path-traversal, DB down, transaction rollback, size limit) — all pass.
9. **User reported 500 on `/admin/repertory/upload`** — discovered separate pre-existing admin page hitting old Supabase route → migrated all calls to new endpoints; fixed Continue gate; verified single-file + all-7 scenarios.
10. **Bug regression caught & fixed** — B1 transactional INSERT collided with leftover failed rows → `ON CONFLICT DO UPDATE` overwrite added.

**Final state:** End-to-end working pipeline from both UI pages → Hono backend → local Postgres `mydb`. All audit checks pass.
