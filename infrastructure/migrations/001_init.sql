-- EasyPWS initial schema
-- FRAME: price_observations are append-only; never overwrite prior prices.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  oidc_subject  TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE retailers (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  base_url      TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE stores (
  id                  TEXT PRIMARY KEY,
  retailer_id         TEXT NOT NULL REFERENCES retailers(id),
  external_store_id   TEXT NOT NULL,
  name                TEXT NOT NULL,
  region              TEXT,
  timezone            TEXT,
  UNIQUE (retailer_id, external_store_id)
);

CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  barcode       TEXT,
  brand         TEXT,
  name          TEXT NOT NULL,
  size          TEXT,
  category      TEXT,
  image_url     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_barcode ON products (barcode);
CREATE INDEX idx_products_name ON products (name);

CREATE TABLE product_identifiers (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  value         TEXT NOT NULL,
  UNIQUE (type, value)
);

CREATE TABLE retailer_listings (
  id                    TEXT PRIMARY KEY,
  product_id            TEXT NOT NULL REFERENCES products(id),
  retailer              TEXT NOT NULL REFERENCES retailers(id),
  retailer_product_id   TEXT NOT NULL,
  product_url           TEXT NOT NULL,
  store_id              TEXT REFERENCES stores(id),
  current_price         NUMERIC(12, 2),
  regular_price         NUMERIC(12, 2),
  unit_price            NUMERIC(12, 4),
  unit                  TEXT,
  in_stock              BOOLEAN NOT NULL DEFAULT true,
  promotion_type        TEXT NOT NULL DEFAULT 'none',
  last_checked_at       TIMESTAMPTZ,
  check_tier            TEXT NOT NULL DEFAULT 'normal',
  next_check_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (retailer, retailer_product_id, store_id)
);

CREATE INDEX idx_listings_product ON retailer_listings (product_id);
CREATE INDEX idx_listings_next_check ON retailer_listings (next_check_at);

-- Append-only price history
CREATE TABLE price_observations (
  id                TEXT PRIMARY KEY,
  listing_id        TEXT NOT NULL REFERENCES retailer_listings(id) ON DELETE CASCADE,
  price             NUMERIC(12, 2) NOT NULL,
  regular_price     NUMERIC(12, 2),
  unit_price        NUMERIC(12, 4),
  promotion_type    TEXT NOT NULL DEFAULT 'none',
  in_stock          BOOLEAN NOT NULL DEFAULT true,
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source            TEXT NOT NULL,
  raw_hash          TEXT
);

CREATE INDEX idx_price_obs_listing_time
  ON price_observations (listing_id, observed_at DESC);

CREATE TABLE promotion_observations (
  id                    TEXT PRIMARY KEY,
  listing_id            TEXT NOT NULL REFERENCES retailer_listings(id) ON DELETE CASCADE,
  promotion_type        TEXT NOT NULL,
  label                 TEXT,
  discount_percentage   NUMERIC(6, 2),
  started_at            TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  observed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  source                TEXT NOT NULL
);

CREATE TABLE watchlists (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE watchlist_items (
  id            TEXT PRIMARY KEY,
  watchlist_id  TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  listing_id    TEXT NOT NULL REFERENCES retailer_listings(id),
  status        TEXT NOT NULL DEFAULT 'active',
  target_price  NUMERIC(12, 2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, listing_id)
);

CREATE TABLE watch_rules (
  id                  TEXT PRIMARY KEY,
  watchlist_item_id   TEXT NOT NULL REFERENCES watchlist_items(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  operator            TEXT NOT NULL,
  value               NUMERIC(12, 4),
  cooldown_hours      INTEGER NOT NULL DEFAULT 24,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_channels (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  name          TEXT NOT NULL,
  config        JSONB NOT NULL DEFAULT '{}',
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_events (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id      TEXT REFERENCES notification_channels(id),
  watch_rule_id   TEXT REFERENCES watch_rules(id),
  listing_id      TEXT NOT NULL REFERENCES retailer_listings(id),
  kind            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  dedupe_key      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ,
  error           TEXT
);

CREATE UNIQUE INDEX idx_notification_dedupe
  ON notification_events (dedupe_key);

CREATE TABLE collection_jobs (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  listing_id      TEXT REFERENCES retailer_listings(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'queued',
  priority        INTEGER NOT NULL DEFAULT 100,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  run_after       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_queue
  ON collection_jobs (status, run_after, priority);

CREATE TABLE adapter_health (
  retailer      TEXT PRIMARY KEY REFERENCES retailers(id),
  status        TEXT NOT NULL,
  latency_ms    INTEGER,
  message       TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_tokens (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  token_prefix    TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ
);

-- Seed retailers
INSERT INTO retailers (id, display_name, base_url, enabled) VALUES
  ('coles', 'Coles', 'https://www.coles.com.au', true),
  ('woolworths', 'Woolworths', 'https://www.woolworths.com.au', true),
  ('aldi', 'ALDI', 'https://www.aldi.com.au', false),
  ('chemist_warehouse', 'Chemist Warehouse', 'https://www.chemistwarehouse.com.au', false),
  ('generic', 'Generic', '', false);
