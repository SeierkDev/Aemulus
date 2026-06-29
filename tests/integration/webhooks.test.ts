import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { ready } from "../../lib/db";
import {
  createWebhook,
  listWebhooks,
  deleteWebhook,
  dispatchRunEvent,
} from "../../lib/webhooks";

const OWNER = "WALLET_WH";
const PUBLIC_URL = "http://93.184.216.34/hook"; // literal public IP → no DNS

beforeAll(async () => {
  await ready();
});
afterEach(() => vi.restoreAllMocks());

describe("webhooks", () => {
  it("creates, lists (no secret leaked), and deletes", async () => {
    const { id, secret } = await createWebhook(OWNER, PUBLIC_URL);
    expect(secret.startsWith("whsec_")).toBe(true);
    const list = await listWebhooks(OWNER);
    const mine = list.find((w) => w.id === id)!;
    expect(mine.url).toBe(PUBLIC_URL);
    expect((mine as unknown as Record<string, unknown>).secret).toBeUndefined();
    expect(await deleteWebhook(id, OWNER)).toBe(true);
    expect((await listWebhooks(OWNER)).find((w) => w.id === id)).toBeUndefined();
  });

  it("rejects SSRF / private URLs at creation", async () => {
    await expect(createWebhook(OWNER, "http://10.0.0.1/x")).rejects.toThrow();
    await expect(createWebhook(OWNER, "http://localhost/x")).rejects.toThrow();
  });

  it("delivers events with a valid HMAC signature", async () => {
    const { secret } = await createWebhook(OWNER, PUBLIC_URL);
    let captured: { headers: Record<string, string>; body: string } | null = null;
    globalThis.fetch = vi.fn(async (_url, init: RequestInit) => {
      captured = {
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      };
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as typeof fetch;

    await dispatchRunEvent(OWNER, "run.completed", { runId: "run_1", status: "completed" });

    expect(captured).not.toBeNull();
    const { headers, body } = captured!;
    expect(headers["x-aemulus-event"]).toBe("run.completed");
    const expected =
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(headers["x-aemulus-signature"]).toBe(expected);
    expect(JSON.parse(body)).toMatchObject({ event: "run.completed", runId: "run_1" });
  });
});
