import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { db, ready } from "../../lib/db";
import {
  createWebhook,
  listWebhooks,
  deleteWebhook,
  dispatchRunEvent,
  WebhookLimitError,
  __setWebhookPoster,
} from "../../lib/webhooks";

const OWNER = "WALLET_WH";
const PUBLIC_URL = "http://93.184.216.34/hook"; // literal public IP → no DNS

beforeAll(async () => {
  await ready();
});
afterEach(() => {
  vi.restoreAllMocks();
  __setWebhookPoster(null); // reset the transport to the real SSRF-safe poster
});

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
    __setWebhookPoster(async (_url, opts) => {
      captured = { headers: opts.headers, body: opts.body };
      return { status: 200 };
    });

    await dispatchRunEvent(OWNER, "run.completed", { runId: "run_1", status: "completed" });

    expect(captured).not.toBeNull();
    const { headers, body } = captured!;
    expect(headers["x-aemulus-event"]).toBe("run.completed");
    // Timestamped signature: "t=<unix>,sha256=<hmac over `${t}.${body}`>"
    const sigHeader = headers["x-aemulus-signature"];
    const [tPart, sigPart] = sigHeader.split(",");
    expect(tPart).toMatch(/^t=\d+$/);
    const t = tPart.slice(2);
    const expected =
      "sha256=" +
      createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(sigPart).toBe(expected);
    expect(JSON.parse(body)).toMatchObject({ event: "run.completed", runId: "run_1" });
  });

  it("stores the signing secret encrypted at rest, not in plaintext", async () => {
    const { id, secret } = await createWebhook("WALLET_WH_ENC", PUBLIC_URL);
    const row = (await db.execute({ sql: `SELECT secret FROM webhooks WHERE id = ?`, args: [id] })).rows[0];
    const stored = String(row.secret);
    expect(stored).not.toBe(secret); // not the raw whsec_…
    expect(stored.startsWith("enc1:")).toBe(true); // AES-GCM ciphertext
    // But delivery still signs with the real secret (decrypted on dispatch).
    let sig = "";
    __setWebhookPoster(async (_u, opts) => {
      sig = opts.headers["x-aemulus-signature"];
      return { status: 200 };
    });
    await dispatchRunEvent("WALLET_WH_ENC", "run.completed", { runId: "e", status: "completed" });
    const t = sig.split(",")[0].slice(2);
    const body = JSON.stringify({ event: "run.completed", runId: "e", status: "completed" });
    expect(sig.split(",")[1]).toBe("sha256=" + createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  });

  it("fails closed on an unreadable secret — never signs with an empty key", async () => {
    const O = "WALLET_WH_BADSECRET";
    const { id } = await createWebhook(O, PUBLIC_URL);
    // Simulate a rotated AUTH_SECRET / corrupted row: an enc1: blob that won't decrypt.
    await db.execute({ sql: `UPDATE webhooks SET secret = 'enc1:not-real-ciphertext' WHERE id = ?`, args: [id] });
    let sent = false;
    __setWebhookPoster(async () => {
      sent = true;
      return { status: 200 };
    });
    await dispatchRunEvent(O, "run.completed", { runId: "x", status: "completed" });
    expect(sent).toBe(false); // nothing delivered under a bad/empty key
    const h = (await listWebhooks(O))[0];
    expect(h.lastError).toMatch(/secret/i);
  });

  it("caps webhooks per owner", async () => {
    const O = "WALLET_WH_CAP";
    for (let i = 0; i < 20; i++) await createWebhook(O, PUBLIC_URL);
    await expect(createWebhook(O, PUBLIC_URL)).rejects.toBeInstanceOf(WebhookLimitError);
  });

  it("auto-disables an endpoint after a streak of failed deliveries", async () => {
    const O = "WALLET_WH_DISABLE";
    const { id } = await createWebhook(O, PUBLIC_URL);
    // Pre-seed the streak to just under the threshold so ONE more failure trips
    // it — avoids 15 real deliveries each paying the retry backoff.
    await db.execute({ sql: `UPDATE webhooks SET fail_streak = 14 WHERE id = ?`, args: [id] });
    __setWebhookPoster(async () => ({ status: 500 })); // fails
    await dispatchRunEvent(O, "run.completed", { runId: "d", status: "completed" });
    expect((await listWebhooks(O))[0].active).toBe(false);

    // A disabled hook receives no further deliveries.
    let called = false;
    __setWebhookPoster(async () => {
      called = true;
      return { status: 200 };
    });
    await dispatchRunEvent(O, "run.completed", { runId: "after", status: "completed" });
    expect(called).toBe(false);
  }, 10_000);

  it("retries a failed delivery and records the attempt count", async () => {
    const OWNER2 = "WALLET_WH_RETRY";
    await createWebhook(OWNER2, PUBLIC_URL);
    let n = 0;
    __setWebhookPoster(async () => {
      n++;
      // fail the first attempt, succeed on the retry
      return { status: n > 1 ? 200 : 500 };
    });

    await dispatchRunEvent(OWNER2, "run.completed", { runId: "r2", status: "completed" });

    expect(n).toBe(2); // retried once after the 500
    const h = (await listWebhooks(OWNER2))[0];
    expect(h.lastStatus).toBe(200);
    expect(h.lastAttempts).toBe(2);
    expect(h.lastError).toBeNull();
  });
});
