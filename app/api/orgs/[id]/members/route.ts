import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { addMember, removeMember } from "@/lib/orgs";
import { readJson, OrgMemberBody } from "@/lib/validate";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Add/update a member (admin only). */
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
    const parsed = await readJson(req, OrgMemberBody);
    if (!parsed.ok) return parsed.res;
    const ok = await addMember(id, session.pubkey, parsed.data.wallet, parsed.data.role);
    return NextResponse.json({ ok }, { status: ok ? 200 : 403 });
  } catch (err) {
    logError("api/orgs/members", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** Remove a member (admin only). Body: { wallet }. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const ok = await removeMember(id, session.pubkey, String(body?.wallet ?? ""));
  return NextResponse.json({ ok }, { status: ok ? 200 : 403 });
}
