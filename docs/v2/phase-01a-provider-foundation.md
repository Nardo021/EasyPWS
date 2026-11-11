# EasyPWS V2 — Phase 1A provider foundation

**Status:** offline foundation only. Phase 0 is not PASS.

**Date:** 2026-11-11, Australia/Sydney  
**Repository:** `Nardo021/EasyPWS`  
**Branch:** `easypws-v2/phase-01a-provider-foundation`  
**Baseline:** `1c89650a2c88579e2e2053ccd308d69fd8ee0b34` on `easypws-v2/phase-00-audit`  
**Draft PR #3:** unchanged. This work is a separate draft whose base is `easypws-v2/phase-00-audit`, not `main`.

Labels that stay in force:

- `PROVIDER_GATE_PARTIAL`
- `PHASE_0_PARTIAL`

Phase 1A labels are recorded after local commands and CI. They do not replace the Phase 0 labels.

## What this phase is

Phase 1A adds an offline provider boundary beside the existing `RetailerAdapter`. Nothing in `packages/services`, the API, or the web app calls it. There is no live Omkar, API.SH, Apify, or Coles request, no D1 migration, and no production route.

Retailer and provider are different fields. A provider has `retailerId`, `providerId`, and `upstreamFamily`. Capabilities are separate booleans: product details, search, specials, bulk prices, and store lookup. A provider that lacks a capability is skipped. The skip does not spend budget.

## Quote rules

Normalization uses `classifyQuote` in `packages/adapters/src/evidence/contract.ts`.

- `retrievedAt` is the router clock. It is not freshness.
- `sourceTimestamp` is copied from the provider. Missing and invalid timestamps stay `unknown`.
- A source timestamp inside 24 hours is `current`. It becomes `fresh` only when `freshnessConfirmed` is also set.
- `cacheProvenance` stays `unknown` unless the fixture passes an explicit cache flag.
- `upstreamStoreParameterSent` is the only input for `store_parameter_forwarded`.
- `independentStorePrice` is the only input for `store_price_independently_verified`. An echoed store id, including one equal to the request, is not that input.
- A multibuy total stays on `multiBuyTotalAud`. `singleItemPriceFromOffer` is always null.
- Unknown availability fails the existing schema check and is not a quote.
- An ambiguous promotion can be returned for review. `notificationEligible` and `confirmedLiveSpecial` stay false.

A quote is notification-eligible only when all of these are true: schema valid, store price independently verified, freshness `fresh`, promotion confirmed, kind is half price or ordinary special or multibuy, and availability is available. A regular price is not a special. HTTP 200 does not skip these checks. The wrong product id and a non-AUD or missing price are `invalid_quote`.

## Router rules

`ProviderRouter` tries providers in list order. Each provider is called at most once per route.

- Unsupported capability, retailer mismatch, an open circuit, an authorization block, and an empty budget are skips. They do not call the provider.
- Authorization is remembered on that router instance. A later route does not call that provider again. It is not treated as a timeout.
- Rate limit opens the circuit immediately. There is no `Retry-After` retry.
- Timeout and upstream unavailability count toward the configured failure threshold. The clock is injected. Tests advance `ManualClock`.
- After the open interval, one probe can close the circuit.
- The first schema-valid quote stops the route. Later providers are not called.
- If every provider fails or is skipped, the outcome is `unavailable` and `quote` is null.
- Two providers with `upstreamFamily: "coles"` do not create independent store evidence. A different family does not create it either. `explicit_outside_source` is set only when the selected quote already has `store_price_independently_verified`.
- Search, specials, and bulk results keep each quote's own flags, and the collection result itself is never notification-eligible.
- Store lookup returns a store record or `unavailable`. It does not return a price.

Diagnostics use fixed reason codes. They do not include response bodies or credentials.

## Tests

`packages/adapters/src/provider/router.test.ts` covers provider fallback, total failure, unsupported search and product details, missing store, wrong product, invalid price schema, budget exhaustion, timeout, circuit open and recovery, authorization without a later retry, rate limit, ambiguous promotions, unknown freshness, shared Coles upstream, echoed store ids, and the explicit outside-source gate.

Existing evidence, Coles adapter, rules, database, and queue tests stay in place.

## Not done

- No live provider client.
- No D1 schema or provenance columns.
- No Worker, Cron, or Cloudflare remote call.
- No change to price checks, rules, or notifications. A review-only quote is not delivered anywhere.
- The Coles store price from Phase 0 is still `store_price_unverified`.
- Phase 1B is not started.

## Local commands

Node `v24.13.0`, pnpm `9.15.0`, Windows. No provider HTTP call was made.

| Order | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | 0 | Lockfile up to date. Already up to date. |
| 2 | `pnpm build` | 0 | 8 libraries, Next.js static export, API `tsc`. |
| 3 | `pnpm typecheck` | 0 | Workspace typecheck completed. |
| 4 | `pnpm test` | 0 | adapters 42 passed, rules 4 passed, database smoke ok, queue smoke ok. |
| 5 | `pnpm lint` | 0 | ESLint completed. |

### CI for `6eb8078ff8a084fb81b2268f1decc5df382b203b`

Both runs passed on Ubuntu and Windows. Each run has `install-build-test` and `fresh-typecheck-test` on `ubuntu-latest` and `windows-latest`.

| Event | Result | URL |
| --- | --- | --- |
| push | success | https://github.com/Nardo021/EasyPWS/actions/runs/43027391436 |
| pull_request | success | https://github.com/Nardo021/EasyPWS/actions/runs/43027417477 |

`PHASE_1A_LOCAL_PASS`. `PROVIDER_GATE_PARTIAL`. `PHASE_0_PARTIAL`.
