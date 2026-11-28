-- Local additive tables for Telegram read-only queries.
-- Reservations count failed attempts. Cache stores validated mapped results only.

CREATE TABLE IF NOT EXISTS telegram_query_reservations (
  request_key TEXT PRIMARY KEY,
  sydney_day TEXT NOT NULL,
  operation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS telegram_query_reservations_day
  ON telegram_query_reservations (sydney_day);

CREATE TABLE IF NOT EXISTS telegram_query_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  stored_at TEXT NOT NULL
);
