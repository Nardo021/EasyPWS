# EasyPWS V2 — Phase 1F-B owner-only Telegram price alerts

**Status:** SOURCE_DRAFTED / NOT_DEPLOYED  
**Date:** 2026-11-28 (Australia/Sydney)  
**Base:** `main` `90a6e23487a6f9683c4acc90bda88bd65d419f70`  
**Branch:** `easypws-v2/phase-01f-b-telegram-alerts`

## What this phase does

A price drop is committed with its observation and one outbox row in a single D1 batch. The transition id is that observation, so 5 → 3 → 5 → 3 can notify twice, while replaying the same observation cannot. A drop that also crosses the target becomes one notification. Delivery stays off until the owner opts in, and opt-in does not send older rows. Opt-out suppresses queued rows and keeps the audit rows.

The price Worker calls the Telegram Worker's private `AlertDelivery` RPC. It does not receive the bot token, choose a chat, or open a public send route. The Telegram database claims the transition id before `sendMessage`. A confirmed send, a definite failure, a timeout, and a lost response are stored separately. Unknown and failed claims are not retried. This is not exactly-once delivery.

Fixture reports, invalid quotes, the first price, unchanged or rising prices, and paused or removed items do not enter the outbox. The existing production Cron remains `0 22 * * *`. The daily budget remains 15 recorded attempts. No Omkar request was added.

## Verification on this machine

- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` passed.
- `pnpm test` includes Telegram 33 tests and the lite local-D1 suite (atomicity, repeated cycles, stale target, same-timestamp race, opt-in backlog, ledger replay). The lite test resolves workspace packages from source, so it also runs in the CI job that does not build first.
- `pnpm --filter @easypws/lite run check:monitor` passed: `externalRequests 0`, `monitorUsedToday 15`.
- Browser check on fixture `http://127.0.0.1:8790`: default off, acknowledgement required, opt-in, opt-out, and search still returned the local milk sample. Health stayed `fixture` with `externalRequests 0`.

## Not done

No production D1 migration, Worker deploy, Access change, DNS change, secret change, new Cron, or real Telegram message. The service binding is staged in the price Worker's production Wrangler config and is not applied until a later deploy. Phase 1F-C is out of scope. Phase 0 remains PARTIAL. Provider gate remains PARTIAL.
