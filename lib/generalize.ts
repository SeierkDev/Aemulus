import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getClaude, MODELS } from "./claude";
import type { Demonstration, GeneralizedSkill } from "./types";

/**
 * Turn a recorded demonstration into a generalized, parameterized skill.
 *
 * Claude (the generalizer / Opus) reads the trace and decides which typed
 * values are task-specific *inputs* (vary per run) versus *constants* (fixed
 * UI navigation), then emits a step plan + an input schema. We force the
 * output through a strict tool so the shape is guaranteed, then validate.
 */

export const EMIT_SKILL_TOOL: Anthropic.Tool = {
  name: "emit_skill",
  description: "Emit the generalized skill derived from the demonstration.",
  // strict tool use → input is guaranteed to match this schema
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "description", "inputFields", "steps"],
    properties: {
      name: { type: "string", description: "Short skill name." },
      description: {
        type: "string",
        description: "One sentence describing what the skill does.",
      },
      inputFields: {
        type: "array",
        description:
          "The values that vary between runs. Empty if the task has no variable inputs.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "label", "example"],
          properties: {
            key: { type: "string", description: "snake_case machine key." },
            label: { type: "string", description: "Human-readable label." },
            example: {
              type: "string",
              description: "The value from the demonstration.",
            },
          },
        },
      },
      steps: {
        type: "array",
        description: "The generalized, ordered steps to replay.",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "intent",
            "action",
            "selectors",
            "target",
            "valueSource",
            "value",
            "inputKey",
            "key",
          ],
          properties: {
            intent: {
              type: "string",
              description: "What this step accomplishes, in plain language.",
            },
            action: {
              type: "string",
              enum: ["navigate", "click", "input", "select", "key", "submit"],
            },
            selectors: {
              type: "array",
              items: { type: "string" },
              description: "Candidate selectors, best-first, from the trace.",
            },
            target: {
              type: "string",
              description: "Human label of the element (or URL for navigate).",
            },
            valueSource: {
              type: "string",
              enum: ["input", "constant", "none"],
              description:
                "input = bound to an inputField; constant = fixed value; none = no value.",
            },
            value: {
              type: "string",
              description: "Constant value, or \"\" when not a constant.",
            },
            inputKey: {
              type: "string",
              description:
                "Key of the bound inputField, or \"\" when not an input.",
            },
            key: {
              type: "string",
              description: "Key name for key actions (Enter/Tab), else \"\".",
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You convert a single recorded browser demonstration into a reusable, generalized skill.

The demonstration is one example of a repetitive task (e.g. entering data into a form). Your job:
1. Identify which typed/selected VALUES are task-specific data that will change every run (these become inputFields), versus values that are fixed parts of the workflow (constants).
   - Personal/record data the user typed (names, emails, amounts, IDs) → almost always inputFields.
   - Fixed dropdown choices, canned text, or UI toggles that would be identical every run → constants.
2. Produce an ordered step plan that reproduces the task. Preserve the trace's selectors (best-first). Keep navigation, clicks, key presses, and submits as steps with valueSource "none".
3. For each value-bearing step (input/select), set valueSource to "input" and inputKey to the matching field key, OR "constant" with the literal value.
   - Any step whose value is shown as <secret> (a password or sensitive field) MUST be an inputField with valueSource "input" — NEVER a constant. Its example must be "".

Be conservative and faithful to the trace. Use clear snake_case keys. Always call emit_skill exactly once.`;

/** Compact the raw trace into the lines we feed the model. */
export function traceForPrompt(demo: Demonstration): string {
  const lines = demo.trace.map((a) => {
    const parts: string[] = [`#${a.idx} ${a.type}`];
    if (a.name) parts.push(`target="${a.name}"`);
    else if (a.text) parts.push(`text="${a.text}"`);
    if (a.sensitive) parts.push(`value=<secret>`);
    else if (a.value != null && a.value !== "") parts.push(`value="${a.value}"`);
    if (a.key) parts.push(`key=${a.key}`);
    if (a.selectors?.length) parts.push(`selector=${a.selectors[0]}`);
    if (a.type === "navigate") parts.push(`url=${a.url}`);
    return parts.join("  ");
  });
  return lines.join("\n");
}

const InputFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  example: z.string(),
});

const StepSchema = z.object({
  intent: z.string(),
  action: z.enum(["navigate", "click", "input", "select", "key", "submit"]),
  selectors: z.array(z.string()),
  target: z.string(),
  valueSource: z.enum(["input", "constant", "none"]),
  value: z.string(),
  inputKey: z.string(),
  key: z.string(),
});

export const GeneralizedSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputFields: z.array(InputFieldSchema),
  steps: z.array(StepSchema),
});

export async function generalizeDemonstration(
  demo: Demonstration,
): Promise<GeneralizedSkill> {
  const user = `Task title: ${demo.title}
Start URL: ${demo.startUrl ?? "(none)"}

Recorded trace (${demo.trace.length} steps):
${traceForPrompt(demo)}`;

  const res = await getClaude().messages.create({
    model: MODELS.generalizer,
    max_tokens: 8000,
    system: SYSTEM,
    tools: [EMIT_SKILL_TOOL],
    tool_choice: { type: "tool", name: "emit_skill" },
    messages: [{ role: "user", content: user }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Generalizer did not return a skill.");
  }
  return GeneralizedSchema.parse(block.input) as GeneralizedSkill;
}
