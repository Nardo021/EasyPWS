# EasyPWS Architecture

**FRAME:** Independent price monitoring platform + Home Assistant integration layer.  
Do **not** put scraping, database, or rule engine inside HAOS.

## Stack (chosen)

| Layer              | Choice                                        |
| ------------------ | --------------------------------------------- |
| Web                | Next.js static export (same origin)           |
| API                | NestJS                                        |
| Worker / Scheduler | In-process queue + poller                     |
| Database           | SQLite (`node:sqlite`) + Drizzle              |
| Queue              | In-process (no Redis)                         |
| Deployment         | Single Node process on Debian LXC via systemd |
| Auth               | Authentik OIDC (later) + API tokens           |
| HA                 | Native custom integration                     |

## System context

```text
User Interfaces
  EasyPWS Web UI | Home Assistant | Mobile / PWA
        │ HTTPS/REST │
        ▼
   EasyPWS single process (:3000)
     Web static + /api/v1 + worker + scheduler
        │
   Retailer Adapters
        │
   SQLite (easypws.sqlite)
```

## Monorepo layout

```text
easypws/
├── apps/           # web (static export), api (single runtime)
├── packages/       # contracts, core, database, adapters, rules, notifications, observability, services
├── integrations/   # home-assistant custom component
├── infrastructure/ # deploy, systemd, migrations, cloudflare, monitoring
└── docs/
```

## Data model

- **Canonical Product** — barcode/brand/name/size (retailer-agnostic)
- **Retailer Listing** — Coles/Woolworths page + current price snapshot fields
- **Price Observation** — append-only history (never overwrite)

See `infrastructure/migrations/001_init.sql` and `@easypws/contracts`.

## Adapter priority

1. Retailer internal JSON/API
2. Stable third-party API
3. HTML scrape
4. Headless browser (last resort)

## Watch rules

`TARGET_PRICE`, `ANY_PRICE_DROP`, `HALF_PRICE`, `DISCOUNT_PERCENTAGE`,  
`HISTORICAL_LOW`, `BACK_IN_STOCK`, `OUT_OF_STOCK`, `PROMOTION_STARTED`, `PROMOTION_ENDED`

Evaluation flow: new observation → compare previous → evaluate rules → cooldown/dedupe → notify.

## Adaptive scheduling

| Tier              | Interval               |
| ----------------- | ---------------------- |
| On promotion      | 2–4 h                  |
| Normal watch      | 6–12 h                 |
| Stale / no change | 24 h                   |
| Adapter failure   | exponential backoff    |
| Manual refresh    | rate-limited immediate |

## Home Assistant role

HA: entities, quick controls, automations, notifications.  
Web UI: search, charts, complex watchlist management.
