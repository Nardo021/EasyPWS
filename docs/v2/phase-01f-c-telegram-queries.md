# EasyPWS V2 — Phase 1F-C owner-only Telegram read-only queries

**Status:** LOCAL_SOURCE / NOT_DEPLOYED  
**Date:** 2026-11-28 (Australia/Sydney)  
**Baseline main:** `7e0b15e9006111a01ad5d370fedf2c413100816d`  
**Branch:** `easypws-v2/phase-01f-c-telegram-queries`

## What this phase does

The owner can ask the existing private Telegram webhook for a read-only price or watchlist reply. The commands are `/search`, `/price`, `/watchlist`, `/history`, and `/deals`. `/start` and `/help` list them in Chinese and say that a query does not change the watchlist, a target price, or alert consent.

Search accepts 2–80 characters and shows at most five results. Price and history accept one numeric SKU. Watchlist, history, and deals show at most eight stored rows. Replies use AUD, the SKU, store 4166, a Sydney retrieval time, the source label, and a canonical `https://www.coles.com.au/product/<sku>` link when the SKU is numeric. Prices are described as third-party API reports, not independently verified Coles prices.

Telegram calls a named private `PriceQuery` entrypoint on the price Worker through the `PRICE_QUERY` service binding. The price Worker still calls `AlertDelivery` through `TELEGRAM_ALERTS`. There is no public query route. Telegram does not receive the Omkar key and does not bind the price database. The price Worker does not receive the bot token.

An update is claimed before the query RPC. Each claimed update gets one reply attempt. The request key is the SHA-256 of `easypws-query:<operation>:<update id>`. The raw private message and the owner id are not stored in the price database.

## Quota and cache

Search and price reuse `searchReported`, `detailsReported`, and the existing `provider_calls` ledger. The store is fixed at 4166. An uncached query makes one outbound request and does not retry. A cache hit makes none.

The Telegram allowance is five uncached attempts per Australia/Sydney day. The reservation is one conditional insert: the row is written only when that request key is new and the day still has fewer than five rows. `changes = 1` reserves the attempt. `changes = 0` with an existing key is a replay and does not call the provider or present an old cache as a new price. `changes = 0` without a row means the day is exhausted. Any other `changes` value is ambiguous and also does not call the provider. Failed and rejected live attempts stay reserved. The same key on a later Sydney day is still a replay.

A successful validated live response is cached for 10 minutes. The cache stores at most 32 rows and drops payloads older than 10 minutes. Expired cache is not shown as a current price. If the daily allowance is exhausted, an expired entry is reported as stale and the old amount is omitted. Fixture mode and a quote for a store other than 4166 are rejected and are not cached.

This allowance is not a global provider quota. The automatic monitor still records at most 15 attempts per Sydney day. Web manual requests are unchanged and do not use this reservation table.

## Stored queries

`/watchlist`, `/history`, and `/deals` read the price database and do not call the provider or write business rows. History is only for a SKU already watched at store 4166. Deals are rows whose stored current price and regular price are both present and whose current price is lower. That is a recorded discount, not an official Coles special.

## What this phase does not do

Production is unchanged. This branch does not deploy either Worker, apply migration `0005_telegram_queries.sql` to production D1, change Access, DNS, Cron, or secrets, enable or disable alert consent, call Omkar, or send a Telegram message. Phase 1F-D is not included. Issue #10 stays open.

Phase 0 and the provider gate remain PARTIAL. A natural Phase 1F-B price-alert delivery remains unverified. The preference read `enabled=1`, `epoch=6` at 2026-11-28T10:26:13.120Z stays unreconciled.

## Verification in this session

Observed on 2026-11-28, Australia/Sydney, before the draft pull request:

- `pnpm install --frozen-lockfile` completed with the lockfile unchanged.
- `pnpm build`, `pnpm typecheck`, and `pnpm test` passed. Adapter tests: 48. Rules tests: 4. Telegram tests: 35. Lite tests: 17, including the local D1 quota/cache test and the two-worker RPC test. Database and services smokes passed.
- The first `pnpm lint` failed on one unused initializer. After that initializer was removed, `pnpm lint` passed with no problems. The full test command was not repeated after that one-line change.
- `pnpm --filter @easypws/lite run check:monitor` passed: `externalRequests 0`, `monitorUsedToday 15`. Migration `0005_telegram_queries.sql` was applied only to that local smoke database.
- `wrangler deploy --dry-run --env production --keep-vars` for the price Worker printed `easypws-telegram#AlertDelivery` and `--dry-run: exiting now`. The Telegram dry-run printed `easypws#PriceQuery` and the same exit line. Neither printed `Current Version ID`. Wrangler was 4.160.1.
- Omkar and Telegram transports were mocked. No production D1 migration, deploy, Access change, or real provider call was made.

The two-worker harness configures both service bindings and proves Telegram `POST /webhook` → `PriceQuery`, then the price Worker's scheduled handler → `AlertDelivery`. The scheduled path is the production caller. Calling `getEnv().TELEGRAM_ALERTS.deliver()` from the Node test process reads the outbound response for about five seconds and stores `unknown`; this draft does not replace that path with a public route. The existing bridge-worker test still proves `AlertDelivery` returns `sent`.
