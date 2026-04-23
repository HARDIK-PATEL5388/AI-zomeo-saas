-- ============================================================
-- HOMEOPATHY REPERTORY SAAS - COMPLETE DATABASE SCHEMA
-- ============================================================

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector"; -- for AI embeddings (pgvector)

-- ============================================================
-- MULTI-TENANT: CLINICS
-- ============================================================
CREATE TABLE clinics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  address TEXT,
  subscription_plan TEXT DEFAULT 'trial' CHECK (subscription_plan IN ('trial', 'starter', 'professional', 'enterprise')),
  subscription_status TEXT DEFAULT 'active' CHECK (subscription_status IN ('active', 'suspended', 'cancelled')),
  subscription_expires_at TIMESTAMPTZ,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- USERS & AUTH
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('master_admin', 'admin', 'doctor', 'patient')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REPERTORY SOURCES & VERSIONS
-- ============================================================
CREATE TABLE repertory_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  publisher TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO repertory_sources (name, slug, publisher) VALUES
  ('Complete Repertory', 'complete', 'Roger van Zandvoort'),
  ('Jeremy Sherr Repertory', 'sherr', 'Jeremy Sherr'),
  ('Khullar Repertory', 'khullar', 'Dr. Khullar'),
  ('Murphy Clinical Repertory', 'murphy', 'Robin Murphy');

CREATE TABLE repertory_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID NOT NULL REFERENCES repertory_sources(id),
  version TEXT NOT NULL,
  year INTEGER NOT NULL,
  is_current BOOLEAN DEFAULT FALSE,
  release_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, version)
);

-- ============================================================
-- CHAPTERS
-- ============================================================
CREATE TABLE chapters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID NOT NULL REFERENCES repertory_sources(id),
  code TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(source_id, code)
);

INSERT INTO chapters (source_id, code, slug, name, sort_order)
SELECT 
  s.id,
  c.code, c.slug, c.name, c.sort_order
FROM repertory_sources s, (VALUES
  ('MIND', 'mind', 'Mind', 1),
  ('VERT', 'vertigo', 'Vertigo', 2),
  ('HEAD', 'head', 'Head', 3),
  ('EYES', 'eyes', 'Eyes', 4),
  ('EARS', 'ears', 'Ears', 5),
  ('NOSE', 'nose', 'Nose', 6),
  ('FACE', 'face', 'Face', 7),
  ('MOUTH', 'mouth', 'Mouth', 8),
  ('THROA', 'throat', 'Throat', 9),
  ('STOM', 'stomach', 'Stomach', 10),
  ('ABDOM', 'abdomen', 'Abdomen', 11),
  ('RECT', 'rectum', 'Rectum', 12),
  ('CHEST', 'chest', 'Chest', 13),
  ('HEART', 'heart', 'Heart & Circulation', 14),
  ('BACK', 'back', 'Back', 15),
  ('EXTR', 'extremities', 'Extremities', 16),
  ('SLEEP', 'sleep', 'Sleep', 17),
  ('SKIN', 'skin', 'Skin', 18),
  ('GEN', 'generalities', 'Generalities', 19),
  ('FEVER', 'fever', 'Fever', 20)
) AS c(code, slug, name, sort_order)
WHERE s.slug = 'complete';

-- ============================================================
-- RUBRICS (Hierarchical Tree)
-- ============================================================
CREATE TABLE rubrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID NOT NULL REFERENCES repertory_sources(id),
  version_id UUID REFERENCES repertory_versions(id),
  chapter_id UUID NOT NULL REFERENCES chapters(id),
  parent_id UUID REFERENCES rubrics(id),
  name TEXT NOT NULL,
  full_path TEXT NOT NULL,         -- e.g., "Mind > Fear > Death"
  level INTEGER NOT NULL DEFAULT 1, -- 1=chapter level, 2=rubric, 3=sub-rubric
  remedy_count INTEGER DEFAULT 0,   -- denormalized for perf
  search_vector TSVECTOR,
  embedding VECTOR(1536),           -- OpenAI embedding for semantic search
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search index (GIN)
CREATE INDEX idx_rubrics_search ON rubrics USING GIN(search_vector);
-- Trigram index for partial matching
CREATE INDEX idx_rubrics_name_trgm ON rubrics USING GIN(name gin_trgm_ops);
-- Tree traversal
CREATE INDEX idx_rubrics_parent ON rubrics(parent_id);
CREATE INDEX idx_rubrics_chapter ON rubrics(chapter_id);
CREATE INDEX idx_rubrics_source ON rubrics(source_id);
-- Embedding index for vector similarity
CREATE INDEX idx_rubrics_embedding ON rubrics USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

-- Trigger to auto-update search vector
CREATE OR REPLACE FUNCTION rubrics_search_vector_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.full_path, '') || ' ' || COALESCE(NEW.name, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rubrics_search_update
  BEFORE INSERT OR UPDATE ON rubrics
  FOR EACH ROW EXECUTE FUNCTION rubrics_search_vector_trigger();

-- ============================================================
-- REMEDIES
-- ============================================================
CREATE TABLE remedies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  abbreviation TEXT UNIQUE NOT NULL,
  latin_name TEXT,
  common_name TEXT,
  category TEXT,       -- plant, mineral, animal, nosode, etc.
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_remedies_abbr ON remedies(abbreviation);
CREATE INDEX idx_remedies_name ON remedies USING GIN(to_tsvector('english', name));

-- Insert common remedies
INSERT INTO remedies (name, abbreviation, latin_name, category) VALUES
  ('Aconitum Napellus', 'Acon', 'Aconitum napellus', 'plant'),
  ('Arsenicum Album', 'Ars', 'Arsenicum album', 'mineral'),
  ('Belladonna', 'Bell', 'Atropa belladonna', 'plant'),
  ('Bryonia Alba', 'Bry', 'Bryonia alba', 'plant'),
  ('Calcarea Carbonica', 'Calc', 'Calcarea carbonica', 'mineral'),
  ('Chamomilla', 'Cham', 'Matricaria chamomilla', 'plant'),
  ('Gelsemium', 'Gels', 'Gelsemium sempervirens', 'plant'),
  ('Ignatia Amara', 'Ign', 'Ignatia amara', 'plant'),
  ('Lachesis Mutus', 'Lach', 'Lachesis muta', 'animal'),
  ('Lycopodium Clavatum', 'Lyc', 'Lycopodium clavatum', 'plant'),
  ('Natrum Muriaticum', 'Nat-m', 'Natrum muriaticum', 'mineral'),
  ('Nux Vomica', 'Nux-v', 'Strychnos nux-vomica', 'plant'),
  ('Phosphorus', 'Phos', 'Phosphorus', 'mineral'),
  ('Pulsatilla Nigricans', 'Puls', 'Pulsatilla nigricans', 'plant'),
  ('Rhus Toxicodendron', 'Rhus-t', 'Toxicodendron radicans', 'plant'),
  ('Sepia Officinalis', 'Sep', 'Sepia officinalis', 'animal'),
  ('Silica', 'Sil', 'Silicea terra', 'mineral'),
  ('Spongia Tosta', 'Spong', 'Spongia officinalis', 'animal'),
  ('Sulphur', 'Sulph', 'Sulphur', 'mineral'),
  ('Thuja Occidentalis', 'Thuj', 'Thuja occidentalis', 'plant');

-- ============================================================
-- RUBRIC-REMEDY RELATIONSHIPS (Core Repertory Data)
-- ============================================================
CREATE TABLE rubric_remedies (
  rubric_id UUID NOT NULL REFERENCES rubrics(id) ON DELETE CASCADE,
  remedy_id UUID NOT NULL REFERENCES remedies(id) ON DELETE CASCADE,
  grade SMALLINT NOT NULL CHECK (grade BETWEEN 1 AND 4),
  -- 1=minor, 2=moderate, 3=strong, 4=keynote
  source_id UUID NOT NULL REFERENCES repertory_sources(id),
  version_id UUID REFERENCES repertory_versions(id),
  PRIMARY KEY (rubric_id, remedy_id, source_id)
);

-- Critical performance indexes for analysis engine
CREATE INDEX idx_rr_rubric ON rubric_remedies(rubric_id);
CREATE INDEX idx_rr_remedy ON rubric_remedies(remedy_id);
CREATE INDEX idx_rr_source ON rubric_remedies(source_id);
CREATE INDEX idx_rr_grade ON rubric_remedies(grade);
-- Composite for fast repertorization queries
CREATE INDEX idx_rr_rubric_remedy_grade ON rubric_remedies(rubric_id, remedy_id, grade);

-- ============================================================
-- PATIENTS
-- ============================================================
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),  -- if patient has a login
  patient_code TEXT,  -- clinic-assigned code
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  age INTEGER,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  phone TEXT,
  email TEXT,
  address TEXT,
  occupation TEXT,
  blood_group TEXT,
  allergies TEXT,
  chronic_conditions TEXT,
  emergency_contact JSONB,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patients_clinic ON patients(clinic_id);
CREATE INDEX idx_patients_name ON patients USING GIN(to_tsvector('english', first_name || ' ' || last_name));

-- ============================================================
-- CASES
-- ============================================================
CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES users(id),
  case_number TEXT,  -- auto-generated human-readable ID
  title TEXT,
  chief_complaint TEXT NOT NULL,
  history TEXT,
  examination_findings TEXT,
  mental_generals TEXT,
  physical_generals TEXT,
  particulars TEXT,
  modalities TEXT,  -- better/worse factors
  miasmatic_analysis TEXT,
  provisional_diagnosis TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
  ai_extracted_symptoms JSONB,  -- AI-extracted keywords
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cases_patient ON cases(patient_id);
CREATE INDEX idx_cases_doctor ON cases(doctor_id);
CREATE INDEX idx_cases_clinic ON cases(clinic_id);

-- ============================================================
-- CASE RUBRICS (Selected rubrics for repertorization)
-- ============================================================
CREATE TABLE case_rubrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  rubric_id UUID NOT NULL REFERENCES rubrics(id),
  source_id UUID NOT NULL REFERENCES repertory_sources(id),
  weight INTEGER DEFAULT 1 CHECK (weight BETWEEN 1 AND 4),
  -- 1=eliminating, 2=characteristic, 3=confirmatory, 4=common
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  added_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(case_id, rubric_id, source_id)
);

CREATE INDEX idx_case_rubrics_case ON case_rubrics(case_id);

-- ============================================================
-- ANALYSIS RESULTS
-- ============================================================
CREATE TABLE analysis_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  remedy_id UUID NOT NULL REFERENCES remedies(id),
  score NUMERIC(10, 2) NOT NULL,
  rank INTEGER NOT NULL,
  rubric_coverage INTEGER,      -- how many rubrics covered
  total_rubrics INTEGER,        -- total rubrics in analysis
  coverage_percent NUMERIC(5,2),
  grade_breakdown JSONB,        -- breakdown by grade
  rubric_details JSONB,         -- per-rubric contribution
  source_id UUID REFERENCES repertory_sources(id),
  analyzed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_results_case ON analysis_results(case_id);
CREATE INDEX idx_results_rank ON analysis_results(case_id, rank);

-- ============================================================
-- PRESCRIPTIONS
-- ============================================================
CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES users(id),
  remedy_id UUID NOT NULL REFERENCES remedies(id),
  potency TEXT NOT NULL,  -- e.g., "200C", "1M", "30C"
  dose TEXT,              -- e.g., "3 pills"
  frequency TEXT,         -- e.g., "twice daily"
  duration TEXT,          -- e.g., "7 days"
  instructions TEXT,
  rationale TEXT,
  diet_restrictions TEXT,
  lifestyle_advice TEXT,
  follow_up_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prescriptions_case ON prescriptions(case_id);
CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);

-- ============================================================
-- FOLLOW-UPS
-- ============================================================
CREATE TABLE followups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  prescription_id UUID REFERENCES prescriptions(id),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES users(id),
  followup_date DATE NOT NULL,
  overall_improvement INTEGER CHECK (overall_improvement BETWEEN 0 AND 10),
  -- 0=worse, 5=same, 10=completely cured
  symptom_changes TEXT,
  new_symptoms TEXT,
  mental_state TEXT,
  physical_state TEXT,
  doctor_notes TEXT,
  action_taken TEXT CHECK (action_taken IN ('continue', 'repeat', 'change_potency', 'change_remedy', 'intercurrent', 'wait')),
  next_followup_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_followups_case ON followups(case_id);
CREATE INDEX idx_followups_patient ON followups(patient_id);

-- ============================================================
-- AI SEARCH LOGS (for improving search quality)
-- ============================================================
CREATE TABLE ai_search_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  clinic_id UUID REFERENCES clinics(id),
  query TEXT NOT NULL,
  extracted_keywords JSONB,
  suggested_rubrics JSONB,
  selected_rubrics JSONB,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SUBSCRIPTIONS & BILLING
-- ============================================================
CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  price_monthly NUMERIC(10,2),
  price_yearly NUMERIC(10,2),
  max_doctors INTEGER,
  max_patients INTEGER,
  features JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE
);

INSERT INTO subscription_plans (name, slug, price_monthly, price_yearly, max_doctors, max_patients, features) VALUES
  ('Trial', 'trial', 0, 0, 1, 50, '{"ai_search": false, "multiple_repertories": false, "export": false}'),
  ('Starter', 'starter', 29, 290, 1, 500, '{"ai_search": true, "multiple_repertories": false, "export": true}'),
  ('Professional', 'professional', 79, 790, 5, 5000, '{"ai_search": true, "multiple_repertories": true, "export": true}'),
  ('Enterprise', 'enterprise', 199, 1990, -1, -1, '{"ai_search": true, "multiple_repertories": true, "export": true, "api_access": true}');

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES clinics(id),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_clinic ON audit_logs(clinic_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- ============================================================
-- ROW-LEVEL SECURITY (Multi-tenant isolation)
-- ============================================================
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;

-- Example RLS policy (clinic-scoped)
CREATE POLICY clinic_isolation_patients ON patients
  USING (clinic_id = current_setting('app.current_clinic_id')::UUID);

CREATE POLICY clinic_isolation_cases ON cases
  USING (clinic_id = current_setting('app.current_clinic_id')::UUID);

-- ============================================================
-- FUNCTIONS & STORED PROCEDURES
-- ============================================================

-- REPERTORIZATION ENGINE
CREATE OR REPLACE FUNCTION calculate_repertorization(p_case_id UUID, p_source_id UUID DEFAULT NULL)
RETURNS TABLE(remedy_id UUID, remedy_name TEXT, abbreviation TEXT, score NUMERIC, rank BIGINT, rubric_coverage INT, total_rubrics INT) AS $$
BEGIN
  RETURN QUERY
  WITH selected_rubrics AS (
    SELECT cr.rubric_id, cr.weight, cr.source_id
    FROM case_rubrics cr
    WHERE cr.case_id = p_case_id
      AND (p_source_id IS NULL OR cr.source_id = p_source_id)
  ),
  remedy_scores AS (
    SELECT 
      rr.remedy_id,
      SUM(sr.weight::NUMERIC * rr.grade::NUMERIC) AS total_score,
      COUNT(DISTINCT rr.rubric_id)::INT AS covered_rubrics,
      (SELECT COUNT(*)::INT FROM selected_rubrics) AS total_rubric_count
    FROM rubric_remedies rr
    INNER JOIN selected_rubrics sr ON rr.rubric_id = sr.rubric_id
      AND (p_source_id IS NULL OR rr.source_id = sr.source_id)
    GROUP BY rr.remedy_id
  )
  SELECT 
    rs.remedy_id,
    r.name,
    r.abbreviation,
    rs.total_score,
    ROW_NUMBER() OVER (ORDER BY rs.total_score DESC, rs.covered_rubrics DESC) AS rank,
    rs.covered_rubrics,
    rs.total_rubric_count
  FROM remedy_scores rs
  JOIN remedies r ON r.id = rs.remedy_id
  ORDER BY rs.total_score DESC, rs.covered_rubrics DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql;

-- AI RUBRIC SEARCH (Full-text + similarity)
CREATE OR REPLACE FUNCTION search_rubrics(
  p_query TEXT,
  p_source_id UUID DEFAULT NULL,
  p_chapter_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE(
  rubric_id UUID, rubric_name TEXT, full_path TEXT,
  chapter_name TEXT, remedy_count INT, rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.name,
    r.full_path,
    c.name AS chapter_name,
    r.remedy_count,
    ts_rank(r.search_vector, plainto_tsquery('english', p_query)) AS rank
  FROM rubrics r
  JOIN chapters c ON c.id = r.chapter_id
  WHERE r.search_vector @@ plainto_tsquery('english', p_query)
    AND (p_source_id IS NULL OR r.source_id = p_source_id)
    AND (p_chapter_id IS NULL OR r.chapter_id = p_chapter_id)
  ORDER BY rank DESC, r.remedy_count DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_clinics BEFORE UPDATE ON clinics FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_patients BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_cases BEFORE UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_prescriptions BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
