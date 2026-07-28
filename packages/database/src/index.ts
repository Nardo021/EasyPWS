/**
 * Database package scaffold.
 * SQL migrations live in infrastructure/migrations/.
 * ORM / query client selection (Drizzle / Prisma / pg) happens in implementation phase.
 */

export const MIGRATIONS_PATH = "infrastructure/migrations";

export interface DatabaseConfig {
  connectionString: string;
}
