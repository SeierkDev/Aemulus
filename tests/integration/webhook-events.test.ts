import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { ready } from "../../lib/db";
import { createWebhook, listWebhooks, dispatchRunEvent } from "../../lib/webhooks";

const PUBLIC_URL = "http://93.184.216.34/hook"; // literal public IP, no DNS

beforeAll(async () => {
  await ready();
});
afterEach(() => vi.restoreAllMocks());

describe("webhook event subscriptions (output destinations)", () => {
  it("only delivers events a webhook is subscribed to", async () => {
    const owner = "WH_EVT";
    await createWebhook(owner, PUBLIC_URL, ["run.output"]); // results-only
    const list = await listWebhooks(owner);
    expect(list[0].events).toEqual(["run.output"]);

    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as typeof fetch;

    // not subscribed -> no delivery
    await dispatchRunEvent(owner, "run.completed", { runId: "r1", status: "completed" });
    expect(calls).toBe(0);

    // subscribed -> delivered
    await dispatchRunEvent(owner, "run.output", { runId: "r1", output: { a: "1" } });
    expect(calls).toBe(1);
  });

  it("defaults to the status events (run.output is opt-in)", async () => {
    const owner = "WH_EVT2";
    await createWebhook(owner, PUBLIC_URL); // no events arg
    const list = await listWebhooks(owner);
    expect(list[0].events).toEqual([
      "run.completed",
      "run.needs_review",
      "run.failed",
    ]);
    expect(list[0].events).not.toContain("run.output");
  });
});
