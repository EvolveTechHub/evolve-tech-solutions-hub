-- Link service requests to signed-in client accounts and track their status.
ALTER TABLE submissions ADD COLUMN client_account_id TEXT;
ALTER TABLE submissions ADD COLUMN status TEXT NOT NULL DEFAULT 'Received';
CREATE INDEX IF NOT EXISTS idx_submissions_client_account
  ON submissions (client_account_id, created_at DESC);