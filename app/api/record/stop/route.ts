import { NextResponse } from "next/server";
import { recorder } from "@/lib/recorder";
import { createDemonstration } from "@/lib/demonstrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const state = await recorder.stop();
  if (!state.id || state.actions.length === 0) {
    return NextResponse.json({ state, demonstrationId: null });
  }
  const dem = await createDemonstration({
    title: state.title,
    startUrl: state.startUrl || null,
    trace: state.actions,
  });
  recorder.markSaved(dem.id);
  return NextResponse.json({ state: recorder.snapshot(), demonstrationId: dem.id });
}
