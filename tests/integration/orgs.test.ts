import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import {
  createOrg,
  addMember,
  removeMember,
  roleOf,
  listMyOrgs,
} from "../../lib/orgs";
import { createSkill, setSkillOrg, getSkill, skillAccess, listSkills } from "../../lib/skills";
import type { GeneralizedSkill } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "T", description: "", inputFields: [], steps: [] };
const A = "WALLET_A_ORG";
const B = "WALLET_B_ORG";
const C = "WALLET_C_ORG";

beforeAll(async () => {
  await ready();
});

describe("orgs + membership", () => {
  it("creator is admin; admin-only add/remove; can't remove the creator", async () => {
    const org = await createOrg(A, "Acme");
    expect(await roleOf(org.id, A)).toBe("admin");

    expect(await addMember(org.id, B, C)).toBe(false); // B isn't an admin
    expect(await addMember(org.id, A, B)).toBe(true); // A (admin) adds B
    expect(await roleOf(org.id, B)).toBe("member");
    expect((await listMyOrgs(B)).find((o) => o.id === org.id)).toBeTruthy();

    expect(await removeMember(org.id, A, A)).toBe(false); // never orphan the creator
    expect(await removeMember(org.id, A, B)).toBe(true);
    expect(await roleOf(org.id, B)).toBeNull();
  });

  it("only the creator can remove or demote another admin (no rogue-admin takeover)", async () => {
    const org = await createOrg(A, "Beta"); // A is creator/admin
    expect(await addMember(org.id, A, B, "admin")).toBe(true);
    expect(await addMember(org.id, A, C, "admin")).toBe(true);

    // B (admin, NOT creator) can't remove or demote co-admin C.
    expect(await removeMember(org.id, B, C)).toBe(false);
    expect(await addMember(org.id, B, C, "member")).toBe(false); // demote refused
    expect(await roleOf(org.id, C)).toBe("admin");

    // The creator can.
    expect(await addMember(org.id, A, C, "member")).toBe(true); // creator demotes
    expect(await roleOf(org.id, C)).toBe("member");
    // A plain admin CAN still remove a plain member.
    expect(await removeMember(org.id, B, C)).toBe(true);
  });
});

describe("skillAccess + shared skills", () => {
  it("widens view/run/edit correctly across owner, members, admins, outsiders", async () => {
    const org = await createOrg(A, "Team");
    await addMember(org.id, A, B, "member");
    await addMember(org.id, A, C, "admin");
    const skill = await createSkill({ owner: A, generalized: GEN, sourceDemoId: null });

    // before sharing: only the owner has access (skill is unpublished)
    expect(await skillAccess(skill, A)).toEqual({ view: true, run: true, edit: true });
    expect(await skillAccess(skill, B)).toEqual({ view: false, run: false, edit: false });

    await setSkillOrg(skill.id, A, org.id);
    const shared = (await getSkill(skill.id))!;
    // Sharing widens view+run to the team, but EDIT stays owner-only — a non-owner
    // (even an org admin) can't rewrite the executable plan in place.
    expect(await skillAccess(shared, B)).toEqual({ view: true, run: true, edit: false }); // member
    expect(await skillAccess(shared, C)).toEqual({ view: true, run: true, edit: false }); // admin: view+run, NOT edit
    expect(await skillAccess(shared, "OUTSIDER")).toEqual({ view: false, run: false, edit: false });

    // shared skill shows up in a member's skill list
    expect((await listSkills(B)).some((s) => s.id === skill.id)).toBe(true);
    expect((await listSkills("OUTSIDER")).some((s) => s.id === skill.id)).toBe(false);
  });
});
