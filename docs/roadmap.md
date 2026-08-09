# Roadmap

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
