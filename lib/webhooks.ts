import { createHmac, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { db, ready } from "./db";
import { id } from "./ids";
import { assertSafeUrl } from "./safe-url";
import { logError } from "./log";
import { incr } from "./metrics";

/**
 * Outbound webhooks for run events (run.completed / run.needs_review /
 * run.failed). Each delivery is HMAC-signed so receivers can verify it. URLs
 * are SSRF-guarded at create AND delivery time (a subscriber can't point us at
 * internal services), and deliveries time out.
 */

export interface WebhookMeta {
  id: string;
  url: string;
  active: boolean;
  lastStatus: number | null;
  lastAt: number | null;
  lastAttempts: number | null;
  lastError: string | null;
  createdAt: number;
}

export type RunEvent = "run.completed" | "run.needs_review" | "run.failed";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 800, 2500]; // delay before attempt i
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Timestamped HMAC signature (Stripe-style): the signed payload is
 * `${t}.${body}`, so a receiver can reject a stale/replayed delivery by checking
 * `t` is recent before comparing the HMAC. Header: `t=<unix>,sha256=<hex>`.
 */
function sign(secret: string, ts: number, body: string): string {
  const mac = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},sha256=${mac}`;
}

/** Create a webhook. Throws (via assertSafeUrl) if the URL is unsafe/private. */
export async function createWebhook(
  owner: string,
  url: string,
): Promise<{ id: string; secret: string }> {
  await assertSafeUrl(url);
  await ready();
  const wid = id("wh");
  const secret = `whsec_${bs58.encode(randomBytes(24))}`;
  await db.execute({
    sql: `INSERT INTO webhooks (id, owner, url, secret, active, created_at)
          VALUES (?, ?, ?, ?, 1, ?)`,
    args: [wid, owner, url, secret, Date.now()],
  });
  return { id: wid, secret };
}

export async function listWebhooks(owner: string): Promise<WebhookMeta[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT id, url, active, last_status, last_at, last_attempts, last_error, created_at
          FROM webhooks WHERE owner = ? ORDER BY created_at DESC`,
    args: [owner],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    url: String(x.url),
    active: Number(x.active) === 1,
    lastStatus: x.last_status == null ? null : Number(x.last_status),
    lastAt: x.last_at == null ? null : Number(x.last_at),
    lastAttempts: x.last_attempts == null ? null : Number(x.last_attempts),
    lastError: x.last_error == null ? null : String(x.last_error),
    createdAt: Number(x.created_at),
  }));
}

export async function deleteWebhook(
  webhookId: string,
  owner: string,
): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `DELETE FROM webhooks WHERE id = ? AND owner = ?`,
    args: [webhookId, owner],
  });
  return r.rowsAffected > 0;
}

/** Deliver an event to all of an owner's active webhooks (signed, best-effort). */
export async function dispatchRunEvent(
  owner: string,
  event: RunEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  await ready();
  const r = await db.execute({
    sql: `SELECT id, url, secret FROM webhooks WHERE owner = ? AND active = 1`,
    args: [owner],
  });
  if (r.rows.length === 0) return;
  const body = JSON.stringify({ event, ...payload });
  // One timestamp/signature per delivery — reused across retries so a receiver's
  // replay window doesn't reject a legitimate retry.
  const ts = Math.floor(Date.now() / 1000);

  for (const w of r.rows) {
    const url = String(w.url);
    const signature = sign(String(w.secret), ts, body);
    let status = 0;
    let lastError: string | null = null;
    let attempts = 0;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (BACKOFF_MS[i]) await sleep(BACKOFF_MS[i]);
      attempts = i + 1;
      try {
        await assertSafeUrl(url); // re-check: host could resolve private now
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-aemulus-event": event,
            "x-aemulus-signature": signature,
          },
          body,
          // Never follow redirects — a 3xx to an internal host would bypass the
          // SSRF guard, which only validated the original URL.
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
        status = res.status;
        lastError = status >= 200 && status < 300 ? null : `HTTP ${status}`;
      } catch (e) {
        status = 0;
        lastError = e instanceof Error ? e.message : "delivery failed";
        logError("webhook.deliver", e, { url, attempt: attempts });
      }
      if (status >= 200 && status < 300) break; // delivered — stop retrying
    }

    incr(status >= 200 && status < 300 ? "webhooks.delivered" : "webhooks.failed");
    await db
      .execute({
        sql: `UPDATE webhooks SET last_status = ?, last_at = ?, last_attempts = ?, last_error = ? WHERE id = ?`,
        args: [status, Date.now(), attempts, lastError, String(w.id)],
      })
      .catch(() => {});
  }
}

/** Map a terminal run status to its event name. */
export function eventForStatus(status: string): RunEvent {
  if (status === "completed") return "run.completed";
  if (status === "needs_review") return "run.needs_review";
  return "run.failed";
}
