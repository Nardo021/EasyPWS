# EasyPWS

Easy Price Watch Service — self-hosted multi-retailer price monitoring with a Home Assistant integration layer.

Scrapers, PostgreSQL, Redis, and the rule engine run **outside** HAOS. HA consumes EasyPWS via a native custom integration and scoped API tokens.

## First-release features

- Coles product URL import + BFF price fetch
- Watchlist with target price / any drop / half-price / historical low rules
- Append-only price history + ECharts in Web UI
- BullMQ worker + adaptive scheduler
- HA summary entities, per-product sensors, monitoring switch, refresh button, and services

## Quick start

```bash
cp .env.example .env
corepack enable
pnpm install

docker compose up -d postgres redis
# wait for healthy, then:
BOOTSTRAP_ISSUE_TOKENS=true pnpm --filter @easypws/api dev
# in other terminals:
pnpm --filter @easypws/worker dev
pnpm --filter @easypws/scheduler dev
pnpm --filter @easypws/web dev
```

On first API boot with `BOOTSTRAP_ISSUE_TOKENS=true`, logs print one-time `BOOTSTRAP_TOKEN` and `HA_API_TOKEN`. Paste the bootstrap token into the Web UI.

Full stack:

```bash
docker compose up -d --build
```

## API (Bearer token)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/products/import` | `{ url, targetPrice? }` |
| GET | `/api/v1/watchlists/items` | list monitored products |
| PATCH | `/api/v1/watchlists/items/:id/status` | pause/resume |
| POST | `/api/v1/watchlists/items/:id/refresh` | enqueue check |
| GET | `/api/v1/prices/listings/:id/history` | chart points |
| GET | `/api/v1/ha/summary` | HA coordinator payload |

## Docs

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [HA integration](integrations/home-assistant/README.md)
- [Docker / Proxmox](infrastructure/docker/README.md)

## License

Unlicense — see [LICENSE](LICENSE).
