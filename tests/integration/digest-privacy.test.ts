import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { issueLinkCode, redeemLinkCode, chatsDueDigest, noteChatType } from "../../lib/telegram";

/**
 * A wallet summary carries earnings and a claimable balance.
 *
 * Alerts in a group are the point of /here. This is not: a group linked for
 * alerts would have received somebody's income in front of everyone in it.
 */
const OWNER = "wallet_digest_priv";
const DM = "chat_dg_dm";
const GROUP = "chat_dg_group";

describe("who gets a wallet summary", () => {
  beforeAll(async () => {
    await ready();
    for (const chat of [DM, GROUP]) {
      const code = await issueLinkCode(chat);
      await redeemLinkCode(code, OWNER);
    }
  });

  // Unknown is treated as not-private, so a link made before the type existed
  // cannot leak while waiting to classify itself.
  it("sends to nobody until a chat has identified itself", async () => {
    const due = await chatsDueDigest(1);
    expect(due.map((d) => d.chatId)).not.toContain(DM);
    expect(due.map((d) => d.chatId)).not.toContain(GROUP);
  });

  it("sends to a private chat once it has", async () => {
    await noteChatType(DM, "private");
    const due = await chatsDueDigest(1);
    expect(due.map((d) => d.chatId)).toContain(DM);
  });

  it("never sends to a group, however long it waits", async () => {
    await noteChatType(GROUP, "supergroup");
    const due = await chatsDueDigest(1);
    expect(due.map((d) => d.chatId)).not.toContain(GROUP);
  });
});
