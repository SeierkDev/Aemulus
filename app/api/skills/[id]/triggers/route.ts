import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getSkill } from "@/lib/skills";
import { createTrigger, countActiveTriggers, MAX_ACTIVE_TRIGGERS } from "@/lib/triggers";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create an inbound trigger URL for a skill you own. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const { id } = await params;
    const skill = await getSkill(id);
    if (!skill || skill.owner !== session.pubkey) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    // Cap active triggers per owner, matching the schedules/webhooks siblings.
    if ((await countActiveTriggers(session.pubkey)) >= MAX_ACTIVE_TRIGGERS) {
      return NextResponse.json(
        { error: `Trigger limit reached (max ${MAX_ACTIVE_TRIGGERS}).` },
        { status: 409 },
      );
    }
    const trigger = await createTrigger(session.pubkey, id);
    return NextResponse.json({ trigger });
  } catch (err) {
    logError("api/skills/triggers", err);
    return NextResponse.json({ error: "Failed to create trigger" }, { status: 500 });
  }
}
