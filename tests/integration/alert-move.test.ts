import { beforeAll, describe, expect, it, vi } from "vitest";
import { ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { createSchedule, setWatch, getWatch } from "../../lib/schedules";
import { issueLinkCode, redeemLinkCode } from "../../lib/telegram";
import { cmdHere } from "../../lib/telegram-commands";
import type { GeneralizedSkill, Skill } from "../../lib/types";

vi.mock("../../lib/runner", () => ({ executeRun: vi.fn() }));

/**
 * Moving a watch to another chat.
 *
 * The dangerous direction is privacy: /here is how an alert reaches a group,
 * which is precisely where a value that was meant to stay hidden should not
 * suddenly appear.
 */
const OWNER = "wallet_here_owner";
const DM = "chat_here_dm";
const GROUP = "chat_here_group";
let skill: Skill;
let sid = "";

describe("/here", () => {
  beforeAll(async () => {
    await ready();
    skill = await createSkill({
      owner: OWNER,
      generalized: { name: "H", description: "", inputFields: [], steps: [] } as GeneralizedSkill,
      sourceDemoId: null,
    });
    for (const chat of [DM, GROUP]) {
      const code = await issueLinkCode(chat);
      await redeemLinkCode(code, OWNER);
    }
    sid = await createSchedule({
      owner: OWNER, skillId: skill.id, input: {},
      cadence: "hourly", level: 2, tier: "pro",
    });
    // Deliberately redacted: this watch reports THAT a value changed, never what to.
    await setWatch(sid, OWNER, { key: "balance", op: "changed" }, {
      channel: "telegram", chatId: DM, redact: true,
    });
  });

  it("points the watch at the chat the command was typed in", async () => {
    const r = await cmdHere(OWNER, "1", GROUP);
    expect(r.text).toContain("here");
    expect((await getWatch(sid))!.notify?.chatId).toBe(GROUP);
  });

  // The bug this pins: rebuilding notify from scratch dropped redact, so a
  // watch set to hide a balance would start publishing it — at the exact moment
  // it moved somewhere more people could read it.
  it("does not quietly un-redact a watch by moving it", async () => {
    expect((await getWatch(sid))!.notify?.redact).toBe(true);
  });

  it("refuses a number the owner doesn't have", async () => {
    const r = await cmdHere(OWNER, "99", GROUP);
    expect(r.text).toContain("don't have a watch");
  });
});
