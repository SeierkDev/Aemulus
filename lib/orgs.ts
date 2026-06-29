import { db, ready } from "./db";
import { id } from "./ids";

/**
 * Teams/orgs: a group of wallets that share skills. Roles: "admin" (manage
 * members + edit shared skills) and "member" (view + run shared skills). The
 * creator is an admin. Personal runs/earnings/vault stay per-wallet; orgs only
 * widen who can see/run/edit a skill.
 */
export type OrgRole = "admin" | "member";

export interface OrgMeta {
  id: string;
  name: string;
  role: OrgRole;
}

export interface MemberMeta {
  wallet: string;
  role: OrgRole;
  createdAt: number;
}

export async function createOrg(owner: string, name: string): Promise<OrgMeta> {
  await ready();
  const oid = id("org");
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO orgs (id, name, owner, created_at) VALUES (?, ?, ?, ?)`,
    args: [oid, name || "Team", owner, now],
  });
  await db.execute({
    sql: `INSERT INTO org_members (org_id, wallet, role, created_at) VALUES (?, ?, 'admin', ?)`,
    args: [oid, owner, now],
  });
  return { id: oid, name: name || "Team", role: "admin" };
}

/** The caller's role in an org, or null if not a member. */
export async function roleOf(orgId: string, wallet: string): Promise<OrgRole | null> {
  await ready();
  const r = await db.execute({
    sql: `SELECT role FROM org_members WHERE org_id = ? AND wallet = ?`,
    args: [orgId, wallet],
  });
  const role = r.rows[0]?.role;
  return role === "admin" || role === "member" ? role : null;
}

/** Orgs the wallet belongs to (with the wallet's role). */
export async function listMyOrgs(wallet: string): Promise<OrgMeta[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT o.id, o.name, m.role FROM org_members m
          JOIN orgs o ON o.id = m.org_id
          WHERE m.wallet = ? ORDER BY o.created_at DESC`,
    args: [wallet],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    name: String(x.name),
    role: x.role === "admin" ? "admin" : "member",
  }));
}

export async function listMembers(orgId: string): Promise<MemberMeta[]> {
  await ready();
  const r = await db.execute({
    sql: `SELECT wallet, role, created_at FROM org_members WHERE org_id = ?
          ORDER BY created_at ASC`,
    args: [orgId],
  });
  return r.rows.map((x) => ({
    wallet: String(x.wallet),
    role: x.role === "admin" ? "admin" : "member",
    createdAt: Number(x.created_at),
  }));
}

/** Add/update a member (admin only). */
export async function addMember(
  orgId: string,
  actor: string,
  wallet: string,
  role: OrgRole = "member",
): Promise<boolean> {
  if ((await roleOf(orgId, actor)) !== "admin") return false;
  await db.execute({
    sql: `INSERT INTO org_members (org_id, wallet, role, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(org_id, wallet) DO UPDATE SET role = excluded.role`,
    args: [orgId, wallet, role === "admin" ? "admin" : "member", Date.now()],
  });
  return true;
}

/** Remove a member (admin only; can't remove the org's creator). */
export async function removeMember(
  orgId: string,
  actor: string,
  wallet: string,
): Promise<boolean> {
  if ((await roleOf(orgId, actor)) !== "admin") return false;
  const org = await db.execute({ sql: `SELECT owner FROM orgs WHERE id = ?`, args: [orgId] });
  if (String(org.rows[0]?.owner) === wallet) return false; // never orphan the creator
  const r = await db.execute({
    sql: `DELETE FROM org_members WHERE org_id = ? AND wallet = ?`,
    args: [orgId, wallet],
  });
  return r.rowsAffected > 0;
}
