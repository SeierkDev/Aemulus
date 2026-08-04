import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Who a command acts as, in a room full of people.
 *
 * A private chat IS a person. A group is a room, and resolving the wallet from
 * the room means every member can manage the linking wallet's watches: list
 * them, delete them, redirect them, read its tier. Linking a group to receive
 * alerts would have handed it over — and /here, which exists precisely so
 * alerts CAN go to a group, is what made that reachable.
 */
describe("acting identity in a group", () => {
  const src = readFileSync("app/api/telegram/webhook/route.ts", "utf8");

  it("resolves the sender's own link rather than the room's", () => {
    // The room's owner is still read, but only to classify the chat.
    expect(src).toMatch(/chatOwner/);
    // The acting wallet comes from who typed it.
    expect(src).toMatch(/update\.message\?\.from\?\.id/);
    expect(src).toMatch(/isPrivate\s*\?\s*chatOwner/);
  });

  // Someone acting in a group needs their own connection first; falling back to
  // the room's wallet is the whole bug.
  it("asks an unconnected member to link privately instead of using the room's wallet", () => {
    expect(src).toMatch(/Message me privately and connect your wallet first/);
  });

  it("still reads the message sender's id from the update", () => {
    expect(src).toMatch(/from\?:\s*\{\s*id\?:/);
  });

  // Buttons matter more than typed commands here: an alert carries Pause and
  // Check, and alerts are exactly what appears in a group. A tap resolving to
  // the room's wallet lets any member pause or check a watch they do not own.
  it("resolves a button tap from whoever tapped it", () => {
    expect(src).toMatch(/q\.from\?\.id/);
    expect(src).toMatch(/handleAlertAction\(chatId, data, owner\)/);
    expect(src).toMatch(/handleCallback\(chatId, data, owner\)/);
  });

  // The room still travels with the action: a watch created or moved from a
  // group should alert that group. Only WHO is acting comes from the person.
  it("keeps the chat as the destination while the sender is the identity", () => {
    expect(src).toMatch(/chatId still travels/);
  });

  // Disconnecting is the one command where the ROOM's wallet is the authority
  // rather than the sender's. Without that, a member could unlink a group and
  // then /start to redeem a fresh code against their own wallet — taking the
  // room's alerts rather than just breaking them.
  it("lets only the connecting wallet disconnect a room", () => {
    expect(src).toMatch(/chatOwner !== actingOwner/);
    expect(src).toMatch(/Only the wallet that connected this chat/);
  });

  // A private chat is its own owner, so the rule has to be a no-op there.
  it("does not get in the way in a private chat", () => {
    expect(src).toMatch(/!isPrivate && chatOwner/);
  });

  /**
   * Authorised is not the same as safe to answer.
   *
   * Resolving identity from the sender made these commands act as the right
   * wallet in a room — and their replies still go to the room. /watches prints
   * watch names and their current values; /quota prints a tier and how much of
   * it is used. In a group that is a broadcast, and the person typing almost
   * certainly did not mean it as one.
   */
  it("refuses to print somebody's own numbers into a room", () => {
    expect(src).toMatch(/PRIVATE_ONLY/);
    for (const cmd of ["/watches", "/quota", "/alerts"]) {
      expect(src).toContain(`"${cmd}"`);
    }
    expect(src).toMatch(/only answer it in a private chat/);
  });

  // Acting in a room is the entire point of a room, so the action commands and
  // /here have to keep working there.
  it("still lets someone act in a room", () => {
    expect(src).not.toMatch(/PRIVATE_ONLY[^;]*"\/here"/);
    expect(src).not.toMatch(/PRIVATE_ONLY[^;]*"\/check"/);
  });

  /**
   * /start is dispatched before identity is resolved, so the wallet it sees is
   * the CHAT's. That is correct for linking and wrong for the preset deep link
   * I hung off it: in a room it would start a watch billed to, and owned by,
   * whoever connected the room rather than whoever typed it.
   */
  it("only follows a preset deep link in a private chat", () => {
    expect(src).toMatch(/handleStart\(chatId, arg, isPrivate\)/);
    expect(src).toMatch(/isPrivate && arg\.startsWith\("alert_"\)/);
  });
});
