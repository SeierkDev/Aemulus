import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import {
  createTrigger,
  resolveTrigger,
  recordTriggerFire,
  listTriggers,
  deleteTrigger,
} from "../../lib/triggers";

const OWNER = "TRG_OWNER";

beforeAll(async () => {
  await ready();
});

describe("run triggers", () => {
  it("creates a token-addressed trigger, resolves it, counts fires, and deletes", async () => {
    const t = await createTrigger(OWNER, "skl_t");
    expect(t.token.startsWith("trg_")).toBe(true);

    const resolved = await resolveTrigger(t.token);
    expect(resolved).toMatchObject({ owner: OWNER, skillId: "skl_t", id: t.id });

    await recordTriggerFire(t.id);
    const list = await listTriggers(OWNER, "skl_t");
    expect(list.find((x) => x.id === t.id)!.fireCount).toBe(1);

    expect(await deleteTrigger(t.id, OWNER)).toBe(true);
    expect(await resolveTrigger(t.token)).toBeNull(); // gone
  });

  it("rejects unknown/garbage tokens and other owners' deletes", async () => {
    expect(await resolveTrigger("trg_nope")).toBeNull();
    expect(await resolveTrigger("not-a-token")).toBeNull();
    const t = await createTrigger(OWNER, "skl_t2");
    expect(await deleteTrigger(t.id, "SOMEONE_ELSE")).toBe(false);
  });
});
