import { db, ready } from "./db";
import { id } from "./ids";
import { decryptJSON, encryptJSON } from "./encrypt";
import type { Demonstration, RecordedAction } from "./types";

/** Persist a recorded trace as a demonstration owned by a wallet. */
export async function createDemonstration(input: {
  owner: string;
  title: string;
  startUrl: string | null;
  trace: RecordedAction[];
}): Promise<Demonstration> {
  await ready();
  const dem: Demonstration = {
    id: id("dem"),
    owner: input.owner,
    title: input.title,
    startUrl: input.startUrl,
    trace: input.trace,
    createdAt: Date.now(),
  };
  await db.execute({
    sql: `INSERT INTO demonstrations (id, owner, title, start_url, trace, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      dem.id,
      dem.owner,
      dem.title,
      dem.startUrl,
      encryptJSON(dem.trace),
      dem.createdAt,
    ],
  });
  return dem;
}

export async function getDemonstration(
  demId: string,
): Promise<Demonstration | null> {
  await ready();
  const r = await db.execute({
    sql: `SELECT * FROM demonstrations WHERE id = ?`,
    args: [demId],
  });
  const row = r.rows[0];
  return row ? rowToDemonstration(row) : null;
}

export async function listDemonstrations(
  owner: string,
  limit = 200,
): Promise<Demonstration[]> {
  await ready();
  // Bound the list: each row decrypts a full (up-to-1000-action) trace, so an
  // unlimited SELECT would make a heavy user's own server-rendered skills page do
  // unbounded row-loading + AES-GCM work. The most-recent N covers the "pending to
  // generalize" UI; older demos are still fetchable by id.
  const r = await db.execute({
    sql: `SELECT * FROM demonstrations WHERE owner = ? ORDER BY created_at DESC LIMIT ?`,
    args: [owner, Math.max(1, Math.min(1000, limit))],
  });
  return r.rows.map(rowToDemonstration);
}

function rowToDemonstration(row: Record<string, unknown>): Demonstration {
  return {
    id: String(row.id),
    owner: row.owner == null ? "" : String(row.owner),
    title: String(row.title),
    startUrl: row.start_url == null ? null : String(row.start_url),
    trace: decryptJSON<RecordedAction[]>(
      row.trace == null ? null : String(row.trace),
      [],
    ),
    createdAt: Number(row.created_at),
  };
}
