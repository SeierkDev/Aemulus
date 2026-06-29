import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { withIdempotency } from "../../lib/idempotency";

beforeAll(async () => {
  await ready();
});

describe("withIdempotency", () => {
  it("runs the handler once per key and replays the stored response", async () => {
    let calls = 0;
    const run = (key: string | null) =>
      withIdempotency("OWNER_A", "test", key, async () => {
        calls++;
        return { status: 200, body: { n: calls } };
      });

    const first = await run("k1");
    const replay = await run("k1");
    expect(calls).toBe(1); // handler ran ONCE
    expect(first.body).toEqual({ n: 1 });
    expect(replay.body).toEqual({ n: 1 }); // same original response

    // A different key runs again.
    const other = await run("k2");
    expect(calls).toBe(2);
    expect(other.body).toEqual({ n: 2 });
  });

  it("does not dedup across different owners or scopes", async () => {
    let calls = 0;
    const h = async () => {
      calls++;
      return { status: 200, body: { calls } };
    };
    await withIdempotency("OWNER_B", "scopeX", "same", h);
    await withIdempotency("OWNER_C", "scopeX", "same", h); // different owner
    await withIdempotency("OWNER_B", "scopeY", "same", h); // different scope
    expect(calls).toBe(3);
  });

  it("runs every time when no key is supplied", async () => {
    let calls = 0;
    const h = async () => {
      calls++;
      return { status: 200, body: {} };
    };
    await withIdempotency("OWNER_D", "test", null, h);
    await withIdempotency("OWNER_D", "test", null, h);
    expect(calls).toBe(2);
  });

  it("releases the reservation when the handler throws (retry can proceed)", async () => {
    let calls = 0;
    const flaky = () =>
      withIdempotency("OWNER_E", "test", "retry", async () => {
        calls++;
        if (calls === 1) throw new Error("transient");
        return { status: 200, body: { ok: true } };
      });

    await expect(flaky()).rejects.toThrow("transient");
    const second = await flaky(); // same key — must NOT be stuck/409
    expect(calls).toBe(2);
    expect(second.body).toEqual({ ok: true });
  });
});
