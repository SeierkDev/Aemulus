import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { MIGRATIONS } from "../lib/migrations";
import { SCHEMA } from "../lib/schema";

/**
 * The baseline and the migrations have to agree.
 *
 * migrations.ts states the rule at the top: to change the schema, update SCHEMA
 * so fresh databases are correct, AND append a migration so existing ones catch
 * up. Doing only the second half still works — a fresh database runs the
 * baseline and then every migration, so the column arrives either way — which is
 * exactly why it goes unnoticed.
 *
 * What it costs is that SCHEMA stops describing the database. It is the file
 * anyone reads to learn the shape of a table, and every column added by
 * migration and never backfilled into it is a column the documentation denies
 * exists. This test is the missing half of that convention.
 */

/** The body of `CREATE TABLE [IF NOT EXISTS] <name> ( ... );` in SCHEMA. */
function tableBody(sql: string, table: string): string | null {
  const re = new RegExp(
    `CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  );
  return re.exec(sql)?.[1] ?? null;
}

describe("the baseline schema", () => {
  const added = MIGRATIONS.flatMap((m) =>
    (m.addColumns ?? []).map((c) => ({ ...c, id: m.id, name: m.name })),
  );

  it("has something to check", () => {
    expect(added.length).toBeGreaterThan(0);
  });

  it("declares every column any migration adds", () => {
    const missing: string[] = [];
    for (const c of added) {
      const body = tableBody(SCHEMA, c.table);
      // A table created by a later migration rather than by the baseline is not
      // drift — there is no baseline definition to have drifted from.
      if (body === null) continue;
      if (!new RegExp(`^\\s*${c.column}\\b`, "m").test(body)) {
        missing.push(`${c.table}.${c.column} (migration ${c.id} ${c.name})`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * And it has to actually run.
   *
   * Checking that a column NAME appears somewhere in the file is not the same
   * as checking the file is valid SQL — a backfill that forgets the comma on
   * the previous column satisfies the first and fails the second, and a fresh
   * database would then refuse to boot at all. Execute it.
   */
  it("creates a database", async () => {
    const db = createClient({ url: ":memory:" });
    await db.executeMultiple(SCHEMA);
    const t = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    expect(t.rows.length).toBeGreaterThan(5);
  });

  // Every column a migration adds must exist on the table the baseline built,
  // with the type it was migrated as — not merely be spelled somewhere nearby.
  it("gives each backfilled column the same shape a migration would", async () => {
    const db = createClient({ url: ":memory:" });
    await db.executeMultiple(SCHEMA);
    for (const c of added) {
      const info = await db.execute(`PRAGMA table_info(${c.table})`);
      const col = info.rows.find((r) => String(r.name) === c.column);
      if (!col) continue; // table introduced by a later migration
      expect(String(col.type).toUpperCase()).toBe(
        c.def.split(/\s+/)[0].toUpperCase(),
      );
    }
  });

  // Ids are recorded in a Set, so a gap is harmless and a REUSED id is not: the
  // second one is silently treated as already applied and never runs.
  it("never reuses a migration id", () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
