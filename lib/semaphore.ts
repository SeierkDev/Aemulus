/**
 * Tiny async semaphore. Bounds how many runs launch Chromium concurrently so a
 * burst of requests can't exhaust server memory — excess runs queue and start
 * as slots free up. Cached on globalThis so the cap is process-wide (HMR-safe).
 */
export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next(); // hand the slot directly to the next waiter
    else this.active--;
  }

  get inUse(): number {
    return this.active;
  }
  get waiting(): number {
    return this.queue.length;
  }
}

const MAX = Math.max(1, Number(process.env.MIMIC_MAX_CONCURRENT_RUNS) || 3);

declare global {
  var __mimicRunSlots: Semaphore | undefined;
}

export const runSlots: Semaphore =
  globalThis.__mimicRunSlots ?? (globalThis.__mimicRunSlots = new Semaphore(MAX));
