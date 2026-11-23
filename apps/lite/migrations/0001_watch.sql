CREATE TABLE IF NOT EXISTS watched_products (
  id TEXT PRIMARY KEY,
  retailer_product_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  size TEXT,
  product_url TEXT NOT NULL,
  image_url TEXT,
  current_price REAL,
  regular_price REAL,
  promotion_type TEXT NOT NULL,
  promotion_kind TEXT NOT NULL,
  in_stock INTEGER NOT NULL,
  availability_known INTEGER NOT NULL,
  source_label TEXT NOT NULL,
  price_note TEXT NOT NULL,
  source_timestamp TEXT,
  retrieved_at TEXT,
  target_price REAL,
  monitoring_status TEXT NOT NULL DEFAULT 'active',
  notification_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (retailer_product_id, store_id)
);

CREATE TABLE IF NOT EXISTS price_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  price REAL,
  regular_price REAL,
  promotion_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
