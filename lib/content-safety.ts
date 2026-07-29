import { getClaude } from "./claude";
import { logError } from "./log";

/**
 * Content safety for user-supplied text (run inputs, skill names/descriptions).
 * Blocks hate speech and illegal content while ALLOWING ordinary profanity —
 * "fuck" is fine, slurs and illegal material are not.
 *
 * Two layers:
 *  1. A free, instant blocklist of the most severe UNAMBIGUOUS terms (slurs +
 *     illegal-abuse markers). Whole-word + obfuscation-tolerant so innocent
 *     substrings (e.g. "Scunthorpe") don't trip it and ordinary profanity is
 *     untouched.
 *  2. An optional Claude judge (AEMULUS_AI_MODERATION=1) that catches contextual
 *     / obfuscated cases the wordlist can't — still allowing profanity.
 */

export interface SafetyResult {
  allowed: boolean;
  reason?: string;
}

const ALLOWED: SafetyResult = { allowed: true };

// Core severe terms. Deliberately small and unambiguous; the AI layer does the
// nuanced work. Patterns also catch simple leet obfuscation.
const SEVERE = [
  "n[i1]gger",
  "n[i1]gga",
  "chink",
  "kike",
  "spic\\b",
  "faggot",
  "\\btr[a4]nny\\b",
  // illegal sexual-abuse material
  "child\\s*por(n|no)",
  "cp\\s*(gore|porn)",
  "pedophile\\s*(porn|content)",
];
const SEVERE_RE = new RegExp(SEVERE.join("|"), "i");

/** Fold trivial obfuscation (separators, repeats) so "n i g g e r" or
 * "niiigger" still match. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s._\-*]+/g, "")
    .replace(/(.)\1{2,}/g, "$1$1");
}

export function blocklistHit(text: string): boolean {
  if (!text) return false;
  return SEVERE_RE.test(text) || SEVERE_RE.test(normalize(text));
}

function aiEnabled(): boolean {
  return process.env.AEMULUS_AI_MODERATION === "1";
}

/** Ask Claude whether the text is hate speech or illegal. Returns null on any
 * error so a moderation outage can't hard-block the product (the blocklist still
 * guards the worst). */
async function aiModerate(text: string): Promise<SafetyResult | null> {
  try {
    const res = await getClaude().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 16,
      system:
        "You are a content-safety filter for a browser-automation product. Decide if the USER text should be BLOCKED. BLOCK only: hate speech / slurs targeting a protected group, or requests to carry out clearly illegal acts (child sexual content, terrorism, weapons or drug manufacturing, real-world violence against a person). ALLOW ordinary profanity (fuck, shit), adult topics, criticism, and normal business/automation tasks. Reply with exactly one word: ALLOW or BLOCK.",
      messages: [{ role: "user", content: text.slice(0, 2000) }],
    });
    const out = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .toUpperCase();
    return out.includes("BLOCK")
      ? { allowed: false, reason: "This content isn't allowed." }
      : ALLOWED;
  } catch (e) {
    logError("safety.ai", e);
    return null; // fail open — the blocklist already caught the worst
  }
}

/** Moderate a single piece of text. */
export async function checkText(text: string): Promise<SafetyResult> {
  if (!text || !text.trim()) return ALLOWED;
  if (blocklistHit(text)) {
    return { allowed: false, reason: "This content isn't allowed (hate or illegal content)." };
  }
  if (aiEnabled()) {
    const ai = await aiModerate(text);
    if (ai) return ai;
  }
  return ALLOWED;
}

/** Moderate the values of a run's input map (search queries, field values). */
export async function checkValues(
  values: Record<string, string>,
): Promise<SafetyResult> {
  const joined = Object.values(values ?? {})
    .filter((v) => typeof v === "string")
    .join("\n")
    .trim();
  return checkText(joined);
}
