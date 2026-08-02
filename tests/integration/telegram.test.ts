import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import {
  mdEscape,
  issueLinkCode,
  ownerForChat,
  chatsForOwner,
  redeemLinkCode,
  unlinkChat,
  verifyWebhookSecret,
  telegramEnabled,
} from "../../lib/telegram";

/**
 * The identity half of the Telegram feature.
 *
 * Telegram hands us a chat id and nothing else, and a chat id is not proof of
 * who anybody is. Everything here exists to make sure the only way a chat gets
 * bound to a wallet is by redeeming a code on the site, where that wallet has
 * actually signed — because the alternative is that anyone can point their own
 * chat at somebody else's wallet and receive values scraped off that person's
 * logged-in pages.
 */

const A = "wallet_alice";
const B = "wallet_bob";

beforeAll(async () => {
  await ready();
});

describe("verifyWebhookSecret", () => {
  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  // Fail closed. An unset secret means an unprotected endpoint, and accepting
  // everything would be worse than rejecting everything.
  it("rejects everything when no secret is configured", () => {
    expect(verifyWebhookSecret("anything")).toBe(false);
    expect(verifyWebhookSecret(null)).toBe(false);
  });

  it("accepts only the exact secret", () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret-value";
    expect(verifyWebhookSecret("s3cret-value")).toBe(true);
    expect(verifyWebhookSecret("s3cret-valu")).toBe(false);
    expect(verifyWebhookSecret("s3cret-values")).toBe(false);
    expect(verifyWebhookSecret("")).toBe(false);
    expect(verifyWebhookSecret(null)).toBe(false);
  });
});

describe("telegramEnabled", () => {
  it("is off without a token, so nothing has to guard its own calls", () => {
    const had = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(telegramEnabled()).toBe(false);
    if (had) process.env.TELEGRAM_BOT_TOKEN = had;
  });
});

describe("link codes", () => {
  it("binds a chat to the wallet that redeemed the code", async () => {
    const chat = "chat_1";
    const code = await issueLinkCode(chat);
    expect(await redeemLinkCode(code, A)).toEqual({ ok: true, chatId: chat });
    expect(await ownerForChat(chat)).toBe(A);
  });

  // The obvious attack: reuse a code you saw over someone's shoulder.
  it("refuses a code that has already been redeemed", async () => {
    const code = await issueLinkCode("chat_2");
    await redeemLinkCode(code, A);
    expect(await redeemLinkCode(code, B)).toEqual({ ok: false, reason: "used" });
    expect(await ownerForChat("chat_2")).toBe(A); // still Alice's
  });

  it("refuses a code it has never seen", async () => {
    expect(await redeemLinkCode("NOPE1234", A)).toEqual({ ok: false, reason: "unknown" });
  });

  it("is case-insensitive and tolerates surrounding space", async () => {
    const chat = "chat_3";
    const code = await issueLinkCode(chat);
    expect(await redeemLinkCode(`  ${code.toLowerCase()} `, A)).toEqual({
      ok: true,
      chatId: chat,
    });
  });

  // Issuing a fresh code has to invalidate the previous one, or every code a
  // chat was ever given stays live for ten minutes.
  it("drops an earlier unused code when a new one is issued", async () => {
    const chat = "chat_4";
    const first = await issueLinkCode(chat);
    const second = await issueLinkCode(chat);
    expect(second).not.toBe(first);
    expect(await redeemLinkCode(first, A)).toEqual({ ok: false, reason: "unknown" });
    expect((await redeemLinkCode(second, A)).ok).toBe(true);
  });

  it("issues codes that are not guessable from the chat id", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const c = await issueLinkCode(`chat_rand_${i}`);
      expect(c).not.toContain("chat");
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }
  });
});

describe("re-linking", () => {
  // A shared or resold device must not keep receiving the previous person's
  // alerts. Re-linking replaces, it does not accumulate.
  it("replaces the binding rather than adding a second", async () => {
    const chat = "chat_5";
    await redeemLinkCode(await issueLinkCode(chat), A);
    await redeemLinkCode(await issueLinkCode(chat), B);
    expect(await ownerForChat(chat)).toBe(B);
    expect(await chatsForOwner(A)).not.toContain(chat);
    expect(await chatsForOwner(B)).toContain(chat);
  });

  it("lets one wallet link several chats", async () => {
    const owner = "wallet_multi";
    await redeemLinkCode(await issueLinkCode("chat_m1"), owner);
    await redeemLinkCode(await issueLinkCode("chat_m2"), owner);
    const chats = await chatsForOwner(owner);
    expect(chats).toContain("chat_m1");
    expect(chats).toContain("chat_m2");
  });

  it("unlinking stops alerts and is safe to repeat", async () => {
    const chat = "chat_6";
    await redeemLinkCode(await issueLinkCode(chat), A);
    expect(await unlinkChat(chat)).toBe(true);
    expect(await ownerForChat(chat)).toBeNull();
    expect(await unlinkChat(chat)).toBe(false);
  });
});

describe("mdEscape", () => {
  // Telegram's legacy Markdown REJECTS a message whose _ * ` [ do not balance,
  // so an unescaped skill name like "my_skill" costs the user the whole alert —
  // the one failure a monitoring product cannot have.
  it("escapes every character Telegram treats as syntax", () => {
    expect(mdEscape("my_skill")).toBe("my\\_skill");
    expect(mdEscape("a*b")).toBe("a\\*b");
    expect(mdEscape("a`b")).toBe("a\\`b");
    expect(mdEscape("a[b")).toBe("a\\[b");
  });

  it("leaves ordinary text alone", () => {
    expect(mdEscape("Track my order")).toBe("Track my order");
    expect(mdEscape("pending → shipped")).toBe("pending → shipped");
    expect(mdEscape("$1,249.00")).toBe("$1,249.00");
  });
});

describe("markdown safety", () => {
  // Watch alerts bold the field name and print values scraped off a live page.
  // Telegram rejects a message with unbalanced formatting characters, and a
  // rejected message is an alert that silently never arrives — the one failure
  // a watch cannot afford.
  it("leaves no bare formatting characters in anything from a page", () => {
    for (const raw of ["order_status", "a*b", "_x_", "50% [off]", "a`b`", "__init__"]) {
      const e = mdEscape(raw);
      expect((e.match(/(?<!\\)\*/g) || []).length, `bare * in ${e}`).toBe(0);
      expect((e.match(/(?<!\\)_/g) || []).length, `bare _ in ${e}`).toBe(0);
      expect((e.match(/(?<!\\)`/g) || []).length, `bare backtick in ${e}`).toBe(0);
    }
  });
});
