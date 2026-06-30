import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { setSkillOrg } from "@/lib/skills";
import { roleOf } from "@/lib/orgs";
import { readJson, ShareBody } from "@/lib/validate";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Share a skill with an org (or unshare). Owner only; must be a member of the
 *  target org. Body: { orgId: string | null }. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const { id } = await params;
    const parsed = await readJson(req, ShareBody);
    if (!parsed.ok) return parsed.res;
    const orgId: string | null = parsed.data.orgId ?? null;
    if (orgId && (await roleOf(orgId, session.pubkey)) === null) {
      return NextResponse.json({ error: "Not a member of that org" }, { status: 403 });
    }
    const ok = await setSkillOrg(id, session.pubkey, orgId);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  } catch (err) {
    logError("api/skills/share", err);
    return NextResponse.json({ error: "Failed to share" }, { status: 500 });
  }
}
