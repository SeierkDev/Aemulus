import { beforeAll, describe, expect, it } from "vitest";
import { db, ready, migrate } from "../../lib/db";
import { createTrigger, resolveTrigger } from "../../lib/triggers";
import { creditEarning, getClaimable } from "../../lib/earnings";
import { createWebhook, listWebhooks } from "../../lib/webhooks";

// The migration runner re-executes a migration's addColumns + statements whenever
// it isn't recorded in schema_migrations — i.e. after a crash between running a
// migration and recording it (the runner is NOT transactional). Every statement is
// meant to be idempotent + crash-safe; this EXECUTES that invariant across all
// migrations (not just asserts it by inspection) and proves live data survives.

beforeAll(async () => {
  await ready(); // full migrate once
});

describe("migration crash-retry idempotency", () => {
  it("re-running every migration against an already-migrated DB is a safe no-op that preserves data", async () => {
    // Seed rows touched by the statement-bearing migrations (29 triggers,
    // 31 earnings, 32 webhooks) so a re-run can't silently corrupt or drop them.
    const trig = await createTrigger("MIG_OWNER", "skl_mig");
    await creditEarning({ owner: "MIG_OWNER", skillId: "skl_mig", runId: "r", runner: "MIG_RUNNER", amount: 7 });
    const { id: whId } = await createWebhook("MIG_OWNER", "http://93.184.216.34/hook");

    const fullCount = Number(
      (await db.execute(`SELECT COUNT(*) AS n FROM schema_migrations`)).rows[0].n,
    );
    expect(fullCount).toBeGreaterThan(0);

    // Simulate the crash: forget which migrations were applied, forcing EVERY
    // migration's addColumns + statements to run again against the live schema.
    await db.execute(`DELETE FROM schema_migrations`);
    await expect(migrate()).resolves.toBeUndefined(); // no statement throws on re-run

    // schema_migrations is fully repopulated…
    expect(
      Number((await db.execute(`SELECT COUNT(*) AS n FROM schema_migrations`)).rows[0].n),
    ).toBe(fullCount);

    // …and the seeded data survived the re-run (no destructive/non-idempotent step).
    expect(await resolveTrigger(trig.token)).toMatchObject({ owner: "MIG_OWNER" });
    expect(await getClaimable("MIG_OWNER")).toBe(7);
    expect((await listWebhooks("MIG_OWNER")).some((w) => w.id === whId)).toBe(true);

    // Idempotent again: a SECOND re-run is also clean (defends multi-restart).
    await db.execute(`DELETE FROM schema_migrations`);
    await expect(migrate()).resolves.toBeUndefined();
    expect(await getClaimable("MIG_OWNER")).toBe(7);
  });
});
