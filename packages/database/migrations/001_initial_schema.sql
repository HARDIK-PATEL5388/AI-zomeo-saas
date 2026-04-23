-- ============================================================
-- Zomeo.ai — Complete Database Schema
-- Supabase PostgreSQL 15 + pgvector + RLS
-- Hompath Technologies Pvt. Ltd. — Confidential
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- TENANT & USER TABLES
-- ============================================================

CREATE TABLE tenants (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  plan              TEXT NOT NULL DEFAULT 'starter'
                      CHECK (plan IN ('starter','professional','clinic','institution','researcher')),
  stripe_customer_id TEXT UNIQUE,
  grace_until       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id         UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'doctor'
               CHECK (role IN ('doctor','admin','partner','student')),
  email      TEXT NOT NULL UNIQUE,
  profile_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- REPERTORY CONTENT TABLES (must be before tenant_licences FK)
-- ============================================================

CREATE TABLE repertories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL UNIQUE,
  author          TEXT,
  category        TEXT CHECK (category IN ('repertory','materia_medica','specialty','therapeutic')),
  live_version_id UUID,  -- FK added after content_versions
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE content_versions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repertory_id  UUID NOT NULL REFERENCES repertories(id),
  year          INTEGER NOT NULL,
  version_tag   TEXT NOT NULL,
  is_live       BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived   BOOLEAN NOT NULL DEFAULT FALSE,
  rubric_count  INTEGER,
  promoted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK now that content_versions exists
ALTER TABLE repertories
  ADD CONSTRAINT fk_repertories_live_version
  FOREIGN KEY (live_version_id) REFERENCES content_versions(id);

CREATE TABLE chapters (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repertory_id      UUID NOT NULL REFERENCES repertories(id),
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  parent_chapter_id UUID REFERENCES chapters(id)
);

-- ============================================================
-- TENANT LICENCES (references repertories)
-- ============================================================

CREATE TABLE tenant_licences (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repertory_id          UUID REFERENCES repertories(id),
  plan                  TEXT NOT NULL,
  valid_from            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to              TIMESTAMPTZ,
  stripe_subscription_id TEXT,
  active                BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================================
-- REMEDIES (referenced by rubric_remedies + prescriptions)
-- ============================================================

CREATE TABLE remedies (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code              TEXT NOT NULL UNIQUE,
  full_name         TEXT NOT NULL,
  family            TEXT,
  kingdom           TEXT CHECK (kingdom IN ('Plant','Animal','Mineral','Nosode','Imponderabilia')),
  miasm             TEXT CHECK (miasm IN ('Psora','Sycosis','Syphilis','Tubercular','Cancer')),
  profile_embedding VECTOR(1536),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RUBRICS (large table — 200K+ rows per repertory)
-- ============================================================

CREATE TABLE rubrics (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chapter_id    UUID NOT NULL REFERENCES chapters(id),
  repertory_id  UUID NOT NULL REFERENCES repertories(id),
  version_id    UUID REFERENCES content_versions(id),
  symptom_text  TEXT NOT NULL,
  level         SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 4),
  parent_id     UUID REFERENCES rubrics(id),
  fts_vector    TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', symptom_text)) STORED,
  embedding     VECTOR(1536),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rubric_remedies (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rubric_id  UUID NOT NULL REFERENCES rubrics(id) ON DELETE CASCADE,
  remedy_id  UUID NOT NULL REFERENCES remedies(id),
  grade      SMALLINT NOT NULL CHECK (grade BETWEEN 1 AND 3),
  UNIQUE(rubric_id, remedy_id)
);

CREATE TABLE cross_references (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rubric_id       UUID NOT NULL REFERENCES rubrics(id),
  target_rubric_id UUID NOT NULL REFERENCES rubrics(id),
  ref_type        TEXT NOT NULL CHECK (ref_type IN ('see','compare','related'))
);

CREATE TABLE remedy_keynotes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  remedy_id      UUID NOT NULL REFERENCES remedies(id),
  content_text   TEXT NOT NULL,
  source_book_id UUID,  -- FK to books added below
  embedding      VECTOR(1536),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PATIENT & CLINICAL TABLES
-- ============================================================

CREATE TABLE patients (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,
  dob               DATE,
  gender            TEXT CHECK (gender IN ('male','female','other')),
  contact_json      JSONB DEFAULT '{}',
  demographic_json  JSONB DEFAULT '{}',
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cases (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  case_json  JSONB NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','archived')),
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE consultations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  consultation_date   TIMESTAMPTZ NOT NULL,
  prescription_json   JSONB DEFAULT '{}',
  rubrics_json        JSONB DEFAULT '[]',
  symptom_embedding   VECTOR(1536),  -- anonymised for AI research
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE prescriptions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consultation_id  UUID NOT NULL REFERENCES consultations(id),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  remedy_id        UUID NOT NULL REFERENCES remedies(id),
  potency          TEXT NOT NULL,
  dose             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE appointments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  datetime   TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled','completed','cancelled','no-show')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  patient_id       UUID REFERENCES patients(id),
  amount           NUMERIC(10,2) NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'INR',
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','sent','paid','overdue')),
  stripe_invoice_id TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BOOKS & REFERENCE TABLES
-- ============================================================

CREATE TABLE books (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL,
  author          TEXT,
  year            INTEGER,
  category        TEXT CHECK (category IN ('materia_medica','clinical','philosophy','specialty')),
  live_version_id UUID,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE book_passages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id      UUID NOT NULL REFERENCES books(id),
  heading      TEXT NOT NULL,
  subheading   TEXT,
  content_text TEXT NOT NULL,
  fts_vector   TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content_text)) STORED,
  embedding    VECTOR(1536),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add source_book_id FK to remedy_keynotes
ALTER TABLE remedy_keynotes
  ADD CONSTRAINT fk_keynotes_source_book
  FOREIGN KEY (source_book_id) REFERENCES books(id);

-- ============================================================
-- UPLOAD & INGESTION TRACKING
-- ============================================================

CREATE TABLE upload_jobs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repertory_id  UUID REFERENCES repertories(id),
  year          INTEGER NOT NULL,
  version_tag   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','validating','approved','rejected','ingesting','live','failed')),
  admin_id      UUID NOT NULL REFERENCES users(id),
  files_json    JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE validation_reports (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id      UUID NOT NULL REFERENCES upload_jobs(id),
  stage       SMALLINT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('error','warning','info')),
  code        TEXT NOT NULL,   -- V001 through V010
  message     TEXT NOT NULL,
  line_no     INTEGER,
  remedy_code TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ingestion_stages (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id             UUID NOT NULL REFERENCES upload_jobs(id),
  stage_name         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','running','completed','failed')),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  records_processed  INTEGER DEFAULT 0,
  error_json         JSONB
);

CREATE TABLE diff_reports (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repertory_id   UUID NOT NULL REFERENCES repertories(id),
  v_old_id       UUID REFERENCES content_versions(id),
  v_new_id       UUID NOT NULL REFERENCES content_versions(id),
  added_count    INTEGER DEFAULT 0,
  modified_count INTEGER DEFAULT 0,
  removed_count  INTEGER DEFAULT 0,
  diff_json      JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Full-text search
CREATE INDEX rubrics_fts_idx ON rubrics USING GIN (fts_vector);
CREATE INDEX book_passages_fts_idx ON book_passages USING GIN (fts_vector);

-- Trigram partial matching
CREATE INDEX rubrics_trgm_idx ON rubrics USING GIN (symptom_text gin_trgm_ops);

-- pgvector semantic search (ivfflat — best for large datasets)
CREATE INDEX rubrics_embedding_idx ON rubrics
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 200);
CREATE INDEX keynotes_embedding_idx ON remedy_keynotes
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX passages_embedding_idx ON book_passages
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX remedies_profile_idx ON remedies
  USING ivfflat (profile_embedding vector_cosine_ops) WITH (lists = 20);

-- Composite performance indexes
CREATE INDEX rubric_remedies_idx ON rubric_remedies (rubric_id, remedy_id, grade);
CREATE INDEX rubrics_repertory_idx ON rubrics (repertory_id, level, parent_id);
CREATE INDEX cases_patient_idx ON cases (patient_id, tenant_id, status);
CREATE INDEX patients_tenant_idx ON patients (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX appointments_tenant_dt_idx ON appointments (tenant_id, datetime);
CREATE INDEX consultations_case_idx ON consultations (case_id, tenant_id);
CREATE INDEX prescriptions_consult_idx ON prescriptions (consultation_id, remedy_id);
CREATE INDEX licences_tenant_idx ON tenant_licences (tenant_id, active);

-- ============================================================
-- HYBRID SEARCH FUNCTION (FTS + pgvector + Reciprocal Rank Fusion)
-- ============================================================

CREATE OR REPLACE FUNCTION search_rubrics(
  p_query_text      TEXT,
  p_query_embedding VECTOR(1536),
  p_rep_ids         UUID[],
  p_match_count     INT DEFAULT 15
) RETURNS TABLE (
  rubric_id      UUID,
  rubric_text    TEXT,
  repertory_name TEXT,
  chapter_name   TEXT,
  score          FLOAT
) LANGUAGE sql STABLE AS $$
  WITH fts AS (
    SELECT id,
           ts_rank(fts_vector, to_tsquery('english', p_query_text)) AS r,
           ROW_NUMBER() OVER (ORDER BY ts_rank(fts_vector, to_tsquery('english', p_query_text)) DESC) AS rn
    FROM rubrics
    WHERE fts_vector @@ to_tsquery('english', p_query_text)
      AND repertory_id = ANY(p_rep_ids)
    LIMIT 50
  ),
  vec AS (
    SELECT id,
           1 - (embedding <=> p_query_embedding) AS r,
           ROW_NUMBER() OVER (ORDER BY embedding <=> p_query_embedding) AS rn
    FROM rubrics
    WHERE repertory_id = ANY(p_rep_ids)
      AND embedding IS NOT NULL
    ORDER BY embedding <=> p_query_embedding
    LIMIT 50
  ),
  rrf AS (
    SELECT COALESCE(fts.id, vec.id) AS id,
           (1.0 / (60 + COALESCE(fts.rn, 1000))) + (1.0 / (60 + COALESCE(vec.rn, 1000))) AS score
    FROM fts FULL OUTER JOIN vec ON fts.id = vec.id
  )
  SELECT r.id, ru.symptom_text, rep.name, ch.name, r.score
  FROM rrf r
  JOIN rubrics ru ON r.id = ru.id
  JOIN chapters ch ON ru.chapter_id = ch.id
  JOIN repertories rep ON ru.repertory_id = rep.id
  ORDER BY r.score DESC
  LIMIT p_match_count;
$$;

-- Book passage semantic search
CREATE OR REPLACE FUNCTION search_book_passages(
  query_embedding VECTOR(1536),
  match_count     INT DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.6
) RETURNS TABLE (
  id           UUID,
  heading      TEXT,
  content_text TEXT,
  similarity   FLOAT,
  books        JSONB
) LANGUAGE sql STABLE AS $$
  SELECT
    bp.id,
    bp.heading,
    bp.content_text,
    1 - (bp.embedding <=> query_embedding) AS similarity,
    jsonb_build_object('title', b.title, 'author', b.author) AS books
  FROM book_passages bp
  JOIN books b ON bp.book_id = b.id
  WHERE bp.embedding IS NOT NULL
    AND b.is_active = TRUE
    AND 1 - (bp.embedding <=> query_embedding) > match_threshold
  ORDER BY bp.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE patients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases             ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_licences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubrics           ENABLE ROW LEVEL SECURITY;
ALTER TABLE books             ENABLE ROW LEVEL SECURITY;

-- Patients: tenant isolation
CREATE POLICY patients_tenant ON patients
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

-- Cases: tenant isolation
CREATE POLICY cases_tenant ON cases
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Consultations: tenant isolation
CREATE POLICY consultations_tenant ON consultations
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

-- Prescriptions: tenant isolation
CREATE POLICY prescriptions_tenant ON prescriptions
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

-- Appointments: tenant isolation
CREATE POLICY appointments_tenant ON appointments
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

-- Invoices: tenant isolation
CREATE POLICY invoices_tenant ON invoices
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

-- Rubrics: only licensed repertories readable
CREATE POLICY rubrics_licence_gate ON rubrics FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR EXISTS (
      SELECT 1 FROM tenant_licences tl
      WHERE tl.tenant_id::text = auth.jwt() ->> 'tenant_id'
        AND tl.repertory_id = rubrics.repertory_id
        AND tl.active = TRUE
        AND (tl.valid_to IS NULL OR tl.valid_to > NOW())
    )
  );

-- Books: only licensed books readable
CREATE POLICY books_licence_gate ON books FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR is_active = TRUE
  );

-- Upload jobs: admin only
CREATE POLICY upload_jobs_admin ON upload_jobs
  USING (auth.jwt() ->> 'role' = 'admin');

-- Remedies: all authenticated users can read
CREATE POLICY remedies_authenticated ON remedies FOR SELECT
  USING (auth.role() = 'authenticated');

-- Tenant licences: own licences only
CREATE POLICY licences_tenant ON tenant_licences FOR SELECT
  USING (tenant_id::text = auth.jwt() ->> 'tenant_id');

-- ============================================================
-- SEED DATA — 26 Repertories
-- ============================================================

INSERT INTO repertories (name, author, category, is_active) VALUES
  ('Ajit',      'Dr. Ajit Kulkarni',      'repertory',      false),
  ('Allen',     'H. C. Allen',             'repertory',      false),
  ('Boenning',  'Boenninghausen',          'repertory',      false),
  ('Boericke',  'William Boericke',        'repertory',      false),
  ('Boger',     'C. M. Boger',             'repertory',      false),
  ('Clarke',    'John Henry Clarke',       'materia_medica', false),
  ('Complete',  'Roger van Zandvoort',     'repertory',      false),
  ('COVID-19',  'Hompath Research Team',   'specialty',      false),
  ('Fever',     'Multiple Authors',        'specialty',      false),
  ('Gentry',    'W. D. Gentry',            'repertory',      false),
  ('Jeremy',    'Jeremy Sherr',            'repertory',      false),
  ('Kent',      'James Tyler Kent',        'repertory',      false),
  ('Khullar',   'Dr. S. P. Khullar',      'repertory',      false),
  ('Knerr',     'Calvin B. Knerr',        'repertory',      false),
  ('Lippe',     'Adolph von Lippe',       'repertory',      false),
  ('Miasms',    'Multiple Authors',       'specialty',      false),
  ('Murphy',    'Robin Murphy',           'repertory',      false),
  ('Perfect',   'Internal Hompath',       'specialty',      false),
  ('Phatak',    'S. R. Phatak',           'repertory',      false),
  ('Roberts',   'Herbert A. Roberts',     'materia_medica', false),
  ('Scholten',  'Jan Scholten',           'specialty',      false),
  ('Special',   'Multiple Authors',       'specialty',      false),
  ('Surjit',    'Dr. Surjit Singh',       'repertory',      false),
  ('Therap',    'Multiple Authors',       'therapeutic',    false),
  ('Wards',     'Multiple Authors',       'specialty',      false),
  ('Sankaran',  'Sankaran / Multiple',    'specialty',      false);
