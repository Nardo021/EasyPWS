# Docker / Proxmox deployment notes

## Target layout

```
Proxmox
├── Home Assistant VM          # consumers only — no scrapers/DB here
├── EasyPWS LXC                # this compose stack
│   ├── easypws-api
│   ├── easypws-worker
│   ├── easypws-scheduler
│   ├── easypws-web
│   ├── PostgreSQL
│   └── Redis
├── Authentik
├── Cloudflared
└── Monitoring (Uptime Kuma, optional Grafana)
```

## Quick start

```bash
cp .env.example .env
# set NEXT_PUBLIC_API_URL to a URL the browser can reach
docker compose up -d --build
```

Schema is applied on first Postgres boot via `infrastructure/migrations/001_init.sql`.

### Bootstrap tokens

On first API start with `BOOTSTRAP_ISSUE_TOKENS=true`:

```bash
docker compose logs api | grep -E 'BOOTSTRAP_TOKEN|HA_API_TOKEN'
```

Paste `BOOTSTRAP_TOKEN` into the Web UI. Use `HA_API_TOKEN` in the HA integration config.

If logs were lost, set `BOOTSTRAP_ROTATE_SECRET` and call:

```bash
curl -X POST http://localhost:3001/api/v1/tokens/recover \
  -H 'Content-Type: application/json' \
  -d '{"secret":"<BOOTSTRAP_ROTATE_SECRET>"}'
```

### Important env

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | Must be browser-reachable (not `api:3001` from your laptop) |
| `COLES_STORE_ID` | Store-scoped pricing |
| `HA_WEBHOOK_URL` | Optional notification channel |
| `MANUAL_REFRESH_COOLDOWN_MS` | Default 60000 |
| `SCHEDULER_STAGGER_MS` | Delay between enqueued due jobs |

## Domains (suggested)

- `easypws.leoze.top` — Web
- `api.price.leoze.top` — API

Edge: Cloudflare → Cloudflare Access → Authentik → EasyPWS.
