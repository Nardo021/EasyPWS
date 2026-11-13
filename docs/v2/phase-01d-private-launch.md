# Phase 1D — private launch preparation

**Date:** 2026-11-13, Australia/Sydney  
**Branch:** `easypws-v2/phase-01d-private-launch`  
**Base:** `easypws-v2/phase-01c-auto-monitor` at `7265e45393bd206b865cb3e33c8392196e0fa27c`  
**Status:** `LOCAL_READY` / `DEPLOYMENT_PENDING_APPROVAL`

No remote Worker, D1, DNS, Access, or Cron change was made. `PRIVATE_DEPLOYED` is not claimed. Phase 0 remains `PHASE_0_PARTIAL` / `PROVIDER_GATE_PARTIAL`.

## Read-only Cloudflare check

Account `Leo`. Zone `yanze.me` is active. No Worker or D1 is named EasyPWS. Existing Workers and databases were left untouched.

`easypws.yanze.me` already has a proxied CNAME to the healthy Cloudflare Tunnel named `Home` (`908698ab-2099-4b45-a47a-af1c5329da4b`). Attaching a Worker custom domain would replace that hostname. That step is blocked until the owner explicitly approves the DNS change.

## Prepared configuration

`apps/lite/wrangler.jsonc` keeps the local Worker unchanged. The `production` environment is named `easypws`, disables `workers.dev` and preview URLs, sets `EASYPWS_RUNTIME=production`, and requires the `OMKAR_API_KEY` secret. Its D1 binding name is `easypws`, but the database id is a placeholder and does not exist. There is no route and no cron.

Local development still uses fixture mode. In production, a missing key or `EASYPWS_OMKAR_MODE=fixture` returns HTTP 503 and does not serve sample prices. Requests without a Cloudflare Access email return HTTP 401, including static files and `/api/*`. The production session reports `mode: "private"` and the Access email.

## Deployment plan, after explicit approval

1. Confirm that `easypws.yanze.me` may leave the Home tunnel.
2. Run `wrangler d1 create easypws` and replace the placeholder database id. Do not import local fixture rows.
3. Apply `apps/lite/migrations` to that remote database only.
4. Set the `OMKAR_API_KEY` secret on the `production` environment. Do not put it in wrangler vars or the browser bundle.
5. Deploy `easypws` with `workers.dev` and preview URLs off, and with no public route yet.
6. Create Worker-wide Access for all traffic, allowing only the owner. Confirm a signed-out request cannot read `/` or `/api/*`.
7. Only then add the custom domain. There is still no alternate public hostname.
8. Cron stays off. A later activation can add one daily schedule; the existing handler already stops at 15 Sydney-day calls and does not send notifications.

## Local check

```powershell
pnpm --filter @easypws/lite check:production
```
