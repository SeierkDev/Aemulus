import { timingSafeEqual, randomBytes } from "node:crypto";
import { db, ready } from "./db";
import { logError } from "./log";

/**
 * Telegram transport and identity linking.
 *
 * Two things live here and they are deliberately separate concerns:
 *
 *   Sending. A thin wrapper over the Bot API. Inert without a token, so every
 *   caller can run unconditionally and the whole feature is off by simply not
 *   configuring it.
 *
 *   Linking. Binding a Telegram chat to a wallet. This is the part with teeth:
 *   Telegram tells us a chat id and nothing more, and a chat id is not identity.
 *   So the flow starts in Telegram (a one-time code) and finishes on the site (a
 *   wallet signature). If a pasted address were accepted as proof of who someone
 *   is, anyone could point their own chat at anyone else's wallet and receive
 *   alerts containing values off that person's logged-in pages.
 */

const API = "https://api.telegram.org";

/**
 * Escape text that will be interpolated into a Markdown message.
 *
 * Telegram's legacy Markdown treats _ * ` and [ as syntax, and it REJECTS the
 * whole message when they do not balance. So a skill called "my_skill", or a
 * captured value containing an underscore, silently costs the user their alert
 * — the one failure mode a monitoring product cannot have. Anything
 * user-supplied goes through here.
 */
export function mdEscape(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}

// Link constants live in ./telegram-links, which imports nothing, so a footer
// does not pull the database client in just to render two anchors.
export {
  BOT_HANDLE,
  botUrl,
  TELEGRAM_CHANNEL_URL,
  TELEGRAM_COMMUNITY_URL,
} from "./telegram-links";

export function telegramEnabled(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/**
 * Does this request actually come from Telegram?
 *
 * Telegram echoes the secret configured on setWebhook in a header on every
 * update. Without checking it, the webhook URL is an open endpoint that anyone
 * who guesses it can post to — including a forged /start that would hand them a
 * link code for a chat they do not control.
 *
 * Compared in constant time: a plain === leaks the secret one character at a
 * time to anyone willing to measure.
 */
export function verifyWebhookSecret(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Fail closed. An unset secret means an unprotected endpoint, so refuse
  // rather than accept everything.
  if (!expected) return false;
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Send a message. Never throws: a failed delivery must not be able to break a
 * run's settlement or a webhook handler, and Telegram being down is not our
 * problem to escalate.
 */
export async function sendMessage(
  chatId: string,
  text: string,
  opts: {
    markdown?: boolean;
    /** Link buttons (open a URL). */
    buttons?: { text: string; url: string }[];
    /** Inline keyboard rows. A button carries either callback data or a url;
     *  Telegram allows both kinds side by side in one row, which an alert needs
     *  so "Pause" and "See what I saw" can sit together. */
    inlineKeyboard?: { text: string; data?: string; url?: string }[][];
  } = {},
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    };
    if (opts.markdown) body.parse_mode = "Markdown";
    if (opts.inlineKeyboard?.length) {
      body.reply_markup = {
        inline_keyboard: opts.inlineKeyboard.map((row) =>
          row.map((b) =>
            b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data },
          ),
        ),
      };
    } else if (opts.buttons?.length) {
      body.reply_markup = { inline_keyboard: [opts.buttons.map((b) => ({ ...b }))] };
    }
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logError("telegram.send", new Error(`HTTP ${res.status}`), { chat: chatId });
      return false;
    }
    return true;
  } catch (e) {
    logError("telegram.send", e, { chat: chatId });
    return false;
  }
}

/**
 * Acknowledge a button press.
 *
 * Telegram leaves a loading spinner on the button until the callback is
 * answered, so this must happen on every path including failures — otherwise a
 * user is left looking at a button that appears stuck.
 */
export async function answerCallback(callbackId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`${API}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* a stuck spinner is not worth escalating */
  }
}

/* ── linking ─────────────────────────────────────────────────────────────── */

/** How long a link code is good for. Short: it is typed within a minute or not at all. */
const CODE_TTL_MS = 10 * 60_000;

/**
 * Issue a one-time code for a chat.
 *
 * Random, not sequential or derived from the chat id — a guessable code would
 * let someone bind THEIR chat to YOUR wallet by redeeming a code they never
 * received. Any earlier unused codes for the chat are dropped so only the most
 * recent one is live.
 */
export async function issueLinkCode(chatId: string): Promise<string> {
  await ready();
  const code = randomBytes(6).toString("base64url").toUpperCase().slice(0, 8);
  const now = Date.now();
  await db.execute({
    sql: `DELETE FROM telegram_codes WHERE chat_id = ? AND used_at IS NULL`,
    args: [chatId],
  });
  await db.execute({
    sql: `INSERT INTO telegram_codes (code, chat_id, expires_at, used_at) VALUES (?, ?, ?, NULL)`,
    args: [code, chatId, now + CODE_TTL_MS],
  });
  return code;
}

export type RedeemResult =
  | { ok: true; chatId: string }
  | { ok: false; reason: "unknown" | "expired" | "used" };

/**
 * Redeem a code for a wallet. Called from the site, AFTER the wallet has been
 * verified — this function trusts its `owner` argument completely, so its only
 * caller must be a route behind a real session.
 *
 * The claim is a single conditional UPDATE so two redemptions of the same code
 * cannot both win; SQLite serializes writes, and the loser sees 0 rows affected.
 */
export async function redeemLinkCode(
  code: string,
  owner: string,
): Promise<RedeemResult> {
  await ready();
  const now = Date.now();
  const clean = code.trim().toUpperCase();
  const r = await db.execute({
    sql: `SELECT chat_id, expires_at, used_at FROM telegram_codes WHERE code = ?`,
    args: [clean],
  });
  const row = r.rows[0];
  if (!row) return { ok: false, reason: "unknown" };
  if (row.used_at != null) return { ok: false, reason: "used" };
  if (Number(row.expires_at) < now) return { ok: false, reason: "expired" };

  const claimed = await db.execute({
    sql: `UPDATE telegram_codes SET used_at = ? WHERE code = ? AND used_at IS NULL`,
    args: [now, clean],
  });
  if (claimed.rowsAffected === 0) return { ok: false, reason: "used" };

  const chatId = String(row.chat_id);
  // One wallet per chat. Re-linking a chat replaces the previous binding rather
  // than adding a second, so a shared device cannot quietly keep receiving the
  // last person's alerts.
  await db.execute({
    sql: `INSERT INTO telegram_links (chat_id, owner, created_at) VALUES (?, ?, ?)
          ON CONFLICT(chat_id) DO UPDATE SET owner = excluded.owner, created_at = excluded.created_at`,
    args: [chatId, owner, now],
  });
  return { ok: true, chatId };
}

/** The wallet a chat is bound to, if any. */
export async function ownerForChat(chatId: string): Promise<string | null> {
  await ready();
  const r = await db.execute({
    sql: `SELECT owner FROM telegram_links WHERE chat_id = ?`,
    args: [chatId],
  });
  return r.rows[0] ? String(r.rows[0].owner) : null;
}

/** Every chat a wallet has linked. A person may run Telegram on more than one account. */
/**
 * Chats due a wallet summary.
 *
 * Everything else in the alerts work serves people watching pages. This is the
 * one path that serves the people publishing skills, and it needs no page, no
 * skill and no quota — the numbers already exist.
 */
export async function chatsDueDigest(everyMs: number): Promise<
  { chatId: string; owner: string }[]
> {
  await ready();
  const cutoff = Date.now() - everyMs;
  const r = await db.execute({
    sql: `SELECT chat_id, owner FROM telegram_links
          WHERE (last_digest_at IS NULL OR last_digest_at < ?)
            AND chat_type = 'private'
          LIMIT 50`,
    args: [cutoff],
  });
  return r.rows.map((row) => ({ chatId: String(row.chat_id), owner: String(row.owner) }));
}

export async function markDigestSent(chatId: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE telegram_links SET last_digest_at = ? WHERE chat_id = ?`,
    args: [Date.now(), chatId],
  });
}

/**
 * Remember what kind of chat this is, from any message it sends.
 *
 * Recorded opportunistically rather than only at link time, so chats linked
 * before the column existed classify themselves the next time somebody uses
 * them, instead of being permanently unknown.
 */
export async function noteChatType(chatId: string, type: string | undefined): Promise<void> {
  if (!type) return;
  await ready();
  await db.execute({
    sql: `UPDATE telegram_links SET chat_type = ? WHERE chat_id = ? AND (chat_type IS NULL OR chat_type != ?)`,
    args: [type, chatId, type],
  });
}

export async function chatsForOwner(owner: string): Promise<string[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT chat_id FROM telegram_links WHERE owner = ?`,
    args: [owner],
  });
  return r.rows.map((row) => String(row.chat_id));
}

export async function unlinkChat(chatId: string): Promise<boolean> {
  await ready();
  const r = await db.execute({
    sql: `DELETE FROM telegram_links WHERE chat_id = ?`,
    args: [chatId],
  });
  return r.rowsAffected > 0;
}
