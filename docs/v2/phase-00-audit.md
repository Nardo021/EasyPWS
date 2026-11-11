# EasyPWS V2 — Phase 0 baseline / Cloudflare portability audit

**Audit date:** 2026-11-11 (Australia/Sydney)  
**Baseline:** `main` at [`e476f9f5a639abe2a3401573ba883c58be124425`](https://github.com/Nardo021/EasyPWS/commit/e476f9f5a639abe2a3401573ba883c58be124425)  
**Status:** PARTIAL — STATIC_SOURCE_REVIEW_COMPLETE; BASELINE_TESTS_NOT_RUN; LIVE_PROVIDER_TESTS_NOT_RUN; CLOUDFLARE_BUILD_NOT_RUN.  
**Scope:** No functional code changes, no remote migrations, no production deployment. This document records inspected source and a proposed implementation path, **not** an acceptance of Phase 0.

## Locked user requirements

- Personal, single-user use only. No signup, subscription, billing or multi-tenancy.
- Final deployment: `https://easypws.yanze.me` on Cloudflare Workers / Pages. Prefer a single Workers Static Assets + API deployment.
- Mobile-first installable PWA: open home screen to see watched Coles items currently on special; one-tap link to retailer; price history, search/import, target-price rules.
- Coles first; Woolworths later.
- Prefer free or cheap independent providers, fail over on unhealthy/invalid response, avoid stale data presented as live.
- Candidate providers: Omkar Cloud hosted API, API.SH, Apify where actually economical, existing Coles BFF and an independently maintained compatible implementation if legally/operationally appropriate. Their reliability and quotas are **unverified**.

## Verified from repository source

| Area | Evidence path | Observation | Required action |
| --- | --- | --- | --- |
| Frontend | `apps/web/next.config.ts`; `apps/web/package.json` | Next 15 already has `output: "export"`, unoptimized images. | Test exported assets on Workers Static Assets; preserve UI logic initially. |
| HTTP server | `apps/api/src/main.ts`, `apps/api/src/app.module.ts` | NestJS Express listener, local filesystem static-serving, lifecycle startup and shutdown. | Replace Node listener with Worker `fetch` handler (thin router); decouple services from Nest runtime. |
| DB | `packages/database/src/client.ts` | Node `DatabaseSync`, local filesystem bootstrap and singleton proxy. | Add D1 binding and Drizzle D1 adapter; migrate schema using versioned SQL, never runtime filesystem initialization. |
| Persistent model | `packages/database/src/schema.ts`; `infrastructure/migrations/001_init.sql` | SQLite tables for users, retailers, stores, products, listings, price history, watchlist, rules, jobs, tokens, health. | Preserve keys/relationships, migrate to D1, ensure FK/indexes, add versioned migrations and rollback plan. |
| Scheduler | `packages/services/src/runtime.ts` | `setInterval` polls due listings and queues work. | Trigger small batches with `scheduled()`; durable cursor/lease and retries; protect against duplicate processing. |
| Work queue | `packages/services/src/queue.ts` | Queue, retry and timers are process-local arrays. | Do **not** retain as production scheduler; begin with D1-backed due-job model, add Cloudflare Queues/Workflows only if necessary. |
| Coles | `packages/adapters/src/coles/api-client.ts`, `adapter.ts` | GETs Coles BFF product/search; hardcoded default store fallback; detects some challenge responses. | Introduce retailer/store-aware provider interface; no unapproved anti-bot bypass. |
| Price / promotion | `packages/adapters/src/coles/normalizer.ts`, `packages/services/src/price-check-service.ts` | Price observations are appended only when price, stock or promotion changes; `source` is generic `adapter_api`. | Preserve all changes and add data provenance / `last_verified_at`; handle missing `was`, multibuy and stale discounts explicitly. |
| Contracts | `packages/contracts/src/adapters.ts`, `prices.ts` | `RetailerAdapter` conflates retailer with data source; no per-call store, freshness or provider identifiers. | Add provider capability/fallback boundary separate from retailer; retain compatibility adapters until tests pass. |
| Authentication | `apps/web/lib/api.ts`, `apps/api/src/auth/auth.guard.ts` | Browser persists Bearer token in localStorage; Nest guard uses token table. | Prefer one-user Cloudflare Access for website; validate Access JWT/identity on sensitive Worker endpoints as appropriate; keep any machine token separate and secret. |
| Cloudflare notes | `infrastructure/cloudflare/README.md` | Existing strategy is Cloudflare Tunnel to LXC, not Workers-native. | Supersede in V2 proposal; do not change existing docs/deployment until tested. |
| Woolworths | `packages/adapters/src/woolworths/adapter.ts` | URL parser only; functionality mostly stub. | Defer live integration until Coles Phase 1–4 gates pass. |
| Testing | `packages/adapters/src/coles/adapter.test.ts`, `packages/services/scripts/smoke-queue.mts`, `packages/database/scripts/smoke-bootstrap.mts` | Source contains a few normalizer/queue/bootstrap tests. | Run all tests and include independent D1/Worker adapter tests; do not infer CI from source. |

## Findings requiring explicit implementation decisions

1. **Store scope P0:** Coles API client defaults to `COLES_STORE_ID` or a fixed ID; Omkar's published Specials example defaults to store `584` in Victoria. Never accept cross-store quote without matching configured NSW store ID.
2. **Provider independence P0:** Omkar hosted, Omkar self-hosted and native Coles BFF may share the same upstream. Track `provider_id`, `upstream_family` and `transport`; provider count is not fault-domain count.
3. **Specials semantics P0:** `is_on_special` need not imply `was_price` exists. Multibuy prices require minimum quantity and must not be displayed as single-item discount. Do not compute invented percentage savings.
4. **Freshness P0:** Historic cached data is useful but not evidence of current promotions. Model `observed_at`, `fetched_at`, `verified_at`, `expires_at`, `store_id` and `source`; show STALE / UNKNOWN distinctly.
5. **Durable jobs P0:** Process-local retries can vanish on restart. Cron batches must commit progress and retry idempotently, with bounded per-invocation work.
6. **Data migration P0:** D1 uses SQL-compatible semantics but not Node's filesystem `node:sqlite`. Need explicit migration / forward-only deploy validation, not `ensureSchema()` at runtime.
7. **Input trust P1:** URL parsing should require exactly `coles.com.au` or a proper `.coles.com.au` subdomain, not `hostname.endsWith("coles.com.au")` alone.
8. **Single-user auth P0:** Access must be configured for allowed identity. Do not expose unprotected internal refresh / admin endpoints or provider tokens in client assets.
9. **Observability P1:** record provider latency, outcome/error class, quota consumption, row counts, and consecutive failures without dumping personal data or secrets.
10. **Security/compliance gate:** assess retailer website terms and provider license/terms before connecting live. No captcha/proxy/anti-bot circumvention implementation as part of this phase.

## Recommended Cloudflare target (proposed, not implemented)

```text
https://easypws.yanze.me
  -> Cloudflare Access (personal identity)
  -> Worker: static frontend assets + /api/v1/*
        |-- D1: products, retailer listings, watchlist, observations,
        |        provider health, snapshots, durable jobs
        |-- ProviderRouter: Omkar Hosted / API.SH / others (after verification)
        +-- Worker scheduled(): bounded due-job processing
```

- Prefer the existing static-export-capable Next.js output, or simplify to a static React SPA only if tests indicate it is necessary.
- Preserve pure TypeScript rules and parsers. Isolate Node-specific modules from Worker bundles.
- Drizzle can target D1 via its D1 driver; create an injectable database abstraction rather than changing all service APIs blindly.
- Access is for browser sessions; scheduled work should use the Worker scheduled event, **not** a public HTTP endpoint. Provider secrets remain Worker secrets.
- **No Python server inside ordinary Workers:** Omkar's open-source package uses Python Bottle + Cheroot + `curl_cffi`. Hosted HTTPS API can be called from Workers. Self-hosting requires a compatible runtime external to ordinary Workers (or a separately assessed reimplementation).
- Assess free account limits (CPU, subrequests, D1 reads/writes and cron), including future quota changes, before a production claim.

## Remaining Phase 0 acceptance criteria

- [x] Read source baseline / file-level portability review.
- [x] Record target deployment and data provenance requirements.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` with log/exit-code evidence.
- [ ] Verify local static export and a minimal Cloudflare Worker + D1 prototype (without live deployment or modifying main).
- [ ] Execute provider probes with selected store, bounded request budget, real HTTP result codes and 20 sample SKUs; compare normalized output and prices.
- [ ] Check exact free quotas / request-cost for Omkar hosted, API.SH and Apify. Don't guess.
- [ ] Draft D1 migration plan with idempotence, data portability, rollback strategy and old-data backup.
- [ ] Define authorization, date/store freshness semantics, retry and failure handling tests.
- [ ] Present evidence matrix, blockers and release gates. Phase 0 becomes PASS only after local+provider evidence is reviewed.

## Reference documentation

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Omkar Coles Scraper source](https://github.com/omkarcloud/coles-scraper)
- [Omkar Specials schema / store parameter](https://www.omkar.cloud/tools/coles-scraper/specials)
