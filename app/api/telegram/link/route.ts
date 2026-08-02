import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { chatsForOwner, redeemLinkCode, sendMessage } from "@/lib/telegram";
import { enforceRateLimit } from "@/lib/ratelimit";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which chats this wallet has linked. */
export async function GET() {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  return NextResponse.json({ chats: await chatsForOwner(session.pubkey) });
}

/**
 * Redeem a link code, binding the Telegram chat that produced it to this wallet.
 *
 * This is the half of the flow that establishes identity, and it is on the site
 * rather than in the bot for one reason: here the wallet has actually signed.
 * Telegram can tell us a chat id, and a chat id is not proof of anything — if
 * this accepted a pasted address, anyone could bind their own chat to somebody
 * else's wallet and start receiving values scraped off that person's logged-in
 * pages.
 */
export async function POST(req: Request) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  // Codes are 8 characters, so brute force is the obvious attack. Bound it hard
  // per wallet — a legitimate person types one code, once.
  const limited = enforceRateLimit(`tg-link:${session.pubkey}`, 10, 10 * 60_000, "Too many attempts");
  if (limited) return limited;

  let code = "";
  try {
    const body = (await req.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    /* fall through to the empty-code error below */
  }
  if (!code.trim()) {
    return NextResponse.json({ error: "Enter the code from Telegram." }, { status: 400 });
  }

  try {
    const res = await redeemLinkCode(code, session.pubkey);
    if (!res.ok) {
      // Deliberately the same message for every failure. Distinguishing
      // "unknown" from "expired" would tell someone guessing codes when they
      // had found a real one.
      return NextResponse.json(
        { error: "That code is not valid. Send /start in Telegram for a new one." },
        { status: 400 },
      );
    }
    // Confirm in the chat itself, so the person can see it worked without
    // switching back to the browser.
    void sendMessage(
      res.chatId,
      "Linked. Watches you set up will arrive here.",
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("telegram.link", e);
    return NextResponse.json({ error: "Could not link this chat." }, { status: 500 });
  }
}
