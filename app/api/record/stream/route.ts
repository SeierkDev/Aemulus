import { requireAccess } from "@/lib/auth";
import { getRecorder } from "@/lib/recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** SSE stream of screencast frames for the live recording view. */
export async function GET(req: Request) {
  const session = await requireAccess();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const rec = getRecorder(session.pubkey);
  const encoder = new TextEncoder();
  let lastSeq = -1;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      while (!req.signal.aborted) {
        const st = rec.snapshot();
        if (st.status !== "recording") {
          send(`event: end\ndata: {}\n\n`);
          break;
        }
        const f = rec.getFrame();
        if (f.data && f.seq !== lastSeq) {
          lastSeq = f.seq;
          send(`data: ${JSON.stringify({ seq: f.seq, url: f.url, data: f.data })}\n\n`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
