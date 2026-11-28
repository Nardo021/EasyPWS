-- Monotonic product revision, consent epoch, and in-flight delivery lease.
-- Existing alert_events rows are not rewritten.

ALTER TABLE watched_products ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

ALTER TABLE owner_alert_preference ADD COLUMN epoch INTEGER NOT NULL DEFAULT 1;

ALTER TABLE notification_outbox ADD COLUMN consent_epoch INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notification_outbox ADD COLUMN claim_token TEXT;

ALTER TABLE notification_outbox ADD COLUMN lease_until TEXT;

CREATE TABLE IF NOT EXISTS commit_tokens (
  token TEXT PRIMARY KEY
);
