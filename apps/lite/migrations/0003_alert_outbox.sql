-- Durable transition identity and owner alert outbox.
-- Existing alert_events rows and their dedupe keys are not rewritten.

ALTER TABLE price_observations ADD COLUMN observation_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_observations_observation_key
  ON price_observations (observation_key)
  WHERE observation_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS price_transitions (
  id TEXT PRIMARY KEY,
  observation_key TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_url TEXT NOT NULL,
  previous_price REAL NOT NULL,
  price REAL NOT NULL,
  target_price REAL,
  price_drop INTEGER NOT NULL,
  target_crossed INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  transition_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'unknown', 'suppressed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_alert_preference (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO owner_alert_preference (id, enabled, updated_at)
VALUES (1, 0, '1970-01-01T00:00:00.000Z');
