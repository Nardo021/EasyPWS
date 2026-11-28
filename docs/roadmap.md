# EasyPWS Roadmap

## Active roadmap — V2 Lite (calibrated 2026-11-23)

EasyPWS V2 is a **private, owner-only Coles price watcher**. Keep the Worker + D1 + Cloudflare Access architecture small; do not turn the former multi-retailer/HA roadmap into requirements for V2.

| Stage | Verified status | Next acceptance condition |
| --- | --- | --- |
| Phase 0 / Provider evidence | PARTIAL | Third-party quote cannot be described as independently verified Coles store price |
| Phase 1A Provider foundation | Offline code and CI passed | Keep existing interface; no expansion without need |
| Phase 1B Watchlist | Delivered in private V2 | Search, URL import, manual refresh, price history |
| Phase 1C Monitor handler | Local tests passed | First live scheduled check accepted 2026-11-24 as `AUTO_MONITOR_VERIFIED` ([PR #8 acceptance](https://github.com/Nardo021/EasyPWS/pull/8#issuecomment-7118428005)). Later Sydney-day results are on the Phase 1E-B row. This is not a long-term reliability claim or official Coles price validation. |
| Phase 1D Private Cloudflare release | PRIVATE_DEPLOYED (owner confirmed 2026-11-23) | Owner-only Access, D1, real Static Assets, custom domain, disabled workers.dev |
| **Phase 1E-A Git baseline** | **Completed, main CI success (2026-11-23)** | PR #3–#7 merged sequentially, main CI #45164141858 passed; no production redeploy. |
| **Phase 1E-B Automatic checks** | **AUTO_MONITOR_VERIFIED** | First real scheduled run accepted 2026-11-24 ([PR #8 production acceptance](https://github.com/Nardo021/EasyPWS/pull/8#issuecomment-7118428005)). PR #8 merge and main CI #45167271907 remain the schedule evidence. Independent read-only D1 evidence recorded 2026-11-28: Sydney days 2026-11-24 through 2026-11-27 `updated` with matching details HTTP 200; 2026-11-28 `preserved`, HTTP status 0, no valid HTTP response recorded. Not a long-term reliability claim or official Coles price validation. |
| Phase 1F-A Telegram webhook | Merged on main `90a6e23` | Isolated owner webhook only |
| Phase 1F-B Telegram price alerts | Deployment accepted; live alert unverified | PR #11 merged at main `211feb41`. Consent smoke passed. A later read observed alerts enabled at epoch 6; that change is not owner-reconciled. |
| Phase 2A Mobile PWA | Proposed | Mobile usability, install manifest/icons; don't claim installable PWA before validation |
| Phase 2B Watchlist-first specials | Proposed | Useful watched-product deals, no indiscriminate full-catalog scrape |
| Phase 3 Other stores/providers | Deferred | Real need, quota/cost check, evidence before expansion |

**Git baseline evidence (historical, 2026-11-23):** PRs [#3](https://github.com/Nardo021/EasyPWS/pull/3), [#4](https://github.com/Nardo021/EasyPWS/pull/4), [#5](https://github.com/Nardo021/EasyPWS/pull/5), [#6](https://github.com/Nardo021/EasyPWS/pull/6), and [#7](https://github.com/Nardo021/EasyPWS/pull/7) were merged in order on 2026-11-23; final PR merge commit: `71183570f2918c2e40e263f7404e903862cd7916`. This integration is **source control only**, not a new Cloudflare deployment. At that calibration, the only file differences between that merged main commit and the production source commit then in use, `96dc7c47001120d5dd7eaa8262dca100beada7ca`, were README, roadmap, Phase 1D notes, and one Wrangler comment. That comparison is historical. It is not a comparison with the current production Workers.

**Current operational facts (corrected 2026-11-28):** `easypws.yanze.me` is private and deployed. The price Worker `dccc33a0-a502-47b3-b6ea-c2d4278d5799` and the Telegram Worker `461ca82b-cbee-4e85-b027-a836788696cf` each receive 100% of traffic, from main `211feb41c88c452781f93a9bc891b8f28a3f3026`. That commit is the merge of PR #11. Main CI run [46132612512](https://github.com/Nardo021/EasyPWS/actions/runs/46132612512) passed all four Ubuntu and Windows jobs. Production Cron remains the one daily trigger `0 22 * * *`. The first real scheduled check was accepted on 2026-11-24 as `AUTO_MONITOR_VERIFIED` ([PR #8 production acceptance](https://github.com/Nardo021/EasyPWS/pull/8#issuecomment-7118428005)): one successful live run, not a long-term reliability claim and not official Coles price validation. A later independent read-only D1 select, recorded in the [PR #12 review](https://github.com/Nardo021/EasyPWS/pull/12#issuecomment-7238027047), shows Sydney days 2026-11-24 through 2026-11-27 as `updated` with matching details HTTP 200, and 2026-11-28 as `preserved` with HTTP status 0 and no valid HTTP response recorded. A natural live price-alert delivery has not been verified. The 2026-11-23 calibration recorded a price Worker built from `96dc7c47001120d5dd7eaa8262dca100beada7ca`; that sentence is historical. After an in-place Access repair that kept the existing audience, owner-only policy, and Worker destination, the owner reported login, the existing watchlist item, price history, and alerts off. The owner also confirmed an enable-then-disable test; an independent read after that test was enabled=0, epoch=3. A later independent read at 2026-11-28T10:26:13.120Z observed enabled=1, epoch=6. Those three later increments are not owner-reconciled, so this document does not describe their sequence. `provider_calls` is 11, the notification outbox is empty, and Telegram price-alert deliveries are 0. Telegram `/help` was owner-confirmed, with sent webhook receipts at 4. Phase 0 and the provider gate remain PARTIAL. Phase 1F-C local development was authorized separately and is not implemented or released here. The old Node/LXC/Home Assistant code remains in this repository and does not power the V2 Worker.

**Constraints:** one user; Coles store 4166; Omkar API-reported price only; no unverified "official" specials; 15 recorded automatic attempts per Australia/Sydney day in the current handler, not a global hard cap; manual API requests also consume provider quota. No multitenant auth, queues, whole-site specials scraping, new provider integrations or remote Cron changes without a specific need and approval.

Links: [Phase 1F-B alerts](v2/phase-01f-b-telegram-alerts.md), [Phase 1F-A webhook](v2/phase-01f-a-telegram-foundation.md), [Phase 1D history](v2/phase-01d-private-launch.md), [Phase 1C checks](v2/phase-01c-auto-monitor.md), [Provider gate](v2/phase-00-results.md).

---

## Legacy V1 Roadmap (historical, not V2 commitments)

## Done

### Scaffold

- [x] Monorepo (pnpm workspaces)
- [x] Shared contracts / domain types
- [x] Adapter SDK stubs
- [x] Rule engine skeleton
- [x] Notification dispatcher skeleton
- [x] SQLite schema migration
- [x] NestJS + Next.js shells
- [x] HA custom integration file tree

### First release (Coles)

- [x] Drizzle database client + bootstrap user/tokens
- [x] API token auth (Bearer) for Web / HA
- [x] Coles BFF adapter (`getProduct`, URL parse, health)
- [x] URL import + watchlist CRUD + default rules
- [x] In-process price_check worker + scheduler
- [x] Append-only observations + rule evaluation + HA webhook notify
- [x] Web UI: import, watchlist controls, ECharts history
- [x] HA entities/services against `/api/v1/ha/*`

### Polish follow-up

- [x] Coles client JSON/bot-challenge detection + retries
- [x] Skip duplicate observations on re-import
- [x] Manual refresh cooldown + scheduler stagger
- [x] Token list / rotate / recover + Web token UX
- [x] Web search UI + per-item target price editor
- [x] HA dynamic entity discovery + config validation
- [x] Vitest for Coles URL/normalizer + rules engine

### Native single-process deploy

- [x] Remove Docker / Postgres / Redis runtime
- [x] SQLite + in-process queue
- [x] Same-port Web static + API
- [x] systemd unit + LXC deploy docs

## Next

1. Authentik OIDC browser sessions (keep API tokens for HA)
2. Coles search GraphQL fallback / residential egress for Incapsula
3. Woolworths adapter (validate platform abstraction)
4. Object storage for raw response snapshots
5. Adapter health dashboard in Web UI
