import { randomUUID } from "node:crypto";

/** Short, url-safe, prefixed id (e.g. "dem_3f9a1c2b"). */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
