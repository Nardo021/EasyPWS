-- Separate an in-flight Telegram claim from an abandoned one.
-- A duplicate delivery must not change a claim that is still inside its lease.

ALTER TABLE telegram_alert_deliveries ADD COLUMN claim_token TEXT;

ALTER TABLE telegram_alert_deliveries ADD COLUMN lease_until TEXT;
