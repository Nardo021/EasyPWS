-- One delivery claim per price transition. No message body, chat id, or token.
CREATE TABLE IF NOT EXISTS telegram_alert_deliveries (
  transition_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'sent', 'failed', 'unknown')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
