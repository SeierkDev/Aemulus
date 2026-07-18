import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { reserveApEntry, releaseApEntry } from "../../lib/ap-controls/billing";

// The AP free-entry limit was a check-then-act (COUNT then seal on a fresh
// aggregate that never contends), so a concurrent burst could all pass. The
// reservation makes the count-and-insert one atomic statement.

beforeAll(async () => {
  await ready();
});

describe("atomic AP entry reservation", () => {
  it("caps sequential reservations at the limit, then refuses", async () => {
    const ws = "w_RESV_SEQ";
    const now = Date.now();
    expect(await reserveApEntry(ws, 2, now)).not.toBeNull();
    expect(await reserveApEntry(ws, 2, now)).not.toBeNull();
    expect(await reserveApEntry(ws, 2, now)).toBeNull(); // over the limit of 2
  });

  it("a concurrent burst can never exceed the limit", async () => {
    const ws = "w_RESV_BURST";
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => reserveApEntry(ws, 3, now)),
    );
    expect(results.filter((r) => r !== null).length).toBe(3); // exactly the limit
  });

  it("releasing a reservation returns the slot (a failed entry doesn't burn quota)", async () => {
    const ws = "w_RESV_RELEASE";
    const now = Date.now();
    const r1 = await reserveApEntry(ws, 1, now);
    expect(r1).not.toBeNull();
    expect(await reserveApEntry(ws, 1, now)).toBeNull(); // at limit
    await releaseApEntry(r1 as string);
    expect(await reserveApEntry(ws, 1, now)).not.toBeNull(); // slot freed
  });

  it("is scoped per workspace", async () => {
    const now = Date.now();
    expect(await reserveApEntry("w_RESV_A", 1, now)).not.toBeNull();
    expect(await reserveApEntry("w_RESV_A", 1, now)).toBeNull(); // A at limit
    expect(await reserveApEntry("w_RESV_B", 1, now)).not.toBeNull(); // B independent
  });
});
