CREATE TABLE IF NOT EXISTS probe_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS probe_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL
);

INSERT OR IGNORE INTO probe_jobs (id, status, attempts, run_after)
VALUES ('job-1', 'queued', 0, '1970-01-01T00:00:00.000Z');
