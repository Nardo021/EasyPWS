import { CHECK_INTERVAL_HOURS } from "@easypws/contracts";
import { createLogger } from "@easypws/observability";

const log = createLogger("easypws-scheduler");

/**
 * Scheduler scaffold.
 * Adaptive tiers (architecture §8):
 * - on_promotion: 2–4h
 * - normal: 6–12h
 * - stale: 24h
 * - adapter_backoff: exponential
 * - manual: rate-limited immediate
 */
async function main(): Promise<void> {
  log.info("Scheduler scaffold started", {
    tiers: CHECK_INTERVAL_HOURS,
    mode: "scaffold",
  });
  log.info("Job enqueuing not wired — awaiting listings + BullMQ producer");

  setInterval(() => {
    log.debug("scheduler heartbeat");
  }, 60_000);
}

main().catch((err: unknown) => {
  log.error("Scheduler failed", { err: String(err) });
  process.exit(1);
});
