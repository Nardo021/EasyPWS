# EasyPWS

Easy Price Watch Service — self-hosted multi-retailer price monitoring with a Home Assistant integration layer.

Scrapers, PostgreSQL, Redis, and the rule engine run **outside** HAOS. HA consumes EasyPWS via a native custom integration and scoped API tokens.

## First-release features

- Coles product URL import + BFF price fetch (search is best-effort; may be bot-blocked)
- Watchlist with target price / any drop / half-price / historical low rules
- Append-only price history + ECharts in Web UI
- BullMQ worker + staggered scheduler
- HA summary + dynamic per-product entities/services
- Token list / rotate / recover paths

## Quick start

```bash
cp .env.example .env
# Ensure NEXT_PUBLIC_API_URL is reachable from your browser
docker compose up -d --build

# One-time tokens (first boot only):
docker compose logs api | grep -E 'BOOTSTRAP_TOKEN|HA_API_TOKEN'
```

Local monorepo dev:

```bash
corepack enable && pnpm install
docker compose up -d postgres redis   # or local Postgres/Redis
BOOTSTRAP_ISSUE_TOKENS=true pnpm --filter @easypws/api dev
pnpm --filter @easypws/worker dev
pnpm --filter @easypws/scheduler dev
pnpm --filter @easypws/web dev
pnpm test
```

Token lost? Set `BOOTSTRAP_ROTATE_SECRET` and `POST /api/v1/tokens/recover`.

## API (Bearer token)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/auth/me` | current principal |
| POST | `/api/v1/products/import` | `{ url, targetPrice? }` |
| GET | `/api/v1/products/search?q=` | Coles search (may fail under bot protection) |
| GET | `/api/v1/watchlists/items` | list monitored products |
| PATCH | `/api/v1/watchlists/items/:id/target-price` | set target |
| POST | `/api/v1/watchlists/items/:id/refresh` | enqueue check (rate-limited) |
| GET | `/api/v1/prices/listings/:id/history` | chart points |
| GET | `/api/v1/ha/summary` | HA coordinator payload |
| POST | `/api/v1/tokens/recover` | rotate bootstrap tokens with shared secret |

## Docs

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [HA integration](integrations/home-assistant/README.md)
- [Docker / Proxmox](infrastructure/docker/README.md)

## License

Unlicense — see [LICENSE](LICENSE).
