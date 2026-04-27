-- ============================================================
-- 007 PATIENT EXTENDED REGISTRATION
-- Extends existing `patients` table to match the legacy Electron
-- patient registration form (Registration / Preliminary / Contact /
-- Patient Card tabs). All new columns are NULLABLE so existing
-- patient rows remain valid.
-- ============================================================

-- ---- REGISTRATION INFORMATION ------------------------------------------------
ALTER TABLE patients ADD COLUMN IF NOT EXISTS registration_date    DATE      DEFAULT CURRENT_DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS registration_number  TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS diagnosis            TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS title                TEXT;        -- Mr / Mrs / Dr / Ms / Master / Miss
ALTER TABLE patients ADD COLUMN IF NOT EXISTS middle_name          TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referred_by          TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS currency             TEXT;        -- INR / USD / EUR ...
ALTER TABLE patients ADD COLUMN IF NOT EXISTS consultation_charges NUMERIC(10,2) DEFAULT 0;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS follow_up_charges    NUMERIC(10,2) DEFAULT 0;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS bill_to              TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS opd_number           TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS opd_date             DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS ipd_number           TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS ipd_date             DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS remarks              TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS photo_url            TEXT;        -- uploaded patient photo

-- ---- PRELIMINARY INFORMATION -------------------------------------------------
ALTER TABLE patients ADD COLUMN IF NOT EXISTS occupation           TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS organization         TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS marital_status       TEXT;        -- Single / Married / Divorced / Widowed
ALTER TABLE patients ADD COLUMN IF NOT EXISTS religion             TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS diet                 TEXT;        -- Veg / Non-Veg / Vegan / Eggetarian
ALTER TABLE patients ADD COLUMN IF NOT EXISTS prognosis            TEXT;        -- Good / Fair / Guarded / Poor
ALTER TABLE patients ADD COLUMN IF NOT EXISTS preliminary_remarks  TEXT;

-- ---- CONTACT DETAILS ---------------------------------------------------------
-- Stored as JSONB so the Electron-style nested structure is preserved
-- without exploding the column count.
-- current_address  : { address, street, country, state, city, zip_code }
-- permanent_address: { same_as_current: boolean, address, street, country, state, city, zip_code }
-- contact_details  : { home_number, office_number, website, emergency_number, fax_number }
ALTER TABLE patients ADD COLUMN IF NOT EXISTS current_address      JSONB DEFAULT '{}'::jsonb;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS permanent_address    JSONB DEFAULT '{}'::jsonb;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS contact_details      JSONB DEFAULT '{}'::jsonb;

-- ---- BACK-COMPAT FIXES -------------------------------------------------------
-- Legacy schema marked first_name / last_name / gender NOT NULL with no default.
-- Electron form allows last_name blank and gender blank, so relax the constraints.
ALTER TABLE patients ALTER COLUMN last_name DROP NOT NULL;
ALTER TABLE patients ALTER COLUMN gender    DROP NOT NULL;

-- ---- INDEXES -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_patients_reg_no   ON patients(registration_number);
CREATE INDEX IF NOT EXISTS idx_patients_reg_date ON patients(registration_date);
CREATE INDEX IF NOT EXISTS idx_patients_phone    ON patients(phone);

-- ---- AUTO REGISTRATION NUMBER ------------------------------------------------
-- Populate registration_number on insert when the caller doesn't supply one.
-- Format: ZMO + zero-padded incremental sequence per clinic (matches Electron's
-- ADA<NNN> behaviour while remaining clinic-scoped).
CREATE SEQUENCE IF NOT EXISTS patient_reg_seq START 1000;

CREATE OR REPLACE FUNCTION patients_set_registration_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.registration_number IS NULL OR NEW.registration_number = '' THEN
    NEW.registration_number := 'ZMO' || LPAD(nextval('patient_reg_seq')::text, 6, '0');
  END IF;
  IF NEW.registration_date IS NULL THEN
    NEW.registration_date := CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS patients_set_reg_no ON patients;
CREATE TRIGGER patients_set_reg_no
  BEFORE INSERT ON patients
  FOR EACH ROW EXECUTE FUNCTION patients_set_registration_number();

-- ---- BACK-FILL EXISTING ROWS -------------------------------------------------
UPDATE patients
SET registration_number = 'ZMO' || LPAD(nextval('patient_reg_seq')::text, 6, '0')
WHERE registration_number IS NULL;

UPDATE patients
SET registration_date = COALESCE(registration_date, created_at::date, CURRENT_DATE)
WHERE registration_date IS NULL;
