-- ============================================================
-- UPLOAD & IMPORT PIPELINE TABLES
-- ============================================================

-- file_versions: tracks every file import (dedup via md5)
CREATE TABLE IF NOT EXISTS file_versions (
  id           SERIAL PRIMARY KEY,
  file_name    TEXT NOT NULL,
  md5_hash     TEXT NOT NULL,
  source_id    UUID REFERENCES repertory_sources(id),
  imported_at  TIMESTAMPTZ DEFAULT NOW(),
  imported_by  UUID REFERENCES users(id),
  rows_added   INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0,
  status       TEXT CHECK (status IN ('pending','processing','done','failed')),
  error_msg    TEXT,
  UNIQUE(file_name, md5_hash)
);

-- upload_jobs: top-level upload job tracking
CREATE TABLE IF NOT EXISTS upload_jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id    UUID REFERENCES repertory_sources(id),
  version_tag  TEXT,
  year         INTEGER,
  status       TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','validating','validated','importing','done','failed')),
  file_names   JSONB DEFAULT '[]',
  validation_result JSONB,
  import_summary    JSONB,
  progress     JSONB DEFAULT '{}',
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- page_refs: source from Pagerefs.tab
CREATE TABLE IF NOT EXISTS page_refs (
  id           SERIAL PRIMARY KEY,
  rubric_id    UUID REFERENCES rubrics(id) ON DELETE CASCADE,
  book_code    TEXT,
  page_number  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_page_refs_rubric ON page_refs(rubric_id);

-- library_index: source from LibraryIndex.tab
CREATE TABLE IF NOT EXISTS library_index (
  id         SERIAL PRIMARY KEY,
  rubric_id  UUID REFERENCES rubrics(id) ON DELETE CASCADE,
  reference  TEXT,
  author     TEXT,
  year       TEXT
);

CREATE INDEX IF NOT EXISTS idx_library_index_rubric ON library_index(rubric_id);

-- Add ext_id and rem_code columns to existing tables for TAB file mapping
ALTER TABLE rubrics ADD COLUMN IF NOT EXISTS ext_id INTEGER UNIQUE;
ALTER TABLE remedies ADD COLUMN IF NOT EXISTS rem_code INTEGER UNIQUE;
ALTER TABLE remedies ADD COLUMN IF NOT EXISTS family TEXT;
ALTER TABLE remedies ADD COLUMN IF NOT EXISTS kingdom TEXT;
ALTER TABLE remedies ADD COLUMN IF NOT EXISTS polar_group TEXT;

CREATE INDEX IF NOT EXISTS idx_rubrics_ext_id ON rubrics(ext_id);
CREATE INDEX IF NOT EXISTS idx_remedies_rem_code ON remedies(rem_code);
