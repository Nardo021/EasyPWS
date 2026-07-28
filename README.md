# EasyPWS

Easy Price Watch Service — self-hosted multi-retailer price monitoring platform with a Home Assistant integration layer.

**Architecture decision:** EasyPWS runs as an independent stack (API, workers, PostgreSQL, Redis). Home Assistant consumes it via a native custom integration — scrapers and the rule engine do **not** live in HAOS.

## Status

Scaffold / architecture phase. Shared contracts, DB schema, Docker Compose, and empty app shells are in place. Retailer scraping and business APIs are not implemented yet.

## Stack

- **Web:** Next.js + TypeScript (`apps/web`)
- **API:** NestJS (`apps/api`)
- **Worker / Scheduler:** BullMQ (`apps/worker`, `apps/scheduler`)
- **Packages:** `@easypws/contracts`, `core`, `adapters`, `rules`, `notifications`, `database`, `observability`
- **Data:** PostgreSQL + Redis
- **HA:** `integrations/home-assistant/custom_components/easypws`

## Quick start

```bash
# prerequisites: Node 20+, pnpm 9, Docker
cp .env.example .env
corepack enable
pnpm install

# data plane
docker compose up -d postgres redis

# packages + API typecheck/build (local)
pnpm --filter @easypws/contracts build
pnpm --filter @easypws/api typecheck
```

API health (after `pnpm --filter @easypws/api dev`):

- `GET http://localhost:3001/api/v1/health`
- `GET http://localhost:3001/api/v1/meta/architecture`

## Docs

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Migrations](infrastructure/migrations/README.md)
- [Docker / Proxmox](infrastructure/docker/README.md)
- [HA integration](integrations/home-assistant/README.md)

## License

Unlicense — see [LICENSE](LICENSE).
