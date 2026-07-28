# Database migrations

SQL migrations are the source of truth for EasyPWS schema.

| File | Description |
|------|-------------|
| `001_init.sql` | Core tables: users, products, listings, append-only `price_observations`, watchlists, rules, jobs, notifications, adapter health |

## Apply (scaffold)

Until a migrator is chosen (Drizzle / Prisma / node-pg-migrate):

```bash
docker compose up -d postgres
psql "$DATABASE_URL" -f infrastructure/migrations/001_init.sql
```

## Design notes

- **Never overwrite** rows in `price_observations` — charts, historical low, and anomaly detection depend on append-only history.
- Canonical `products` are distinct from `retailer_listings` so one product can map to Coles + Woolworths listings.
- `check_tier` / `next_check_at` on listings support adaptive scheduling (promo vs stale vs backoff).
