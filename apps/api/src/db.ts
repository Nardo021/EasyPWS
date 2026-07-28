import { getDatabase, type Database } from "@easypws/database";

export function db(): Database {
  return getDatabase();
}
