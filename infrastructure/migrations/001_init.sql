-- EasyPWS initial schema (SQLite)
-- FRAME: price_observations are append-only; never overwrite prior prices.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  oidc_subject  TEXT UNIQUE,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS retailers (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  base_url      TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stores (
  id                  TEXT PRIMARY KEY,
  retailer_id         TEXT NOT NULL REFERENCES retailers(id),
  external_store_id   TEXT NOT NULL,
  name                TEXT NOT NULL,
  region              TEXT,
  timezone            TEXT,
  UNIQUE (retailer_id, external_store_id)
);

CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,
  barcode       TEXT,
  brand         TEXT,
  name          TEXT NOT NULL,
  size          TEXT,
  category      TEXT,
  image_url     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);

CREATE TABLE IF NOT EXISTS product_identifiers (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  value         TEXT NOT NULL,
  UNIQUE (type, value)
);

CREATE TABLE IF NOT EXISTS retailer_listings (
  id                    TEXT PRIMARY KEY,
  product_id            TEXT NOT NULL REFERENCES products(id),
  retailer              TEXT NOT NULL REFERENCES retailers(id),
  retailer_product_id   TEXT NOT NULL,
  product_url           TEXT NOT NULL,
  store_id              TEXT REFERENCES stores(id),
  current_price         REAL,
  regular_price         REAL,
  unit_price            REAL,
  unit                  TEXT,
  in_stock              INTEGER NOT NULL DEFAULT 1,
  promotion_type        TEXT NOT NULL DEFAULT 'none',
  last_checked_at       INTEGER,
  check_tier            TEXT NOT NULL DEFAULT 'normal',
  next_check_at         INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  UNIQUE (retailer, retailer_product_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_product ON retailer_listings (product_id);
CREATE INDEX IF NOT EXISTS idx_listings_next_check ON retailer_listings (next_check_at);

CREATE TABLE IF NOT EXISTS price_observations (
  id                TEXT PRIMARY KEY,
  listing_id        TEXT NOT NULL REFERENCES retailer_listings(id) ON DELETE CASCADE,
  price             REAL NOT NULL,
  regular_price     REAL,
  unit_price        REAL,
  promotion_type    TEXT NOT NULL DEFAULT 'none',
  in_stock          INTEGER NOT NULL DEFAULT 1,
  observed_at       INTEGER NOT NULL,
  source            TEXT NOT NULL,
  raw_hash          TEXT
);

CREATE INDEX IF NOT EXISTS idx_price_obs_listing_time
  ON price_observations (listing_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS promotion_observations (
  id                    TEXT PRIMARY KEY,
  listing_id            TEXT NOT NULL REFERENCES retailer_listings(id) ON DELETE CASCADE,
  promotion_type        TEXT NOT NULL,
  label                 TEXT,
  discount_percentage   REAL,
  started_at            INTEGER,
  ended_at              INTEGER,
  observed_at           INTEGER NOT NULL,
  source                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlists (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id            TEXT PRIMARY KEY,
  watchlist_id  TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  listing_id    TEXT NOT NULL REFERENCES retailer_listings(id),
  status        TEXT NOT NULL DEFAULT 'active',
  target_price  REAL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (watchlist_id, listing_id)
);

CREATE TABLE IF NOT EXISTS watch_rules (
  id                  TEXT PRIMARY KEY,
  watchlist_item_id   TEXT NOT NULL REFERENCES watchlist_items(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  operator            TEXT NOT NULL,
  value               REAL,
  cooldown_hours      INTEGER NOT NULL DEFAULT 24,
  enabled             INTEGER NOT NULL DEFAULT 1,
  last_triggered_at   INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_channels (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  name          TEXT NOT NULL,
  config        TEXT NOT NULL DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_events (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id      TEXT REFERENCES notification_channels(id),
  watch_rule_id   TEXT REFERENCES watch_rules(id),
  listing_id      TEXT NOT NULL REFERENCES retailer_listings(id),
  kind            TEXT NOT NULL,
  payload         TEXT NOT NULL,
  dedupe_key      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      INTEGER NOT NULL,
  delivered_at    INTEGER,
  error           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dedupe
  ON notification_events (dedupe_key);

CREATE TABLE IF NOT EXISTS collection_jobs (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  listing_id      TEXT REFERENCES retailer_listings(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'queued',
  priority        INTEGER NOT NULL DEFAULT 100,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  run_after       INTEGER NOT NULL,
  locked_at       INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_queue
  ON collection_jobs (status, run_after, priority);

CREATE TABLE IF NOT EXISTS adapter_health (
  retailer      TEXT PRIMARY KEY REFERENCES retailers(id),
  status        TEXT NOT NULL,
  latency_ms    INTEGER,
  message       TEXT,
  checked_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  scopes          TEXT NOT NULL DEFAULT '[]',
  token_prefix    TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER,
  expires_at      INTEGER,
  revoked_at      INTEGER
);

INSERT OR IGNORE INTO retailers (id, display_name, base_url, enabled) VALUES
  ('coles', 'Coles', 'https://www.coles.com.au', 1),
  ('woolworths', 'Woolworths', 'https://www.woolworths.com.au', 1),
  ('aldi', 'ALDI', 'https://www.aldi.com.au', 0),
  ('chemist_warehouse', 'Chemist Warehouse', 'https://www.chemistwarehouse.com.au', 0),
  ('generic', 'Generic', '', 0);
