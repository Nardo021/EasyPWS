import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const PRICE_CHECK_QUEUE = "price_check";

let queue: Queue | null = null;
let connection: Redis | null = null;

function getConnection(): Redis {
  if (!connection) {
    const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";
    connection = new Redis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getPriceCheckQueue(): Queue {
  if (!queue) {
    queue = new Queue(PRICE_CHECK_QUEUE, { connection: getConnection() });
  }
  return queue;
}

export async function enqueuePriceCheck(
  listingId: string,
  opts: { priority?: number; delayMs?: number } = {},
): Promise<string> {
  const job = await getPriceCheckQueue().add(
    "check",
    { listingId },
    {
      jobId: `price_${listingId}_${Date.now()}`,
      priority: opts.priority ?? 100,
      delay: opts.delayMs,
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
    },
  );
  return job.id ?? listingId;
}
