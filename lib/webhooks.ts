import { createHmac, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { db, ready } from "./db";
import { id } from "./ids";
import { assertSafeUrl, safePostJson } from "./safe-url";
import { encryptJSON, decryptJSON } from "./encrypt";
import { logError } from "./log";
import { incr } from "./metrics";

// Bound the blast radius of a single tenant: cap subscriptions per owner (also
// caps per-event fan-out), and auto-deactivate an endpoint after this many
// consecutive failed deliveries so a dead/hostile sink isn't re-attacked forever.
const MAX_WEBHOOKS_PER_OWNER = 20;
const FAIL_STREAK_DISABLE = 15;

/** Host only (no path/query) — for logs, so a secret in a URL query can't leak. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/** The signing secret is encrypted at rest; recover it (tolerating a legacy
 *  plaintext row) to compute the HMAC. Returns null when an encrypted secret
 *  WON'T decrypt (AUTH_SECRET rotated / row corrupted) so the caller can fail
 *  CLOSED — signing with the "" decrypt-failure fallback would emit deliveries
 *  under an empty, forgeable key that no receiver could verify. */
function resolveSecret(stored: string): string | null {
  if (!stored.startsWith("enc1:")) return stored || null; // legacy plaintext
  const s = decryptJSON<string>(stored, "");
  return s.startsWith("whsec_") ? s : null; // "" (or garbage) → decrypt failed
}

/**
 * Outbound webhooks for run events (run.completed / run.needs_review /
 * run.failed). Each delivery is HMAC-signed so receivers can verify it. URLs
 * are SSRF-guarded at create AND delivery time (a subscriber can't point us at
 * internal services), and deliveries time out.
 */

export type RunEvent =
  | "run.completed"
  | "run.needs_review"
  | "run.failed"
  | "run.output";

/** All subscribable events; run.output carries a run's extracted data. */
const ALL_EVENTS: RunEvent[] = [
  "run.completed",
  "run.needs_review",
  "run.failed",
  "run.output",
];
/** Default subscription (back-compat: the status events, not run.output). */
const DEFAULT_EVENTS: RunEvent[] = ["run.completed", "run.needs_review", "run.failed"];

export interface WebhookMeta {
  id: string;
  url: string;
  active: boolean;
  events: RunEvent[];
  lastStatus: number | null;
  lastAt: number | null;
  lastAttempts: number | null;
  lastError: string | null;
  createdAt: number;
}

function parseEvents(raw: unknown): RunEvent[] {
  const parts = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is RunEvent => (ALL_EVENTS as string[]).includes(s));
  return parts.length ? parts : DEFAULT_EVENTS;
}

function cleanEvents(events?: string[]): RunEvent[] {
  const set = (events ?? DEFAULT_EVENTS).filter((e): e is RunEvent =>
    (ALL_EVENTS as string[]).includes(e),
  );
  return set.length ? [...new Set(set)] : DEFAULT_EVENTS;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 800, 2500]; // delay before attempt i
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The delivery transport, injectable so tests can drive delivery without a real
// socket (which the SSRF guard would rightly block for a local endpoint anyway).
type Poster = typeof safePostJson;
let poster: Poster = safePostJson;
/** Test-only: override (or reset with null) the delivery transport. */
export function __setWebhookPoster(p: Poster | null): void {
  poster = p ?? safePostJson;
}

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
export class WebhookLimitError extends Error {
  constructor() {
    super(`You can have at most ${MAX_WEBHOOKS_PER_OWNER} webhooks.`);
    this.name = "WebhookLimitError";
  }
}

export async function createWebhook(
  owner: string,
  url: string,
  events?: string[],
): Promise<{ id: string; secret: string }> {
  await assertSafeUrl(url);
  await ready();
  const count = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM webhooks WHERE owner = ?`,
    args: [owner],
  });
  if (Number(count.rows[0]?.n ?? 0) >= MAX_WEBHOOKS_PER_OWNER) {
    throw new WebhookLimitError();
  }
  const wid = id("wh");
  const secret = `whsec_${bs58.encode(randomBytes(24))}`;
  // Store the secret ENCRYPTED at rest — the server needs the plaintext to sign
  // (so it can't be hashed like an inbound API key), but a DB read shouldn't let
  // an attacker forge valid signatures to every subscriber.
  await db.execute({
    sql: `INSERT INTO webhooks (id, owner, url, secret, events, active, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)`,
    args: [wid, owner, url, encryptJSON(secret), cleanEvents(events).join(","), Date.now()],
  });
  return { id: wid, secret };
}

export async function listWebhooks(owner: string): Promise<WebhookMeta[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT id, url, active, events, last_status, last_at, last_attempts, last_error, created_at
          FROM webhooks WHERE owner = ? ORDER BY created_at DESC`,
    args: [owner],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    url: String(x.url),
    active: Number(x.active) === 1,
    events: parseEvents(x.events),
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
    sql: `SELECT id, url, secret, events FROM webhooks WHERE owner = ? AND active = 1`,
    args: [owner],
  });
  // Only deliver to webhooks subscribed to this event.
  const subscribers = r.rows.filter((w) => parseEvents(w.events).includes(event));
  if (subscribers.length === 0) return;
  const body = JSON.stringify({ event, ...payload });
  // One timestamp/signature per delivery - reused across retries so a receiver's
  // replay window doesn't reject a legitimate retry.
  const ts = Math.floor(Date.now() / 1000);

  // Deliver to all subscribers concurrently so one slow/dead endpoint can't
  // serialize behind the others (each still retries with backoff internally).
  await Promise.allSettled(subscribers.map((w) => deliver(w, event, body, ts)));
}

async function deliver(
  w: Record<string, unknown>,
  event: RunEvent,
  body: string,
  ts: number,
): Promise<void> {
  {
    const url = String(w.url);
    const secret = resolveSecret(String(w.secret));
    let status = 0;
    let lastError: string | null = null;
    let attempts = 0;

    // Fail CLOSED on an unreadable secret: don't send anything signed with an
    // empty key. Recorded as a failed delivery below, so the fail_streak guard
    // eventually auto-disables a hook whose secret can no longer be decrypted.
    const signature = secret === null ? null : sign(secret, ts, body);
    if (signature === null) {
      lastError = "signing secret unreadable";
      logError("webhook.deliver", new Error(lastError), { host: safeHost(url) });
    }

    for (let i = 0; signature !== null && i < MAX_ATTEMPTS; i++) {
      if (BACKOFF_MS[i]) await sleep(BACKOFF_MS[i]);
      attempts = i + 1;
      try {
        // safePostJson pins DNS through the SSRF guard (the resolved IP IS the
        // connected IP), so a host that rebinds to a private address between the
        // check and the connection can't slip through — and it never follows
        // redirects or buffers the response body.
        const res = await poster(url, {
          body,
          headers: {
            "content-type": "application/json",
            "x-aemulus-event": event,
            "x-aemulus-signature": signature!, // loop only runs when non-null
          },
          timeoutMs: 8000,
        });
        status = res.status;
        lastError = status >= 200 && status < 300 ? null : `HTTP ${status}`;
      } catch (e) {
        status = 0;
        lastError = e instanceof Error ? e.message : "delivery failed";
        // Log the HOST only — the full URL could carry a secret in its query.
        logError("webhook.deliver", e, { host: safeHost(url), attempt: attempts });
      }
      if (status >= 200 && status < 300) break; // delivered - stop retrying
    }

    const delivered = status >= 200 && status < 300;
    incr(delivered ? "webhooks.delivered" : "webhooks.failed");
    // Reset the failure streak on success; on failure bump it and auto-disable
    // the endpoint once it crosses the threshold (dead/hostile sinks stop being
    // re-attacked every run). All in one atomic UPDATE.
    await db
      .execute({
        sql: `UPDATE webhooks
              SET last_status = ?, last_at = ?, last_attempts = ?, last_error = ?,
                  fail_streak = CASE WHEN ? = 1 THEN 0 ELSE fail_streak + 1 END,
                  active = CASE WHEN ? = 1 THEN active
                               WHEN fail_streak + 1 >= ? THEN 0
                               ELSE active END
              WHERE id = ?`,
        args: [
          status, Date.now(), attempts, lastError,
          delivered ? 1 : 0, delivered ? 1 : 0, FAIL_STREAK_DISABLE, String(w.id),
        ],
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
