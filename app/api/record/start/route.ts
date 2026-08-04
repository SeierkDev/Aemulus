import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth";
import { assertSafeUrl } from "@/lib/safe-url";
import { getRecorder } from "@/lib/recorder";
import { logError } from "@/lib/log";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readJson, RecordStartBody } from "@/lib/validate";
import { storageWritable } from "@/lib/storage-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECORD_PER_HOUR = Math.max(
  1,
  Number(process.env.AEMULUS_RECORD_PER_HOUR) || 30,
);

/** Normalize a user-typed URL into something Playwright can navigate to. */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t) || t.startsWith("data:")) return t;
  return `https://${t}`;
}

export async function POST(req: Request) {
  try {
    const session = await requireAccess();
    if (!session) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    const limited = enforceRateLimit(
      `rec:${session.pubkey}`,
      RECORD_PER_HOUR,
      60 * 60 * 1000,
      `Too many recordings (limit ${RECORD_PER_HOUR}/hour)`,
    );
    if (limited) return limited;
    const parsed = await readJson(req, RecordStartBody);
    if (!parsed.ok) return parsed.res;
    const body = parsed.data;
    const url = normalizeUrl(body.startUrl);
    try {
      await assertSafeUrl(url);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Unsafe URL" },
        { status: 400 },
      );
    }
    // Checked before launching a browser, because this is the failure that
    // actually happens and the one the user can do nothing about from here.
    // Without it the mkdir below throws EACCES and every cause — a bad URL, a
    // dead browser, an unwritable disk — arrives as the same sentence.
    const storage = await storageWritable();
    if (!storage.writable) {
      logError("api/record/start", new Error(`storage unwritable: ${storage.reason}`));
      return NextResponse.json(
        {
          error:
            "Recording storage isn't writable on the server, so there's nowhere to save this. This is a server problem, not something you did.",
        },
        { status: 503 },
      );
    }

    const state = await getRecorder(session.pubkey).start(
      body.title ?? "",
      url,
      session.pubkey,
    );
    return NextResponse.json(state);
  } catch (e) {
    // 409 said "conflict" for every possible cause — an unwritable volume, a
    // browser that would not launch, a page that never loaded — so the status
    // code actively pointed away from the real problem. A failure here is the
    // server's, and it says which one it was.
    logError("api/record/start", e);
    const detail = explain(e instanceof Error ? e.message : "");
    return NextResponse.json(
      {
        error: "Couldn’t start the recording.",
        ...(detail ? { detail: detail.slice(0, 300) } : {}),
      },
      { status: 500 },
    );
  }
}

/**
 * Turn a Chromium launch failure into something with a next step.
 *
 * These two have one cause each and no way to guess it from the raw output,
 * which runs to dozens of lines of C++ diagnostics. Anything else is passed
 * through unchanged rather than papered over with a friendlier lie.
 */
function explain(msg: string): string {
  if (/no usable sandbox|namespace sandbox|clone helper|SUID sandbox/i.test(msg)) {
    return "Chromium's OS sandbox could not start — this host does not allow unprivileged user namespaces. Set AEMULUS_CHROMIUM_SANDBOX=0 to run without it (a real reduction in isolation, recorded in the receipt).";
  }
  if (/executable doesn't exist|Failed to launch|ENOENT.*chrome/i.test(msg)) {
    return "The browser is missing from this image — Playwright's browsers were not installed in the build.";
  }
  return msg;
}
