import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { getClaude, imageBlock, MODELS } from "./claude";
import { collectCandidates } from "./dom";
import { logError } from "./log";
import type { SkillStep } from "./types";

/**
 * Agentic fallback (opt-in via AEMULUS_AGENT_FALLBACK=1). When a recorded
 * selector fails AND the single-shot operator can't confidently pick one, this
 * runs a bounded "computer-use" loop: the model sees the page and the step's
 * intent and issues small actions (click / type / press / scroll) until it
 * believes the step is done, or gives up. Every action goes through the same
 * locator + the run's egress guard; iterations are hard-capped. If it succeeds
 * the runner skips its own action (the agent already performed it).
 *
 * Default OFF: executing model-chosen actions is the most autonomous (and
 * riskiest) path, so an operator opts in. Without it, a stuck step just pauses
 * for a human (needs_review), exactly as before.
 */
const MAX_STEPS = Math.max(1, Number(process.env.AEMULUS_AGENT_MAX_STEPS) || 5);

export function agentFallbackEnabled(): boolean {
  return process.env.AEMULUS_AGENT_FALLBACK === "1";
}

export interface AgentResult {
  ok: boolean;
  selectorUsed: string;
  confidence: number;
  note: string;
  tokensIn: number;
  tokensOut: number;
}

type AgentAction = {
  action: "click" | "type" | "press" | "scroll" | "done" | "give_up";
  selector?: string;
  value?: string;
  key?: string;
  reasoning?: string;
  confidence?: number;
};

const ACT_TOOL: Anthropic.Tool = {
  name: "act",
  strict: true,
  description: "Choose the next action toward completing the step, or done/give_up.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["action", "selector", "value", "key", "reasoning", "confidence"],
    properties: {
      action: {
        type: "string",
        enum: ["click", "type", "press", "scroll", "done", "give_up"],
      },
      selector: { type: "string", description: "CSS selector for click/type/press, else \"\"." },
      value: { type: "string", description: "Text to type, else \"\"." },
      key: { type: "string", description: "Key for press (e.g. Enter), else \"\"." },
      reasoning: { type: "string", description: "One short sentence." },
      confidence: { type: "number", description: "0..1 the step is on track / done." },
    },
  },
};

async function decide(
  page: Page,
  step: SkillStep,
  value: string,
  history: string[],
): Promise<{ act: AgentAction | null; tokensIn: number; tokensOut: number }> {
  const candidates = await collectCandidates(page);
  const shot = await page.screenshot({ type: "png" });
  const list = candidates
    .map((c, i) => `${i}. ${c.selector}  <${c.tag}> "${c.name || c.text}"`)
    .join("\n");
  const prompt = `Goal for this step: ${step.intent}${value ? ` (value to enter: "${value}")` : ""}

You are driving a browser to accomplish ONLY this step. Look at the screenshot and the elements below, then choose ONE next action. Use "done" when the step is accomplished, "give_up" if it's not possible. Prefer selectors from the list.
${history.length ? `\nSo far you did:\n${history.join("\n")}` : ""}

Elements:
${list}`;

  const res = await getClaude().messages.create({
    model: MODELS.operator,
    max_tokens: 512,
    tools: [ACT_TOOL],
    tool_choice: { type: "tool", name: "act" },
    messages: [
      { role: "user", content: [imageBlock(shot.toString("base64")), { type: "text", text: prompt }] },
    ],
  });
  const tokensIn = res.usage?.input_tokens ?? 0;
  const tokensOut = res.usage?.output_tokens ?? 0;
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return { act: null, tokensIn, tokensOut };
  return { act: block.input as AgentAction, tokensIn, tokensOut };
}

export async function agenticStep(
  page: Page,
  step: SkillStep,
  value: string,
): Promise<AgentResult> {
  const result: AgentResult = {
    ok: false,
    selectorUsed: "",
    confidence: 0,
    note: "",
    tokensIn: 0,
    tokensOut: 0,
  };
  const history: string[] = [];
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const { act, tokensIn, tokensOut } = await decide(page, step, value, history);
      result.tokensIn += tokensIn;
      result.tokensOut += tokensOut;
      if (!act) break;
      result.confidence = typeof act.confidence === "number" ? act.confidence : 0;

      if (act.action === "done") {
        result.ok = true;
        result.note = `Agent completed the step in ${i + 1} action(s): ${act.reasoning ?? ""}`.trim();
        return result;
      }
      if (act.action === "give_up") {
        result.note = `Agent gave up: ${act.reasoning ?? ""}`.trim();
        return result;
      }

      try {
        if (act.action === "scroll") {
          await page.mouse.wheel(0, 600);
        } else {
          const sel = act.selector ?? "";
          const loc = sel ? page.locator(sel).first() : null;
          if (!loc || (await loc.count()) === 0) {
            history.push(`#${i + 1} ${act.action} ${sel} -> not found`);
            continue;
          }
          if (act.action === "click") await loc.click();
          else if (act.action === "type") await loc.fill(act.value ?? value);
          else if (act.action === "press") await loc.press(act.key || "Enter");
          result.selectorUsed = sel;
        }
        await page.waitForTimeout(200);
        history.push(`#${i + 1} ${act.action} ${act.selector ?? ""}`);
      } catch (e) {
        history.push(`#${i + 1} ${act.action} -> error`);
        logError("agent.action", e);
      }
    }
    result.note = result.note || `Agent did not finish within ${MAX_STEPS} actions.`;
    return result;
  } catch (e) {
    // No API key / model error -> behave as "agent unavailable".
    logError("agent.step", e);
    result.note = "Agent unavailable.";
    return result;
  }
}
