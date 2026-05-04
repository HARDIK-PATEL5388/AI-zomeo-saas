-- ============================================================
-- 010: Per-book parser_type
--
-- Each rep_books row records which parser handles its source files.
-- The upload pipeline reads parser_type to dispatch validation /
-- preview / import to the correct RepertoryParser implementation.
--
-- Default 'complete_tab' covers every existing book (Complete and any
-- earlier seeded entries shipped Complete-style .tab files).
-- ============================================================

ALTER TABLE rep_books
  ADD COLUMN IF NOT EXISTS parser_type TEXT NOT NULL DEFAULT 'complete_tab';

-- Backfill: any pre-existing row without parser_type explicitly set still
-- gets 'complete_tab'. NULL/'' both treated as unset for forward safety.
UPDATE rep_books
   SET parser_type = 'complete_tab'
 WHERE parser_type IS NULL OR parser_type = '';

CREATE INDEX IF NOT EXISTS idx_rep_books_parser_type ON rep_books(parser_type);
