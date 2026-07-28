# Roadmap

Current milestone: **architecture docs + empty scaffold** (no production scrapers).

## Done (scaffold)

- [x] Monorepo (pnpm workspaces)
- [x] Shared contracts / domain types
- [x] Adapter SDK stubs (Coles, Woolworths, generic)
- [x] Rule engine skeleton + cooldown helpers
- [x] Notification dispatcher skeleton
- [x] PostgreSQL schema migration
- [x] Docker Compose (Postgres/Redis + app profiles)
- [x] NestJS API health/meta endpoints
- [x] Worker / scheduler process scaffolds
- [x] Next.js placeholder Web UI
- [x] HA custom integration file tree

## Next (implementation)

1. Choose ORM/migrator and wire `@easypws/database`
2. Authentik OIDC + API token / HA scoped token auth
3. Coles adapter (JSON/API first)
4. Product import-by-URL + watchlist CRUD
5. BullMQ price_check pipeline + append observations
6. Rule evaluation → HA webhook notifications
7. Web UI: watchlist, charts (ECharts)
8. Woolworths adapter
9. Flesh out HA entities/services against live API
