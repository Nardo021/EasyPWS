# EasyPWS V2 — Phase 1F-B owner-only Telegram price alerts

**Status:** DEPLOYMENT_ACCEPTED / CONSENT_SMOKE_PASS / LIVE_ALERT_UNVERIFIED  
**Date:** 2026-11-28 (Australia/Sydney)  
**Production main:** `211feb41c88c452781f93a9bc891b8f28a3f3026`  
**Drafted from:** `main` `90a6e23487a6f9683c4acc90bda88bd65d419f70` on `easypws-v2/phase-01f-b-telegram-alerts`

## What this phase does

A price drop is committed with its observation and one outbox row in a single D1 batch. The transition id is that observation, so 5 → 3 → 5 → 3 can notify twice. Replaying an observation key returns stale before any write: price, metadata, history, alert rows, and attempt count stay as they were. Each watched product has a monotonic integer `revision`. A commit must present the revision read with the previous price; a delayed observation cannot win just because the price has cycled back. The same batch rolls back together if a later statement aborts.

Consent is a durable epoch on the owner preference. Every opt-in and opt-out advances it. The outbox row stores the epoch read inside the enqueue statement, and a disabled preference is stored as suppressed rather than queued. Claim and requeue both require that stored epoch to still be the enabled epoch. Turning alerts back on does not unsuppress or send a row from the disabled period. A successful claim is the point of no return: that alert may still be sent, and pause, delete, or opt-out cannot recall it. The interface says so. This is not exactly-once delivery.

Manual refresh and an import of an existing SKU read the item id, revision, price, target, and status before the provider call. Refresh never inserts a watch item. An import does not apply a quote that was fetched before a newer revision. A delete during the fetch stays deleted. A pause, target change, or newer price makes the stale response return 409 and leaves the newer row alone. An initial import writes the watch row and, when the quote has a price, its first observation in one D1 batch. The observation insert runs only when that insert changed a row and the new id is still present. An aborted observation insert leaves no watch row and no orphan observation. An unpriced quote stores the watch row without an observation. A conflict loser does not get history, and the winner path stays compare-and-set guarded. Deleting an item suppresses its queued alerts and removes the item, its observations, and its alert events in one batch. Price transitions and notification outbox rows stay as the delivery audit. Pausing an item updates its status and revision and suppresses its queued alerts in the same batch. Resume does not unsuppress them. Manual refresh does not consume the 15-attempt budget.

The price Worker calls the Telegram Worker's private `AlertDelivery` entrypoint. It does not receive the bot token, choose a chat, or open a public send route. The Telegram ledger claims a transition with a 60-second lease. A duplicate does not change a claim that is still inside that lease. A terminal write that does not persist is reported from the stored row and is not retried. An abandoned `sending` or expired `claimed` row becomes `unknown` and is not sent again. A future lease stays in flight.

Fixture reports, invalid quotes, the first price, unchanged or rising prices, and paused or removed items do not enter the outbox. The existing production Cron remains `0 22 * * *`. The monitor budget remains 15 recorded automatic attempts per Sydney day. It is not a global hard cap. No Omkar request was added.

## Production status on 2026-11-28

Independent readback:

- PR #11 is merged. Main CI run [46132612512](https://github.com/Nardo021/EasyPWS/actions/runs/46132612512) completed successfully for `211feb41c88c452781f93a9bc891b8f28a3f3026`. All four jobs passed: Ubuntu and Windows, `install-build-test` and `fresh-typecheck-test`.
- The price Worker `dccc33a0-a502-47b3-b6ea-c2d4278d5799` and the Telegram Worker `461ca82b-cbee-4e85-b027-a836788696cf` each receive 100% of traffic.
- Price D1 has migrations 0001 through 0004. Telegram D1 has migrations 0001 through 0003.
- The existing Access app was corrected in place to `easypws.yanze.me`. Its audience, owner-only policy, and Worker destination were retained.
- Counts at the accepted read: watchlist 1, observations 6, monitor attempts 5, `provider_calls` 11, notification outbox 0, Telegram price-alert deliveries 0, webhook receipts with status sent 4.
- A preference read at 2026-11-28T10:26:13.120Z observed `enabled=1` and `epoch=6`. The three increments after the owner-confirmed off state at epoch 3 are not owner-reconciled. This document does not infer who made them or in what order.

Owner-reported smoke, distinct from the readback above:

- After the Access repair, the owner confirmed login, the existing watchlist item, price history, and alerts off.
- Telegram `/help` passed. The receipt count supports that a message was sent; a receipt does not store the command text.
- The owner confirmed a successful enable-then-disable test. The independent read after that test was `enabled=0`, `epoch=3`.

Still open:

- A natural live price-alert delivery has not been verified.
- Phase 0 and the provider gate remain PARTIAL.
- Phase 1F-C local development was authorized separately. It is not implemented in this phase and this document does not claim a 1F-C release.
- No new Cron, secret change, or public send route was introduced by this release.

## Verification on this machine before release

- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` passed on 2026-11-28.
- Lite local D1 covers replay after an ABA cycle, a delayed observation with a stale revision, commit-path rollback, opt-out during enqueue, old-epoch requeue, refresh against delete/pause/target/newer price, concurrent import, an import that must not overwrite a price committed during the provider call, an active delivery lease, terminal-write failure, abandoned-claim reconciliation, an aborted first observation with no remaining watch row, a delete or update between the first insert and its observation, delete against a concurrent commit, and pause against a concurrent resume.
- A local two-worker harness calls `AlertDelivery` through the `TELEGRAM_ALERTS` service binding, applies the Telegram migrations to local D1, and mocks only `api.telegram.org`. Public `/deliver`, `/alerts`, and `/webhook/send` return 404. A second delivery does not send again.
- `wrangler deploy --dry-run --env production` for both Workers exited before upload. The price output names `easypws-telegram#AlertDelivery`. The production cron list is still exactly `0 22 * * *`. Wrangler 4.160.1's workerd binary only accepts compatibility dates through 2026-11-17, so the harness uses that date; the staged config date remains 2026-11-24.
- `pnpm --filter @easypws/lite run check:monitor` passed on a local database: `externalRequests 0`, `monitorUsedToday 15`. At the time of that local check, migration `0004_alert_consistency.sql` had been applied only to that local database.

## Draft-time limits (historical)

Before the 2026-11-28 production release, this phase had no production D1 migration, Worker deploy, Access change, DNS change, secret change, new Cron, or real Telegram message. The service binding was staged only. Remote D1 did not yet have `0004_alert_consistency.sql` or the Telegram lease columns. Those limits describe the draft. The production status section above is the current record. Phase 0 remains PARTIAL. The provider gate remains PARTIAL. A natural live price alert remains unverified.
