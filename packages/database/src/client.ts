import { DatabaseSync } from "node:sqlite";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import * as schema from "./schema.js";

export type Database = SqliteRemoteDatabase<typeof schema>;

let singleton: Database | null = null;
let sqlite: DatabaseSync | null = null;

export function resolveDatabasePath(explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  if (process.env["DATABASE_PATH"]) {
    return process.env["DATABASE_PATH"];
  }
  const dataDir = process.env["DATA_DIR"] ?? "./data";
  return join(dataDir, "easypws.sqlite");
}

function resolveAbsolutePath(path: string): string {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function resolveMigrationSqlPath(): string {
  const candidates = [
    join(process.cwd(), "infrastructure/migrations/001_init.sql"),
    join(process.cwd(), "../../infrastructure/migrations/001_init.sql"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "Cannot find infrastructure/migrations/001_init.sql (run from repo root)",
  );
}

function createProxyDb(client: DatabaseSync): Database {
  return drizzle(
    async (sql, params, method) => {
      const stmt = client.prepare(sql);
      // node:sqlite bind values; drizzle passes unknown[]
      const values = [...params] as never[];
      if (method === "run") {
        stmt.run(...values);
        return { rows: [] };
      }
      if (method === "get") {
        const row = stmt.get(...values) as Record<string, unknown> | undefined;
        return { rows: row ? Object.values(row) : [] };
      }
      const rows = stmt.all(...values) as Record<string, unknown>[];
      return { rows: rows.map((row) => Object.values(row)) };
    },
    { schema },
  );
}

export function ensureSchema(dbPath?: string): void {
  const absolute = resolveAbsolutePath(resolveDatabasePath(dbPath));
  mkdirSync(dirname(absolute), { recursive: true });

  const raw = new DatabaseSync(absolute);
  raw.exec("PRAGMA foreign_keys = ON");
  const row = raw
    .prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1",
    )
    .get() as { ok: number } | undefined;
  if (!row) {
    const sql = readFileSync(resolveMigrationSqlPath(), "utf8");
    raw.exec(sql);
  } else {
    raw.exec(`
INSERT OR IGNORE INTO retailers (id, display_name, base_url, enabled) VALUES
  ('coles', 'Coles', 'https://www.coles.com.au', 1),
  ('woolworths', 'Woolworths', 'https://www.woolworths.com.au', 1),
  ('aldi', 'ALDI', 'https://www.aldi.com.au', 0),
  ('chemist_warehouse', 'Chemist Warehouse', 'https://www.chemistwarehouse.com.au', 0),
  ('generic', 'Generic', '', 0);
`);
  }
  raw.close();
}

export function createDatabase(dbPath?: string): Database {
  const absolute = resolveAbsolutePath(resolveDatabasePath(dbPath));
  ensureSchema(absolute);
  const client = new DatabaseSync(absolute);
  client.exec("PRAGMA foreign_keys = ON");
  return createProxyDb(client);
}

export function getDatabase(dbPath?: string): Database {
  if (singleton) {
    return singleton;
  }
  const absolute = resolveAbsolutePath(resolveDatabasePath(dbPath));
  ensureSchema(absolute);
  sqlite = new DatabaseSync(absolute);
  sqlite.exec("PRAGMA foreign_keys = ON");
  singleton = createProxyDb(sqlite);
  return singleton;
}

export async function closeDatabase(): Promise<void> {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    singleton = null;
  }
}
