/**
 * Cursor (keyset) pagination for the public API. Cursors are opaque base64url
 * tokens encoding the last row's (created_at, id) - stable under inserts, no
 * OFFSET scan. Sort is always (created_at DESC, id DESC); the id breaks ties so
 * two rows with the same timestamp can't be skipped or duplicated across pages.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Clamp a client-supplied ?limit to [1, MAX_LIMIT] (default 25). */
export function parseLimit(raw: string | null): number {
  const n = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  // Floor first so a fractional limit in (0,1) can't collapse to 0 (empty page).
  return Math.max(1, Math.min(Math.floor(n), MAX_LIMIT));
}

export function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}:${id}`).toString("base64url");
}

export function decodeCursor(
  raw: string | null,
): { createdAt: number; id: string } | null {
  if (!raw) return null;
  try {
    const [ts, ...rest] = Buffer.from(raw, "base64url").toString("utf8").split(":");
    const createdAt = Number(ts);
    const id = rest.join(":");
    if (!Number.isFinite(createdAt) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Build the keyset WHERE fragment + args for "rows strictly after the cursor"
 * under (created_at DESC, id DESC). Returns an empty clause for the first page.
 */
export function keysetClause(
  cursor: { createdAt: number; id: string } | null,
): { clause: string; args: (string | number)[] } {
  if (!cursor) return { clause: "", args: [] };
  return {
    clause: `(created_at < ? OR (created_at = ? AND id < ?))`,
    args: [cursor.createdAt, cursor.createdAt, cursor.id],
  };
}

/**
 * Given rows fetched with LIMIT (limit + 1), split into a page of `limit` and
 * the next cursor (null if no more). `key` extracts (createdAt, id) from an item.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  key: (item: T) => { createdAt: number; id: string },
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(key(last).createdAt, key(last).id) : null,
  };
}
