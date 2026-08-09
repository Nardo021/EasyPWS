import type { Database } from "@easypws/database";
import { createLogger } from "@easypws/observability";
import { PriceCheckService } from "./price-check-service.js";
import {
  enqueuePriceCheck,
  startPriceCheckWorker,
  stopPriceCheckWorker,
} from "./queue.js";

const log = createLogger("easypws-runtime");

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

async function schedulerTick(priceChecks: PriceCheckService): Promise<void> {
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

export function startPriceCheckRuntime(db: Database): void {
  const priceChecks = new PriceCheckService(db);
  startPriceCheckWorker(async (listingId) => {
    await priceChecks.checkListing(listingId);
  });

  const intervalMs = Number(process.env["SCHEDULER_INTERVAL_MS"] ?? 60_000);
  void schedulerTick(priceChecks).catch((err: unknown) => {
    log.error("Initial scheduler tick failed", { err: String(err) });
  });
  schedulerTimer = setInterval(() => {
    schedulerTick(priceChecks).catch((err: unknown) => {
      log.error("Scheduler tick failed", { err: String(err) });
    });
  }, intervalMs);
  log.info("Price-check runtime started", { intervalMs, concurrency: 1 });
}

export function stopPriceCheckRuntime(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  stopPriceCheckWorker();
  log.info("Price-check runtime stopped");
}
