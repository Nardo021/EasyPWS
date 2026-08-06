import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { getDatabase, bootstrapSystem } from "@easypws/database";
import { createLogger } from "@easypws/observability";
import { PriceCheckService, PRICE_CHECK_QUEUE } from "@easypws/services";

const log = createLogger("easypws-worker");

async function main(): Promise<void> {
  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const db = getDatabase();
  await bootstrapSystem(db, { issueTokens: false });
  const priceChecks = new PriceCheckService(db);

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(
    PRICE_CHECK_QUEUE,
    async (job) => {
      const listingId = String((job.data as { listingId?: string }).listingId ?? "");
      if (!listingId) {
        throw new Error("listingId missing");
      }
      log.info("Checking price", { listingId, jobId: job.id });
      await priceChecks.checkListing(listingId);
    },
    { connection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    log.error("Job failed", { jobId: job?.id, err: err.message });
  });
  worker.on("completed", (job) => {
    log.info("Job completed", { jobId: job.id });
  });

  log.info("Worker ready", { redisUrl, queue: PRICE_CHECK_QUEUE });
}

main().catch((err: unknown) => {
  log.error("Worker failed", { err: String(err) });
  process.exit(1);
});
