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

/** Per-owner cap on orgs created — bounds orgs/org_members row growth per wallet. */
export const MAX_ORGS_PER_OWNER = 25;

/** Count of orgs a wallet has created (owns) — for the create cap. */
export async function countOrgsByOwner(owner: string): Promise<number> {
  await ready();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM orgs WHERE owner = ?`,
    args: [owner],
  });
  return Number((r.rows[0] as Record<string, unknown>).c);
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

export async function listMembers(orgId: string, requester: string): Promise<MemberMeta[]> {
  await ready();
  // Guard at the function boundary: only a member may list an org's members, so
  // this can never become a cross-org wallet-enumeration IDOR if a future caller
  // passes a client-supplied orgId.
  if ((await roleOf(orgId, requester)) === null) return [];
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

const MAX_MEMBERS = 100;

/** Add/update a member (admin only). */
export async function addMember(
  orgId: string,
  actor: string,
  wallet: string,
  role: OrgRole = "member",
): Promise<boolean> {
  if ((await roleOf(orgId, actor)) !== "admin") return false;
  if (!wallet) return false;

  const org = await db.execute({ sql: `SELECT owner FROM orgs WHERE id = ?`, args: [orgId] });
  const owner = String(org.rows[0]?.owner ?? "");
  // The creator stays an admin — never let an ON CONFLICT update demote them
  // (that could leave the org with no admin).
  let effRole: OrgRole = role === "admin" ? "admin" : "member";
  if (wallet === owner) effRole = "admin";

  const existing = await roleOf(orgId, wallet);
  // Only the creator may DEMOTE an existing admin — otherwise one rogue admin
  // could strip every co-admin. (Promoting a member to admin stays open to admins.)
  if (existing === "admin" && effRole !== "admin" && actor !== owner) return false;
  if (existing === null) {
    const count = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?`,
      args: [orgId],
    });
    if (Number(count.rows[0]?.n ?? 0) >= MAX_MEMBERS) return false; // cap team size
  }

  await db.execute({
    sql: `INSERT INTO org_members (org_id, wallet, role, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(org_id, wallet) DO UPDATE SET role = excluded.role`,
    args: [orgId, wallet, effRole, Date.now()],
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
  const owner = String(org.rows[0]?.owner ?? "");
  if (owner === wallet) return false; // never orphan the creator
  // Only the creator may remove another ADMIN — one rogue admin can't seize the org
  // by ejecting every co-admin. Admins can still remove plain members.
  if ((await roleOf(orgId, wallet)) === "admin" && actor !== owner) return false;
  const r = await db.execute({
    sql: `DELETE FROM org_members WHERE org_id = ? AND wallet = ?`,
    args: [orgId, wallet],
  });
  return r.rowsAffected > 0;
}
