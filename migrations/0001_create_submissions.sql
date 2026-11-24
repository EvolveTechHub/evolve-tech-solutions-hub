CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('enquiry', 'registration', 'quote')),
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

CREATE INDEX IF NOT EXISTS idx_submissions_type_created
  ON submissions (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_email
  ON submissions (email);
