-- ============================================================
-- 009: Multi-book repertory structure
--
-- Old shape:  rep_rubrics (chapter as free text) → rep_remlist
-- New shape:  rep_books → rep_book_chapters → rep_rubrics → rep_rubric_remedies
--             (rep_remedies stays shared across books)
--
-- Each book is fully independent: own chapters, own ext_id namespace,
-- own remedy mapping, own grading. Same logical rubric in two books =
-- two separate rows. Mirrors old C++ Zomeo behavior.
--
-- Existing data (Complete repertory) is backfilled into a 'complete'
-- book row so nothing is lost and existing endpoints keep working.
-- ============================================================

-- 1. rep_books master ------------------------------------------------------
CREATE TABLE IF NOT EXISTS rep_books (
  id          SMALLSERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO rep_books (code, name, sort_order)
VALUES ('complete', 'Complete', 0)
ON CONFLICT (code) DO NOTHING;

-- 2. rep_book_chapters (proper chapter table per book) --------------------
CREATE TABLE IF NOT EXISTS rep_book_chapters (
  id          SERIAL PRIMARY KEY,
  book_id     SMALLINT NOT NULL REFERENCES rep_books(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, name)
);
CREATE INDEX IF NOT EXISTS idx_rep_book_chapters_book ON rep_book_chapters(book_id);

-- 3. Add book_id, chapter_id, rubric_id to rep_rubrics --------------------
ALTER TABLE rep_rubrics ADD COLUMN IF NOT EXISTS book_id    SMALLINT;
ALTER TABLE rep_rubrics ADD COLUMN IF NOT EXISTS chapter_id INTEGER;

CREATE SEQUENCE IF NOT EXISTS rep_rubrics_rubric_id_seq;
ALTER TABLE rep_rubrics ADD COLUMN IF NOT EXISTS rubric_id BIGINT;

UPDATE rep_rubrics
   SET book_id = (SELECT id FROM rep_books WHERE code='complete')
 WHERE book_id IS NULL;

UPDATE rep_rubrics
   SET rubric_id = nextval('rep_rubrics_rubric_id_seq')
 WHERE rubric_id IS NULL;

ALTER TABLE rep_rubrics ALTER COLUMN book_id   SET NOT NULL;
ALTER TABLE rep_rubrics ALTER COLUMN rubric_id SET NOT NULL;
ALTER TABLE rep_rubrics ALTER COLUMN rubric_id SET DEFAULT nextval('rep_rubrics_rubric_id_seq');
ALTER SEQUENCE rep_rubrics_rubric_id_seq OWNED BY rep_rubrics.rubric_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='rep_rubrics_rubric_id_key'
  ) THEN
    ALTER TABLE rep_rubrics
      ADD CONSTRAINT rep_rubrics_rubric_id_key UNIQUE (rubric_id);
  END IF;
END $$;

-- Backfill rep_book_chapters from existing rubric.chapter values
INSERT INTO rep_book_chapters (book_id, name, code, sort_order)
SELECT
  (SELECT id FROM rep_books WHERE code='complete') AS book_id,
  chapter, chapter,
  ROW_NUMBER() OVER (ORDER BY chapter) AS sort_order
FROM (
  SELECT DISTINCT chapter
    FROM rep_rubrics
   WHERE chapter IS NOT NULL AND chapter <> ''
) c
ON CONFLICT (book_id, name) DO NOTHING;

UPDATE rep_rubrics r
   SET chapter_id = bc.id
  FROM rep_book_chapters bc
 WHERE bc.book_id = r.book_id
   AND bc.name    = r.chapter
   AND r.chapter_id IS NULL;

-- Drop dependent FKs that reference rep_rubrics(ext_id) before we swap PK.
-- case_rep_rubrics (migration 008) is the known dependent; it gets a fresh
-- rubric_id-based FK below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='case_rep_rubrics_rubric_ext_id_fkey'
  ) THEN
    ALTER TABLE case_rep_rubrics DROP CONSTRAINT case_rep_rubrics_rubric_ext_id_fkey;
  END IF;
END $$;

-- Switch primary key: ext_id → (book_id, ext_id)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_rubrics_pkey') THEN
    ALTER TABLE rep_rubrics DROP CONSTRAINT rep_rubrics_pkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='rep_rubrics_book_ext_pk'
  ) THEN
    ALTER TABLE rep_rubrics
      ADD CONSTRAINT rep_rubrics_book_ext_pk PRIMARY KEY (book_id, ext_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rep_rubrics_book          ON rep_rubrics(book_id);
CREATE INDEX IF NOT EXISTS idx_rep_rubrics_book_chapter  ON rep_rubrics(book_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_rep_rubrics_book_parent   ON rep_rubrics(book_id, parent_ext_id);

-- 4. Rename rep_remlist → rep_rubric_remedies, add book_id ----------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='rep_remlist')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='rep_rubric_remedies') THEN
    ALTER TABLE rep_remlist RENAME TO rep_rubric_remedies;
  END IF;
END $$;

ALTER TABLE rep_rubric_remedies ADD COLUMN IF NOT EXISTS book_id SMALLINT;

UPDATE rep_rubric_remedies
   SET book_id = (SELECT id FROM rep_books WHERE code='complete')
 WHERE book_id IS NULL;

ALTER TABLE rep_rubric_remedies ALTER COLUMN book_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_remlist_pkey') THEN
    ALTER TABLE rep_rubric_remedies DROP CONSTRAINT rep_remlist_pkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='rep_rubric_remedies_pk'
  ) THEN
    ALTER TABLE rep_rubric_remedies
      ADD CONSTRAINT rep_rubric_remedies_pk
      PRIMARY KEY (book_id, rubric_ext_id, rem_code);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_rep_remlist_remedy;
CREATE INDEX IF NOT EXISTS idx_rep_rubric_remedies_remedy
  ON rep_rubric_remedies(rem_code);
CREATE INDEX IF NOT EXISTS idx_rep_rubric_remedies_book_rubric
  ON rep_rubric_remedies(book_id, rubric_ext_id);

-- 5. Add book_id to remaining join tables ---------------------------------
ALTER TABLE rep_papasub       ADD COLUMN IF NOT EXISTS book_id SMALLINT;
ALTER TABLE rep_page_refs     ADD COLUMN IF NOT EXISTS book_id SMALLINT;
ALTER TABLE rep_xrefs         ADD COLUMN IF NOT EXISTS book_id SMALLINT;
ALTER TABLE rep_polar_pairs   ADD COLUMN IF NOT EXISTS book_id SMALLINT;
ALTER TABLE rep_library_index ADD COLUMN IF NOT EXISTS book_id SMALLINT;

UPDATE rep_papasub       SET book_id=(SELECT id FROM rep_books WHERE code='complete') WHERE book_id IS NULL;
UPDATE rep_page_refs     SET book_id=(SELECT id FROM rep_books WHERE code='complete') WHERE book_id IS NULL;
UPDATE rep_xrefs         SET book_id=(SELECT id FROM rep_books WHERE code='complete') WHERE book_id IS NULL;
UPDATE rep_polar_pairs   SET book_id=(SELECT id FROM rep_books WHERE code='complete') WHERE book_id IS NULL;
UPDATE rep_library_index SET book_id=(SELECT id FROM rep_books WHERE code='complete') WHERE book_id IS NULL;

ALTER TABLE rep_papasub       ALTER COLUMN book_id SET NOT NULL;
ALTER TABLE rep_page_refs     ALTER COLUMN book_id SET NOT NULL;
ALTER TABLE rep_xrefs         ALTER COLUMN book_id SET NOT NULL;
ALTER TABLE rep_polar_pairs   ALTER COLUMN book_id SET NOT NULL;
ALTER TABLE rep_library_index ALTER COLUMN book_id SET NOT NULL;

-- Composite PK rebuilds
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_papasub_pkey') THEN
    ALTER TABLE rep_papasub DROP CONSTRAINT rep_papasub_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_papasub_pk') THEN
    ALTER TABLE rep_papasub ADD CONSTRAINT rep_papasub_pk
      PRIMARY KEY (book_id, rubric_ext_id, rem_code);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_page_refs_pkey') THEN
    ALTER TABLE rep_page_refs DROP CONSTRAINT rep_page_refs_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_page_refs_pk') THEN
    ALTER TABLE rep_page_refs ADD CONSTRAINT rep_page_refs_pk
      PRIMARY KEY (book_id, rubric_ext_id, book_code, page_number);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_polar_pairs_pkey') THEN
    ALTER TABLE rep_polar_pairs DROP CONSTRAINT rep_polar_pairs_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_polar_pairs_pk') THEN
    ALTER TABLE rep_polar_pairs ADD CONSTRAINT rep_polar_pairs_pk
      PRIMARY KEY (book_id, ext_id_1, ext_id_2);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_library_index_pkey') THEN
    ALTER TABLE rep_library_index DROP CONSTRAINT rep_library_index_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_library_index_pk') THEN
    ALTER TABLE rep_library_index ADD CONSTRAINT rep_library_index_pk
      PRIMARY KEY (book_id, rubric_ext_id, reference, author, year);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rep_papasub_book        ON rep_papasub(book_id);
CREATE INDEX IF NOT EXISTS idx_rep_page_refs_book      ON rep_page_refs(book_id);
CREATE INDEX IF NOT EXISTS idx_rep_xrefs_book          ON rep_xrefs(book_id);
CREATE INDEX IF NOT EXISTS idx_rep_polar_pairs_book    ON rep_polar_pairs(book_id);
CREATE INDEX IF NOT EXISTS idx_rep_library_index_book  ON rep_library_index(book_id);

-- 6. rep_file_versions: allow same hash under different books ------------
-- (Same TAB content under a different book code should be importable.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rep_file_versions_file_name_md5_hash_key') THEN
    ALTER TABLE rep_file_versions
      DROP CONSTRAINT rep_file_versions_file_name_md5_hash_key;
  END IF;
END $$;

ALTER TABLE rep_file_versions
  ADD COLUMN IF NOT EXISTS book_code TEXT NOT NULL DEFAULT 'complete';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='rep_file_versions_book_file_hash_key'
  ) THEN
    ALTER TABLE rep_file_versions
      ADD CONSTRAINT rep_file_versions_book_file_hash_key
      UNIQUE (book_code, file_name, md5_hash);
  END IF;
END $$;

-- 7. case_rep_rubrics → carry source book identity into analysis ---------
-- Adds book_id + rubric_id columns, backfills from rep_rubrics, swaps
-- the unique key from (case_id, rubric_ext_id) to (case_id, rubric_id),
-- and re-adds the FK against the surrogate rubric_id.
ALTER TABLE case_rep_rubrics ADD COLUMN IF NOT EXISTS book_id   SMALLINT;
ALTER TABLE case_rep_rubrics ADD COLUMN IF NOT EXISTS rubric_id BIGINT;

UPDATE case_rep_rubrics crr
   SET book_id   = r.book_id,
       rubric_id = r.rubric_id
  FROM rep_rubrics r
 WHERE r.ext_id = crr.rubric_ext_id
   AND r.book_id = (SELECT id FROM rep_books WHERE code='complete')
   AND (crr.rubric_id IS NULL OR crr.book_id IS NULL);

-- Rows that failed to backfill (ext_id no longer in Complete) are dropped:
-- they are unreachable in the new model and would block NOT NULL.
DELETE FROM case_rep_rubrics WHERE rubric_id IS NULL;

ALTER TABLE case_rep_rubrics ALTER COLUMN book_id   SET NOT NULL;
ALTER TABLE case_rep_rubrics ALTER COLUMN rubric_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='case_rep_rubrics_case_id_rubric_ext_id_key'
  ) THEN
    ALTER TABLE case_rep_rubrics DROP CONSTRAINT case_rep_rubrics_case_id_rubric_ext_id_key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='case_rep_rubrics_case_rubric_unique'
  ) THEN
    ALTER TABLE case_rep_rubrics
      ADD CONSTRAINT case_rep_rubrics_case_rubric_unique UNIQUE (case_id, rubric_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='case_rep_rubrics_rubric_id_fkey'
  ) THEN
    ALTER TABLE case_rep_rubrics
      ADD CONSTRAINT case_rep_rubrics_rubric_id_fkey
      FOREIGN KEY (rubric_id) REFERENCES rep_rubrics(rubric_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_case_rep_rubrics_book_rubric
  ON case_rep_rubrics(book_id, rubric_ext_id);
CREATE INDEX IF NOT EXISTS idx_case_rep_rubrics_rubric_id
  ON case_rep_rubrics(rubric_id);
