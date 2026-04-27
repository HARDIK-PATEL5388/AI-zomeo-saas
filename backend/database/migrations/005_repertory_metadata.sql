-- Add source/year/version metadata to upload jobs
ALTER TABLE rep_upload_jobs
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
