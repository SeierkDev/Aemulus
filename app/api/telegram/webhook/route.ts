import { NextResponse } from "next/server";
import {
  issueLinkCode,
  ownerForChat,
  sendMessage,
  unlinkChat,
  verifyWebhookSecret,
  answerCallback,
} from "@/lib/telegram";
import {
  cmdDelete,
  cmdPause,
  cmdQuota,
  cmdVerify,
  cmdWatch,
  cmdWatches,
  handleCallback,
  NOT_LINKED,
  type Reply,
} from "@/lib/telegram-commands";
import { publicBaseUrl } from "@/lib/public-url";
import { enforceRateLimit } from "@/lib/ratelimit";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram delivers updates here.
 *
 * Two things are load-bearing:
 *
 *   The secret header. Telegram echoes the value configured on setWebhook on
 *   every request. Without checking it this URL is open to anyone who guesses
 *   it, and a forged /start would hand an attacker a link code for a chat they
 *   do not control.
 *
 *   Always 200. Telegram retries anything that is not a 2xx, and a handler bug
 *   would turn into an infinite redelivery loop. Errors are logged and
 *   swallowed; the user gets a message or nothing, but Telegram is told the
 *   update was received either way.
 */

type Update = {
  message?: {
    // chat.type distinguishes a one to one chat from a group, which decides
    // whether an unrecognised command deserves an answer or silence.
    chat?: { id?: number | string; type?: string };
    text?: string;
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: number | string } };
  };
};

const ok = () => NextResponse.json({ ok: true });

export async function POST(req: Request) {
  if (!verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    // 401 rather than 200: this did not come from Telegram, so there is no
    // delivery to acknowledge.
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return ok();
  }

  try {
    if (update.callback_query) return await onCallback(update);
    return await onMessage(update);
  } catch (e) {
    logError("telegram.webhook", e);
    return ok();
  }
}

async function onCallback(update: Update): Promise<NextResponse> {
  const q = update.callback_query!;
  const chat = q.message?.chat?.id;
  if (chat == null) return ok();
  const chatId = String(chat);
  // Always answer, even on failure: an unanswered callback leaves a spinner on
  // the button forever.
  if (q.id) void answerCallback(q.id).catch(() => {});
  if (enforceRateLimit(`tg:${chatId}`, 30, 60_000, "Slow down")) return ok();
  const reply = await handleCallback(chatId, q.data ?? "");
  if (reply) await send(chatId, reply);
  return ok();
}

async function onMessage(update: Update): Promise<NextResponse> {
  const chat = update.message?.chat?.id;
  const text = (update.message?.text ?? "").trim();
  if (chat == null || !text.startsWith("/")) return ok();
  const chatId = String(chat);
  // In a group, silence on an unknown command is right: the bot should not
  // butt into conversations that were never aimed at it. One to one it is the
  // opposite — a typo answered with nothing looks like a broken bot, and the
  // person has no way to tell the difference.
  const isPrivate = update.message?.chat?.type === "private";

  // Bound per chat: /start writes a row each time, so an unbounded loop would
  // let one chat fill the codes table.
  if (enforceRateLimit(`tg:${chatId}`, 20, 60_000, "Slow down")) return ok();

  const [head, ...rest] = text.split(/\s+/);
  const cmd = head.split("@")[0].toLowerCase();
  const arg = rest.join(" ");

  // /start and /help work before linking; everything else needs a wallet.
  if (cmd === "/start") {
    await handleStart(chatId);
    return ok();
  }
  if (cmd === "/help") {
    await sendMessage(chatId, HELP, { markdown: true });
    return ok();
  }

  const owner = await ownerForChat(chatId);
  if (!owner) {
    // Only answer commands we actually know. Staying silent on the rest keeps
    // the bot from arguing with people in group chats.
    if (KNOWN.has(cmd)) await send(chatId, NOT_LINKED);
    else if (isPrivate) await sendMessage(chatId, UNKNOWN);
    return ok();
  }

  switch (cmd) {
    case "/unlink":
      await handleUnlink(chatId);
      break;
    case "/watch":
      await send(chatId, await cmdWatch(owner));
      break;
    case "/watches":
      await send(chatId, await cmdWatches(owner));
      break;
    case "/pause":
      await send(chatId, await cmdPause(owner, arg, false));
      break;
    case "/resume":
      await send(chatId, await cmdPause(owner, arg, true));
      break;
    case "/delete":
      await send(chatId, await cmdDelete(owner, arg));
      break;
    case "/verify":
      await send(chatId, await cmdVerify(arg));
      break;
    case "/quota":
      await send(chatId, await cmdQuota(owner));
      break;
    default:
      if (isPrivate) await sendMessage(chatId, UNKNOWN);
      break;
  }
  return ok();
}

const UNKNOWN = "I don't know that command. Send /help to see everything I can do.";

const KNOWN = new Set([
  "/watch",
  "/watches",
  "/pause",
  "/resume",
  "/delete",
  "/verify",
  "/quota",
  "/unlink",
]);

async function send(chatId: string, reply: Reply): Promise<void> {
  await sendMessage(chatId, reply.text, {
    markdown: reply.markdown,
    inlineKeyboard: reply.keyboard,
  });
}

// Grouped by what someone is actually trying to do, and each line says what the
// command DOES rather than naming it again. "/watches · your watches" tells a
// first-time reader nothing they could not already guess.
const HELP = [
  "*Aemulus*",
  "",
  "I watch a page for you and message you here when it changes. The page can be one only you can see, because I use a skill you recorded while logged in.",
  "",
  "*Setting up a watch*",
  "/watch",
  "Pick a skill, pick the value to watch, pick how often I check. Three taps.",
  "",
  "/watches",
  "List everything you are watching, with the latest value of each and whether it is running or paused.",
  "",
  "*Managing them*",
  "/pause 1",
  "Stop checking number 1. It keeps its history and you can start it again any time.",
  "",
  "/resume 1",
  "Start checking it again.",
  "",
  "/delete 1",
  "Remove it for good. The numbers come from /watches.",
  "",
  "*Proof and usage*",
  "/verify run\\_abc123",
  "Check that a run really happened the way it says. Works for anyone's run, not just yours.",
  "",
  "/quota",
  "How many runs you have used today and how many you have left.",
  "",
  "*This chat*",
  "/start",
  "Connect this chat to your wallet.",
  "",
  "/unlink",
  "Disconnect it. Alerts stop immediately.",
].join("\n");

async function handleStart(chat: string): Promise<void> {
  const existing = await ownerForChat(chat);
  if (existing) {
    await sendMessage(
      chat,
      [
        `This chat is already connected to your wallet ${short(existing)}.`,
        "",
        "Send /watch to start watching a page, /watches to see what you already have, or /unlink to connect a different wallet.",
      ].join("\n"),
    );
    return;
  }
  const code = await issueLinkCode(chat);
  await sendMessage(
    chat,
    [
      "Let's connect this chat to your wallet.",
      "",
      `Your code is *${code}*`,
      "",
      "Tap the button below, sign in with your wallet, and type that code in. It works for 10 minutes.",
      "",
      "Once you are connected I can watch a page for you and message you here the moment it changes.",
    ].join("\n"),
    {
      markdown: true,
      buttons: [{ text: "Link my wallet", url: `${publicBaseUrl()}/link` }],
    },
  );
}

async function handleUnlink(chat: string): Promise<void> {
  const removed = await unlinkChat(chat);
  await sendMessage(
    chat,
    removed
      ? "Disconnected. This chat will not get any more alerts. Your watches are still there, and reconnecting with /start brings them back."
      : "This chat was not connected to a wallet, so there was nothing to disconnect.",
  );
}

/** A wallet address that fits in a message and is still recognisable. */
function short(pubkey: string): string {
  return pubkey.length > 12 ? `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}` : pubkey;
}
