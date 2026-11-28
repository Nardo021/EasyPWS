# EasyPWS V2 — Phase 1F-B owner-only Telegram price alerts

**Status:** SOURCE_DRAFTED / NOT_DEPLOYED  
**Date:** 2026-11-28 (Australia/Sydney)  
**Base:** `main` `90a6e23487a6f9683c4acc90bda88bd65d419f70`  
**Branch:** `easypws-v2/phase-01f-b-telegram-alerts`

## What this phase does

A price drop is committed with its observation and one outbox row in a single D1 batch. The transition id is that observation, so 5 → 3 → 5 → 3 can notify twice. Replaying an observation key returns stale before any write: price, metadata, history, alert rows, and attempt count stay as they were. Each watched product has a monotonic integer `revision`. A commit must present the revision read with the previous price; a delayed observation cannot win just because the price has cycled back. The same batch rolls back together if a later statement aborts.

Consent is a durable epoch on the owner preference. Every opt-in and opt-out advances it. The outbox row stores the epoch read inside the enqueue statement, and a disabled preference is stored as suppressed rather than queued. Claim and requeue both require that stored epoch to still be the enabled epoch. Turning alerts back on does not unsuppress or send a row from the disabled period. A send that has already been handed to Telegram is not recalled; the interface says so. This is not exactly-once delivery.

Manual refresh and an import of an existing SKU read the item id, revision, price, target, and status before the provider call. Refresh never inserts a watch item. An import does not apply a quote that was fetched before a newer revision. A delete during the fetch stays deleted. A pause, target change, or newer price makes the stale response return 409 and leaves the newer row alone. An initial import uses `INSERT ... ON CONFLICT DO NOTHING` and writes history only under the winning id. Manual refresh does not consume the 15-attempt budget.

The price Worker calls the Telegram Worker's private `AlertDelivery` entrypoint. It does not receive the bot token, choose a chat, or open a public send route. The Telegram ledger claims a transition with a 60-second lease. A duplicate does not change a claim that is still inside that lease. A terminal write that does not persist is reported from the stored row and is not retried. An abandoned `sending` or expired `claimed` row becomes `unknown` and is not sent again. A future lease stays in flight.

Fixture reports, invalid quotes, the first price, unchanged or rising prices, and paused or removed items do not enter the outbox. The existing production Cron remains `0 22 * * *`. The daily budget remains 15 recorded attempts. No Omkar request was added.

## Verification on this machine

- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` passed on 2026-11-28.
- Lite local D1 covers replay after an ABA cycle, a delayed observation with a stale revision, commit-path rollback, opt-out during enqueue, old-epoch requeue, refresh against delete/pause/target/newer price, concurrent import, an import that must not overwrite a price committed during the provider call, an active delivery lease, terminal-write failure, and abandoned-claim reconciliation.
- A local two-worker harness calls `AlertDelivery` through the `TELEGRAM_ALERTS` service binding, applies the Telegram migrations to local D1, and mocks only `api.telegram.org`. Public `/deliver`, `/alerts`, and `/webhook/send` return 404. A second delivery does not send again.
- `wrangler deploy --dry-run --env production` for both Workers exited before upload. The price output names `easypws-telegram#AlertDelivery`. The production cron list is still exactly `0 22 * * *`. Wrangler 4.160.1's workerd binary only accepts compatibility dates through 2026-11-17, so the harness uses that date; the staged config date remains 2026-11-24.
- `pnpm --filter @easypws/lite run check:monitor` passed on a local database: `externalRequests 0`, `monitorUsedToday 15`. Migration `0004_alert_consistency.sql` was applied only to that local database.

## Not done

No production D1 migration, Worker deploy, Access change, DNS change, secret change, new Cron, or real Telegram message. The service binding remains staged and is not deployed. Remote D1 does not yet have `0004_alert_consistency.sql` or the Telegram lease columns. Phase 1F-C is out of scope. Phase 0 remains PARTIAL. Provider gate remains PARTIAL. Dual-platform CI for this revision is on Draft PR #11 and is not treated as passed until those runs finish.
