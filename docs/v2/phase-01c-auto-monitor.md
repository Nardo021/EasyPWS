# Phase 1C — local automatic price checks

**Date:** 2026-11-12, Australia/Sydney  
**Branch:** `easypws-v2/phase-01c-auto-monitor`  
**Base:** `easypws-v2/phase-01b-lite` at `154ee18cab38221392979d2624f0033177397107`

The Lite Worker has a `scheduled()` handler. It checks active watchlist rows, oldest attempt first, through the existing Omkar details client at store `4166`. The automatic budget is 15 calls per Australia/Sydney day. A failed or unpriced response does not replace the last valid price. Price drops and target crossings are stored once in D1. Nothing is pushed, and `notificationEligible` stays false.

`wrangler.jsonc` has no `triggers.crons`. Local checks use `wrangler dev --test-scheduled` and `/cdn-cgi/local/scheduled`. That route is not an application endpoint, and this phase does not deploy it.

```powershell
pnpm --filter @easypws/lite check:monitor
```

Local fixture run on 2026-11-12: `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` exited 0. Adapter tests 48 passed and rules tests 4 passed. `check:monitor` refreshed the oldest active item, stored one price-drop event and one target-crossing event, ignored the second run, stopped at 15 attempts, and left failed or unpriced rows unchanged. `externalRequests` stayed 0. No live Omkar call was made. `check:local` still persisted the milk sample at store `4166`.
