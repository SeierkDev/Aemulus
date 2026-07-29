import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { id } from "./ids";
import {
  addRunStep,
  finishRun,
  setRunOutput,
  setRunUsage,
  setRunCommitment,
  getRun,
} from "./runs";
import { attachReceipt } from "./receipt";
import { buildCommitment, commitmentFields } from "./commitment";
import { finalizeRunAccounting } from "./run-service";
import { logError } from "./log";
import type { Run, RunStatus, Skill } from "./types";

const RUNS_DIR = path.join(process.cwd(), ".data", "recordings");

export interface ExtStepReport {
  idx: number;
  selectorUsed?: string;
  value?: string;
  confidence?: number;
  flagged?: boolean;
  note?: string;
  screenshot?: string; // data URL (image/jpeg|png), optional proof
}

function decodeDataUrl(dataUrl: string): { buf: Buffer; ext: string } | null {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  try {
    return { buf: Buffer.from(m[2], "base64"), ext };
  } catch {
    return null;
  }
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Finalize a run the browser extension executed (the clicking happened in the
 * user's own browser). Persists each reported step — writing proof screenshots
 * to the SAME on-disk layout the cloud runner uses so `attachReceipt` hashes
 * them identically — redacts secret-field values, attaches the verifiable
 * receipt, then runs the shared accounting (earnings, run_count, webhooks,
 * anchors). This mirrors the tail of the cloud runner's executeRun so an
 * extension run is indistinguishable from a cloud run downstream.
 */
export async function finalizeExtensionRun(args: {
  runId: string;
  owner: string;
  skill: Skill;
  status: RunStatus;
  error?: string | null;
  steps: ExtStepReport[];
  outputs?: Record<string, string>;
  tokensIn?: number;
  tokensOut?: number;
}): Promise<Run> {
  const { runId, owner, skill } = args;

  // Plan steps that type a SECRET input — never persist their value/screenshot.
  const secretKeys = new Set(
    (skill.inputSchema.fields ?? []).filter((f) => f.secret).map((f) => f.key),
  );
  const secretStepIdx = new Set(
    skill.plan
      .filter((s) => s.action === "input" && secretKeys.has(s.inputKey))
      .map((s) => s.idx),
  );

  const dir = path.join(RUNS_DIR, owner, runId);
  await mkdir(dir, { recursive: true }).catch(() => {});

  const byIdx = new Map<number, ExtStepReport>();
  for (const s of args.steps) if (typeof s.idx === "number") byIdx.set(s.idx, s);

  // Record steps in plan order (only those the extension actually reached).
  for (const planStep of skill.plan) {
    const rep = byIdx.get(planStep.idx);
    if (!rep) continue;
    const sensitive = secretStepIdx.has(planStep.idx);

    let shotRel = "";
    if (!sensitive && typeof rep.screenshot === "string") {
      const dec = decodeDataUrl(rep.screenshot);
      if (dec && dec.buf.length <= 2_000_000) {
        const file = `step-${String(planStep.idx).padStart(4, "0")}.${dec.ext}`;
        try {
          await writeFile(path.join(dir, file), dec.buf);
          shotRel = path.posix.join("recordings", owner, runId, file);
        } catch (e) {
          logError("ext.screenshot", e);
        }
      }
    }

    await addRunStep({
      id: id("rst"),
      runId,
      idx: planStep.idx,
      intent: planStep.intent,
      action: planStep.action,
      selectorUsed: sensitive ? "" : String(rep.selectorUsed ?? "").slice(0, 400),
      value: sensitive ? "" : String(rep.value ?? "").slice(0, 2000),
      screenshot: shotRel,
      confidence: clamp01(rep.confidence),
      flagged: !!rep.flagged,
      note: String(rep.note ?? "").slice(0, 300),
      createdAt: Date.now(),
    });
  }

  const result =
    args.status === "completed" ? `Completed ${skill.plan.length} steps.` : null;
  await finishRun(runId, { status: args.status, result, error: args.error ?? null });

  // Best-effort tail — a failure here must never throw out (the status above is
  // the source of truth), mirroring the cloud runner.
  try {
    if (args.outputs && Object.keys(args.outputs).length > 0) {
      await setRunOutput(runId, args.outputs);
    }
    await setRunUsage(runId, args.tokensIn ?? 0, args.tokensOut ?? 0);
    const r = await getRun(runId);
    if (r) {
      const c = buildCommitment(commitmentFields(r));
      await setRunCommitment(runId, c.root, c.salts);
    }
    await attachReceipt(runId);
  } catch (e) {
    logError("ext.finalize", e);
  }

  const final = (await getRun(runId)) as Run;
  await finalizeRunAccounting(runId, skill, owner, final);
  return final;
}
