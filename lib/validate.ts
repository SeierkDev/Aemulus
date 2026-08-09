import { z } from "zod";
import { WATCH_OPS, WAIT_OPS, MAX_WAIT_MS } from "./watches";
import { NextResponse } from "next/server";

/**
 * Request-body validation at the API edge. Every mutating route parses its
 * body through one of these schemas so malformed/oversized input is rejected
 * with a 400 before it reaches business logic.
 */

const ACTIONS = ["navigate", "click", "input", "select", "key", "submit", "extract", "run_skill", "wait_for"] as const;

// A skill's input map. Bounds key/value length AND the number of fields, so a
// single request can't store an arbitrarily large object (memory/DB pressure).
const MAX_INPUT_FIELDS = 200;
const inputRecord = z
  .record(z.string().max(200), z.string().max(5000))
  .refine((r) => Object.keys(r).length <= MAX_INPUT_FIELDS, {
    message: `at most ${MAX_INPUT_FIELDS} fields`,
  });

export const VerifyBody = z.object({
  pubkey: z.string().min(32).max(64),
  signature: z.string().min(1).max(200),
});

export const RecordStartBody = z.object({
  title: z.string().max(200).optional(),
  startUrl: z.string().min(1).max(4000),
});

const InputEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("move"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("scroll"), dy: z.number() }),
  z.object({ type: z.literal("text"), text: z.string().max(2000) }),
  z.object({ type: z.literal("key"), key: z.string().max(40) }),
]);

export const RecordInputBody = z.object({
  event: InputEventSchema.optional(),
  events: z.array(InputEventSchema).max(50).optional(),
});

export const GeneralizeBody = z.object({
  demonstrationId: z.string().min(1).max(64),
});

export const SynthesizeBody = z.object({
  demonstrationIds: z.array(z.string().min(1).max(64)).min(2).max(10),
});

export const BulkBody = z.object({
  rows: z
    .array(inputRecord)
    .min(1)
    .max(1000),
});

const SkillStepSchema = z.object({
  idx: z.number().int(),
  intent: z.string().max(2000),
  action: z.enum(ACTIONS),
  selectors: z.array(z.string().max(2000)).max(50),
  target: z.string().max(4000),
  valueSource: z.enum(["input", "constant", "none"]),
  value: z.string().max(5000),
  inputKey: z.string().max(200),
  key: z.string().max(40),
  outputKey: z.string().max(200).optional(),
  // The rule the capture was recorded with. Absent from this schema, zod's
  // default strip silently DELETED it on every skill save — record a rule, edit
  // anything about the skill, and the answer given while looking at the value
  // was gone with nothing said. The op list mirrors the evaluator's, so a plan
  // cannot smuggle in one nothing handles.
  watchOp: z.enum(WATCH_OPS).optional(),
  watchValue: z.string().max(2000).optional(),
  // A wait, for a page that is not ready yet. Bounded here rather than trusted:
  // the step holds a browser and a run slot for its whole duration, so an
  // unbounded one is a way to hold the pool open.
  waitOp: z.enum(WAIT_OPS).optional(),
  waitValue: z.string().max(2000).optional(),
  waitMs: z.number().int().min(1000).max(MAX_WAIT_MS).optional(),
  waitOnTimeout: z.enum(["fail", "continue"]).optional(),
  loop: z.boolean().optional(),
  subSkillId: z.string().max(200).optional(),
  interactive: z.boolean().optional(),
  condition: z
    .object({
      kind: z.enum(["exists", "absent"]),
      selector: z.string().max(2000),
    })
    .optional(),
})
  // A wait with nothing to look at can never be satisfied: it holds a browser
  // for its whole timeout and then reports that the page never got there, every
  // run, forever. Refused where it is set, like an unsatisfiable watch rule.
  .refine((s) => s.action !== "wait_for" || s.selectors.length > 0, {
    message: "A wait needs a selector — something on the page to wait for.",
    path: ["selectors"],
  });
const InputFieldSchema = z.object({
  key: z.string().max(200),
  label: z.string().max(200),
  example: z.string().max(5000),
  secret: z.boolean().optional(),
});

export const SkillUpdateBody = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  plan: z.array(SkillStepSchema).max(200).optional(),
  inputSchema: z
    .object({ fields: z.array(InputFieldSchema).max(50) })
    .optional(),
  allowedHosts: z.array(z.string().max(255)).max(50).optional(),
});

export const PublishBody = z.object({ published: z.boolean() });

export const ReportBody = z.object({ reason: z.string().max(500).optional() });

// Curated collections + spotlights. Lengths mirror the caps in lib/collections.ts
// so a body that would be silently truncated there is rejected here instead.
export const CollectionCreateBody = z.object({
  slug: z.string().min(1).max(60),
  title: z.string().min(1).max(60),
  blurb: z.string().max(200).optional(),
  position: z.number().int().min(-9999).max(9999).optional(),
});
export const CollectionUpdateBody = z.object({
  title: z.string().min(1).max(60).optional(),
  blurb: z.string().max(200).optional(),
  position: z.number().int().min(-9999).max(9999).optional(),
});
export const CollectionSkillBody = z.object({
  skillId: z.string().min(1).max(64),
  position: z.number().int().min(-9999).max(9999).optional(),
});
export const SpotlightBody = z.object({
  skillId: z.string().min(1).max(64),
  blurb: z.string().max(200).optional(),
  position: z.number().int().min(-9999).max(9999).optional(),
});

export const OrgCreateBody = z.object({ name: z.string().min(1).max(80) });
export const OrgMemberBody = z.object({
  wallet: z.string().min(32).max(64),
  role: z.enum(["admin", "member"]).optional(),
});
export const OrgRemoveBody = z.object({ wallet: z.string().min(32).max(64) });

// Share a skill with a team (or null to unshare). orgId is bounded.
export const ShareBody = z.object({
  orgId: z.string().max(64).nullable().optional(),
});

// Live-takeover input event (subset of the recorder's events the runner injects).
export const LiveInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("scroll"), dy: z.number() }),
  z.object({ type: z.literal("text"), text: z.string().max(2000) }),
  z.object({ type: z.literal("key"), key: z.string().max(40) }),
]);

export const VaultBody = z.object({
  host: z.string().min(1).max(255),
  key: z.string().min(1).max(200),
  value: z.string().max(5000),
});

export const RestoreBody = z.object({ version: z.number().int().positive() });

export const ApiKeyBody = z.object({
  name: z.string().max(80).optional(),
  scopes: z.array(z.enum(["read", "run"])).max(2).optional(),
});

export const WebhookBody = z.object({
  url: z.string().url().max(2000),
  events: z
    .array(z.enum(["run.completed", "run.needs_review", "run.failed", "run.output"]))
    .max(4)
    .optional(),
});

export const RunBody = z.object({
  skillId: z.string().min(1).max(64),
  input: inputRecord.optional(),
});

export const ResolveBody = z.object({
  stepIdx: z.number().int().min(0),
  selector: z.string().max(2000).optional(),
  skip: z.boolean().optional(),
});

/**
 * A watch created through the API: the schedule and the rule that reads it, in
 * one body. Cadences include the sub-hourly ones — the schedule form predates
 * them and still offers hourly upward, but a watch is the thing those exist for.
 * Whether the caller's tier can sustain the one they picked is decided in the
 * route, against their balance, not here.
 */
/** What a watch does when it fires. Omitted or "alert" keeps the old behaviour. */
export const WatchActionBody = z.object({
  kind: z.enum(["alert", "run_skill"]),
  skillId: z.string().min(1).max(64).optional(),
  alsoAlert: z.boolean().optional(),
});

export const WatchCreateBody = z.object({
  action: WatchActionBody.optional(),
  skillId: z.string().min(1).max(64),
  cadence: z.enum([
    "every10m",
    "every15m",
    "every30m",
    "hourly",
    "every6h",
    "every12h",
    "daily",
    "weekdays",
    "weekly",
  ]),
  input: inputRecord.optional(),
  rule: z.object({
    key: z.string().min(1).max(120),
    op: z.enum(WATCH_OPS),
    value: z.string().max(2000).optional(),
    confirm: z.number().int().min(1).max(10).optional(),
    cooldownMs: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1000).optional(),
  }),
  notify: z
    .object({
      channel: z.literal("telegram"),
      chatId: z.string().min(1).max(64),
      redact: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

export const WatchRuleBody = z.object({
  key: z.string().min(1).max(120),
  op: z.enum(WATCH_OPS),
  value: z.string().max(2000).optional(),
});

export const ScheduleCreateBody = z.object({
  skillId: z.string().min(1).max(64),
  /** Turn this schedule into a watch: alert on this rule instead of just running. */
  rule: WatchRuleBody.optional(),
  action: WatchActionBody.optional(),
  cadence: z.enum([
    "hourly",
    "every6h",
    "every12h",
    "daily",
    "weekdays",
    "weekly",
  ]),
  input: inputRecord.optional(),
});

export const ScheduleToggleBody = z.object({ active: z.boolean() });

/** Disarm a watch's action without destroying the watch. */
export const ScheduleActionBody = z.object({ action: z.literal("alert") });

export const RateBody = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

/** Parse + validate a JSON request body; returns data or a 400 Response. */
export async function readJson<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid request body";
    return {
      ok: false,
      res: NextResponse.json({ error: msg }, { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data };
}
