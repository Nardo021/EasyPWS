import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

let singleton: Database | null = null;
let sqlClient: ReturnType<typeof postgres> | null = null;

export function createDatabase(connectionString: string): Database {
  const sql = postgres(connectionString, { max: 10 });
  return drizzle(sql, { schema });
}

export function getDatabase(connectionString?: string): Database {
  if (singleton) {
    return singleton;
  }
  const url = connectionString ?? process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  sqlClient = postgres(url, { max: 10 });
  singleton = drizzle(sqlClient, { schema });
  return singleton;
}

export async function closeDatabase(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = null;
    singleton = null;
  }
}
