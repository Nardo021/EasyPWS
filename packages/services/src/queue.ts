export const PRICE_CHECK_QUEUE = "price_check";

export type PriceCheckHandler = (listingId: string) => Promise<void>;

export interface QueueTimer {
  cancel(): void;
}

/** Clock and timer used by the queue. Tests replace this so delays do not sleep. */
export interface QueueClock {
  now(): number;
  setTimer(delayMs: number, callback: () => void): QueueTimer;
}

interface QueueJob {
  id: string;
  listingId: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: number;
}

const systemClock: QueueClock = {
  now: () => Date.now(),
  setTimer(delayMs, callback) {
    const timer = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(timer) };
  },
};

const jobs: QueueJob[] = [];
const timers = new Set<QueueTimer>();

let clock: QueueClock = systemClock;
let handler: PriceCheckHandler | null = null;
let pumping = false;
let stopped = true;
let seq = 0;
let activePumps = 0;

function sortJobs(): void {
  jobs.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.runAt - b.runAt;
  });
}

function schedulePump(delayMs = 0): void {
  if (stopped) {
    return;
  }
  const timer = clock.setTimer(Math.max(0, delayMs), () => {
    timers.delete(timer);
    void pump();
  });
  timers.add(timer);
}

/**
 * A timer can fire before `runAt` because wall clocks and timer wheels differ.
 * Leaving the loop there used to drop the job. Arm the soonest future deadline.
 */
function armSoonest(): void {
  if (stopped) {
    return;
  }
  const now = clock.now();
  let soonest = Number.POSITIVE_INFINITY;
  for (const job of jobs) {
    if (job.runAt < soonest) {
      soonest = job.runAt;
    }
  }
  if (!Number.isFinite(soonest)) {
    return;
  }
  const wait = soonest - now;
  if (wait <= 0) {
    return;
  }
  schedulePump(wait);
}

async function pump(): Promise<void> {
  if (pumping || stopped || !handler) {
    return;
  }
  pumping = true;
  activePumps += 1;
  try {
    while (!stopped && handler) {
      const now = clock.now();
      const index = jobs.findIndex((job) => job.runAt <= now);
      if (index < 0) {
        break;
      }
      const [job] = jobs.splice(index, 1);
      if (!job) {
        break;
      }
      try {
        await handler(job.listingId);
      } catch {
        job.attempts += 1;
        if (job.attempts < job.maxAttempts) {
          const backoffMs = 30_000 * 2 ** (job.attempts - 1);
          job.runAt = clock.now() + backoffMs;
          jobs.push(job);
          sortJobs();
          schedulePump(backoffMs);
        }
      }
    }
  } finally {
    pumping = false;
    activePumps -= 1;
    armSoonest();
  }
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
  const id = `price_${listingId}_${clock.now()}_${seq}`;
  const delayMs = opts.delayMs ?? 0;
  const job: QueueJob = {
    id,
    listingId,
    priority: opts.priority ?? 100,
    attempts: 0,
    maxAttempts: 5,
    runAt: clock.now() + delayMs,
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
  for (const timer of timers) {
    timer.cancel();
  }
  timers.clear();
  jobs.length = 0;
}

/** Test helper */
export function _resetQueueForTests(): void {
  stopPriceCheckWorker();
  seq = 0;
  pumping = false;
  activePumps = 0;
  clock = systemClock;
}

/** Test helper. Call after `_resetQueueForTests`. */
export function _setQueueClockForTests(next: QueueClock): void {
  clock = next;
}

/** Test helper. Resolves when an in-flight pump has finished and armed its next timer. */
export async function _settleQueueForTests(): Promise<void> {
  while (activePumps > 0) {
    await Promise.resolve();
  }
}
