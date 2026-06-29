import { NextResponse } from "next/server";
import { apiKeyOwner } from "@/lib/api-keys";
import { listPublishedSkillsPage, categorize } from "@/lib/skills";
import { decodeCursor, parseLimit } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public API: the published skill catalog. Cursor-paginated: ?limit&cursor. */
export async function GET(req: Request) {
  const owner = await apiKeyOwner(req);
  if (!owner) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const { items, nextCursor } = await listPublishedSkillsPage(limit, cursor);
  return NextResponse.json({
    skills: items.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: categorize(s.name, s.description),
      version: s.version,
      runCount: s.runCount,
      inputs: s.inputSchema.fields.map((f) => ({ key: f.key, label: f.label })),
    })),
    nextCursor,
  });
}
