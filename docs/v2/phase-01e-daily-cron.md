# EasyPWS V2 — Phase 1E-B production daily checks

**Started:** 2026-11-23, Australia/Sydney  
**Base:** `main` at `f34e512181f480a66872931b137b132c26ed5e9e`  
**Scope:** activate exactly one daily Cron for the existing private `easypws` Worker. This does **not** enable notifications, change Access/DNS, or add any service.

## One daily schedule

- Wrangler `env.production.triggers.crons = ["0 22 * * *"]` (UTC).
- 22:00 UTC corresponds to **09:00 AEDT** or **08:00 AEST**, preserving one run per Sydney calendar day through daylight saving changes.
- The existing `scheduled()` calls `runMonitor()`, selects only `monitoring_status='active'`, and has a **15 recorded-attempts / Australia/Sydney day budget**. It runs sequentially, does not explicitly retry external Omkar calls, retains prior valid price on an invalid result, and writes price-change or target-crossing events to D1. No notifications are sent; quotes remain third-party API-reported and `notificationEligible=false`.
- **Known limitation:** `monitor_attempts` are written *after* Omkar requests. The 15-attempt budget is therefore a cap for ordinary non-overlapping runs, **not an atomic global guarantee** during overlapping invocations, crashes, or unrecorded requests. Use only this one daily Cron; assess a minimal pre-request reservation before ever introducing additional schedules or manual scheduled triggers.
- The provider's *current* free quota/remaining balance has not been independently established. At full usage, 15 requests × 31 days = 465 potential scheduled details requests/month **plus** manual search, import and refresh. Budget remaining must not be inferred from historic headers.

## Verified starting snapshot

- Existing owner-only `easypws.yanze.me` private Worker is deployed with Static Assets, D1 and `OMKAR_API_KEY`.
- Cloudflare Cron `schedules: []` before activation.
- Remote D1 returned **zero watched products** and **zero monitor attempts** on 2026-11-23. This means that a Cron invocation will currently make **zero Omkar requests** and no `monitor_attempts` rows. This is expected, not proof that the handler failed.
- Do not synthesize or insert a watched product in production solely to make the counter move. Owner can add a genuine item in the UI when desired.

## Activation and acceptance gate

1. Verify GitHub PR CI and merge the exact schedule configuration into `main`; no other application logic changes required.
2. Through the Cloudflare Worker schedules API, set one and only one `0 22 * * *` trigger on existing Worker `easypws`. Verify readback `schedules: [{cron: "0 22 * * *"}]`, the deployed Worker version stays unchanged and Access/custom domain/secret bindings remain.
3. Allow for Cloudflare propagation (up to 15 minutes). Do **not** claim a run occurred merely because the schedule was saved. Check scheduled invocation telemetry after the next scheduled time.
4. Once the owner adds an actual active watchlist item, verify a production `monitor_attempts` row and expected outcome, with bounded Omkar calls. If there are no active items, preserve status `CRON_CONFIGURED / LIVE_CHECK_PENDING` instead of claiming full automatic-monitor acceptance.
5. To disable the trigger, set the schedules API to `[]` and change Wrangler `env.production.triggers.crons` back to `[]` in source to prevent an accidental reactivation on redeploy.

**Out of scope:** push/email notifications, a separate scheduling service, new providers, data migrations, Git branch cleanup, changing production login or public routes.

## Remote activation evidence — 2026-11-23

**Status: `CRON_CONFIGURED / LIVE_CHECK_PENDING`.** Owner authorized Phase 1E-B by requesting the next step. [PR #8](https://github.com/Nardo021/EasyPWS/pull/8) was merged on `main` at `9ad9fdf3d75fe0c60da06d0d895a986a3300b8e2` after both Push CI and PR CI succeeded. The merge commit also passed [`main` Push CI #45167271907](https://github.com/Nardo021/EasyPWS/actions/runs/45167271907), all four Ubuntu/Windows jobs success.

Cloudflare API **PUT** to the existing `easypws` Worker schedules configured exactly one `0 22 * * *` cron. Immediate GET confirmed it was saved with created_on `2026-11-23T11:42:33.288865Z`. Existing production Worker deployed version `91774a55-591b-4375-951f-aa4daf6e5560` was unchanged; `workers.dev` and previews remained disabled; owner-only Access and custom domain were intact before activation. No new worker deployment, migration, new secret, watchlist modification, manual Omkar request, push notification or new provider.

The actual D1 watchlist contained **zero rows**, so **no production scheduled Omkar call has been executed or verified** yet. The configured schedule alone is not proof of automatic price collection. After propagation and the next scheduled invocation, inspect Worker scheduled metrics; once the owner adds a genuine active watched product, verify a bounded `monitor_attempts` write, its outcome and last valid price preservation. Historical `PHASE_0_PARTIAL / PROVIDER_GATE_PARTIAL` remain unchanged.
