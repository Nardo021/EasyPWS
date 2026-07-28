# EasyPWS Architecture

**FRAME:** Independent price monitoring platform + Home Assistant integration layer.  
Do **not** put scraping, database, or rule engine inside HAOS.

## Stack (chosen)

| Layer | Choice |
|-------|--------|
| Web | Next.js + TypeScript |
| API | NestJS |
| Worker / Scheduler | BullMQ |
| Database | PostgreSQL |
| Cache / Queue | Redis |
| Deployment | Docker Compose on Debian LXC |
| Auth | Authentik OIDC + API tokens |
| HA | Native custom integration |

## System context

```text
User Interfaces
  EasyPWS Web UI | Home Assistant | Mobile / PWA
        │ HTTPS/REST │ WebSocket / MQTT
        ▼            ▼
                 EasyPWS API
                      │
           Application Services
     (products, watchlists, collection,
      history, promo detect, rules, notify)
           │                    │
   Retailer Adapters      Async Workers
           │                    │
                 Data Layer
        PostgreSQL | Redis | Object Storage
```

## Monorepo layout

```text
easypws/
├── apps/           # web, api, worker, scheduler
├── packages/       # contracts, core, database, adapters, rules, notifications, observability
├── integrations/   # home-assistant custom component
├── infrastructure/ # docker notes, migrations, cloudflare, monitoring
├── docs/
└── docker-compose.yml
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

| Tier | Interval |
|------|----------|
| On promotion | 2–4 h |
| Normal watch | 6–12 h |
| Stale / no change | 24 h |
| Adapter failure | exponential backoff |
| Manual refresh | rate-limited immediate |

## Home Assistant role

HA: entities, quick controls, automations, notifications.  
Web UI: search, charts, complex watchlist management.

## First-release scope (future implementation)

Coles → URL import → search → target price / any drop / half-price →  
current/regular/discount/historical low → chart → pause/delete → HA notify/control.  
Woolworths as second adapter to validate abstraction.
