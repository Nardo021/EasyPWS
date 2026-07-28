import { createLogger } from "@easypws/observability";
import { QUEUE_NAMES } from "./queues.js";

const log = createLogger("easypws-worker");

/**
 * BullMQ worker scaffold.
 * Will consume: price_check, product_refresh, notification_delivery, image_process.
 */
async function main(): Promise<void> {
  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  log.info("Worker scaffold started", {
    redisUrl,
    queues: Object.values(QUEUE_NAMES),
    mode: "scaffold",
  });
  log.info("No consumers registered yet — awaiting implementation phase");

  // Keep process alive in docker for health/orchestration scaffolding.
  setInterval(() => {
    log.debug("worker heartbeat");
  }, 60_000);
}

main().catch((err: unknown) => {
  log.error("Worker failed", { err: String(err) });
  process.exit(1);
});
