# Zomeo.ai — AI-Powered Homeopathy SaaS Platform

> Complete cloud-native SaaS rewrite of Zomeo Homeopathy Desktop Software.
> Browser-based · Multi-tenant · 26 Repertories · GPT-4o RAG · No USB Dongle.

**Hompath Technologies Pvt. Ltd. — Confidential — v2.0 — 2025**

---

## Overview

Zomeo.ai is the cloud-native SaaS rewrite of the original Zomeo Homeopathy Desktop Software (C++ / Electron). It moves the entire platform to the browser — always up-to-date, no installation, no hardware dependency, no USB dongle — with AI-powered prescription assistance, semantic search across 26 named repertories, and a modern Admin Portal for partner-supplied repertory data.

### Legacy vs SaaS Comparison

| Dimension | Legacy Zomeo Desktop | Zomeo.ai SaaS |
|-----------|---------------------|---------------|
| Architecture | C++ + Electron desktop app | Next.js 14 + Hono.js cloud SaaS |
| Database | SQLite / MS Access / SQL Server | Supabase PostgreSQL 15 |
| Search Engine | Custom C++ inverted index (.idx/.cdx) | pgvector + PostgreSQL FTS (tsvector) |
| AI | None | GPT-4o RAG pipeline |
| Data Security | Bit-shift encryption + HASP USB lock | AES-256-GCM + RLS + TLS 1.3 |
| Copy Protection | USB hardware key + Product Key | JWT + Subscription licence (USB REMOVED) |
| Platforms | Windows, Mac, iOS, Android separately | Any browser — single responsive PWA |
| Updates | Electron auto-updater via AWS S3 | Vercel CI/CD — zero downtime deploys |
| Billing | One-time lifetime licence | Monthly / Annual SaaS subscription |
| Partner Data | Manual file delivery + installer | Admin upload portal + ingestion pipeline |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZOMEO.AI — SYSTEM LAYERS                     │
├─────────────────────────────────────────────────────────────────┤
│  USERS: Physicians | Students | Researchers | Admins | Partners │
│  Browser (Chrome/Safari/Firefox) + Mobile PWA + Tablet          │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 1 — FRONTEND                                             │
│  Next.js 14 App Router + React Server Components                │
│  TailwindCSS + ShadCN UI + Zustand + TanStack Query             │
│  Hosted on: Vercel Edge Network (Global CDN)                    │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2 — BACKEND API                                          │
│  Node.js 20 LTS + Hono.js v4 + TypeScript 5                    │
│  REST + SSE API | JWT Auth | Rate Limiting | Zod Validation     │
│  BullMQ + Upstash Redis (background jobs)                       │
│  Hosted on: Railway.app (Docker, auto-scale)                    │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3 — DATA                                                 │
│  Supabase: PostgreSQL 15 + pgvector + RLS + Auth + Storage      │
│  Supabase Realtime (WebSocket for live appointments/sync)       │
│  Redis (Upstash) — Query cache + BullMQ queues                  │
├─────────────────────────────────────────────────────────────────┤
│  EXTERNAL SERVICES                                              │
│  OpenAI GPT-4o | Stripe | CCAvenue | Twilio | Resend            │
│  Sentry | PostHog | Cloudflare R2                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Monorepo Structure (Turborepo)

```
zomeo-ai/
├── apps/
│   ├── web/                          # Next.js 14 frontend
│   │   ├── app/
│   │   │   ├── (auth)/               # login, register, onboarding
│   │   │   ├── (app)/                # protected doctor pages
│   │   │   │   ├── dashboard/        # Daily schedule, recent cases, AI summary
│   │   │   │   ├── patients/         # Patient list, search, demographics
│   │   │   │   ├── patients/[id]/    # Patient profile, case history
│   │   │   │   ├── repertory/        # Hybrid search across all 26 repertories
│   │   │   │   ├── repertory/repertorize/  # Repertorization chart builder
│   │   │   │   ├── remedies/         # Remedy detail and comparison
│   │   │   │   ├── books/            # Reference books library
│   │   │   │   ├── ai-assistant/     # Conversational AI prescription assistant
│   │   │   │   ├── appointments/     # Calendar scheduler
│   │   │   │   ├── reports/          # Revenue and diagnosis reports
│   │   │   │   └── settings/         # Profile, subscription, integrations
│   │   │   ├── admin/                # Super-admin dashboard
│   │   │   │   ├── repertory/upload/ # 6-step upload wizard
│   │   │   │   ├── repertory/jobs/   # Live ingestion job status (SSE)
│   │   │   │   ├── repertory/versions/ # Version history + diff viewer
│   │   │   │   ├── remedies/         # Remedy master management
│   │   │   │   └── licences/         # Plan-to-content licence assignment
│   │   │   └── partner-portal/       # Partner login + file repository
│   │   ├── components/
│   │   │   ├── ui/                   # ShadCN UI components
│   │   │   ├── repertory/            # RepertorySearch, RepertoryChart, RubricPicker
│   │   │   ├── cases/                # CaseTakingForm
│   │   │   ├── ai/                   # AIAssistant (streaming SSE)
│   │   │   ├── patients/             # PatientCard
│   │   │   ├── appointments/         # AppointmentCalendar
│   │   │   ├── reports/              # RevenueChart (Recharts)
│   │   │   └── admin/                # UploadWizard, ValidationReport, JobStatusBoard
│   │   ├── hooks/                    # React Query hooks
│   │   └── stores/                   # Zustand global state stores
│   │
│   └── api/                          # Node.js + Hono.js backend
│       ├── src/
│       │   ├── routes/               # Hono route definitions
│       │   │   ├── auth.ts           # /auth/* — login, register, refresh, logout
│       │   │   ├── patients.ts       # /patients/* — CRUD + case history
│       │   │   ├── cases.ts          # /cases/* — case taking, consultations
│       │   │   ├── repertory.ts      # /repertory/* — search, chapters, rubrics
│       │   │   ├── remedies.ts       # /remedies/* — detail, compare
│       │   │   ├── books.ts          # /books/* — library, RAG search
│       │   │   ├── ai.ts             # /ai/* — prescribe, suggest-rubrics, compare
│       │   │   ├── appointments.ts   # /appointments/* — scheduler
│       │   │   ├── reports.ts        # /reports/* — revenue, diagnosis
│       │   │   ├── billing.ts        # /billing/* — Stripe + CCAvenue
│       │   │   ├── admin.ts          # /admin/* — stats, upload, ingest
│       │   │   └── notify.ts         # /notify/* — SMS, email, push
│       │   ├── services/             # Business logic per domain
│       │   │   ├── auth.ts
│       │   │   ├── patient.ts
│       │   │   ├── case.ts
│       │   │   ├── repertory.ts
│       │   │   ├── repertorize.ts    # Core repertorization engine
│       │   │   ├── books.ts
│       │   │   ├── ai.ts             # RAG pipeline + GPT-4o
│       │   │   ├── appointment.ts
│       │   │   ├── reports.ts
│       │   │   ├── billing.ts
│       │   │   ├── upload.ts
│       │   │   ├── ingest.ts
│       │   │   ├── notify.ts
│       │   │   └── remedy.ts
│       │   ├── middleware/
│       │   │   ├── auth.ts           # JWT verification (Supabase keys)
│       │   │   ├── tenant.ts         # Tenant context resolver
│       │   │   ├── subGuard.ts       # Subscription plan entitlement check
│       │   │   └── rateLimiter.ts    # Per-IP + per-tenant rate limiting
│       │   ├── workers/              # BullMQ job worker definitions
│       │   │   ├── validationWorker.ts
│       │   │   ├── ingestionWorker.ts
│       │   │   ├── embeddingWorker.ts
│       │   │   ├── notificationWorker.ts
│       │   │   ├── emailWorker.ts
│       │   │   ├── smsWorker.ts
│       │   │   └── reportWorker.ts
│       │   ├── jobs/                 # Validation + ingestion pipeline stages
│       │   │   ├── validation/       # 9-stage validation pipeline
│       │   │   │   ├── stage1-fileFormat.ts
│       │   │   │   ├── stage2-structureParser.ts
│       │   │   │   ├── stage3-headerCheck.ts
│       │   │   │   ├── stage4-chapterValidation.ts
│       │   │   │   ├── stage5-rubricStructure.ts
│       │   │   │   ├── stage6-remedyCodes.ts
│       │   │   │   ├── stage7-crossReferences.ts
│       │   │   │   ├── stage8-diffComputation.ts
│       │   │   │   └── stage9-securityCheck.ts
│       │   │   └── ingestion/        # 9-stage ingestion pipeline
│       │   │       ├── stage1-fileParser.ts
│       │   │       ├── stage2-dataNormaliser.ts
│       │   │       ├── stage3-dbWriter.ts
│       │   │       ├── stage4-remedyMapper.ts
│       │   │       ├── stage5-ftsIndexer.ts
│       │   │       ├── stage6-embeddingGen.ts
│       │   │       ├── stage7-diffBuilder.ts
│       │   │       ├── stage8-versionPromote.ts
│       │   │       └── stage9-notifyDoctors.ts
│       │   ├── ai/                   # RAG pipeline, GPT-4o, embeddings
│       │   │   ├── ragPipeline.ts    # 10-step RAG query flow
│       │   │   ├── embeddings.ts     # OpenAI text-embedding-3-small
│       │   │   └── streaming.ts      # SSE token streaming
│       │   └── lib/                  # Clients and utilities
│       │       ├── supabase.ts       # Supabase client (service role)
│       │       ├── openai.ts         # OpenAI client
│       │       └── redis.ts          # Upstash Redis + BullMQ queue init
│       └── Dockerfile
│
├── packages/
│   ├── types/                        # Shared TypeScript types + Zod schemas
│   │   ├── src/
│   │   │   ├── patient.ts
│   │   │   ├── case.ts
│   │   │   ├── repertory.ts
│   │   │   ├── remedy.ts
│   │   │   ├── ai.ts
│   │   │   ├── billing.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── database/                     # Supabase migrations + seed data
│   │   ├── migrations/
│   │   │   └── 001_initial_schema.sql
│   │   ├── seeds/
│   │   └── package.json
│   └── utils/                        # Shared utility functions
│       ├── src/
│       └── package.json
│
├── turbo.json                        # Turborepo pipeline config
├── package.json                      # Root workspace config
└── README.md
```

---

## Technology Stack

### Frontend (`apps/web`)

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| Framework | Next.js | 14 | App Router, RSC, SSR, ISR |
| Language | TypeScript | 5 strict | Type safety |
| UI Components | ShadCN UI | latest | Accessible Radix UI components |
| CSS Framework | TailwindCSS | 3 | Utility-first styling |
| Client State | Zustand | 4 | Lightweight global state |
| Server State | TanStack Query | 5 | Data fetching, caching, sync |
| Forms | React Hook Form + Zod | latest | Type-safe form validation |
| Rich Text | TipTap | 2 | Clinical notes editor |
| Charts | Recharts | 2 | Revenue and analytics |
| PDF | React-PDF | 3 | Prescriptions and reports |
| PWA | next-pwa | latest | Mobile PWA + offline |
| i18n | next-intl | 3 | English, Hindi, Gujarati |
| Auth Client | @supabase/ssr | latest | Server-side session handling |
| Testing | Vitest + Playwright | — | Unit + E2E |

### Backend (`apps/api`)

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| Runtime | Node.js | 20 LTS | Server runtime |
| Framework | Hono.js | 4 | Ultra-fast edge-ready API |
| Language | TypeScript | 5 strict | Shared types with frontend |
| Validation | Zod | 3 | Schema validation (shared) |
| Job Queues | BullMQ | 5 | Background job processing |
| Cache | Upstash Redis | serverless | Query cache + BullMQ |
| Logging | Pino + Sentry | — | Structured logs + error tracking |
| Container | Docker | 24 | Railway.app deployment |
| Testing | Vitest + Supertest | — | Unit + API integration |

### Data Layer

| Category | Technology | Purpose |
|----------|-----------|---------|
| Database | Supabase PostgreSQL 15 | Managed DB + Auth + RLS + Realtime |
| Vector DB | pgvector 0.6 | AI embeddings in PostgreSQL |
| Auth | Supabase Auth | JWT, OAuth, MFA, session management |
| Realtime | Supabase Realtime | WebSocket channels for live features |
| File Storage | Supabase Storage | Partner files, patient media, exports |
| CDN | Cloudflare R2 | Large static book assets |

### External Services

| Integration | Provider | Usage |
|------------|----------|-------|
| LLM / AI | OpenAI GPT-4o | Prescription AI, case summary, tutor |
| Embeddings | text-embedding-3-small | 1536-dim vectors for RAG |
| Payments (Global) | Stripe | SaaS subscriptions, invoices |
| Payments (India) | CCAvenue | UPI, net banking, domestic cards |
| SMS | Twilio / MSG91 | Patient appointment reminders, OTP |
| Email | Resend.com | Transactional email |
| Error Tracking | Sentry | Frontend + backend error capture |
| Analytics | PostHog | Product usage, feature flags |
| Monitoring | Grafana + PagerDuty | Infrastructure metrics + alerting |
| OAuth | Google OAuth | One-click sign-in via Supabase |
| Push | Web Push VAPID | PWA appointment reminders |

---

## Database Schema

### Tenant & User Tables

```
tenants           — id, name, plan, stripe_customer_id, created_at
users             — id, tenant_id, role, email, profile_json
tenant_licences   — id, tenant_id, repertory_id, plan, valid_from, valid_to
```

### Patient & Clinical Tables

```
patients          — id, tenant_id, name, dob, gender, contact_json, demographic_json
cases             — id, patient_id, tenant_id, case_json, created_at
consultations     — id, case_id, tenant_id, consultation_date, prescription_json, rubrics_json, symptom_embedding
prescriptions     — id, consultation_id, remedy_id, potency, dose
appointments      — id, patient_id, tenant_id, datetime, status, notes
invoices          — id, tenant_id, patient_id, amount, status, stripe_invoice_id
```

### Repertory Content Tables (Read-heavy, ~6M rows)

```
repertories       — id, name, author, category, live_version_id, is_active
chapters          — id, repertory_id, code, name, sort_order, parent_chapter_id
rubrics           — id, chapter_id, repertory_id, version_id, symptom_text, level, parent_id,
                    fts_vector (TSVECTOR), embedding (VECTOR 1536)
rubric_remedies   — id, rubric_id, remedy_id, grade (1-3)
cross_references  — id, rubric_id, target_rubric_id, ref_type (see/compare/related)
remedies          — id, code, full_name, family, kingdom, miasm, profile_embedding
remedy_keynotes   — id, remedy_id, content_text, source_book_id, embedding
```

### Books & Reference

```
books             — id, title, author, year, category, live_version_id
book_passages     — id, book_id, heading, subheading, content_text, fts_vector, embedding
```

### Upload & Ingestion Tracking

```
upload_jobs       — id, repertory_id, year, version_tag, status, admin_id, files_json
validation_reports — id, job_id, stage, severity, code (V001-V010), message, line_no
ingestion_stages  — id, job_id, stage_name, status, started_at, completed_at, records_processed
content_versions  — id, repertory_id, year, version_tag, is_live, rubric_count, promoted_at
diff_reports      — id, repertory_id, v_old_id, v_new_id, added_count, modified_count, diff_json
```

### Row Level Security

| Table | Operation | Policy |
|-------|-----------|--------|
| patients | SELECT/INSERT | `tenant_id = auth.jwt()->>'tenant_id'` |
| cases | SELECT | `tenant_id = (SELECT tenant_id FROM users WHERE id=auth.uid())` |
| rubrics | SELECT | Licensed repertories via `tenant_licences` table |
| books | SELECT | Licensed books via `tenant_licences` table |
| upload_jobs | ALL | `auth.jwt()->>'role' = 'admin'` |
| remedies | SELECT | All authenticated users |
| ALL TABLES | ALL | Super-admin bypasses all RLS |

---

## The 26 Repertories

| # | Name | Category | Author | Format |
|---|------|----------|--------|--------|
| 1 | Ajit | Repertory | Dr. Ajit Kulkarni | Delimited .txt + .new |
| 2 | Allen | Repertory | H. C. Allen | Delimited .txt + .new |
| 3 | Boenning | Repertory | Boenninghausen | Delimited .txt + .new |
| 4 | Boericke | Repertory | William Boericke | Delimited .txt + .new |
| 5 | Boger | Repertory | C. M. Boger | Delimited .txt + .new |
| 6 | Clarke | Materia Medica | John Henry Clarke | Unstructured .mat |
| 7 | Complete | Repertory | Roger van Zandvoort | Delimited .txt + .new (largest) |
| 8 | COVID-19 | Specialty | Hompath Research | JSON or CSV |
| 9 | Fever | Specialty | Multiple Authors | Delimited .txt |
| 10 | Gentry | Repertory | W. D. Gentry | Delimited .txt + .new |
| 11 | Jeremy | Repertory | Jeremy Sherr | Delimited .txt |
| 12 | Kent | Repertory | James Tyler Kent | Delimited .txt + .new |
| 13 | Khullar | Repertory | Dr. S. P. Khullar | Delimited .txt |
| 14 | Knerr | Repertory | Calvin B. Knerr | Delimited .txt + .new |
| 15 | Lippe | Repertory | Adolph von Lippe | Delimited .txt |
| 16 | Miasms | Specialty | Multiple Authors | JSON or CSV |
| 17 | Murphy | Repertory | Robin Murphy | Delimited .txt + .new |
| 18 | Perfect | Specialty | Internal Hompath | Proprietary JSON |
| 19 | Phatak | Repertory | S. R. Phatak | Delimited .txt |
| 20 | Roberts | Materia Medica | Herbert A. Roberts | Unstructured .mat |
| 21 | Scholten | Specialty | Jan Scholten | JSON or CSV |
| 22 | Special | Specialty | Multiple Authors | Proprietary mix |
| 23 | Surjit | Repertory | Dr. Surjit Singh | Delimited .txt |
| 24 | Therap | Therapeutic | Multiple Authors | Delimited .txt |
| 25 | Wards | Specialty | Multiple Authors | Delimited .txt |
| 26 | Miasms | Specialty | Sankaran / Multiple | JSON or CSV |

---

## Repertorization Algorithm

```
Score = Σ (rubric_weight × remedy_grade)  for each selected rubric

rubric_weight (doctor assigns):
  1 = Common symptom
  2 = Confirmatory
  3 = Characteristic
  4 = Eliminating

remedy_grade (from repertory):
  1 = Minor (plain type)
  2 = Moderate (italics)
  3 = Strong (bold)

Tiebreaker: Rubric coverage (how many rubrics covered by remedy)
```

**Example:**
```
Case: "Mind > Fear > Death" (weight=4), "Mind > Anxiety" (weight=2), "Sleep > Restlessness" (weight=3)

Aconitum Napellus:
  Fear of Death  grade=3 → 4×3 = 12
  Anxiety        grade=3 → 2×3 = 6
  Restlessness   grade=3 → 3×3 = 9
  TOTAL = 27 pts, 3/3 rubrics covered → RANK 1
```

---

## AI & RAG Architecture

### 10-Step RAG Query Flow

```
1. Browser      Doctor types free-text symptom in AI Assistant or case screen
2. Hono RAG     Check Redis cache for embedding. Miss → call text-embedding-3-small (~100ms)
3. pgvector     SELECT rubrics ORDER BY embedding <=> query_vector LIMIT 50
4. PostgreSQL   SELECT rubrics WHERE fts_vector @@ to_tsquery(words) LIMIT 50
5. RRF Merge    score = 1/(60+fts_rank) + 1/(60+vec_rank). Top 15 rubrics
6. Remedy Fetch For top 15 rubrics → aggregate rubric_remedies grades. Top 10 remedies
7. Context      For top 5 remedies → fetch remedy_keynotes + book_passages via vector
8. Prompt Build System prompt + retrieved rubrics + keynotes + doctor query (~4000 tokens)
9. GPT-4o       POST /v1/chat/completions stream:true → SSE token stream to browser
10. Browser     Doctor sees tokens appear. Click rubric to add to case
```

**Privacy:** Patient PII is stripped at the RAG service layer before any OpenAI call. Only anonymised symptom patterns are used.

### AI Features

| Feature | Endpoint | Input | Output |
|---------|----------|-------|--------|
| Symptom to Rubric | `POST /ai/suggest-rubrics` | Free-text symptom | Top 15 rubrics with rep source |
| AI Prescription | `POST /ai/prescribe` | Case rubric list | Top 3 remedies + citations |
| Remedy Comparison | `POST /ai/compare-remedies` | 2-5 remedy IDs | Side-by-side differentiation |
| Auto-Repertorize | `POST /ai/auto-repertorize` | Free-text case notes | Pre-filled chart rubrics |
| Case Summary | `POST /ai/case-summary` | patient_id | Clinical narrative |
| AI Tutor | `POST /ai/tutor` | Student question | Educational explanation |
| Research Query | `POST /ai/research-query` | Diagnosis + remedy | Statistical pattern report |

All AI endpoints stream via **Server-Sent Events (SSE)**.

---

## Complete API Reference

### Auth
```
POST /auth/register         Create new account + tenant record
POST /auth/login            Email/password login → JWT access + refresh token
POST /auth/logout           Invalidate session. Revoke refresh token
POST /auth/refresh          Exchange refresh token for new access token
GET  /auth/me               Current user profile + subscription plan
PUT  /auth/profile          Update profile: name, clinic, specialisation
POST /auth/change-password  Authenticated password change
```

### Patients & Cases
```
GET    /patients                    List patients (filter, paginate)
POST   /patients                    Create patient record
GET    /patients/:id                Patient profile + demographics
PUT    /patients/:id                Update patient details
DELETE /patients/:id                Soft-delete (data retained per HIPAA)
GET    /patients/:id/cases          All cases for patient
POST   /cases                       Create new case with case_json
GET    /cases/:id                   Full case detail
PUT    /cases/:id                   Update case (auto-saved)
POST   /cases/:id/consultations     Add consultation + prescription + rubrics
GET    /cases/:id/consultations     All consultations for case
POST   /cases/:id/media             Upload investigation image/PDF
GET    /cases/:id/media             List all media files
```

### Repertory & Search
```
GET  /repertory/available           Repertories licensed to current tenant
POST /repertory/search              Hybrid FTS + pgvector search
GET  /repertory/:repId/chapters     Chapter tree (hierarchical)
GET  /rubrics/:id                   Rubric detail: text, remedies, cross-refs
GET  /rubrics/:id/related           Semantically related rubrics (pgvector)
GET  /rubrics/:id/remedies          All remedies for rubric with grades
POST /repertorize/chart             Compute repertorization chart matrix
POST /repertorize/analyze           Apply strategy (totality/elimination/keynote)
GET  /remedies                      List/search remedy master
GET  /remedies/:id                  Remedy detail: name, keynotes, family
POST /remedies/compare              Compare 2-5 remedies → differentiation table
```

### AI (All streaming via SSE)
```
POST /ai/suggest-rubrics      Free-text → top 15 rubrics
POST /ai/prescribe            Rubric list → top 3 remedies + citations
POST /ai/compare-remedies     2-5 remedy IDs → differentiation
POST /ai/auto-repertorize     Free-text case → pre-filled chart
POST /ai/case-summary         patient_id → clinical narrative
POST /ai/tutor                Student question → explanation with citations
POST /ai/research-query       Diagnosis + remedy → statistical report
```

### Admin Upload & Ingestion
```
POST /admin/upload/init               Create upload job. Return signed URL
POST /admin/upload/confirm            Trigger BullMQ validation job
GET  /admin/jobs                      List all upload jobs
GET  /admin/jobs/:id/status           SSE stream of live job progress
GET  /admin/jobs/:id/report           Full validation report (V001-V010)
POST /admin/jobs/:id/approve          Start ingestion job
POST /admin/jobs/:id/reject           Reject upload
POST /admin/jobs/:id/publish          Go live. Promote staging. Notify doctors
GET  /admin/repertory/:repId/versions Version history
POST /admin/repertory/rollback        Roll back to version_id
GET  /admin/repertory/diff/:v1/:v2    Rubric diff between two versions
```

### Billing
```
POST /billing/subscribe             Stripe checkout session → redirect URL
POST /billing/webhook               Handle Stripe webhook events
GET  /billing/portal                Stripe Customer Portal URL
GET  /billing/subscription          Current tenant subscription details
POST /billing/ccavenue/init         CCAvenue payment order (India)
POST /billing/ccavenue/callback     CCAvenue payment callback
```

---

## Admin Upload Pipeline

### 6-Step Wizard (UI)

| Step | UI Action | Backend Action |
|------|-----------|---------------|
| 1 | Select repertory + year + files | Validate extensions → create `upload_jobs` row |
| 2 | Upload files (drag-drop) | Return Supabase Storage signed URL |
| 3 | Click Validate | `POST /confirm` → BullMQ validation job |
| 4 | View validation report | `GET /report` → `validation_reports` rows |
| 5 | Click Approve | `POST /approve` → ingestion BullMQ job |
| 6 | Click Go Live | `POST /publish` → promote staging to production |

### Validation Pipeline (9 Stages)

| Stage | Name | Error Code | On Fail |
|-------|------|-----------|---------|
| 1 | File Format | V001 | Block |
| 2 | Structure Parser | V001 | Block |
| 3 | Header Check | — | Warning |
| 4 | Chapter Validation | V006 | Warning |
| 5 | Rubric Structure | V002 V004 | Error/Warn |
| 6 | Remedy Codes | V003 V005 | Error/Warn |
| 7 | Cross-References | V008 | Warning |
| 8 | Diff Computation | V009 V010 | Info only |
| 9 | Security Check | V001 | Block |

### Ingestion Pipeline (9 Stages)

| Stage | Name | Output | Time |
|-------|------|--------|------|
| 1 | file-parser | Normalised JSON rubric array | 1-5 min |
| 2 | data-normaliser | Supabase schema objects | 1-3 min |
| 3 | db-writer | `rubrics_staging` rows (batch 1000) | 5-30 min |
| 4 | remedy-mapper | Mapped remedies / queued for admin | 1-2 min |
| 5 | fts-indexer | `tsvector` column via DB trigger | Auto |
| 6 | embedding-gen | `VECTOR(1536)` per rubric | 10-60 min |
| 7 | diff-builder | `diff_reports` record | 2-5 min |
| 8 | version-promote | Production rubric rows + version live | 1-2 min |
| 9 | notify-doctors | In-app + email to licensed doctors | <1 min |

---

## SaaS Subscription Plans

| Plan | Target | Repertories | Books | AI | Patients | Users | Billing |
|------|--------|-------------|-------|----|----------|-------|---------|
| Starter | Students | Kent only | 5 books | No | 50 | 1 | Monthly |
| Professional | Physician | All 26 | All 565+ | Yes | Unlimited | 1 | Monthly/Annual |
| Clinic | Multi-doctor | All 26 | All 565+ | Yes | Unlimited | Up to 10 | Per-seat Annual |
| Institution | College/Hospital | All 26 | All 565+ | Yes | Unlimited | Unlimited | Custom |
| Researcher | Researcher | All 26 | All 565+ | Yes + Research | N/A | 1 | Annual |

---

## Security Architecture

> All hardware-based copy protection (HASP USB Lock, Sentinel Thales libraries, USB product key) is permanently removed. Zomeo.ai is browser-based SaaS — cloud-native security replaces all hardware protection.

| Domain | Mechanism | Detail |
|--------|-----------|--------|
| Identity | Supabase Auth | Email/password + Google OAuth. Optional MFA |
| Session | JWT + refresh tokens | Access token: 1-hour TTL. Refresh: 7-day rotation |
| API Auth | Bearer JWT verification | Every Hono route verifies JWT. Claims: user_id, tenant_id, role, plan |
| Data Isolation | Supabase RLS | Tenant cannot read another tenant's data at DB level |
| Content Protection | Licence-gated RLS | `tenant_licences` + RLS enforces purchased repertory access |
| File Access | Signed URLs (1-hour) | No direct bucket access |
| Transport | TLS 1.3 enforced | HTTPS-only, HSTS header |
| At-Rest Encrypt | AES-256-GCM | All DB data + Storage files encrypted at rest |
| Rate Limiting | Hono middleware | 100/min per IP. 1000/min per tenant. 20/min AI |
| Injection | Zod + parameterised SQL | All inputs validated before DB query |
| XSS | Next.js + CSP | JSX auto-escape + Content-Security-Policy header |
| CSRF | SameSite cookies + token | SameSite=Strict cookies + CSRF token on forms |
| Patient Privacy | AI data stripping | PII removed before any OpenAI API call |
| HIPAA | Supabase HIPAA BAA | Data residency: India ap-south-1 |

---

## DevOps & Infrastructure

### Infrastructure

| Service | Provider | Purpose |
|---------|----------|---------|
| Frontend | Vercel | Next.js native, global edge CDN, preview deploys per PR |
| Backend | Railway.app | Dockerised Node.js, auto-scale, health checks |
| Database | Supabase Cloud | PostgreSQL 15, PITR, daily backups, ap-south-1 |
| Cache/Queues | Upstash Redis | BullMQ job queues + query embedding cache |
| File Storage | Supabase Storage | Partner files, patient media, exports |
| CDN | Cloudflare R2 | Large reference book assets |
| Error Tracking | Sentry | Frontend + backend errors |
| Analytics | PostHog | Feature usage, funnel, session replay |
| Monitoring | Grafana + PagerDuty | DB connections, API latency, alerting |
| Email | Resend.com | Transactional email |
| SMS | Twilio / MSG91 | Appointment reminders, OTP |

### Dockerfile (Backend)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3001
HEALTHCHECK CMD curl -f http://localhost:3001/health || exit 1
CMD ["node", "dist/index.js"]
```

### Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | Backend + Frontend | Supabase project URL |
| `SUPABASE_ANON_KEY` | Frontend | Supabase anon key (client-side auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend only | Service role key — bypasses RLS for admin |
| `OPENAI_API_KEY` | Backend only | OpenAI API key — never exposed to frontend |
| `STRIPE_SECRET_KEY` | Backend only | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Backend only | Stripe webhook signing secret |
| `CCAVENUE_MERCHANT_ID` | Backend only | CCAvenue merchant identifier |
| `CCAVENUE_ACCESS_CODE` | Backend only | CCAvenue access code |
| `UPSTASH_REDIS_URL` | Backend only | Upstash Redis for BullMQ + cache |
| `TWILIO_ACCOUNT_SID` | Backend only | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Backend only | Twilio auth token |
| `RESEND_API_KEY` | Backend only | Resend.com API key |
| `SENTRY_DSN` | Both | Sentry DSN |
| `NEXT_PUBLIC_API_URL` | Frontend only | Backend API base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend only | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend only | Supabase anon key (public) |

### CI/CD Pipeline

```
Branch Push → Lint & Type Check → Unit Tests → API Tests → E2E Tests (on PR)
           → Frontend Build (merge to main) → Backend Docker Build
           → Preview Deploy (per PR) → Staging Deploy (auto on main)
           → DB Migrations (supabase db push) → Production Deploy (manual approval)
           → Health Check (auto-rollback on failure)
```

---

## Performance Benchmarks & SLAs

| Metric | Target | Method |
|--------|--------|--------|
| Rubric search (FTS + pgvector) | < 500ms P95 | Grafana: /repertory/search latency |
| AI first streaming token | < 2 seconds | Sentry: POST to first SSE event |
| Ingestion pipeline per repertory | < 30 minutes | BullMQ job completion time |
| Bulk embedding (all 26 repertories) | < 4 hours | Timed bulk embedding worker |
| File upload + full validation | < 10 minutes | upload_jobs timestamps |
| Concurrent users (search) | 500 simultaneous | k6: 500 VUs, 10 searches each |
| Patient record page load | < 1.5 seconds | Vercel analytics: LCP |
| API uptime SLA | 99.9% monthly | Railway monitoring + PagerDuty |
| Database uptime SLA | 99.95% monthly | Supabase managed SLA |
| AI response accuracy | 0 hallucinated codes | Output validation: strip non-master remedies |

### Database Indexes

```sql
-- Full-text search on rubrics
CREATE INDEX rubrics_fts_idx ON rubrics USING GIN (fts_vector);

-- Trigram search on rubric text
CREATE INDEX rubrics_trgm_idx ON rubrics USING GIN (symptom_text gin_trgm_ops);

-- pgvector semantic search
CREATE INDEX rubrics_embedding_idx ON rubrics
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 200);

-- Composite for rubric-remedy joins
CREATE INDEX rubric_remedies_idx ON rubric_remedies (rubric_id, remedy_id, grade);
```

---

## Setup & Installation

### Prerequisites
- Node.js 20+
- pnpm 8+ (Turborepo monorepo)
- Supabase project (PostgreSQL 15 + pgvector + RLS)
- OpenAI API key
- Upstash Redis account

### Install

```bash
git clone https://github.com/hompath/zomeo-ai
cd zomeo-ai
pnpm install
```

### Environment Setup

```bash
# Backend
cp apps/api/.env.example apps/api/.env
# Fill in: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY,
#          UPSTASH_REDIS_URL, STRIPE_SECRET_KEY, etc.

# Frontend
cp apps/web/.env.example apps/web/.env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL
```

### Database Migrations

```bash
cd packages/database
supabase db push            # Apply all migrations
supabase db seed            # Seed remedies master data
```

### Development

```bash
# Run all apps in parallel (Turborepo)
pnpm dev

# Or individually
pnpm --filter @zomeo/api dev      # Backend on :3001
pnpm --filter @zomeo/web dev      # Frontend on :3000
```

### Import Repertory Data (Admin Portal)

1. Log in to `/admin` as super-admin
2. Navigate to `/admin/repertory/upload`
3. Use the 6-step wizard to upload repertory files
4. Monitor validation at `/admin/repertory/jobs`
5. Approve and publish to go live

---

## Development Phases

- [x] **Phase 1** — Authentication + Multi-tenant + Patient management
- [x] **Phase 2** — Case taking system
- [x] **Phase 3** — Repertory database + data importer
- [x] **Phase 4** — Repertorization engine (core algorithm)
- [x] **Phase 5** — AI rubric search (GPT-4o + pgvector RAG)
- [ ] **Phase 6** — Prescription & follow-up system (UI complete)
- [ ] **Phase 7** — Admin upload portal + 9-stage ingestion pipeline
- [ ] **Phase 8** — SaaS billing (Stripe + CCAvenue)
- [ ] **Phase 9** — Books library + RAG search
- [ ] **Phase 10** — Appointments + SMS reminders
- [ ] **Phase 11** — Reports + PDF generation
- [ ] **Phase 12** — Mobile PWA + offline support
- [ ] **Phase 13** — Internationalisation (Hindi, Gujarati)
- [ ] **Phase 14** — Partner portal
- [ ] **Phase 15** — Research query AI + analytics

---

## License

Commercial SaaS — All rights reserved.
Repertory data requires separate licensing from publishers.
**Hompath Technologies Pvt. Ltd. — Confidential**
