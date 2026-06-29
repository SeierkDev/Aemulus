import type Anthropic from "@anthropic-ai/sdk";
import { getClaude, imageBlock, MODELS } from "./claude";
import { logError } from "./log";

/**
 * Vision success-verification. After a run executes every step, the model looks
 * at the FINAL screenshot and the skill's goal and judges whether the task was
 * actually accomplished - not just "all steps ran". Best-effort: returns null if
 * the model/API key is unavailable (the run is unaffected, outcome just stays
 * unchecked).
 */
export interface OutcomeVerdict {
  achieved: boolean;
  confidence: number;
  reason: string;
  tokensIn: number;
  tokensOut: number;
}

const VERIFY_TOOL: Anthropic.Tool = {
  name: "report_outcome",
  strict: true,
  description: "Report whether the screenshot shows the goal was accomplished.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["achieved", "confidence", "reason"],
    properties: {
      achieved: {
        type: "boolean",
        description: "true only if the final screen clearly shows the goal was met.",
      },
      confidence: { type: "number", description: "0..1 - how sure you are." },
      reason: { type: "string", description: "One short sentence of evidence." },
    },
  },
};

export async function verifyOutcome(
  goal: string,
  screenshotBase64: string,
): Promise<OutcomeVerdict | null> {
  try {
    const res = await getClaude().messages.create({
      model: MODELS.operator,
      max_tokens: 512,
      tools: [VERIFY_TOOL],
      tool_choice: { type: "tool", name: "report_outcome" },
      messages: [
        {
          role: "user",
          content: [
            imageBlock(screenshotBase64),
            {
              type: "text",
              text: `This is the final screen after an automation tried to: ${goal}\n\nDid it succeed? Judge only from what's visible. Be strict - if there's an error, a blocked state, or no clear sign of success, say achieved=false.`,
            },
          ],
        },
      ],
    });
    const tokensIn = res.usage?.input_tokens ?? 0;
    const tokensOut = res.usage?.output_tokens ?? 0;
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return null;
    const out = block.input as Partial<OutcomeVerdict>;
    return {
      achieved: out.achieved === true,
      confidence: typeof out.confidence === "number" ? out.confidence : 0,
      reason: typeof out.reason === "string" ? out.reason : "",
      tokensIn,
      tokensOut,
    };
  } catch (e) {
    // No API key / model error - skip verification, leave the outcome unchecked.
    logError("verifyOutcome", e);
    return null;
  }
}
