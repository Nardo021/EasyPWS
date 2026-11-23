# EasyPWS Roadmap

## Active roadmap — V2 Lite (calibrated 2026-11-23)

EasyPWS V2 is a **private, owner-only Coles price watcher**. Keep the Worker + D1 + Cloudflare Access architecture small; do not turn the former multi-retailer/HA roadmap into requirements for V2.

| Stage | Verified status | Next acceptance condition |
| --- | --- | --- |
| Phase 0 / Provider evidence | PARTIAL | Third-party quote cannot be described as independently verified Coles store price |
| Phase 1A Provider foundation | Offline code and CI passed | Keep existing interface; no expansion without need |
| Phase 1B Watchlist | Delivered in private V2 | Search, URL import, manual refresh, price history |
| Phase 1C Monitor handler | Local tests passed | Production Cron configured in Phase 1E-B; no active watched products yet |
| Phase 1D Private Cloudflare release | PRIVATE_DEPLOYED (owner confirmed 2026-11-23) | Owner-only Access, D1, real Static Assets, custom domain, disabled workers.dev |
| **Phase 1E-A Git baseline** | **Completed, main CI success (2026-11-23)** | PR #3–#7 merged sequentially, main CI #45164141858 passed; no production redeploy. |
| **Phase 1E-B Automatic checks** | **CRON_CONFIGURED / LIVE_CHECK_PENDING** | PR #8 merged, main CI #45167271907 passed, remote one daily Cron 22:00 UTC verified. Add a genuine watchlist item and confirm a real scheduled check. |
| Phase 1F Notification MVP | Proposed | Owner-approved channel and explicit API-reported-price wording, no repeated spam |
| Phase 2A Mobile PWA | Proposed | Mobile usability, install manifest/icons; don't claim installable PWA before validation |
| Phase 2B Watchlist-first specials | Proposed | Useful watched-product deals, no indiscriminate full-catalog scrape |
| Phase 3 Other stores/providers | Deferred | Real need, quota/cost check, evidence before expansion |

**Git baseline evidence:** PRs [#3](https://github.com/Nardo021/EasyPWS/pull/3), [#4](https://github.com/Nardo021/EasyPWS/pull/4), [#5](https://github.com/Nardo021/EasyPWS/pull/5), [#6](https://github.com/Nardo021/EasyPWS/pull/6), and [#7](https://github.com/Nardo021/EasyPWS/pull/7) were merged in order on 2026-11-23; final PR merge commit: `71183570f2918c2e40e263f7404e903862cd7916`. This integration is **source control only**, not a new Cloudflare deployment. The only file differences between that merged main commit and the actual production source commit are README, roadmap, Phase 1D notes, and one Wrangler comment.\n\n**Current operational facts:** `easypws.yanze.me` is private and deployed. Production Cron is **configured once per day**, but it has not yet performed a verified live watchlist check. Push notifications are **off**. The source of truth for code is GitHub; the latest production Worker was deployed from source commit `96dc7c47001120d5dd7eaa8262dca100beada7ca`, with only a later deployment-note commit on the Phase 1D PR at the time of this calibration. `main` integration is a repository operation, not automatic deployment. The old Node/LXC/Home Assistant code remains in this repository, but does not power the V2 Worker.

**Constraints:** one user; Coles store 4166; Omkar API-reported price only; no unverified "official" specials; 15 automatic checks per Australia/Sydney day in current handler; manual API requests also consume provider quota. No multitenant auth, queues, whole-site specials scraping, new provider integrations or remote Cron changes without a specific need and approval.

Links: [Phase 1D history](v2/phase-01d-private-launch.md), [Phase 1C checks](v2/phase-01c-auto-monitor.md), [Provider gate](v2/phase-00-results.md).

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
