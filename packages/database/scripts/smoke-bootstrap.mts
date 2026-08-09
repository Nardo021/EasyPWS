import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapSystem } from "../src/bootstrap.ts";
import { closeDatabase, getDatabase } from "../src/client.ts";

const dir = mkdtempSync(join(tmpdir(), "easypws-db-"));
process.env["DATABASE_PATH"] = join(dir, "test.sqlite");

try {
  const db = getDatabase();
  const result = await bootstrapSystem(db, {
    email: "test@easypws.local",
    issueTokens: true,
    colesStoreId: "647",
  });
  if (!result.userId || !result.bootstrapToken?.startsWith("epws_")) {
    throw new Error(`bootstrap failed: ${JSON.stringify(result)}`);
  }
  console.log("sqlite bootstrap smoke ok");
} finally {
  await closeDatabase();
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
}
