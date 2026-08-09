# EasyPWS

Easy Price Watch Service — self-hosted multi-retailer price monitoring with a Home Assistant integration layer.

Scrapers, SQLite, and the rule engine run **outside** HAOS as a **single Node process**. HA consumes EasyPWS via a native custom integration and scoped API tokens.

## First-release features

- Coles product URL import + BFF price fetch (search is best-effort; may be bot-blocked)
- Watchlist with target price / any drop / half-price / historical low rules
- Append-only price history + ECharts in Web UI
- In-process worker + staggered scheduler
- HA summary + dynamic per-product entities/services
- Token list / rotate / recover paths

## Quick start (native / LXC)

```bash
cp .env.example .env
# Node.js >= 22.5 required (node:sqlite)
pnpm install
pnpm build
BOOTSTRAP_ISSUE_TOKENS=true pnpm start

# Tokens (first boot):
# journalctl -u easypws  OR  process stdout
# grep BOOTSTRAP_TOKEN / HA_API_TOKEN
```

Open `http://localhost:3000` — Web UI and `/api/v1` share one port.

Local monorepo dev:

```bash
pnpm install
BOOTSTRAP_ISSUE_TOKENS=true pnpm dev:api   # :3000 API + queue + scheduler
pnpm dev:web                               # :3001 UI → API at :3000
pnpm test
```

Production CT deploy: [infrastructure/deploy/README.md](infrastructure/deploy/README.md)

Token lost? Set `BOOTSTRAP_ROTATE_SECRET` and `POST /api/v1/tokens/recover`.

## API (Bearer token)

| Method | Path                                        | Purpose                                      |
| ------ | ------------------------------------------- | -------------------------------------------- |
| GET    | `/api/v1/auth/me`                           | current principal                            |
| POST   | `/api/v1/products/import`                   | `{ url, targetPrice? }`                      |
| GET    | `/api/v1/products/search?q=`                | Coles search (may fail under bot protection) |
| GET    | `/api/v1/watchlists/items`                  | list monitored products                      |
| PATCH  | `/api/v1/watchlists/items/:id/target-price` | set target                                   |
| POST   | `/api/v1/watchlists/items/:id/refresh`      | enqueue check (rate-limited)                 |
| GET    | `/api/v1/prices/listings/:id/history`       | chart points                                 |
| GET    | `/api/v1/ha/summary`                        | HA coordinator payload                       |
| POST   | `/api/v1/tokens/recover`                    | rotate bootstrap tokens with shared secret   |

## Docs

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [HA integration](integrations/home-assistant/README.md)
- [LXC deploy](infrastructure/deploy/README.md)

## License

Unlicense — see [LICENSE](LICENSE).
