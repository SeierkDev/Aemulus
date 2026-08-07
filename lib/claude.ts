import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

/**
 * Shared Anthropic client + the two model roles Aemulus uses.
 *
 * Aemulus splits work across two model tiers on purpose:
 *  - GENERALIZER turns a raw demonstration into a reusable, parameterized
 *    skill. This is the hardest reasoning step (intent inference), so it gets
 *    the strongest model.
 *  - OPERATOR makes per-step decisions during a run (look at the page, decide
 *    the next action, judge confidence). It runs many times per task and uses
 *    vision, so it uses a fast, capable, cheaper model.
 *
 * Model IDs are centralized here - adjust in one place.
 */
export const MODELS = {
  /** Demonstration → generalized skill. Deepest reasoning. */
  generalizer: "claude-opus-4-8",
  /** Per-step page understanding + action selection during a run. */
  operator: "claude-sonnet-4-6",
} as const;

declare global {
  var __aemAnthropic: Anthropic | undefined;
}

/**
 * Lazily construct the client. Done on first use (not at import) so that
 * importing a route doesn't require ANTHROPIC_API_KEY - only actually calling
 * Claude does. Cached on globalThis to survive HMR.
 */
export function getClaude(): Anthropic {
  return (globalThis.__aemAnthropic ??= new Anthropic({
    apiKey: env.anthropicApiKey,
  }));
}

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/**
 * What the bytes actually are, read from their magic number.
 *
 * The API rejects a mismatch outright — "specified using the image/png media
 * type, but the image appears to be a image/jpeg image", 400, the whole call
 * lost. Declaring a type nobody checked is the bug: a screenshot's format
 * depends on who took it (Playwright's default is PNG, chrome.tabs
 * .captureVisibleTab returns JPEG, a CDP screencast frame is JPEG, and an
 * uploaded document is whatever the user had), and every one of those paths
 * ends up here.
 */
export function sniffImageType(base64: string): ImageMediaType | null {
  // 12 bytes is enough for every signature below; 16 base64 chars covers it.
  const head = Buffer.from(base64.slice(0, 24), "base64");
  if (head.length < 4) return null;
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return "image/png";
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif";
  if (
    head.length >= 12 &&
    head.toString("ascii", 0, 4) === "RIFF" &&
    head.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * A screenshot turned into an Anthropic image content block.
 *
 * The declared type comes from the bytes. `mediaType` is only a fallback for
 * when the signature is unrecognizable — a caller that believes it knows the
 * format can still be wrong, and the bytes cannot.
 */
export function imageBlock(
  base64: string,
  mediaType: ImageMediaType = "image/png",
): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: sniffImageType(base64) ?? mediaType,
      data: base64,
    },
  };
}
