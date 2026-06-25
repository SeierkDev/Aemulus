import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { setPublished } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAccess();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const { published } = (await req.json().catch(() => ({}))) as {
    published?: boolean;
  };
  const ok = await setPublished(id, session.pubkey, Boolean(published));
  if (!ok) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  return NextResponse.json({ published: Boolean(published) });
}
