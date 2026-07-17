import { beforeAll, describe, expect, it } from "vitest";
import { db, ready } from "../../lib/db";
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

  it("never stores the raw token: DB holds a hash + ciphertext, panel sees plaintext", async () => {
    const t = await createTrigger(OWNER, "skl_enc");

    // The `token` column is the sha256 hash (lookup key), NOT the raw token, and
    // `token_enc` is AES-GCM ciphertext (enc1: prefix) - a DB-only read can't
    // replay the credential.
    const row = (
      await db.execute({
        sql: `SELECT token, token_enc FROM triggers WHERE id = ?`,
        args: [t.id],
      })
    ).rows[0];
    expect(String(row.token)).not.toContain(t.token);
    expect(String(row.token)).toMatch(/^[0-9a-f]{64}$/); // hex sha256
    expect(String(row.token_enc).startsWith("enc1:")).toBe(true);

    // But the owner can still see the real URL token (decrypted for display).
    const shown = (await listTriggers(OWNER, "skl_enc")).find((x) => x.id === t.id)!;
    expect(shown.token).toBe(t.token);
    // And presenting the stored hash as a token must NOT resolve.
    expect(await resolveTrigger(String(row.token))).toBeNull();
  });

  it("rejects unknown/garbage tokens and other owners' deletes", async () => {
    expect(await resolveTrigger("trg_nope")).toBeNull();
    expect(await resolveTrigger("not-a-token")).toBeNull();
    const t = await createTrigger(OWNER, "skl_t2");
    expect(await deleteTrigger(t.id, "SOMEONE_ELSE")).toBe(false);
  });
});
