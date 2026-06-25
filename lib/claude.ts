import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

/**
 * Shared Anthropic client + the two model roles Mimic uses.
 *
 * Mimic splits work across two model tiers on purpose:
 *  - GENERALIZER turns a raw demonstration into a reusable, parameterized
 *    skill. This is the hardest reasoning step (intent inference), so it gets
 *    the strongest model.
 *  - OPERATOR makes per-step decisions during a run (look at the page, decide
 *    the next action, judge confidence). It runs many times per task and uses
 *    vision, so it uses a fast, capable, cheaper model.
 *
 * Model IDs are centralized here — adjust in one place.
 */
export const MODELS = {
  /** Demonstration → generalized skill. Deepest reasoning. */
  generalizer: "claude-opus-4-8",
  /** Per-step page understanding + action selection during a run. */
  operator: "claude-sonnet-4-6",
} as const;

declare global {
  var __mimicAnthropic: Anthropic | undefined;
}

/**
 * Lazily construct the client. Done on first use (not at import) so that
 * importing a route doesn't require ANTHROPIC_API_KEY — only actually calling
 * Claude does. Cached on globalThis to survive HMR.
 */
export function getClaude(): Anthropic {
  return (globalThis.__mimicAnthropic ??= new Anthropic({
    apiKey: env.anthropicApiKey,
  }));
}

/** A screenshot turned into an Anthropic image content block. */
export function imageBlock(
  base64: string,
  mediaType: "image/png" | "image/jpeg" = "image/png",
): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: base64 },
  };
}
