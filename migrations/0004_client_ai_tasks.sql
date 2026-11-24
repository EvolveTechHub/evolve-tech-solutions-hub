-- Store authenticated AI task runs and their generated results.
CREATE TABLE IF NOT EXISTS client_ai_tasks (
  id TEXT PRIMARY KEY,
  client_account_id TEXT NOT NULL,
  service TEXT NOT NULL,
  task_mode TEXT NOT NULL,
  objective TEXT NOT NULL,
  result TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_ai_tasks_account_created
  ON client_ai_tasks (client_account_id, created_at DESC);
