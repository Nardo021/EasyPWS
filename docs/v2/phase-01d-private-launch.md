# Phase 1D — private launch preparation

**Date:** 2026-11-13, Australia/Sydney  
**Branch:** `easypws-v2/phase-01d-private-launch`  
**Base:** `easypws-v2/phase-01c-auto-monitor` at `7265e45393bd206b865cb3e33c8392196e0fa27c`  
**Status:** `LOCAL_READY` / `DEPLOYMENT_PENDING_APPROVAL`

No remote Worker, D1, DNS, Access, or Cron change was made. `PRIVATE_DEPLOYED` is not claimed. Phase 0 remains `PHASE_0_PARTIAL` / `PROVIDER_GATE_PARTIAL`.

## Deployment continuation — 2026-11-17

**Current status: `APP_DEPLOYED / OWNER_SESSION_BLOCKED`. This is not `PRIVATE_DEPLOYED`.** The real Worker is uploaded. Signed-out Access checks passed. The owner browser session is not complete, so `easypws.yanze.me` still points at the Home tunnel.

- Confirmed `wrangler d1 migrations list DB --env production --remote`: no pending migrations. SQL was not applied again.
- Production auth validates the Access JWT. A forged email header or invalid token does not authorize.
- Secret `OMKAR_API_KEY` is present on Worker `easypws`. Its value was not printed.
- Deployed version `91774a55-591b-4375-951f-aa4daf6e5560`: static assets, D1 `easypws`, `EASYPWS_RUNTIME=production`, no routes, no Cron, preview URLs off.
- Temporary `workers.dev` hostname is enabled only for the Access test. Signed-out `/`, `/api/v1/health`, `/api/v1/auth/me`, and search return HTTP 302 to Cloudflare Access, including a forged email header and fake JWT. No application data was returned. Live Omkar calls: 0.
- Owner login is waiting on Cloudflare Access (one-time PIN or Authentik). DNS cutover stays blocked until that session can search, save, import, and refresh.

## Deployment continuation — 2026-11-16 (verified remote state)

**Current status: `REMOTE_D1_MIGRATED / APP_NOT_DEPLOYED`. This supersedes the older preparation-only snapshot below. The owner approved the private infrastructure and DNS cutover only after successful security verification.**

- Created remote D1 `easypws`: `cf8c92cf-939f-4535-b47b-95e687a8a99a`.
- Applied the exact existing `0001_watch.sql` and `0002_monitor.sql` to **remote** D1 through the Cloudflare D1 API (not through the local Wrangler CLI). Created Wrangler-compatible `d1_migrations` tracking records for both files. Verified all six business/migration tables and `last_attempt_at`; watchlist and alerts are empty.
- Created Worker `easypws` with only a **503 placeholder**, no static assets, no public routes, `workers.dev` disabled and preview URLs disabled.
- Created Worker-wide `EasyPWS Private Worker` Access application, allowing only the owner. **Remote browser and request authentication are not yet verified.**
- Existing `easypws.yanze.me` DNS still points to the Home tunnel. **Do not replace it yet.** No remote Cron, notification, or Omkar API use.
- CI for previous configuration commit `28188bda073ca88c2e93804db91ffce7876adea5`: both push and PR workflows succeeded.

### Authentication boundary — 2026-11-17

Production no longer accepts `Cf-Access-Authenticated-User-Email` by itself. With Static Assets, `ctx.access` is not passed to the user Worker, so the Worker validates `Cf-Access-Jwt-Assertion` (or the `CF_Authorization` cookie) for issuer `https://leo728.cloudflareaccess.com`, audience `e4b280e1e4796c7a896a29737dd5817f26ba6128f9dccac0c9744dffa72ad3f9`, RS256 signature, expiry, and the owner email. A forged header, `alg: none`, or a token signed by another key returns HTTP 401 and no fixture price. `wrangler d1 migrations list DB --env production --remote` reported no pending migrations; the SQL was not applied again.

### Remaining required actions (use the developer's local checkout and secure credential input)

1. First run `pnpm --filter @easypws/lite exec wrangler d1 migrations list DB --env production --remote` and confirm **no pending migrations**. The remote D1 migration records have already been inserted; **do not reapply the SQL manually**.
2. Resolve the header-only production authentication check: a user-supplied `Cf-Access-Authenticated-User-Email` header is not independent proof of Access authorization. Prefer validated Access JWT claims for this static-assets Worker (Cloudflare documents that `ctx.access` can be unavailable with Static Assets). Verify a forged email header and invalid/missing JWT cannot authorize any page or API. Keep the existing Worker-wide Access policy.
3. From this branch, build Next.js static assets and use the project's Wrangler. Securely provision `OMKAR_API_KEY` for the **production** environment before full deployment; never commit or print its value. `secrets.required` makes Wrangler reject a deploy without it. The remote Worker is currently the harmless 503 placeholder; a secret update may deploy a new version, but there is still no public route.
4. Deploy the actual `easypws` Worker with Workers Static Assets and remote D1, keeping `workers_dev=false`, preview URLs off, routes/domains unset and Cron disabled. Confirm the new Worker has assets and `DB` binding; do not treat the existing 503 stub as the real application.
5. After checking the Worker-wide Access configuration, use a **temporary Access-protected** hostname only for a tightly bounded authorized/signed-out verification if necessary. Verify signed-out webpage/API denied; authorized session works; remote D1 persists Watchlist, and at most two real Omkar calls succeed for store 4166. Disable the temporary hostname afterwards unless it is deliberately protected.
6. **Only after all checks pass**, replace the existing Home-tunnel DNS record for `easypws.yanze.me` with the Worker custom domain. Preserve the tunnel and all other hostnames. Verify old DNS target is gone and final hostname is protected.
7. Leave remote Cron, push, PR merges and unrelated projects untouched. Keep `PHASE_0_PARTIAL` and `PROVIDER_GATE_PARTIAL` until independently resolved.

## Read-only Cloudflare check (2026-11-13 historical snapshot)

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
