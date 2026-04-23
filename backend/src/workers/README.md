# Zomeo.ai — BullMQ Background Job Workers

This directory contains BullMQ worker definitions for all background processing queues.

## Queue Architecture

| Queue | Workers | Triggered By | Purpose |
|-------|---------|-------------|---------|
| `validation-queue` | 4 | `POST /admin/upload/confirm` | 9-stage validation pipeline |
| `ingestion-queue` | 4 | `POST /admin/jobs/:id/approve` | 9-stage ingestion pipeline |
| `embedding-queue` | 8 | Stage 6 of ingestion | OpenAI text-embedding-3-small batched calls |
| `notification-queue` | 2 | Stage 9 of ingestion | In-app + email to licensed doctors |
| `email-queue` | 2 | Various services | Resend transactional emails |
| `sms-queue` | 2 | Appointment service | Twilio appointment reminders |
| `report-queue` | 2 | Reports service | Heavy SQL + PDF rendering |

## Files

- `validationWorker.ts` — Runs 9-stage file validation
- `ingestionWorker.ts` — Runs 9-stage data ingestion pipeline
- `embeddingWorker.ts` — Generates OpenAI embeddings in batches of 100
- `notificationWorker.ts` — Sends in-app + Resend email notifications
- `emailWorker.ts` — Resend.com transactional email sender
- `smsWorker.ts` — Twilio SMS sender for appointment reminders
- `reportWorker.ts` — Background report generation + PDF export

## Validation Pipeline (9 Stages)

1. File Format — UTF-8/16, <500MB, supported extension
2. Structure Parser — delimiter detection, JSON schema, legacy decode
3. Header Check — rep name match, chapter/rubric count
4. Chapter Validation — codes in master or flagged NEW
5. Rubric Structure — no empty text, level 1-4, no orphans
6. Remedy Codes — all codes in remedies master, grade 1/2/3
7. Cross-References — target IDs exist, no circular refs
8. Diff Computation — added/modified/removed vs previous version
9. Security Check — injection scan, ≤50000 rubrics per file

## Ingestion Pipeline (9 Stages)

1. file-parser — raw decoded file → normalised JSON
2. data-normaliser — parsed JSON → Supabase schema objects
3. db-writer — batch insert 1000 rubrics to rubrics_staging
4. remedy-mapper — map unknown codes / queue for admin review
5. fts-indexer — tsvector updated by DB trigger (automatic)
6. embedding-gen — OpenAI text-embedding-3-small per rubric
7. diff-builder — generate diff_reports record
8. version-promote — promote staging to production rubrics
9. notify-doctors — in-app + email to all licensed tenants
