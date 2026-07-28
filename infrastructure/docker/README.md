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

## Quick start (data plane only)

```bash
cp .env.example .env
docker compose up -d postgres redis
```

Schema is applied on first Postgres boot via `infrastructure/migrations/001_init.sql`.

## App services (scaffold images)

```bash
docker compose --profile apps up -d --build
```

App containers are under the `apps` profile so empty scaffolds do not block bringing up Postgres/Redis.

## Domains (suggested)

- `easypws.leoze.top` — Web
- `api.price.leoze.top` or `price.leoze.top` — API

Edge: Cloudflare → Cloudflare Access → Authentik → EasyPWS.
