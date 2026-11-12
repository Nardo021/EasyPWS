export interface RouterClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): { cancel(): void };
}

interface ManualTimer {
  at: number;
  callback: () => void;
  cancelled: boolean;
}

/** Test clock. Callers advance time; nothing in the router sleeps. */
export class ManualClock implements RouterClock {
  private current: number;
  private readonly timers: ManualTimer[] = [];

  constructor(startMs: number) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  setTimer(callback: () => void, delayMs: number): { cancel(): void } {
    const timer: ManualTimer = {
      at: this.current + delayMs,
      callback,
      cancelled: false,
    };
    this.timers.push(timer);
    return {
      cancel() {
        timer.cancelled = true;
      },
    };
  }

  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      let next: ManualTimer | undefined;
      for (const timer of this.timers) {
        if (timer.cancelled || timer.at > target) {
          continue;
        }
        if (!next || timer.at < next.at) {
          next = timer;
        }
      }
      if (!next) {
        break;
      }
      this.current = next.at;
      next.cancelled = true;
      next.callback();
    }
    this.current = target;
  }
}

export function systemRouterClock(): RouterClock {
  return {
    now: () => Date.now(),
    setTimer(callback, delayMs) {
      const handle = setTimeout(callback, delayMs);
      return {
        cancel() {
          clearTimeout(handle);
        },
      };
    },
  };
}
