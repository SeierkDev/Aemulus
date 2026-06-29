import { NextResponse } from "next/server";
import { apiKeyOwner } from "@/lib/api-keys";
import { listPublishedSkills, categorize } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public API: the published skill catalog. */
export async function GET(req: Request) {
  const owner = await apiKeyOwner(req);
  if (!owner) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }
  const skills = await listPublishedSkills(100);
  return NextResponse.json({
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: categorize(s.name, s.description),
      version: s.version,
      runCount: s.runCount,
      inputs: s.inputSchema.fields.map((f) => ({ key: f.key, label: f.label })),
    })),
  });
}
