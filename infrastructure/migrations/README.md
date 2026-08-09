# Schema migrations

SQLite DDL lives in [`001_init.sql`](./001_init.sql).

Applied automatically on process start via `ensureSchema()` in `@easypws/database` when the `users` table is missing.

Manual apply (optional):

```bash
sqlite3 "$DATABASE_PATH" < infrastructure/migrations/001_init.sql
```
