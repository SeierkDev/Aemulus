import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { getRecorder } from "@/lib/recorder";
import { readJson } from "@/lib/validate";
import { logError } from "@/lib/log";
import { z } from "zod";
import { WATCH_OPS } from "@/lib/watches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  on: z.boolean(),
  /** Optional name for the next capture. Falls back to a slug of the element's
   *  own label, so leaving it blank is a reasonable default rather than an error.
   *  Bounded by what the /watch wizard's callback data can carry — a longer name
   *  means the capture never shows up as something you can watch. */
  key: z.string().max(32).optional(),
  /** The rule to record with this capture. Constrained to the operators the
   *  evaluator knows, so a client cannot store one nothing can satisfy. */
  op: z.enum(WATCH_OPS).optional(),
  opValue: z.string().max(2000).optional(),
});

/**
 * Turn capture mode on or off mid-recording.
 *
 * Its own route rather than a field on start: capture gets toggled repeatedly
 * while recording — point at a value, take it, carry on with the task — and the
 * recording must not have to restart to change it.
 */
export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const parsed = await readJson(req, Body);
    if (!parsed.ok) return parsed.res;

    const rec = getRecorder(session.pubkey);
    if (!rec.isBusy()) {
      return NextResponse.json({ error: "Nothing is recording." }, { status: 409 });
    }
    await rec.setCapture(
      parsed.data.on,
      parsed.data.key ?? "",
      // "changed" is the default the evaluator already applies, so storing it
      // explicitly would only add noise to the step.
      parsed.data.op && parsed.data.op !== "changed" ? parsed.data.op : "",
      parsed.data.opValue ?? "",
    );
    return NextResponse.json({ capturing: parsed.data.on, key: parsed.data.key ?? "" });
  } catch (e) {
    logError("api/record/capture", e);
    return NextResponse.json({ error: "Could not switch capture mode." }, { status: 500 });
  }
}
