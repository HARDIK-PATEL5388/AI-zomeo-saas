-- Migration 008: Repertory Analysis v2
-- Bridges existing UUID `cases` table with integer-keyed `rep_*` data backbone.
-- Two new tables only; no changes to legacy analysis schema.

-- 1. Selected rubrics for a case (per-doctor working set)
CREATE TABLE IF NOT EXISTS case_rep_rubrics (
  id             SERIAL PRIMARY KEY,
  case_id        UUID    NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  rubric_ext_id  INTEGER NOT NULL REFERENCES rep_rubrics(ext_id) ON DELETE CASCADE,
  weight         SMALLINT NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 4),
  intensity      TEXT CHECK (intensity IN ('high','mid','low')) DEFAULT 'mid',
  symptom_note   TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  added_by       UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, rubric_ext_id)
);
CREATE INDEX IF NOT EXISTS idx_case_rep_rubrics_case ON case_rep_rubrics(case_id);
CREATE INDEX IF NOT EXISTS idx_case_rep_rubrics_rubric ON case_rep_rubrics(rubric_ext_id);

-- 2. Saved analysis snapshots
CREATE TABLE IF NOT EXISTS case_rep_analyses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  method        TEXT NOT NULL CHECK (method IN ('kent','weighted')),
  rubric_count  INTEGER NOT NULL,
  results       JSONB NOT NULL,
  notes         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_case_rep_analyses_case ON case_rep_analyses(case_id, created_at DESC);

-- 3. Trigram support for fast rubric autocomplete
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_rep_rubrics_text_trgm
  ON rep_rubrics USING GIN (rubric_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_rep_rubrics_full_path_trgm
  ON rep_rubrics USING GIN (full_path gin_trgm_ops);
