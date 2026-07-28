# Roadmap

## Done

### Scaffold
- [x] Monorepo (pnpm workspaces)
- [x] Shared contracts / domain types
- [x] Adapter SDK stubs
- [x] Rule engine skeleton
- [x] Notification dispatcher skeleton
- [x] PostgreSQL schema migration
- [x] Docker Compose
- [x] NestJS / worker / scheduler / Next.js shells
- [x] HA custom integration file tree

### First release (Coles)
- [x] Drizzle database client + bootstrap user/tokens
- [x] API token auth (Bearer) for Web / HA
- [x] Coles BFF adapter (`getProduct`, URL parse, health)
- [x] URL import + watchlist CRUD + default rules
- [x] BullMQ price_check worker + scheduler
- [x] Append-only observations + rule evaluation + HA webhook notify
- [x] Web UI: import, watchlist controls, ECharts history
- [x] HA entities/services against `/api/v1/ha/*`

## Next

1. Authentik OIDC browser sessions (keep API tokens for HA)
2. Coles search endpoint hardening / GraphQL fallback
3. Woolworths adapter (validate platform abstraction)
4. Per-product HA entity discovery on watchlist changes
5. Object storage for raw response snapshots
6. Rate-limit / adaptive backoff polish + adapter health dashboard
