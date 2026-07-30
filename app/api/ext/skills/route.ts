import { NextResponse } from "next/server";
import { apiKeyAuth } from "@/lib/api-keys";
import { listSkills } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The extension popup lists the skills you can run in your own browser, with the
// inputs each one needs. Scoped to skills you OWN - a marketplace skill's plan
// isn't handed to a third party's extension (that stays a cloud run).
export async function GET(req: Request) {
  const auth = await apiKeyAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  const skills = await listSkills(auth.owner);
  return NextResponse.json({
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      fields: (s.inputSchema.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        example: f.example ?? "",
        secret: !!f.secret,
      })),
    })),
  });
}
