-- Expand the submissions type constraint to include client workspace requests.
-- Run this migration against the PREVIEW D1 database before testing client requests.

CREATE TABLE submissions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('enquiry', 'registration', 'quote', 'client_request')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  organisation TEXT,
  interest TEXT,
  service TEXT,
  currency TEXT,
  details TEXT,
  message TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO submissions_new
  (id, type, name, email, organisation, interest, service, currency, details, message, created_at)
SELECT
  id, type, name, email, organisation, interest, service, currency, details, message, created_at
FROM submissions;

DROP TABLE submissions;
ALTER TABLE submissions_new RENAME TO submissions;

CREATE INDEX IF NOT EXISTS idx_submissions_type_created
  ON submissions (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_email
  ON submissions (email);
