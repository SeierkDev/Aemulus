import { beforeAll, describe, expect, it } from "vitest";
import { db, migrate, addColumnIfMissing } from "../../lib/db";
import { MIGRATIONS } from "../../lib/migrations";

async function columns(table: string): Promise<string[]> {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  return info.rows.map((r) => String(r.name));
}

beforeAll(async () => {
  await migrate();
});

describe("migrations", () => {
  it("records every migration exactly once and is idempotent", async () => {
    await migrate(); // running again must be a safe no-op
    const r = await db.execute(`SELECT id FROM schema_migrations ORDER BY id`);
    expect(r.rows.map((x) => Number(x.id))).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it("brings the schema fully up (baseline + additive columns)", async () => {
    const runCols = await columns("runs");
    expect(runCols).toEqual(
      expect.arrayContaining(["receipt_hash", "receipt_sig", "receipt_cluster"]),
    );
    const skillCols = await columns("skills");
    expect(skillCols).toEqual(
      expect.arrayContaining(["owner", "published", "run_count"]),
    );
  });

  it("addColumnIfMissing adds a missing column and no-ops when present", async () => {
    await db.executeMultiple(`CREATE TABLE t_mig (a TEXT);`);
    await addColumnIfMissing("t_mig", "b", "TEXT");
    await addColumnIfMissing("t_mig", "b", "TEXT"); // second call must not throw
    expect(await columns("t_mig")).toEqual(expect.arrayContaining(["a", "b"]));
  });
});
