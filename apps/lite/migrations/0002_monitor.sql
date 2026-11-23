ALTER TABLE watched_products ADD COLUMN last_attempt_at TEXT;

CREATE TABLE IF NOT EXISTS monitor_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  product_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  previous_price REAL,
  price REAL NOT NULL,
  target_price REAL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
