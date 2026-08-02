import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneralizedSkill } from "../../lib/types";

// Capture every upload attempt instead of making one. The property under test
// is which screenshots reach Arweave at all — and since Arweave has no delete,
// an upload that should never have happened cannot be undone.
// hoisted: vi.mock is lifted above ordinary consts, so the spy has to be too.
const { storeBytes } = vi.hoisted(() => ({
  storeBytes: vi.fn(async () => "tx_fake" as string | null),
}));
vi.mock("../../lib/arweave", async (orig) => ({
  ...(await orig<typeof import("../../lib/arweave")>()),
  shotsEnabled: () => true,
  storeBytes,
}));

import { db, ready } from "../../lib/db";
import { createSkill } from "../../lib/skills";
import { archiveRunShots, setShotsPublic } from "../../lib/shot-archive";
import { DATA_ROOT } from "../../lib/paths";

let skillId = "";

async function makeRun(id: string, shotsPublic: 0 | 1): Promise<void> {
  const rel = path.join("recordings", "consent", id, "step-0000.png");
  const abs = path.join(DATA_ROOT, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.from(`pretend png for ${id}`));

  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO runs (id, owner, skill_id, status, input, created_at, updated_at, shots_public)
          VALUES (?, ?, ?, 'completed', '{}', ?, ?, ?)`,
    args: [id, "owner_1", skillId, now, now, shotsPublic],
  });
  await db.execute({
    sql: `INSERT INTO run_steps (id, run_id, idx, intent, action, screenshot, confidence, flagged, note, created_at)
          VALUES (?, ?, 0, '', 'click', ?, 1, 0, '', ?)`,
    args: [`step_${id}`, id, rel, now],
  });
}

describe("screenshots are never published without consent", () => {
  beforeAll(async () => {
    await ready();
    const skill = await createSkill({
      owner: "owner_1",
      generalized: { name: "T", description: "", inputFields: [], steps: [] } as GeneralizedSkill,
      sourceDemoId: null,
    });
    skillId = skill.id;
  });
  beforeEach(() => {
    storeBytes.mockClear();
  });

  // The whole safety property. Public verification has always excluded
  // screenshots; a run's images hold invoices, vendor names and whatever else
  // was on a logged-in page. Storing one the owner never published would be an
  // irreversible disclosure.
  it("uploads nothing for a run the owner did not publish", async () => {
    await makeRun("run_private_1", 0);
    const r = await archiveRunShots("run_private_1");
    expect(storeBytes).not.toHaveBeenCalled();
    expect(r.stored).toBe(0);
  });

  it("uploads for a run the owner did publish", async () => {
    await makeRun("run_public_1", 1);
    const r = await archiveRunShots("run_public_1");
    expect(storeBytes).toHaveBeenCalledTimes(1);
    expect(r.stored).toBe(1);
  });

  // Tagged with the receipt's own hash and nothing else. That tag is the only
  // route from a receipt to the image without our database — and it must not
  // carry the run id or the owner, or reading Arweave would reveal whose run
  // it was to anyone who looked.
  it("tags the upload with the content hash and nothing identifying", async () => {
    await makeRun("run_public_2", 1);
    await archiveRunShots("run_public_2");
    const tags = (storeBytes.mock.calls[0] as unknown[])[1] as { name: string; value: string }[];
    const flat = JSON.stringify(tags);
    expect(tags.find((t) => t.name === "Shot-Hash")?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(flat).not.toContain("run_public_2");
    expect(flat).not.toContain("owner_1");
  });

  // Turning the flag off must stop future uploads even though it cannot
  // retract past ones.
  it("stops uploading once the owner turns it back off", async () => {
    await makeRun("run_public_3", 1);
    expect(await setShotsPublic("run_public_3", "owner_1", false)).toBe(true);
    await archiveRunShots("run_public_3");
    expect(storeBytes).not.toHaveBeenCalled();
  });

  // Without a done-marker the sweep re-reads the same newest few published runs
  // on every tick, forever, and never reaches an older one queued behind them —
  // the run silently never becomes permanent.
  it("marks a finished run so the sweep moves on instead of re-reading it", async () => {
    await makeRun("run_public_5", 1);
    await archiveRunShots("run_public_5");
    const r = await db.execute({
      sql: `SELECT shots_archived_at, shots_attempts FROM runs WHERE id = ?`,
      args: ["run_public_5"],
    });
    expect(Number(r.rows[0].shots_attempts)).toBe(1);
    expect(r.rows[0].shots_archived_at).not.toBeNull();
  });

  // A pass that stored nothing must NOT be marked done, or a transient failure
  // would permanently lose that run's evidence.
  it("leaves a failed pass unmarked so a later sweep retries it", async () => {
    storeBytes.mockResolvedValueOnce(null);
    await makeRun("run_public_6", 1);
    await archiveRunShots("run_public_6");
    const r = await db.execute({
      sql: `SELECT shots_archived_at, shots_attempts FROM runs WHERE id = ?`,
      args: ["run_public_6"],
    });
    expect(Number(r.rows[0].shots_attempts)).toBe(1);
    expect(r.rows[0].shots_archived_at).toBeNull();
  });

  // Publishing is the owner's call, so it must not be somebody else's.
  it("will not let a stranger publish a run they don't own", async () => {
    await makeRun("run_public_4", 0);
    expect(await setShotsPublic("run_public_4", "not_the_owner", true)).toBe(false);
    await archiveRunShots("run_public_4");
    expect(storeBytes).not.toHaveBeenCalled();
  });
});
