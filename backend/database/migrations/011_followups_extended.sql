-- ============================================================
-- 011: Extend followups for the Generate-Prescription workflow
--
-- Adds prescription + clinical fields the doctor captures right after
-- repertorization, on top of the original follow-up tracking columns.
-- Old columns are preserved and back-filled into the new columns so
-- existing rows continue to read correctly through either name.
-- ============================================================

ALTER TABLE followups
  ADD COLUMN IF NOT EXISTS analysis_id        UUID,
  ADD COLUMN IF NOT EXISTS visit_date         DATE,
  ADD COLUMN IF NOT EXISTS complaints         TEXT,
  ADD COLUMN IF NOT EXISTS remedy_name        TEXT,
  ADD COLUMN IF NOT EXISTS remedy_code        INTEGER,
  ADD COLUMN IF NOT EXISTS potency            TEXT,
  ADD COLUMN IF NOT EXISTS dosage             TEXT,
  ADD COLUMN IF NOT EXISTS repetition         TEXT,
  ADD COLUMN IF NOT EXISTS days               TEXT,
  ADD COLUMN IF NOT EXISTS prescription_type  TEXT,
  ADD COLUMN IF NOT EXISTS remedy_response    TEXT,
  ADD COLUMN IF NOT EXISTS diagnosis          TEXT,
  ADD COLUMN IF NOT EXISTS preferences        TEXT,
  ADD COLUMN IF NOT EXISTS investigations     TEXT,
  ADD COLUMN IF NOT EXISTS examination        TEXT,
  ADD COLUMN IF NOT EXISTS improvement_score  INTEGER,
  ADD COLUMN IF NOT EXISTS next_visit_date    DATE,
  ADD COLUMN IF NOT EXISTS notes              TEXT,
  ADD COLUMN IF NOT EXISTS created_by         UUID,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();

-- Back-fill new columns from existing data so legacy rows stay readable
UPDATE followups
   SET visit_date        = COALESCE(visit_date,        followup_date),
       improvement_score = COALESCE(improvement_score, overall_improvement),
       notes             = COALESCE(notes,             doctor_notes),
       next_visit_date   = COALESCE(next_visit_date,   next_followup_date),
       created_by        = COALESCE(created_by,        doctor_id),
       updated_at        = COALESCE(updated_at,        created_at);

-- followup_date was NOT NULL in 001; relax it so rows created via the new
-- flow can omit the legacy column when callers only set visit_date.
ALTER TABLE followups
  ALTER COLUMN followup_date DROP NOT NULL;

-- The 001 schema constrained action_taken to a fixed enum. The spec needs a
-- broader vocabulary (continue / repeat / change_potency / wait / etc.) and
-- the prescription_type field also needs flexibility, so loosen the check.
ALTER TABLE followups
  DROP CONSTRAINT IF EXISTS followups_action_taken_check;

CREATE INDEX IF NOT EXISTS idx_followups_visit_date
  ON followups(visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_followups_remedy_code
  ON followups(remedy_code);
CREATE INDEX IF NOT EXISTS idx_followups_created_by
  ON followups(created_by);
CREATE INDEX IF NOT EXISTS idx_followups_clinic_visit
  ON followups(clinic_id, visit_date DESC);

-- Optional media attachments per follow-up (photos / lab reports / etc.)
CREATE TABLE IF NOT EXISTS followup_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  followup_id UUID NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_type TEXT,
  caption TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_followup_media_followup
  ON followup_media(followup_id);

-- Auto-touch updated_at on UPDATE so the API doesn't have to maintain it
CREATE OR REPLACE FUNCTION followups_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_followups_touch ON followups;
CREATE TRIGGER trg_followups_touch
  BEFORE UPDATE ON followups
  FOR EACH ROW EXECUTE FUNCTION followups_touch_updated_at();
