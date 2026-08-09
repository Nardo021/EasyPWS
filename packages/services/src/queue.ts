export const PRICE_CHECK_QUEUE = "price_check";

export type PriceCheckHandler = (listingId: string) => Promise<void>;

interface QueueJob {
  id: string;
  listingId: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: number;
}

const jobs: QueueJob[] = [];
const delayedTimers = new Set<ReturnType<typeof setTimeout>>();

let handler: PriceCheckHandler | null = null;
let pumping = false;
let stopped = true;
let seq = 0;

function sortJobs(): void {
  jobs.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.runAt - b.runAt;
  });
}

async function pump(): Promise<void> {
  if (pumping || stopped || !handler) {
    return;
  }
  pumping = true;
  try {
    while (!stopped && handler) {
      const now = Date.now();
      const idx = jobs.findIndex((j) => j.runAt <= now);
      if (idx < 0) {
        break;
      }
      const [job] = jobs.splice(idx, 1);
      if (!job) {
        break;
      }
      try {
        await handler(job.listingId);
      } catch {
        job.attempts += 1;
        if (job.attempts < job.maxAttempts) {
          const backoffMs = 30_000 * 2 ** (job.attempts - 1);
          job.runAt = Date.now() + backoffMs;
          jobs.push(job);
          sortJobs();
          schedulePump(backoffMs);
        }
      }
    }
  } finally {
    pumping = false;
  }
}

function schedulePump(delayMs = 0): void {
  if (stopped) {
    return;
  }
  const timer = setTimeout(() => {
    delayedTimers.delete(timer);
    void pump();
  }, delayMs);
  delayedTimers.add(timer);
}

/** @deprecated no-op retained for call-site compatibility during migration */
export function getPriceCheckQueue(): { name: string } {
  return { name: PRICE_CHECK_QUEUE };
}

export async function enqueuePriceCheck(
  listingId: string,
  opts: { priority?: number; delayMs?: number } = {},
): Promise<string> {
  seq += 1;
  const id = `price_${listingId}_${Date.now()}_${seq}`;
  const delayMs = opts.delayMs ?? 0;
  const job: QueueJob = {
    id,
    listingId,
    priority: opts.priority ?? 100,
    attempts: 0,
    maxAttempts: 5,
    runAt: Date.now() + delayMs,
  };
  jobs.push(job);
  sortJobs();
  schedulePump(delayMs);
  return id;
}

export function startPriceCheckWorker(next: PriceCheckHandler): void {
  handler = next;
  stopped = false;
  schedulePump(0);
}

export function stopPriceCheckWorker(): void {
  stopped = true;
  handler = null;
  for (const timer of delayedTimers) {
    clearTimeout(timer);
  }
  delayedTimers.clear();
  jobs.length = 0;
}

/** Test helper */
export function _resetQueueForTests(): void {
  stopPriceCheckWorker();
  seq = 0;
  pumping = false;
}
