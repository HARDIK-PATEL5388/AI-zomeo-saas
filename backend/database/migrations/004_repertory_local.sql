-- ============================================================
-- LOCAL POSTGRES — Repertory Data Upload (7 TAB files)
-- DB: mydb @ localhost:5432
-- All tables prefixed `rep_` to keep them isolated from any
-- existing Supabase-shaped schema.
-- ============================================================

-- 1. Remedies master (RemID.tab — 4 cols)
CREATE TABLE IF NOT EXISTS rep_remedies (
  rem_code     INTEGER PRIMARY KEY,
  abbreviation TEXT,
  full_name    TEXT,
  common_name  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Rubric hierarchy (Complete.tab — 21 cols)
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

-- 3. Polar pairs (REPolar.tab — 2 cols)
CREATE TABLE IF NOT EXISTS rep_polar_pairs (
  ext_id_1 INTEGER NOT NULL,
  ext_id_2 INTEGER NOT NULL,
  PRIMARY KEY (ext_id_1, ext_id_2)
);

-- 4. Page references (Pagerefs.tab — 3 cols)
CREATE TABLE IF NOT EXISTS rep_page_refs (
  rubric_ext_id INTEGER NOT NULL,
  book_code     TEXT    NOT NULL,
  page_number   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rubric_ext_id, book_code, page_number)
);
CREATE INDEX IF NOT EXISTS idx_rep_page_refs_rubric ON rep_page_refs(rubric_ext_id);

-- 5. Library index (LibraryIndex.tab — 12 cols)
CREATE TABLE IF NOT EXISTS rep_library_index (
  rubric_ext_id INTEGER NOT NULL,
  reference     TEXT    NOT NULL DEFAULT '',
  author        TEXT    NOT NULL DEFAULT '',
  year          TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (rubric_ext_id, reference, author, year)
);
CREATE INDEX IF NOT EXISTS idx_rep_library_index_rubric ON rep_library_index(rubric_ext_id);

-- 6. Rubric→remedy links (PapaSub.tab — 2 cols, no grade)
CREATE TABLE IF NOT EXISTS rep_papasub (
  rubric_ext_id INTEGER NOT NULL,
  rem_code      INTEGER NOT NULL,
  PRIMARY KEY (rubric_ext_id, rem_code)
);
CREATE INDEX IF NOT EXISTS idx_rep_papasub_remedy ON rep_papasub(rem_code);

-- 7. Rubric→remedy links WITH grade (Remlist.tab — 10 cols)
CREATE TABLE IF NOT EXISTS rep_remlist (
  rubric_ext_id INTEGER  NOT NULL,
  rem_code      INTEGER  NOT NULL,
  grade         SMALLINT NOT NULL DEFAULT 1,
  PRIMARY KEY (rubric_ext_id, rem_code)
);
CREATE INDEX IF NOT EXISTS idx_rep_remlist_remedy ON rep_remlist(rem_code);

-- ============================================================
-- Job tracking
-- ============================================================
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
