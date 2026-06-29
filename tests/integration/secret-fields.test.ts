import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, updateSkill, getSkill } from "../../lib/skills";
import type { GeneralizedSkill } from "../../lib/types";

const GEN: GeneralizedSkill = { name: "S", description: "", inputFields: [], steps: [] };

beforeAll(async () => {
  await ready();
});

describe("secret input fields", () => {
  it("persists the secret flag on an input field", async () => {
    const s = await createSkill({ owner: "SEC_O", generalized: GEN, sourceDemoId: null });
    await updateSkill(s.id, {
      name: s.name,
      description: s.description,
      plan: s.plan,
      inputSchema: {
        fields: [
          { key: "user", label: "User", example: "alice" },
          { key: "otp", label: "2FA code", example: "", secret: true },
        ],
      },
    });
    const got = await getSkill(s.id);
    const fields = got!.inputSchema.fields;
    expect(fields.find((f) => f.key === "user")!.secret).toBeFalsy();
    expect(fields.find((f) => f.key === "otp")!.secret).toBe(true);
  });
});
