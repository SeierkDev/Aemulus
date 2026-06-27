import { describe, it, expect } from "vitest";
import { Semaphore } from "../lib/semaphore";

describe("Semaphore", () => {
  it("allows up to max concurrent and queues the rest", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.inUse).toBe(2);

    let third = false;
    const p = sem.acquire().then(() => {
      third = true;
    });
    await Promise.resolve();
    expect(third).toBe(false); // queued, not granted
    expect(sem.waiting).toBe(1);

    sem.release(); // hands the slot to the waiter
    await p;
    expect(third).toBe(true);
    expect(sem.waiting).toBe(0);
  });

  it("never exceeds max under a burst", async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        await sem.acquire();
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        sem.release();
      }),
    );
    expect(peak).toBeLessThanOrEqual(3);
  });
});
