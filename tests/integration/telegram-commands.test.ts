import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { issueLinkCode, redeemLinkCode } from "../../lib/telegram";
import { getWatch, listSchedules } from "../../lib/schedules";
import {
  handleCallback,
  cmdWatch,
  cmdWatches,
  cmdVerify,
  watchableFields,
} from "../../lib/telegram-commands";
import type { GeneralizedSkill, Skill } from "../../lib/types";

/**
 * The bot's command surface.
 *
 * The important tests here are about ownership. Callback data comes back from
 * the client, so a button is an untrusted input: nothing may assume that the
 * skill id in a tap belongs to the person who tapped it.
 */

const ALICE = "wallet_cmd_alice";
const BOB = "wallet_cmd_bob";
const ALICE_CHAT = "chat_cmd_alice";
const BOB_CHAT = "chat_cmd_bob";

let aliceSkill: Skill;
let bobSkill: Skill;

const withExtract = (name: string): GeneralizedSkill => ({
  name,
  description: "",
  inputFields: [],
  steps: [
    {
      intent: "read the status",
      action: "extract",
      selectors: ["#s"],
      target: "#s",
      valueSource: "none",
      value: "",
      inputKey: "",
      key: "",
      outputKey: "status",
    },
  ],
});

beforeAll(async () => {
  await ready();
  aliceSkill = await createSkill({ owner: ALICE, generalized: withExtract("Alice watch"), sourceDemoId: null });
  bobSkill = await createSkill({ owner: BOB, generalized: withExtract("Bob watch"), sourceDemoId: null });
  await redeemLinkCode(await issueLinkCode(ALICE_CHAT), ALICE);
  await redeemLinkCode(await issueLinkCode(BOB_CHAT), BOB);
}, 60_000);

describe("watchableFields", () => {
  it("offers only what the skill actually captures", () => {
    expect(watchableFields(aliceSkill)).toEqual(["status"]);
  });

  it("offers nothing for a skill that extracts nothing", async () => {
    const s = await createSkill({
      owner: ALICE,
      generalized: { name: "No extract", description: "", inputFields: [], steps: [] },
      sourceDemoId: null,
    });
    expect(watchableFields(s)).toEqual([]);
  });
});

describe("/watch", () => {
  it("lists only skills that capture something", async () => {
    const r = await cmdWatch(ALICE);
    const labels = (r.keyboard ?? []).flat().map((b) => b.text);
    expect(labels).toContain("Alice watch");
    expect(labels).not.toContain("No extract");
  });

  it("never lists somebody else's skills", async () => {
    const r = await cmdWatch(ALICE);
    const data = (r.keyboard ?? []).flat().map((b) => b.data);
    expect(data.some((d) => d.includes(bobSkill.id))).toBe(false);
  });
});

describe("callback ownership", () => {
  // The attack this exists to stop: craft a callback naming someone else's
  // skill id and get a watch on it. Callback data is client-supplied, so the
  // skill's owner has to be re-checked on every tap.
  it("refuses a skill the tapping chat does not own", async () => {
    const r = await handleCallback(ALICE_CHAT, `w|s|${bobSkill.id}`);
    // What matters is that it refused and told them how to start over, not the
    // exact wording, which is copy and will keep changing.
    expect(r?.keyboard).toBeUndefined();
    expect(r?.text).toContain("/watch");
    expect(r?.keyboard).toBeUndefined();
  });

  it("refuses a skill that no longer exists", async () => {
    const r = await handleCallback(ALICE_CHAT, "w|s|skl_deadbeefdead");
    // What matters is that it refused and told them how to start over, not the
    // exact wording, which is copy and will keep changing.
    expect(r?.keyboard).toBeUndefined();
    expect(r?.text).toContain("/watch");
  });

  it("refuses everything from an unlinked chat", async () => {
    const r = await handleCallback("chat_never_linked", `w|s|${aliceSkill.id}`);
    expect(r?.text).toContain("isn't connected");
  });

  it("ignores callback data that isn't ours", async () => {
    expect(await handleCallback(ALICE_CHAT, "something|else")).toBeNull();
  });
});

describe("the wizard", () => {
  it("walks skill → field → cadence and creates the watch", async () => {
    const step1 = await handleCallback(ALICE_CHAT, `w|s|${aliceSkill.id}`);
    expect((step1!.keyboard ?? []).flat().map((b) => b.text)).toEqual(["status"]);

    const step2 = await handleCallback(ALICE_CHAT, `w|f|${aliceSkill.id}|status`);
    const cadences = (step2!.keyboard ?? []).flat().map((b) => b.text);
    expect(cadences).toContain("Every hour");
    expect(cadences).toContain("Every day");

    const step3 = await handleCallback(ALICE_CHAT, `w|c|${aliceSkill.id}|status|daily`);
    expect(step3!.text).toContain("Watch created");

    const mine = await listSchedules(ALICE);
    const created = mine.find((s) => s.skillId === aliceSkill.id);
    expect(created).toBeTruthy();
    const w = await getWatch(created!.id);
    expect(w?.rule.key).toBe("status");
    expect(w?.rule.op).toBe("changed");
    // The alert has to come back to the chat that set it up.
    expect(w?.notify?.chatId).toBe(ALICE_CHAT);
    // And it starts with no baseline, so the first check cannot alert.
    expect(w?.state.lastValue).toBeNull();
  });

  it("tells the user what the cadence will cost them in runs", async () => {
    const r = await handleCallback(ALICE_CHAT, `w|c|${aliceSkill.id}|status|hourly`);
    // Quota is the thing people get surprised by, so the confirmation says it
    // rather than letting them find out tomorrow.
    expect(r!.text).toContain("24");
  });

  it("rejects an unknown cadence rather than guessing one", async () => {
    const r = await handleCallback(ALICE_CHAT, `w|c|${aliceSkill.id}|status|fortnightly`);
    expect(r!.keyboard).toBeUndefined();
    expect(r!.text).toContain("/watch");
  });
});

describe("/watches", () => {
  it("numbers them so the manage commands can take a number", async () => {
    const r = await cmdWatches(ALICE);
    expect(r.text).toContain("1.");
    expect(r.text).toContain("/pause 1");
  });

  it("says something useful when there are none", async () => {
    const r = await cmdWatches("wallet_with_nothing");
    expect(r.text).toContain("/watch");
  });
});

describe("/verify", () => {
  it("asks for a run id when given nothing", async () => {
    expect((await cmdVerify("")).text).toContain("run id");
  });

  it("says so when there is no receipt", async () => {
    expect((await cmdVerify("run_does_not_exist")).text.toLowerCase()).toContain("no receipt");
  });
});

describe("the caps the website enforces apply here too", () => {
  // A watch IS a schedule. The web API refuses past MAX_ACTIVE_SCHEDULES to
  // bound scheduler load and row growth; creating one from Telegram without the
  // same check would have made the bot a way around it, and every extra watch
  // burns quota runs on every tick.
  it("refuses a new watch once the active limit is reached", async () => {
    const { MAX_ACTIVE_SCHEDULES, createSchedule, countActiveSchedules } =
      await import("../../lib/schedules");

    const already = await countActiveSchedules(ALICE);
    for (let i = already; i < MAX_ACTIVE_SCHEDULES; i++) {
      await createSchedule({
        owner: ALICE,
        skillId: aliceSkill.id,
        input: {},
        cadence: "daily",
        level: 0,
        tier: "free",
      });
    }
    expect(await countActiveSchedules(ALICE)).toBe(MAX_ACTIVE_SCHEDULES);

    const r = await handleCallback(ALICE_CHAT, `w|c|${aliceSkill.id}|status|daily`);
    expect(r?.text).toContain("limit");
    // And it really did not create one past the cap.
    expect(await countActiveSchedules(ALICE)).toBe(MAX_ACTIVE_SCHEDULES);
  });
});
