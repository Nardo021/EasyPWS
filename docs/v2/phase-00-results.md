# EasyPWS V2 — Phase 0 results

**Verdict: PARTIAL.** Phase 0 is not PASS. The acceptance gate still requires a verified NSW store, 20 real SKUs, and at least one provider quote whose store id is proven. Those items are unmet.

**Date:** 2026-11-11, Australia/Sydney  
**Repository:** `Nardo021/EasyPWS`  
**Branch:** `easypws-v2/phase-00-audit`  
**Baseline SHA:** `e476f9f5a639abe2a3401573ba883c58be124425`  
**Branch tip before this report:** `6bf9a8ae7525bf7843a0f0dec4ada74d0bfbcd84`  
**Environment:** Windows, Node `v24.13.0`, pnpm `9.15.0` (matches `packageManager`), Python `3.13.15` present but not used to run a scraper. Corrective A adds `.github/workflows/ci.yml`. No production deploy, no remote D1 database, no merge.

Labels used below:

- **Fact** — source or vendor documentation read in this session.
- **Measured** — a command or HTTP call executed in this session.
- **Proposal** — design that was not implemented.

## Acceptance checklist

| Gate | Result |
| --- | --- |
| Source portability review | Met earlier on this branch; rechecked against the same baseline. |
| `pnpm install`, `lint`, `typecheck`, `test`, `build` with exit codes | Original Windows run failed. Corrective A passed these commands on a clean worktree, including typecheck and test before any `dist` existed. See Corrective A. Lint is ESLint, not an echo. |
| Local static export and a local Worker + D1 prototype | Met. Next.js exported 21 files. Wrangler `4.160.0` ran the prototype locally only. |
| One verified NSW store and 20 real SKUs | Not met. HTML store pages were an Incapsula challenge. One real product id was returned. The payload does not echo a store id. |
| At least one fresh, store-proven provider quote | Not met. Coles BFF product details returned one priced product. Store scoping was not proven. |
| Published quotas, without guessing account usage | Met for published pages. Account meters were not visible because no provider key was present. |
| D1 migration, freshness, auth, and retry design | Met as a proposal in this file. Not implemented. |

## Task A — baseline commands

`pnpm install --frozen-lockfile` was run on a tree with no `node_modules`.

| Command | Exit | What was measured |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | 242 packages added in 12.8s. pnpm reported ignored build scripts for `@nestjs/core`, `better-sqlite3`, `esbuild`, and `sharp`. |
| `pnpm lint` | 0 | Not lint coverage. Every package script is `echo "lint placeholder"`. Scope was 10 of 11 workspace projects. No ESLint config file exists. |
| `pnpm typecheck` | 2 | Stopped on `@easypws/notifications`: `tsc` exit 2, cannot find `@easypws/contracts` or `@easypws/core`. Those packages export `./dist`, and `dist` did not exist yet. |
| `pnpm test` | 1 | `@easypws/adapters` vitest loaded 0 tests and failed to resolve `@easypws/core`. The root script uses `&&`, so rules, database, and services were not started by this command. |
| `pnpm build` | 2 | The package filter matched nothing, then Next.js built, then `@easypws/api` `tsc` exited 2 because workspace `dist` types were missing. |

**Measured cause of the skip:** `package.json` runs `pnpm -r --filter './packages/**' run build`. Windows `cmd.exe` does not treat single quotes as quotes, so pnpm receives the quote characters as part of the filter. Reproduced with `cmd /c "pnpm --filter './packages/**' list --depth -1"`, which printed `No projects matched the filters` and exited 0. Because that exit is 0, `&&` continues. From PowerShell, `pnpm --filter "./packages/**" list --depth -1` lists all eight library packages.

**Measured Next.js export, from the official `pnpm build` before the API compile failed:** Next.js `15.5.22`, compiled, exported 4 static routes (`/` and `/_not-found` plus the shared generation count reported as 4 pages). `apps/web/next.config.ts` sets `output: "export"`. After that run, `apps/web/out` contained 21 files. `apps/web/out/index.html` was 6,254 bytes.

**Measured follow-up, not a rerun of the failing official build script.** `pnpm --filter "./packages/**" run build` exited 0 and compiled contracts, observability, core, database, adapters, rules, notifications, and services. After those `dist` folders existed:

| Follow-up command | Exit | Result |
| --- | --- | --- |
| `pnpm typecheck` | 0 | All 10 package typecheck scripts completed. |
| `pnpm test` | 0 | Adapters vitest 5 passed. Rules vitest 4 passed. Database smoke printed `sqlite bootstrap smoke ok` and Node printed `ExperimentalWarning: SQLite is an experimental feature`. Services smoke printed `in-process queue smoke ok`. |
| `pnpm --filter @easypws/api build` | 0 | `tsc` completed. |

The clean official `pnpm typecheck`, `pnpm test`, and `pnpm build` results remain the failing exits in the first table. The follow-up shows the TypeScript sources typecheck once the Windows filter actually builds packages. The earlier per-package typecheck errors in `bootstrap.ts` were cascades from missing `@easypws/core` types; they were gone after the package build.

Separate runs while `dist` was still missing, because the root test script had stopped early:

| Command | Exit |
| --- | --- |
| `pnpm --filter @easypws/rules test` | 1, vitest failed to resolve `@easypws/core`, 0 tests |
| `pnpm --filter @easypws/database test` | 1, `ERR_MODULE_NOT_FOUND` for `@easypws/core/dist/index.js` |
| `pnpm --filter @easypws/services test` | 0, `in-process queue smoke ok` |

No CI run exists to compare with. There is no `.github` workflow.

## Task B — Cloudflare compatibility

### Runtime inventory

**Fact, from source at the baseline:**

| Current piece | Where | Worker constraint |
| --- | --- | --- |
| NestJS Express listener, filesystem static files, `process.exit` | `apps/api/src/main.ts` | Replace with a module `fetch` handler. Static files come from Workers assets, not `node:fs` path guesses. |
| `DatabaseSync` from `node:sqlite`, `mkdirSync` / `readFileSync`, runtime `ensureSchema()` | `packages/database/src/client.ts`, `apps/api/src/app.module.ts` | Persist in D1. Apply versioned SQL with Wrangler migrations. Do not initialize schema on each request. |
| `setInterval` scheduler | `packages/services/src/runtime.ts` | Use a Worker `scheduled` handler. |
| In-memory array queue and `setTimeout` retries | `packages/services/src/queue.ts` | Retries die with the isolate. Use D1 job rows with a lease. |
| Browser `localStorage` bearer token | `apps/web/lib/api.ts` | Browser sessions should be Cloudflare Access. Keep any machine token server-side. |
| `node:crypto` hashes and `timingSafeEqual` | `packages/services/src/auth-token-service.ts`, `packages/database/src/bootstrap.ts` | `node:crypto` is a supported Workers API on current compatibility dates. Token storage still moves to D1. |
| Coles client fallback store `647` and `hostname.endsWith("coles.com.au")` | `packages/adapters/src/coles/api-client.ts`, `packages/adapters/src/coles/adapter.ts` | `647` is not a verified NSW store. The hostname check also matches a name that merely ends with that string. |

**Fact, Cloudflare docs retrieved 2026-11-11:** `node:sqlite` in Workers is a stub enabled for compatibility dates on or after 2026-01-29. It is not a durable database. Workers Free limits include 100,000 requests/day, 10 ms CPU per invocation, 50 subrequests/request, 128 MB memory, 5 Cron Triggers per account, 20,000 static files per Worker version, and 25 MiB per static file. Workers Paid is a $5 USD/month minimum and uses the Standard model: 10 million included requests/month, default 30 s CPU with a 5 minute maximum, and up to 15 minutes of CPU for a Cron Trigger. D1 Free is 5 million rows read/day, 100,000 rows written/day, 5 GB, and 10 databases. Since 2026-09-01, exceeding the free daily row limits fails queries until 00:00 UTC. D1 enforces foreign keys by default. `PRAGMA defer_foreign_keys` is the documented way to defer them inside one transaction.

### Local proof

**Measured.** Prototype directory: `infrastructure/cloudflare/phase0-poc/`. Wrangler `4.160.0`. Config sets `workers_dev` and `preview_urls` to false, a placeholder D1 id `00000000-0000-0000-0000-000000000000`, and no route. Commands used `--local` only. `wrangler deploy` and `wrangler d1 create` were not run.

| Step | Result |
| --- | --- |
| `wrangler d1 migrations apply easypws-phase0-local --local` | Exit 0. Resource location `local`. Migration `0001_probe.sql` applied. Wrangler reported 4 commands executed successfully. |
| `wrangler dev --local --port 8787 --test-scheduled` | Ready at `http://127.0.0.1:8787`. Bindings: local D1 and local assets. |
| `GET /api/v1/health` | 200. `probeEvents` 0, `queuedJobs` 1. |
| `GET /` | 200. Served the local static HTML, including the sentence that it is not production. |
| `GET /__scheduled?cron=0+*+*+*+*` | 200. The following health read showed `probeEvents` 1. |
| `GET /api/v1/jobs/claim` twice | First body `{"claimed":"job-1"}`. Second body `{"claimed":null}`. |
| `node:sqlite` inside the same local Worker | The module imported. `new DatabaseSync(":memory:")` threw `Illegal constructor`. |
| `wrangler d1 execute ... --local --command "PRAGMA foreign_keys = ON;"` | Exit 0, `success: true`, empty result rows, still on the local database. |

**Verdict:** a Worker `fetch` handler, Workers static assets, a D1 binding, and a `scheduled` insert are viable locally. `node:sqlite` is not a substitute for D1. NestJS `listen`, filesystem schema bootstrap, `setInterval`, and the in-memory queue are not the production runtime. This was local workerd, not the Cloudflare network, and it does not measure the Free plan 10 ms CPU limit.

**Smallest migration, proposal:**

1. Keep pure TypeScript parsers, rules, and normalizers.
2. Replace `apps/api/src/main.ts` with a Worker `fetch` router for the existing `/api/v1` paths.
3. Serve the existing Next export as Workers static assets. The measured export is 21 files, under the Free 20,000-file cap.
4. Swap `node:sqlite` for `env.DB` (`D1Database`). Keep Drizzle on its D1 driver behind the current database interface.
5. Replace `runtime.ts` and `queue.ts` with `scheduled()` plus the existing `collection_jobs` rows.
6. Put Cloudflare Access in front of `easypws.yanze.me`. Scheduled work stays on the cron event, not a public URL.

## Task C — providers

**Budget.** Conservative cap for this session: 24 external HTTP calls. No provider API key was set in process, user, or machine environment for `RAPIDAPI_KEY`, `OMKAR_API_KEY`, `APISH_KEY`, `API_SH_KEY`, `APIFY_TOKEN`, or `APIFY_API_TOKEN`. No paid call was authenticated. HTML responses that contained `Incapsula` / `_Incapsula_Resource` were not retried and were not bypassed. No proxy, no second identity, no `curl_cffi`.

**Request log, measured.** 14 HTTP attempts. The table groups 13 recorded responses. One extra search response was fetched and discarded by a local script bug before logging; it is not a fourteenth recorded body.

| # | Call | Status | Latency | Bytes | Notes |
| --- | --- | --- | --- | --- | --- |
| 1–2 | `https://www.coles.com.au/robots.txt` | 200 | 83 ms, then 97 ms | about 926 | `content-type: text/html`. Body contained Incapsula markers. Not a robots file. |
| 3–4 | `https://www.coles.com.au/find-stores/coles/nsw/marrickville-4166` | 200 | 33 ms, then 35 ms | about 921 | Same Incapsula HTML. Store name and state were not readable. |
| 5 | BFF search `storeId=4166&searchTerm=milk&page=1` | 404 | 36 ms and a repeat at 93 ms | 54 | JSON: `{ "statusCode": 404, "message": "Resource not found" }`. Not a challenge. |
| 6 | BFF details `8737163?storeId=4166` | 200 | 80 ms | 5,992 | JSON product. See the one-SKU table. |
| 7 | Same details URL, later shape read | 200 | not separately timed | JSON | `lastUpdated` `2026-11-11T21:25:51.419+11:00`. |
| 8 | Same details URL again for header names | 200 | — | JSON | `lastUpdated` still exactly `2026-11-11T21:25:51.419+11:00`. Response header names included `cache-control`, `expires`, and `pragma`. No store id header. |
| 9 | BFF details `8737163?storeId=584` | 200 | — | JSON | Same price and promotion. `lastUpdated` `2026-11-11T21:28:42.319+11:00`. |
| 10 | BFF details `999999999?storeId=4166` | 200 | 169 ms | 0 | Empty body, `content-type` null. Not a 404. |
| 11 | Omkar RapidAPI host, no key | 401 | 624 ms | 108 | JSON error body, no product payload kept. |
| 12 | `https://api.api.sh/coles/v1/search?q=milk`, no key | 401 | 57 ms | 76 | JSON error body, no product payload kept. |

`storeId=584` was used once, explicitly, as the Victorian id named by Omkar's own docs (Burwood East). It was not used as the selected store.

### Store identity

**Fact.** Omkar's product-details docs, fetched 2026-11-11, default the example to store `584` (Coles Burwood East, VIC) and show `4166` only as an example URL path: `/find-stores/coles/nsw/marrickville-4166`. The repository default is `COLES_STORE_ID` or `647`, labeled "Default Coles Store" in `.env.example`. Neither `647` nor `4166` was confirmed against a Coles page in this session.

**Measured.** The Marrickville URL returned an Incapsula HTML page, so the NSW name was not verified. Product `8737163` answered for both `4166` and `584` with the same price. `locations` in the payload is an aisle slot (`aisle`, `shelf`, `facing`), not a store. `storeId` on the JSON was null. Header names did not include a store id. The identical `lastUpdated` on repeated `4166` calls, plus `cache-control`, means at least one `4166` response was cached. The `584` call received a newer `lastUpdated`. That does not prove the price is store-specific, and it does not prove the parameter is ignored.

**Result:** no verified NSW store. `4166` stays an unverified candidate. `647` stays an unverified code default. `584` stays the documented Victorian example.

### The one real SKU

Search could not supply more ids: the implemented search path is a JSON 404. Specials and bulk are not implemented on this client. HTML catalogue pages were challenged, and this phase did not bypass them. No further ids were invented.

| Field | Value |
| --- | --- |
| Provider | Existing Coles BFF `GET /api/bff/products/{id}` |
| Requested store | `4166`, unverified |
| Product id | `8737163` |
| Name / brand / size | Energy Drink Original 4x250ml / V / 1L |
| HTTP | 200, `application/json`, first timed call 80 ms, 5,992 bytes |
| Current price | 6 AUD (`pricing.now` and `pricing.rawPriceNow`) |
| Was price | 12 AUD |
| Promotion | `promotionType=SPECIAL`, `specialType=PERCENT_OFF`, `priceDescription=1/2 Price`, `savePercent=50`, `saveAmount=6`, `onlineSpecial=false` |
| Multibuy quantity | Absent |
| Availability | `true`, `availabilityType=InStoreAndOnline`, `availableQuantity=257` |
| Source time | `lastUpdated` present, but it changed between the cached `4166` response and the `584` response. Not accepted as catalogue freshness. |
| Schema | Fields used by `ColesPricingRaw` are present: `now`, `was`, `promotionType`, `specialType`. |
| Existing normalizer | On this object, `normalizeColesProduct` returns `promotionType=half_price` and stamps `storeId=4166` from the caller, not from the payload. |
| Currency | No `pricing.currency` field on this BFF object. |

**Sample shortages, measured by absence:** ordinary 0/5, half-price 1 candidate only if the ratio is trusted, ordinary specials 0/4, multibuy 0/3, unavailable 0/2. The missing-id probe did not return a structured 404; it returned an empty 200. The current client treats a missing JSON content type as a bot challenge, so this empty 200 would be reported as a challenge even though the body had no Incapsula marker.

### Provider matrix

| Provider | Store | Search | Details | Specials | Bulk | Price parity | Quota | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Omkar Hosted | Not called | Not called | Not called | Not called | Not called | Not called | Published RapidAPI Basic page, fetched 2026-11-11: $0/month, 1,000 requests/month hard limit, 1,000 requests/hour, 10,240 MB/month then $0.001/MB. Account meter not visible. Unauthenticated call returned 401. | **BLOCKED** |
| API.SH | Not called | Not called | Not called | Not called | Not called | Not called | Published page, fetched 2026-11-11: 1,000 free credits/month, 1 credit per Coles endpoint, failed calls free, $1 per 1,000 credits on the monthly plan, $2 per 1,000 pay-as-you-go. Their "no rate limit" sentence was not measured. Unauthenticated call returned 401. | **BLOCKED** |
| Apify | Not called | Not called | Not called | Not called | Not called | Not called | No `APIFY_TOKEN`. No run. Pages fetched 2026-11-11: `rel8ble/coles-scraper` advertises $0.29/1,000 results plus a $0.00005 start fee and residential-proxy rotation when Imperva challenges. That proxy behavior is out of scope here. `omkar-cloud/coles-scraper` advertises $1/1,000 standard and $3/1,000 detailed, and claims the Apify $5 monthly credit covers 5,000 standard products. That claim was not checked on an account. No free Coles actor was identified. | **BLOCKED** |
| Existing Coles BFF | Unverified | 404 `Resource not found` | 200 for `8737163`; empty 200 for `999999999` | Not implemented | Not implemented | Only one priced SKU, identical at requested `4166` and `584`, store not echoed | No vendor quota page for this unofficial BFF. HTML challenges were not bypassed. | **PARTIAL** |
| Omkar self-hosted Python | Not run | Not run | Not run | Not run | Not run | Not run | **Fact:** GitHub `requirements.txt` is `bottle`, `cheroot`, `curl_cffi`, `marshmallow`, `pytest`. README describes `python run.py` on port 8000, no key on an AU/NZ/US connection, and a residential proxy elsewhere because Coles blocks other networks. MIT license claimed by the README. `curl_cffi` is browser impersonation, so it was not started. It cannot run inside ordinary Workers. Hosting cost of a separate Python process was not measured. | **BLOCKED** for a live test. Static portability review only. |

Omkar Hosted, Omkar self-hosted, and the Coles BFF are the same `upstream_family=coles` until a response proves otherwise. Separate hosts are not separate catalogue sources.

## Task D — design

### D1 schema migration

**Fact.** `infrastructure/migrations/001_init.sql` is the SQLite schema. `packages/database/src/schema.ts` does not declare `promotion_observations`, which the SQL file creates. Price rows are append-only by comment and by the service, which inserts an observation rather than updating history. `source` is the string `adapter_api` in `price-check-service.ts`.

**Proposal, not applied.** Add a forward-only D1 migration, `0002_provenance.sql`, after a D1-safe copy of `0001`. Keep existing primary keys. Add columns rather than rewriting history:

- `price_observations`: `provider_id`, `upstream_family`, `transport`, `requested_store_id`, `response_store_id`, `fetched_at`, `source_timestamp`, `verified_at`, `expires_at`, `currency`, `was_price`, `promotion_kind`, `offer_text`, `multi_buy_min_quantity`, `schema_valid`.
- `collection_jobs`: `lease_token`, `lease_expires_at`.
- `adapter_health`: change the key from retailer-only to `provider_id`, and keep retailer as a column.
- New `provider_calls`: `provider_id`, `operation`, `http_status`, `latency_ms`, `error_class`, `created_at`. No raw body, no keys.

Do not run `PRAGMA foreign_keys` as a portability assumption. Local D1 accepted `PRAGMA foreign_keys = ON` and returned no rows. Production D1 already enforces foreign keys. Use `PRAGMA defer_foreign_keys = on` only inside an import transaction that would otherwise insert children before parents.

`ensureSchema()` reads SQL from the Worker filesystem and runs it at startup. The Worker path must not do that.

### Existing data

**Measured.** This workspace has no `easypws.sqlite`. `data/` and `*.sqlite` are gitignored. The LXC database was not opened.

**Proposal.** Before any later import: stop the Node writer, copy the sqlite file, record `sqlite3` row counts per table, dump in foreign-key order, import into an empty D1 database, compare counts, and keep the LXC file as the rollback. DNS and `easypws.yanze.me` stay on the current host until those counts match. A failed D1 import is discarded by leaving traffic on the copy. This phase did not perform that backup.

### ProviderRouter

**Proposal.**

```ts
type Freshness = "live" | "stale" | "unknown";

interface PriceQuote {
  retailer: "coles";
  retailerProductId: string;
  requestedStoreId: string;
  responseStoreId: string | null;
  priceAud: number | null;
  wasPriceAud: number | null;
  currency: "AUD" | null;
  promotionKind:
    | "none"
    | "half_price"
    | "percent_off"
    | "multibuy"
    | "other"
    | "unknown";
  multiBuyMinQuantity: number | null;
  offerText: string | null;
  available: boolean | null;
  fetchedAt: string;
  sourceTimestamp: string | null;
  providerId: string;
  upstreamFamily: "coles";
  transport: string;
  schemaValid: boolean;
  freshness: Freshness;
}
```

Fallback policy, proposal:

1. A quote is invalid if the JSON is not the expected object, the product id differs, the currency is present and not AUD, the price is missing or not finite, or `responseStoreId` is present and differs from the requested store.
2. If `responseStoreId` is null, freshness is `unknown`. Do not display it as the selected NSW store. The measured BFF payload is in this class.
3. `specialType=PERCENT_OFF` stays `percent_off` even when `was` is double `now`. Half-price is a separate label only when the provider text or a dedicated field says so. The current normalizer does the opposite on the captured SKU; that should become a fixture, not the new rule, until product wants the ratio rule.
4. Multibuy is invalid as a unit price unless `multiBuyMinQuantity` is an integer greater than 1. Show the offer text beside the each price.
5. On invalid, 401, 403, 404, empty 200, or 5xx, try the next provider that has remaining daily budget. Do not average conflicting prices. Keep both quotes for review.
6. If every provider fails, serve the last `schemaValid` row and mark it `stale`.
7. Honor `Retry-After` once. Do not loop to provoke 429. Open the circuit after repeated failures for that provider id.
8. Omkar Hosted and the BFF do not fail over as independent catalogues while both are `upstream_family=coles`. Failover across them only covers transport failure, not a bad Coles price.

### Freshness

**Proposal, using the measured timestamp behavior.** Store `fetched_at` from the Worker clock. Copy `lastUpdated` into `source_timestamp` only as an untrusted provider field. The captured field changed between a cached `4166` response and a `584` response, so it is not evidence that the promotion was current at that second. `verified_at` is set only when the quote is schema-valid and the store id matched. `expires_at` is a product choice, not a measured Coles TTL: start with 6 hours for a priced special and 24 hours otherwise, then revise after a real multi-provider run. UI states are `live`, `stale`, and `unknown`. The home screen must not call an `unknown` row a current special.

### Cron and jobs

**Proposal.** One hourly cron claims at most 5 due `collection_jobs` with a compare-and-swap:

`UPDATE collection_jobs SET status='leased', lease_token=?, lease_expires_at=?, attempts=attempts+1 WHERE id=? AND status='queued' AND run_after<=?`

A second cron tick must not take a live lease. On success, set `done` or schedule `run_after`. On failure, set `queued` again with backoff, and stop at `max_attempts`. The local prototype's claim returned the job once and then null. That is the behavior to keep, moved onto the real job table. Free-plan CPU is 10 ms per invocation and was not measured against a 6 KB parse. Phase 1 should log CPU before relying on the Free plan. If a details fetch plus parse exceeds 10 ms, the documented alternative is Workers Paid, whose cron CPU ceiling is 15 minutes.

### Cloudflare and provider quota

**Proposal, arithmetic on published limits, not a bill.**

| Item | Published limit | Personal watchlist sketch |
| --- | --- | --- |
| Worker requests | Free 100,000/day | Hourly cron is 24 invocations/day, plus a person's own browsing. Not the binding limit. |
| Cron triggers | Free 5 per account | This app needs 1. Other Workers on the account were not counted. |
| Static assets | Free 20,000 files, 25 MiB each | Measured export is 21 files. |
| D1 reads / writes | Free 5 million reads/day, 100,000 writes/day | Indexed lookups for tens of products are far below that if full scans are avoided. Index writes count as extra written rows. |
| Workers Paid | $5 USD/month minimum | Only if measured CPU or account cron count exceeds Free. |
| Omkar Hosted | 1,000 requests/month hard limit on the published Basic plan | 40 SKUs refreshed every day is about 1,200 calls/month and does not fit. 20 SKUs every other day is about 300 and fits one provider with headroom. Bulk of 20 per call is documented by Omkar and was not tested. |
| API.SH | 1,000 credits/month, 1 credit per Coles call | Same arithmetic. Not stackable with Omkar as a way to hide overage; it is a second billable meter. |
| Apify | Paid per result, platform credit separate | Not selected. The cheapest advertised Coles actor also advertises proxy rotation against Imperva, which this design will not use. |

Provider free tiers, not Cloudflare, are the binding published limit for a daily watchlist.

### Authentication and security

**Fact.** Access puts `Cf-Access-Jwt-Assertion` on requests to the origin. Docs also describe `ctx.access` for Workers, with a stated limitation around static assets and service bindings that still has to be read before implementation. Browser requests also receive a `CF_Authorization` cookie; the docs say to validate the header.

**Proposal.** One Access application on `easypws.yanze.me`, allow policy limited to the owner's identity. No signup. The Worker checks the Access JWT on `/api/*` and does not trust `localStorage`. Home Assistant, if it stays, uses an Access service token or a hashed machine token stored in D1, not a token shipped in the static export. Cron does not call a public refresh URL. Provider keys are Worker secrets.

**Findings from this pass, not fixed here:**

- The Coles subscription key is hardcoded in `packages/adapters/src/coles/api-client.ts` and repeated in `.env.example`. It was not copied into this report. Move any future use to a secret and do not print it.
- `parseProductUrl` accepts any hostname that ends with `coles.com.au`.
- `createId` uses `Math.random`.
- The empty-200 missing product is classified as a bot challenge by the current client.
- The normalizer attaches the requested store id even when the payload has none.

No anti-bot bypass, proxy, or captcha handling is part of this design.

### Phase 1 task breakdown

1. Change the root build filter so `cmd.exe` does not pass literal quotes, then rerun `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm build` from a clean tree.
2. Replace the placeholder lint scripts or drop lint from the gate. Do not treat exit 0 from `echo` as a lint pass.
3. Add the `PriceQuote` contract and fixture tests for the captured `8737163` shape, the search 404 JSON, and the empty 200. Assert that a missing response store id becomes `unknown`.
4. Add the D1 provenance migration and stop runtime `ensureSchema()` on the Worker path. Keep the local poc local.
5. Introduce `ProviderRouter` with the fallback rules above, still without a live Omkar key.
6. Replace the Nest listener with a Worker `fetch` router and assets only after the clean build is green. Do not deploy it.
7. Add Access on the hostname before any route serves provider data.
8. When an Omkar RapidAPI Basic key exists, repeat a bounded NSW probe. Stop at the published 1,000/month hard limit. Do not select Apify actors that rotate proxies against Imperva.

## Remaining blockers

- No verified NSW store id.
- Twenty real SKUs were not collected.
- Omkar Hosted, API.SH, and Apify were not called with credentials.
- Omkar self-hosted was not executed, on purpose, because it depends on `curl_cffi`.
- BFF search is a 404. BFF details do not echo the store. `lastUpdated` is not trusted freshness.
- Free-plan CPU was not measured.
- No production data file was backed up because none was in this workspace, and the LXC host was not contacted.
- Remote GitHub Actions for Corrective A is recorded in that section. It is not a provider-gate item.

## Next action

Do not start Phase 1. The provider gate is still blocked: a verified NSW store, 20 real SKUs, and a credentialed provider quote are unmet. Do not deploy, and do not spend provider quota until a free Omkar key and a store-proven NSW id are both available. Read Corrective A before treating the old Windows build failure as current.

## Corrective A — Windows build, test, and CI

**Date:** 2026-11-11, Australia/Sydney  
**Starting SHA:** `fa5ce9438460bf7658e0b6f0b7b03b21adfd174e`  
**Ending SHA:** `219489f7044dbdfcdf7e07d25c5e5789a2d4d479`  
**Verdict labels:** `BUILD_GATE_PASS`, `CI_GATE_NOT_VERIFIED`, `PROVIDER_GATE_BLOCKED`, `PHASE_0_PARTIAL`. Phase 0 is not PASS.

### Original defect and root cause

**Measured.** The root `build` script was `pnpm -r --filter './packages/**' run build && ...`. On Windows, pnpm runs package scripts with `cmd.exe`. `cmd.exe` does not treat single quotes as quotes, so pnpm received a pattern that included the quote characters, matched no projects, and exited 0. The `&&` chain still built `@easypws/web` and then `@easypws/api`. The API `tsc` failed because library `dist` output had never been produced. A filter that matches nothing was not a failure.

**Measured.** Every library `exports` map pointed `types` and `import` at `./dist`. A fresh `tsc --noEmit` and Vitest/tsx resolved workspace packages to those files. Without a previous build, typecheck and test failed even after the filter was corrected.

**Fact.** All ten workspace `lint` scripts were `echo "lint placeholder"`. `pnpm lint` could exit 0 without reading a source file. The repository had no ESLint config and no GitHub Actions workflow.

### What changed

`scripts/workspace.mjs` is the root `build`, `typecheck`, `test`, and `lint` entry. It spawns pnpm with the filter `./packages/*` as one argument. On Windows that goes through `cmd.exe` without quoting the `*` (quoting it made pnpm treat the quotes as part of the pattern and match nothing). On other platforms the same argument is passed with no shell, so bash does not glob it. `--fail-if-no-match` is set, and the build also requires the list output to contain all eight library names: `@easypws/adapters`, `@easypws/contracts`, `@easypws/core`, `@easypws/database`, `@easypws/notifications`, `@easypws/observability`, `@easypws/rules`, `@easypws/services`. Libraries build in pnpm's dependency order, then `@easypws/web`, then `@easypws/api`.

Typecheck and test do not read `dist`. Each library export adds condition `easypws-source` → `./src/index.ts`. Package typecheck configs set `customConditions` to that name. Adapter and rules Vitest configs use the same condition and include only `src/**/*.test.ts`, so compiled tests under `dist` are not run a second time. Database and services smoke tests use `node --conditions=easypws-source`. Production `import` / `default` still point at `dist` for the API runtime.

Lint is ESLint `10.14.0` with `typescript-eslint` `8.72.2` and `@eslint/js` `10.0.1`, flat config, recommended rules, TypeScript sources only. Three source edits were required for that ruleset and nothing else: the web page dropped an `eslint-disable` for `react-hooks/exhaustive-deps` because that plugin is not installed; one `throw new Error` in `apps/web/lib/api.ts` now passes `{ cause: err }`; the observability logger dropped an unused `no-console` disable. `next-env.d.ts` keeps its triple-slash references, and that rule is off for `*.d.ts`. The database `migrate` script is still an echo. It is not the lint command.

`.github/workflows/ci.yml` runs on push and pull request for `ubuntu-latest` and `windows-latest`. It uses pnpm `9.15.0` and Node `22` (the `engines` range is `>=22.5`). One job installs, builds, typechecks, tests, and lints. A second job installs, then typechecks, tests, and lints without building, so a `dist` dependency fails CI. There is no deploy.

### Commands executed

Clean checkout: detached worktree `D:\Dev\projects\EasyPWS-gate` at the starting SHA, with this change applied and no `node_modules` or `dist`. The existing checkout's `node_modules` and `dist` were left in place. Commands were started through `cmd.exe`. Node `v24.13.0`, pnpm `9.15.0`.

| Order | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | 0 | Fresh install. A later repeat printed `Lockfile is up to date` and `Already up to date` and also exited 0. |
| 2 | `pnpm typecheck` before any build | 0 | 10 of 11 workspace projects. Root is excluded so the runner does not call itself. |
| 3 | `pnpm test` before any build | 0 | adapters 5 passed, rules 4 passed, `sqlite bootstrap smoke ok`, `in-process queue smoke ok`. |
| 4 | dist directories outside `node_modules` | — | 0. Typecheck and test did not create `dist`. |
| 5 | `pnpm lint` before any build | 0 | ESLint completed with no findings. |
| 6 | `pnpm build` | 0 | Log line `Library filter selected 8 packages.` Order was contracts and observability, core, then adapters, database, notifications, and rules, then services, then web export, then API `tsc`. |
| 7 | `pnpm typecheck` after build | 0 | Same 10 projects. |
| 8 | `pnpm test` after build | 0 | Same counts as the pre-build run. `dist` tests were not executed again. |
| 9 | `pnpm lint` after build | 0 | No findings. |

`git check-ignore` matched `packages/contracts/dist`, `apps/api/dist`, and `apps/web/out` to `.gitignore`. `git ls-files` for `dist` and `out` was empty. Generated output was not staged.

Separate from the worktree, `pnpm --fail-if-no-match --filter "./does-not-exist/*" list --depth -1` exited 1 with `No projects matched the filters`. A PowerShell `pnpm build` in the existing checkout, before the worktree run, also selected 8 packages and exited 0.

Linux bash was not executed here. This machine has no WSL distribution. The non-Windows branch of the runner does not invoke a shell. Ubuntu execution is the CI job, and that job had not been observed when this section was written.

Next.js printed `The Next.js plugin was not detected in your ESLint configuration` during `next build` and still exited 0. `eslint-config-next` was not added.

### CI

Workflow file: `.github/workflows/ci.yml`.  
Remote run: not observed yet. `CI_GATE_NOT_VERIFIED`. The workflow is in ending SHA `219489f7044dbdfcdf7e07d25c5e5789a2d4d479`.

### Changed files

- `.github/workflows/ci.yml`
- `eslint.config.mjs`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/workspace.mjs`
- `apps/api/package.json`
- `apps/api/tsconfig.typecheck.json`
- `apps/web/app/page.tsx`
- `apps/web/lib/api.ts`
- `apps/web/next-env.typecheck.d.ts`
- `apps/web/package.json`
- `apps/web/tsconfig.typecheck.json`
- `packages/adapters/package.json`
- `packages/adapters/tsconfig.typecheck.json`
- `packages/adapters/vitest.config.ts`
- `packages/contracts/package.json`
- `packages/contracts/tsconfig.typecheck.json`
- `packages/core/package.json`
- `packages/core/tsconfig.typecheck.json`
- `packages/database/package.json`
- `packages/database/tsconfig.typecheck.json`
- `packages/notifications/package.json`
- `packages/notifications/tsconfig.typecheck.json`
- `packages/observability/package.json`
- `packages/observability/src/index.ts`
- `packages/observability/tsconfig.typecheck.json`
- `packages/rules/package.json`
- `packages/rules/tsconfig.typecheck.json`
- `packages/rules/vitest.config.ts`
- `packages/services/package.json`
- `packages/services/tsconfig.typecheck.json`
- `docs/v2/phase-00-results.md`

### Remaining blockers

Provider gate is unchanged and blocked. No NSW store was verified. 20 real SKUs were not collected. No provider credential was used. No Cloudflare resource was deployed. Phase 0 stays `PHASE_0_PARTIAL`. CI remote status is `CI_GATE_NOT_VERIFIED` until a GitHub Actions run is observed.
