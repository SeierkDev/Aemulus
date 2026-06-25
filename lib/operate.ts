import type Anthropic from "@anthropic-ai/sdk";
import { getClaude, imageBlock, MODELS } from "./claude";

/**
 * Operator fallback. When a recorded selector no longer resolves on the live
 * page, the operator (Claude Sonnet, with vision) looks at the screenshot and
 * the page's interactive elements and picks the element that fulfills the
 * step's intent — reporting a confidence so the runner can decide whether to
 * proceed or flag for a human (calibrated autonomy).
 */

export interface Candidate {
  selector: string;
  tag: string;
  text: string;
  name: string;
}

export interface OperatorDecision {
  selector: string; // "" when the operator can't find a suitable element
  confidence: number; // 0..1
  reasoning: string;
}

const DECISION_TOOL: Anthropic.Tool = {
  name: "choose_element",
  strict: true,
  description:
    "Choose the element that fulfills the step, or report none with low confidence.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["selector", "confidence", "reasoning"],
    properties: {
      selector: {
        type: "string",
        description:
          "The exact selector (from the candidate list) to act on, or \"\" if none fits.",
      },
      confidence: {
        type: "number",
        description: "0..1 — how sure you are this is the right element.",
      },
      reasoning: { type: "string", description: "One short sentence." },
    },
  },
};

export async function operatorChooseSelector(args: {
  intent: string;
  action: string;
  value: string;
  candidates: Candidate[];
  screenshotBase64: string;
}): Promise<OperatorDecision> {
  const list = args.candidates
    .map(
      (c, i) =>
        `${i}. selector=${c.selector}  <${c.tag}> name="${c.name}" text="${c.text}"`,
    )
    .join("\n");

  const prompt = `Step intent: ${args.intent}
Action: ${args.action}${args.value ? `  value="${args.value}"` : ""}

The originally recorded selector no longer matches. Pick the element from the candidates below that best fulfills the step's intent. Return its exact selector, or "" if none fits. Be honest with confidence — low if you're guessing.

Candidates:
${list}`;

  const res = await getClaude().messages.create({
    model: MODELS.operator,
    max_tokens: 1024,
    tools: [DECISION_TOOL],
    tool_choice: { type: "tool", name: "choose_element" },
    messages: [
      {
        role: "user",
        content: [imageBlock(args.screenshotBase64), { type: "text", text: prompt }],
      },
    ],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    return { selector: "", confidence: 0, reasoning: "no decision" };
  }
  const out = block.input as Partial<OperatorDecision>;
  return {
    selector: typeof out.selector === "string" ? out.selector : "",
    confidence: typeof out.confidence === "number" ? out.confidence : 0,
    reasoning: typeof out.reasoning === "string" ? out.reasoning : "",
  };
}
