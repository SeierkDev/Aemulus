/**
 * Where to find us on Telegram.
 *
 * Its own module with no imports, deliberately. These are read by presentation
 * components like the site footer, and putting them in lib/telegram.ts meant a
 * footer transitively pulled in the database client to render two links.
 *
 * The three places do different jobs and are easy to confuse: the bot is where
 * a watch is actually set up, the channel is announcements only, and the group
 * is where people talk. Env-overridable so a rename never means hunting links
 * through components.
 */

export const BOT_HANDLE =
  process.env.AEMULUS_TELEGRAM_BOT?.trim().replace(/^@/, "") || "AemulusAIBot";

/** Deep link that opens a chat with the bot. */
export function botUrl(): string {
  return `https://t.me/${BOT_HANDLE}`;
}

/** Announcements. Read-only; posts here get comments in the group below. */
export const TELEGRAM_CHANNEL_URL =
  process.env.AEMULUS_TELEGRAM_CHANNEL ?? "https://t.me/AemulusChannel";

/** The community group, linked to the channel as its discussion. */
export const TELEGRAM_COMMUNITY_URL =
  process.env.AEMULUS_TELEGRAM_COMMUNITY ?? "https://t.me/AemulusAi";
