import { z } from "zod";
import { NextResponse } from "next/server";

/**
 * Request-body validation at the API edge. Every mutating route parses its
 * body through one of these schemas so malformed/oversized input is rejected
 * with a 400 before it reaches business logic.
 */

const ACTIONS = ["navigate", "click", "input", "select", "key", "submit"] as const;

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
});
const InputFieldSchema = z.object({
  key: z.string().max(200),
  label: z.string().max(200),
  example: z.string().max(5000),
});

export const SkillUpdateBody = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  plan: z.array(SkillStepSchema).max(200).optional(),
  inputSchema: z
    .object({ fields: z.array(InputFieldSchema).max(50) })
    .optional(),
});

export const PublishBody = z.object({ published: z.boolean() });

export const RunBody = z.object({
  skillId: z.string().min(1).max(64),
  input: z.record(z.string().max(200), z.string().max(5000)).optional(),
});

export const ResolveBody = z.object({
  stepIdx: z.number().int().min(0),
  selector: z.string().max(2000).optional(),
  skip: z.boolean().optional(),
});

export const ScheduleCreateBody = z.object({
  skillId: z.string().min(1).max(64),
  cadence: z.enum(["hourly", "daily"]),
  input: z.record(z.string().max(200), z.string().max(5000)).optional(),
});

export const ScheduleToggleBody = z.object({ active: z.boolean() });

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
