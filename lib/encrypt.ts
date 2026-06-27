import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { env } from "./env";

/**
 * Transparent at-rest encryption for sensitive JSON columns (recorded traces,
 * run inputs, step actions) — these can contain whatever the user typed. AES-
 * 256-GCM with a key derived from AUTH_SECRET. Decryption tolerates legacy
 * plaintext rows so existing data still reads.
 */
const PREFIX = "enc1:";

function key(): Buffer {
  return createHash("sha256").update(env.authSecret).digest(); // 32 bytes
}

export function encryptJSON(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const pt = Buffer.from(JSON.stringify(value ?? null), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptJSON<T>(stored: string | null | undefined, fallback: T): T {
  if (!stored) return fallback;
  if (!stored.startsWith(PREFIX)) {
    // Legacy plaintext (or seeded data).
    try {
      return JSON.parse(stored) as T;
    } catch {
      return fallback;
    }
  }
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString("utf8")) as T;
  } catch {
    return fallback;
  }
}
