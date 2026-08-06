import { getDatabase, bootstrapSystem } from "@easypws/database";
import { createLogger } from "@easypws/observability";
import { enqueuePriceCheck, PriceCheckService } from "@easypws/services";

const log = createLogger("easypws-scheduler");

async function tick(priceChecks: PriceCheckService): Promise<void> {
  const due = await priceChecks.listDueListings(100);
  const staggerMs = Number(process.env["SCHEDULER_STAGGER_MS"] ?? 1500);
  for (let i = 0; i < due.length; i += 1) {
    const listingId = due[i]!;
    await enqueuePriceCheck(listingId, {
      priority: 50,
      delayMs: i * staggerMs,
    });
  }
  if (due.length > 0) {
    log.info("Enqueued due listings", { count: due.length, staggerMs });
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
