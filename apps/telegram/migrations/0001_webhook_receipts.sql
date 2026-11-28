-- Isolated Telegram webhook idempotency state. No message contents or owner identifiers.
CREATE TABLE IF NOT EXISTS telegram_update_receipts (
  update_id INTEGER PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('claimed', 'sent', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
