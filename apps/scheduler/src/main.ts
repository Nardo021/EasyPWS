import { getDatabase, bootstrapSystem } from "@easypws/database";
import { createLogger } from "@easypws/observability";
import { enqueuePriceCheck, PriceCheckService } from "@easypws/services";

const log = createLogger("easypws-scheduler");

async function tick(priceChecks: PriceCheckService): Promise<void> {
  const due = await priceChecks.listDueListings(100);
  for (const listingId of due) {
    await enqueuePriceCheck(listingId, { priority: 50 });
  }
  if (due.length > 0) {
    log.info("Enqueued due listings", { count: due.length });
  }
}

async function main(): Promise<void> {
  const db = getDatabase();
  await bootstrapSystem(db, { issueTokens: false });
  const priceChecks = new PriceCheckService(db);
  const intervalMs = Number(process.env["SCHEDULER_INTERVAL_MS"] ?? 60_000);

  log.info("Scheduler started", { intervalMs });
  await tick(priceChecks);
  setInterval(() => {
    tick(priceChecks).catch((err: unknown) => {
      log.error("Scheduler tick failed", { err: String(err) });
    });
  }, intervalMs);
}

main().catch((err: unknown) => {
  log.error("Scheduler failed", { err: String(err) });
  process.exit(1);
});
