-- ============================================================
-- Add mobile_code and mobile_number columns to users table
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_number TEXT;

-- Index for fast mobile login lookup
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile_number);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
