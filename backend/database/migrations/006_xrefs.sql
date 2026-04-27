-- Cross-references between rubrics (Xrefs.tab — 5 cols)
-- Format: xref_id \t pair_id \t rubric_ext_1 \t rubric_ext_2 \t rel_type
CREATE TABLE IF NOT EXISTS rep_xrefs (
  xref_id          INTEGER PRIMARY KEY,
  pair_id          INTEGER,
  rubric_ext_id_1  INTEGER NOT NULL,
  rubric_ext_id_2  INTEGER NOT NULL,
  rel_type         SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rep_xrefs_r1 ON rep_xrefs(rubric_ext_id_1);
CREATE INDEX IF NOT EXISTS idx_rep_xrefs_r2 ON rep_xrefs(rubric_ext_id_2);
