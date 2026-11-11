# EasyPWS V2 — Phase 0 provider probe protocol

**Date:** 2026-11-11  
**Execution status:** PARTIAL — Corrective C reviewed the saved Omkar fixtures offline. Sanitized evidence is in [phase-00-results.md](./phase-00-results.md). The price is not store-proven. No further hosted requests are justified for this gate.  
**Safety:** Read-only, rate-limited requests; no stored credentials in repo, screenshots or logs. Stop on access denial, bot challenges or disallowed use. Never work around anti-bot protection, rotate identities to defeat controls, or infer authorization from public visibility.

## Hypothesis

An inexpensive hosted source can supply an NSW-store-aware Watchlist of fresh discounts, while a second independently maintained provider can cover partial outages. A cached last-known snapshot is available even if no provider responds, but it is labelled stale. **This is a hypothesis pending external HTTP tests.**

## Candidate inventory

| Candidate | Integration | Verified in source/docs | Needed before acceptance |
| --- | --- | --- | --- |
| Omkar hosted | HTTPS GET /products/details, /products/search, /products/bulk, /specials, /stores/search | [Omkar docs](https://www.omkar.cloud/tools/coles-scraper) and [repo](https://github.com/omkarcloud/coles-scraper) show schemas and matching local routes | Confirm account-specific free quota, auth method, actual live HTTP success and store validity |
| Omkar open source | Python Bottle/Cheroot/`curl_cffi` local REST API | Repo `run.py`, `requirements.txt`, `routes.py`, `config.py` | Test local native Python environment **if lawful**, keep out of Workers; quantify independent hosting cost; not a Workers-native fallback |
| API.SH | Hosted Coles API | Public documentation advertises free credits | Confirm current quota, live success, Specials coverage, per-store scoping, terms and latency |
| Apify candidate | Actor/platform-specific API | Platform offers credits, but cost is per Actor | Identify exact Actor, current charge, capabilities, account quota; do not assume free 1,000 calls |
| Existing Coles BFF | GET `/api/bff/products/{id}` and `/api/bff/products/search` | `packages/adapters/src/coles/api-client.ts` is implemented | Actual network and usage authorization unverified; stop on any challenge or denied response |
| Last known D1 snapshot | Local persistent store | Business requirement, not yet implemented | Store ID, source, observation timestamp and expiry must be displayed, never falsely “live” |

## Specific Omkar contract findings

- The open-source `routes.py` defines 16 GET endpoints with `/coles` aliases. `/products/bulk` is intended for up to 20 products; `/specials` supports `special_type`, `category`, `page`, `sort_by`, and `store` (per docs).
- Omkar `/specials` documentation uses page size 48 and distinguishes `special_type=half_price`, `multi_buy`, `online_only`. Do not hardcode those as guaranteed forever; validate real response.
- `pricing.is_on_special` can be true even if `was_price` is null, especially for multibuy. `offer_description` and `multi_buy.min_quantity` distinguish the multi-item offer.
- The Omkar public example defaults to store ID `584` (Burwood East, VIC). EasyPWS must set a **confirmed NSW store** explicitly; never silently default to VIC.
- Hosted and self-hosted Omkar share adapter semantics and might share upstream Coles BFF/GraphQL. Report `upstream_family="coles"` for both; separate host reliability does not establish independent upstream reliability.
- The README currently references a RapidAPI 1,000 calls/month free plan. Verify the live plan rather than treating README as a guaranteed current contract.
- Public `parsers.listing` keeps `_type == "PRODUCT"` rows and sets `is_sponsored` from `featured` or `adId`. `PAGE_SIZE` is 48 and `MAX_PAGES` is 104. `per_page` is that page size, not the length of `products`.
- Public `_run` sends `excludeAds=true` and `storeId`. The captured hosted page still contained sponsored product rows, so that flag does not remove them from the parsed list.
- `classifyQuote`, `assessListingPage`, and `compareStoreQuotes` in `packages/adapters/src/evidence/contract.ts` encode the labels below. Tests use synthetic quotes, not raw responses.

## Test design (perform manually / with Cursor's isolated diagnostic runner)

### Preflight
1. Confirm current store ID with an authorized store lookup and cross-check exact name/location against the retailer.
2. Inspect provider terms of service, rate limits and explicit permissions. Stop if prohibited.
3. Fix an overall test budget (e.g. <= 50 remote requests across **all** paid/quota-controlled services), track every request. Do not assume each endpoint costs the same credits.
4. Use environment variables or encrypted local config for API keys. Never commit `.env`, auth headers, raw cookies, or entire responses.
5. Execute against a single consistent NSW store and note timezone `Australia/Sydney`.

### Sample design
Collect 20 *real, verified* Coles product IDs (not invented IDs):
- 5 ordinary no-promotion items
- 5 half-price items
- 4 ordinary specials with a former price
- 3 multibuy
- 2 out-of-stock or unavailable, if found
- 1 malformed/removed product test

If a desired category is unavailable, report shortage; don't fabricate sample counts. Store only non-sensitive normalized fields and IDs. Include at least two different packaging sizes and brands, and test a second confirmed NSW store on a subset to detect store-specific price changes.

### Endpoints and negative cases
- `stores/search`: resolve identity; ensure selected store actually exists.
- `products/search`: nonempty search, empty query, and pagination behavior.
- `products/details`: compare product ID/name/store/price/availability.
- `products/bulk`: compare bulk with individual details on same store, up to permitted batch size.
- `specials`: page 1, half-price, multibuy and store-specific results; validate paging metadata.
- Missing product (404/empty), invalid params (400), 401/403 (authorization), 429/5xx (limit/failure); use mock responses for rate-limit/5xx where necessary. **Never intentionally hammer a provider to trigger rate limits.**
- Schema regression with local fixtures: null `was_price`, missing name, zero price, currency not AUD, wrong ID/store, unknown promotion kind, unusually large response, HTML masquerading as JSON, mismatched pagination.

### Captured evidence per case
`case_id`, `provider_id`, `upstream_family`, `retailer`, `store_id`, `product_id`, `request_type`, `observed_at`, `http_status`, `latency_ms`, `normalized_price_aud`, `was_price_aud`, `is_on_special`, `promotion_kind`, `multi_buy_min_quantity`, `source_timestamp`, `schema_valid`, `freshness_state`, `error_class`, `call_cost`, `confidence`.

Log only approved evidence and sanitized response excerpts; retain full raw payloads only if allowed and in local, gitignored storage.

## Data integrity rules

1. Match `retailer + retailerProductId + storeId` before comparing prices.
2. If a provider responds with malformed, foreign-store or contradictory data, treat as **invalid**, advance to another verified provider, and record provenance. An HTTP 200 alone is not success.
3. Avoid automatic false “half price” labels based purely on a missing/undefined former price.
4. Multibuy unit economics need an explicitly stated quantity; show normal per-item price and offer separately.
5. If all active providers fail, preserve last valid D1 snapshot and show “last verified <time>” + stale state.
6. If providers disagree on price, prefer freshness + store agreement + source quality. Quarantine disagreements for user review; don't silently average.
7. Enforce fixed budgets, exponential backoff for transient failures and circuit breaking; comply with `Retry-After`.

## Outcome matrix to fill after actual run

| Provider | Store verified | Search | Details | Specials | Bulk | Price parity | Quota verified | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Omkar Hosted | YES, Marrickville `4166`, NSW, from postcode `2204` | 200, `milk`, 55 rows, 296 matches | 200 for `8737163` at `4166` and `846` | 200, page 1, 58 rows, 7289 matches | 200, 20 ids, price fields matched the listing | Same price at `4166` and `846`; stock 257 vs 399. `store_id` is copied from the request | Header meter 1000, remaining 994 after Corrective B | PARTIAL |
| API.SH | NO | NOT CALLED | NOT CALLED | NOT CALLED | NOT CALLED | NOT CALLED | Published 1,000 credits/month; no key; unauthenticated 401 | BLOCKED |
| Apify Actor (not selected) | NO | NOT CALLED | NOT CALLED | NOT CALLED | NOT CALLED | NOT CALLED | Published actor prices; no token; no run | BLOCKED |
| Existing BFF | NO | 404 | 200 for one SKU; empty 200 for a missing id | NOT IMPLEMENTED | N/A | Same price at requested 4166 and 584; store not echoed | No vendor quota; HTML challenge not bypassed | PARTIAL |
| Omkar local Python | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | MIT and `curl_cffi` read from source; process not started | BLOCKED |

## Acceptance gate

Phase 0 cannot be marked PASS until: baseline tests/build verified; one selected NSW store verified; 20 real test SKU evidence collected; at least one provider returns valid fresh data; provider quotas and restrictions established; Cloudflare architecture and D1 migration design accepted. Failure to access a provider is a BLOCKED result, not a simulated PASS.

Corrective C applies that gate as follows. These readings do not relax it.

- A store-directory hit for `4166` verifies the store identity. It does not verify a later price.
- `store_parameter_forwarded` means the client source sends the store upstream. `store_price_independently_verified` requires a store-selected source outside the provider. An echoed `store_id` never supplies that.
- Equal prices at two stores are inconclusive. A stock difference verifies quantity only.
- `freshly_fetched` means the record has a source timestamp. Listing and bulk cards without one are `historical_cached` on that axis.
- Walking specials pages cannot be required for PASS. The measured total of 7289 is larger than the 104-page cap.
