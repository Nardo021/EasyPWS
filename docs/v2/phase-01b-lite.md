# Phase 1B Lite — local Coles watchlist

**Date:** 2026-11-12, Australia/Sydney  
**Branch:** `easypws-v2/phase-01b-lite`  
**Base:** `easypws-v2/phase-01a-provider-foundation` at `e35c2d852437d2034e17ef3ecb726b763d8ccf22`

This is a local Worker and D1 app. It is not deployed. Prices are Omkar API reports for store `4166` (Coles Marrickville, NSW). They are not officially verified Coles store prices. `notificationEligible` stays false. Phase 0 stays `PHASE_0_PARTIAL` and `PROVIDER_GATE_PARTIAL`.

## Run locally

```powershell
pnpm install
pnpm --filter @easypws/web build
pnpm --filter @easypws/lite dev
```

Open `http://127.0.0.1:8787`. The worker serves the existing Next.js export and `/api/v1`. The legacy NestJS app is unchanged and still expects `BOOTSTRAP_TOKEN` when this worker is not answering.

The worker always sends `store=4166`. It does not read `COLES_STORE_ID` and does not fall back to store `584`.

Put `RAPIDAPI_KEY` or `OMKAR_API_KEY` in the gitignored repo `.env` to use the hosted API. With no key, or with `EASYPWS_OMKAR_MODE=fixture`, the page uses labeled sample data and makes no external request. There is no automatic retry and search runs only when the button is clicked.

## What was checked

| Check | Result |
| --- | --- |
| `pnpm build` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0. adapters 48 passed, rules 4 passed, database smoke ok, queue smoke ok |
| `pnpm lint` | exit 0 |
| `pnpm --filter @easypws/lite check:local` | exit 0. Import, refresh, delete, and a Worker restart kept the milk sample. `externalRequests` 0. Store `4166`. |
| Browser on `http://127.0.0.1:8787` | Fixture mode. Search, URL import, `$6.00` half-price sample, manual refresh, restart still showed the item, delete cleared it. |
| Live Omkar | 2 requests, no retries. Search `milk` returned 12 rows; first id `8150288`, reported price `4.95`. Details import for that row returned HTTP 200. Worker counter `externalRequests` 2. Mode `live`. Store `4166`. |

The browser session did not call Omkar. The two live requests were a separate local Worker process.

## Limits

No production deploy, no remote D1, no Cloudflare configuration change, no Cron, no notifications, no second retailer, and no extra provider router. The local API is open on localhost and is not an Access-protected deployment. One search page is capped at 12 rows. A missing key stays on the sample catalogue.
