# EasyPWS V2 — Phase 1F-A Telegram private webhook foundation

**Status:** CODE_ONLY / CI_PENDING / NOT_DEPLOYED  
**Date:** 2026-11-24 (Australia/Sydney)  
**Source branch:** `easypws-v2/phase-01f-a-telegram-foundation`, based on `main` `bed46f4571ee331ce11fb8101f0d1d4bd41e8cc6`.

## Purpose and current limits

Add a narrowly scoped **single-owner Telegram webhook** without weakening the existing `easypws` Worker's Cloudflare Access. This phase implements **only** `/start`, `/help`, strict authentication and D1-based webhook update deduplication. **No price search, watchlist read, Omkar API use, monitoring change, notification sending, or live Telegram integration yet.**

`apps/telegram` is a separate Cloudflare Worker project (proposed production name `easypws-telegram`). It has no service binding to `easypws`, no shared price D1 credentials and no Omkar API key. An independent, tiny D1 is used solely for webhook receipt IDs and state.

## Security properties of source implementation

1. Only **POST `/webhook`** is routed, any other endpoint returns 404. The Worker must be **fully configured** before it accepts requests; otherwise returns 503.
2. Telegram `X-Telegram-Bot-Api-Secret-Token` is required, syntax checked and constant-work compared to the configured high-entropy 32–256-character secret. A missing/incorrect secret yields 403 before any D1 access.
3. Only a Telegram message from the exactly configured numeric `TELEGRAM_OWNER_USER_ID` to the exactly configured numeric `TELEGRAM_OWNER_CHAT_ID`, with `chat.type=private`, is processed. Never authorize by username or display name; group/channel/wrong-owner updates are silently acknowledged without actions.
4. Body is bounded to 8 KiB; malformed JSON, invalid content-type and unsupported HTTP methods cannot reach the sender.
5. An independent D1 `telegram_update_receipts` table uses `update_id INTEGER PRIMARY KEY` and `INSERT OR IGNORE`. This atomically **claims** an update before sending a reply, eliminating a duplicate webhook send in ordinary duplicate-delivery races.
6. Telegram `sendMessage` uses HTTPS, JSON, a 5-second timeout and checks both HTTP status and response `ok:true`. No unsafe HTML parsing; messages are fixed responses for `/start`, `/help`, unsupported command notice.
7. A failed/ambiguous Telegram delivery is recorded as `failed` and **is not automatically retried**. This is an *at-most-one-send-attempt* policy, not exactly-once delivery. A Worker crash after claiming an update could leave it `claimed`, pending manual reconciliation in a later phase.
8. No API credentials, message bodies, user identifiers or secrets are written to D1 or diagnostics. Storage contains `update_id`, status and timestamps only.

## Code and CI

- `apps/telegram/src/index.ts` — small, dependency-injectable Worker handler.
- `apps/telegram/src/index.test.ts` — 14 offline Node tests (valid owner, invalid secret, spoofed user/chat, group, duplicate update, failure and config fail-closed).
- `apps/telegram/migrations/0001_webhook_receipts.sql` — isolated tiny D1 schema, **not applied to production yet**.
- `apps/telegram/wrangler.jsonc` — deliberately **local-only**, disabled workers.dev/preview with a local-placeholder D1 ID. There is **no production environment, custom domain or public webhook yet**.
- `scripts/workspace.mjs` and `pnpm-lock.yaml` — register the app in full CI typechecking and testing, with existing dependency versions.

CI acceptance is required on Ubuntu **and** Windows: fresh install with frozen lockfile, build, typecheck, all tests and lint. Never label production connectivity PASS from these offline tests.

## Owner-controlled Telegram setup before live deployment

**Do not paste the BotFather token, webhook secret, authentication cookies or API keys into chat, GitHub, Notion, logs or command output.**

1. The owner creates a private-purpose Bot using **[@BotFather](https://t.me/BotFather)** with `/newbot`. Keep the generated Bot Token private.
2. Owner sends a message to the new Bot and obtains their numeric Telegram `from.id` **and** the private `chat.id` using the official [Bot API getUpdates](https://core.telegram.org/bots/api#getupdates) through a secure local process **before** installing any webhook. Check both IDs, do not use an @username as an identity.
3. Create a separate Cloudflare D1 `easypws-telegram` and apply only this app's `0001_webhook_receipts.sql` to that new DB. Never migrate or overwrite the existing price DB.
4. Add a separate `env.production` to the Telegram Wrangler config with the actual new D1 UUID, service name `easypws-telegram`, no Cron and no `easypws` service binding. Disable preview URLs, and use a **dedicated public webhook hostname** with no wildcard Access bypass. First confirm the selected hostname doesn't weaken the current owner's protected EasyPWS application.
5. Store `TELEGRAM_BOT_TOKEN`, a separate uniformly generated high-entropy `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_USER_ID` and `TELEGRAM_OWNER_CHAT_ID` as **Cloudflare encrypted secrets**. Do not commit them or add them as plain-text Wrangler vars.
6. After verifying the newly deployed Worker and denial tests, register `setWebhook` using the official Telegram Bot API: `url=https://<dedicated-host>/webhook`, `secret_token=<separate-secret>`, `allowed_updates=["message"]`, and `drop_pending_updates=false`. Prefer the minimum `max_connections` supported by Telegram. Do not let the bot run if authorization settings are missing.
7. Owner tests only their real `/start`, `/help`; ensure missing secret, nonowner ID, wrong chat and group messages cannot send or read data; confirm duplicate `update_id` has one receipt and one send attempt. Record sanitized evidence only.
8. **Explicit owner approval required before Phase 1F-B/1F-C** enabled price delivery, shared D1 binding or Omkar access.

## Explicitly not authorized by this phase

- No public access to the existing `easypws` Worker or its price D1.
- No price notification, search, provider request, extra Cron, D1 production migration or new Worker deployment without the necessary Bot credentials and activation gates.
- No Telegram bot token in any shared document. No fictitious user IDs, chats, bot names or webhook credentials.
- Current EasyPWS `PRIVATE_DEPLOYED` / `AUTO_MONITOR_VERIFIED` (first run) / `PHASE_0_PARTIAL` / `PROVIDER_GATE_PARTIAL` are unchanged.

**Next gate:** GitHub Draft PR CI, then owner's BotFather setup and separate D1 + Webhook deployment after secure configuration. The bot is not live as a result of this source-only phase.
