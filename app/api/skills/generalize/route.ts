import { NextResponse } from "next/server";
import { getDemonstration } from "@/lib/demonstrations";
import { generalizeDemonstration } from "@/lib/generalize";
import { createSkill } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { demonstrationId } = (await req.json().catch(() => ({}))) as {
      demonstrationId?: string;
    };
    if (!demonstrationId) {
      return NextResponse.json(
        { error: "demonstrationId is required" },
        { status: 400 },
      );
    }
    const demo = await getDemonstration(demonstrationId);
    if (!demo) {
      return NextResponse.json(
        { error: "Demonstration not found" },
        { status: 404 },
      );
    }
    const generalized = await generalizeDemonstration(demo);
    const skill = await createSkill({
      generalized,
      sourceDemoId: demo.id,
    });
    return NextResponse.json({ skill });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to generalize",
      },
      { status: 500 },
    );
  }
}
