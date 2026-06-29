import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { createOrg, listMyOrgs } from "@/lib/orgs";
import { readJson, OrgCreateBody } from "@/lib/validate";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  return NextResponse.json({ orgs: await listMyOrgs(session.pubkey) });
}

export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const parsed = await readJson(req, OrgCreateBody);
    if (!parsed.ok) return parsed.res;
    const org = await createOrg(session.pubkey, parsed.data.name);
    return NextResponse.json({ org });
  } catch (err) {
    logError("api/orgs", err);
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 });
  }
}
