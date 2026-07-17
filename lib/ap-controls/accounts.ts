import { randomBytes, scrypt, timingSafeEqual, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { db, ready } from "../db";

// Email + password accounts for the AP product. Passwords are hashed with scrypt
// (Node built-in — no new dependency). Each user is their own workspace for now;
// workspace_id is stored so per-workspace data scoping can key off it later.

const scryptAsync = promisify(scrypt);

const DDL = `
  CREATE TABLE IF NOT EXISTS ap_user (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  )`;

let ensured: Promise<void> | null = null;
export function ensureAccountSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ready();
      await db.execute(DDL);
    })();
  }
  return ensured;
}

export interface ApUser {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  createdAt: number;
}

export class AccountError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AccountError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const dk = (await scryptAsync(password, Buffer.from(saltHex, "hex"), 64)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

function rowToUser(r: Record<string, unknown>): ApUser {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name),
    workspaceId: String(r.workspace_id),
    createdAt: Number(r.created_at),
  };
}

export async function findUserByEmail(email: string): Promise<(ApUser & { passwordHash: string }) | null> {
  await ensureAccountSchema();
  const r = await db.execute({ sql: `SELECT * FROM ap_user WHERE email = ?`, args: [normalizeEmail(email)] });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? { ...rowToUser(row), passwordHash: String(row.password_hash) } : null;
}

export async function findUserById(id: string): Promise<ApUser | null> {
  await ensureAccountSchema();
  const r = await db.execute({ sql: `SELECT * FROM ap_user WHERE id = ?`, args: [id] });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  now: number;
}

export async function createUser(input: CreateUserInput): Promise<ApUser> {
  await ensureAccountSchema();
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AccountError("invalid_email", "Enter a valid email address.");
  if (input.password.length < 8) throw new AccountError("weak_password", "Password must be at least 8 characters.");

  const id = `usr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const user: ApUser = { id, email, name: input.name?.trim() || email.split("@")[0], workspaceId: id, createdAt: input.now };
  const passwordHash = await hashPassword(input.password);

  const ins = await db.execute({
    sql: `INSERT OR IGNORE INTO ap_user (id, email, name, workspace_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [user.id, user.email, user.name, user.workspaceId, passwordHash, user.createdAt],
  });
  if (ins.rowsAffected !== 1) throw new AccountError("email_taken", "That email is already registered.");
  return user;
}
