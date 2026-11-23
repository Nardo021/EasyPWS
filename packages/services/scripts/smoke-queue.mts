import {
  _resetQueueForTests,
  _setQueueClockForTests,
  _settleQueueForTests,
  enqueuePriceCheck,
  startPriceCheckWorker,
  stopPriceCheckWorker,
  type QueueClock,
  type QueueTimer,
} from "../src/queue.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

interface ManualTimer {
  at: number;
  callback: () => void;
  cancelled: boolean;
}

class ManualClock implements QueueClock {
  current = 0;
  timers: ManualTimer[] = [];

  now(): number {
    return this.current;
  }

  setTimer(delayMs: number, callback: () => void): QueueTimer {
    const timer: ManualTimer = {
      at: this.current + delayMs,
      callback,
      cancelled: false,
    };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }

  private pending(): ManualTimer[] {
    return this.timers.filter((timer) => !timer.cancelled);
  }

  async fireDue(): Promise<void> {
    for (;;) {
      const ready = this.pending()
        .filter((timer) => timer.at <= this.current)
        .sort((a, b) => a.at - b.at);
      if (ready.length === 0) {
        return;
      }
      const readySet = new Set(ready);
      this.timers = this.timers.filter((timer) => !readySet.has(timer));
      for (const timer of ready) {
        timer.callback();
      }
      await _settleQueueForTests();
    }
  }

  async advance(ms: number): Promise<void> {
    this.current += ms;
    await this.fireDue();
  }

  /** Run every currently armed timer without moving the clock. */
  async fireArmedWithoutAdvancing(): Promise<void> {
    const armed = this.pending();
    this.timers = [];
    for (const timer of armed) {
      timer.callback();
    }
    await _settleQueueForTests();
  }
}

function useClock(): ManualClock {
  _resetQueueForTests();
  const clock = new ManualClock();
  _setQueueClockForTests(clock);
  return clock;
}

async function testPriorityAndDelay(): Promise<void> {
  const clock = useClock();
  const seen: string[] = [];
  startPriceCheckWorker(async (listingId) => {
    seen.push(listingId);
  });
  await enqueuePriceCheck("low", { priority: 100 });
  await enqueuePriceCheck("high", { priority: 1 });
  await enqueuePriceCheck("later", { priority: 1, delayMs: 80 });
  await clock.fireDue();
  assert(seen[0] === "high" && seen[1] === "low" && seen.length === 2, `priority order wrong: ${JSON.stringify(seen)}`);
  await clock.advance(79);
  assert(!seen.includes("later"), "delayed job ran before its deadline");
  await clock.advance(1);
  assert(seen[2] === "later", `delayed job missing: ${JSON.stringify(seen)}`);
}

async function testFutureJobDoesNotBlockReadyJob(): Promise<void> {
  const clock = useClock();
  const seen: string[] = [];
  startPriceCheckWorker(async (listingId) => {
    seen.push(listingId);
  });
  await enqueuePriceCheck("waiting", { priority: 1, delayMs: 50 });
  await enqueuePriceCheck("ready", { priority: 50 });
  await clock.fireDue();
  assert(JSON.stringify(seen) === JSON.stringify(["ready"]), `ready job blocked: ${JSON.stringify(seen)}`);
}

async function testEarlyWakeRearms(): Promise<void> {
  const clock = useClock();
  const seen: string[] = [];
  startPriceCheckWorker(async (listingId) => {
    seen.push(listingId);
  });
  await enqueuePriceCheck("delayed", { delayMs: 80 });
  await clock.fireArmedWithoutAdvancing();
  assert(seen.length === 0, "early timer consumed the delayed job");
  await clock.advance(80);
  assert(seen[0] === "delayed", "early wake did not re-arm the delayed job");
}

async function testStopDropsPendingWork(): Promise<void> {
  const clock = useClock();
  const seen: string[] = [];
  startPriceCheckWorker(async (listingId) => {
    seen.push(listingId);
  });
  await enqueuePriceCheck("delayed", { delayMs: 80 });
  stopPriceCheckWorker();
  await clock.advance(80);
  assert(seen.length === 0, "stopped worker still ran a job");
}

async function testRetryBackoffAndGiveUp(): Promise<void> {
  const clock = useClock();
  let attempts = 0;
  startPriceCheckWorker(async () => {
    attempts += 1;
    throw new Error("fail");
  });
  await enqueuePriceCheck("retry");
  await clock.fireDue();
  assert(attempts === 1, `expected first attempt, saw ${attempts}`);
  await clock.advance(29_999);
  assert(attempts === 1, "retry ran before the 30s backoff");
  await clock.advance(1);
  assert(attempts === 2, `expected second attempt, saw ${attempts}`);
  await clock.advance(60_000);
  assert(attempts === 3, `expected third attempt, saw ${attempts}`);
  await clock.advance(120_000);
  assert(attempts === 4, `expected fourth attempt, saw ${attempts}`);
  await clock.advance(240_000);
  assert(attempts === 5, `expected fifth attempt, saw ${attempts}`);
  await clock.advance(480_000);
  assert(attempts === 5, "job ran after maxAttempts");
}

async function testRetryThenSuccess(): Promise<void> {
  const clock = useClock();
  const seen: string[] = [];
  let attempts = 0;
  startPriceCheckWorker(async (listingId) => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error("fail");
    }
    seen.push(listingId);
  });
  await enqueuePriceCheck("ok");
  await clock.fireDue();
  await clock.advance(30_000);
  await clock.advance(60_000);
  assert(seen[0] === "ok", "successful retry did not record the job");
  assert(attempts === 3, `expected success on attempt 3, saw ${attempts}`);
  await clock.advance(120_000);
  assert(attempts === 3, "successful job was retried again");
}

await testPriorityAndDelay();
await testFutureJobDoesNotBlockReadyJob();
await testEarlyWakeRearms();
await testStopDropsPendingWork();
await testRetryBackoffAndGiveUp();
await testRetryThenSuccess();
_resetQueueForTests();
console.log("in-process queue smoke ok");
